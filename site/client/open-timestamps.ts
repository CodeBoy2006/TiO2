import type { PendingAttestation, Timestamp } from '@otskit/core'

const blockstreamApi = 'https://blockstream.info/api'
const requestTimeoutMs = 12_000
const maxProofBytes = 64 * 1024
const maxCalendarBytes = 10_000
const sha256Pattern = /^[a-f0-9]{64}$/u
const blockHeaderPattern = /^[a-f0-9]{160}$/u

type Fetcher = typeof fetch

interface PendingStamp {
    attestation: PendingAttestation
    timestamp: Timestamp
}

export type OpenTimestampVerification =
    | { status: 'pending' }
    | {
          status: 'verified'
          blockHeight: number
          blockTime: number
          blockUrl: string
      }

async function fetchResponse(fetcher: Fetcher, url: string, label: string, init?: RequestInit) {
    let response: Response

    try {
        response = await fetcher(url, {
            ...init,
            signal: AbortSignal.timeout(requestTimeoutMs)
        })
    } catch {
        throw new Error(`${label} could not be reached.`)
    }

    if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}.`)
    }

    return response
}

async function readBytes(response: Response, maxBytes: number, label: string) {
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`${label} is too large.`)
    }

    if (!response.body) return new Uint8Array()

    const chunks: Uint8Array[] = []
    const reader = response.body.getReader()
    let byteLength = 0

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        byteLength += value.byteLength
        if (byteLength > maxBytes) {
            await reader.cancel()
            throw new Error(`${label} is too large.`)
        }
        chunks.push(value)
    }

    const bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }

    return bytes
}

async function readText(response: Response, maxBytes: number, label: string) {
    return new TextDecoder().decode(await readBytes(response, maxBytes, label))
}

function collectPendingStamps(timestamp: Timestamp, result: PendingStamp[] = [], seen = new Set<Timestamp>()) {
    if (seen.has(timestamp)) return result
    seen.add(timestamp)

    for (const attestation of timestamp.attestations) {
        if (attestation.kind === 'pending') result.push({ attestation, timestamp })
    }

    for (const branch of timestamp.branches) collectPendingStamps(branch.stamp, result, seen)

    return result
}

async function upgradePendingTimestamp(timestamp: Timestamp, core: typeof import('@otskit/core'), fetcher: Fetcher) {
    const pendingStamps = collectPendingStamps(timestamp)
    if (!pendingStamps.length) {
        throw new Error('The proof has no Bitcoin or pending OpenTimestamps attestation.')
    }

    const outcomes = await Promise.allSettled(
        pendingStamps.map(async ({ attestation, timestamp: pendingTimestamp }) => {
            const calendarUrl = core.parseCalendarUri(attestation.uri)
            const commitment = core.bytesToHex(pendingTimestamp.msg)
            let response: Response

            try {
                response = await fetcher(new URL(`/timestamp/${commitment}`, calendarUrl), {
                    headers: { Accept: 'application/vnd.opentimestamps.v1' },
                    signal: AbortSignal.timeout(requestTimeoutMs)
                })
            } catch {
                throw new Error('OpenTimestamps calendar could not be reached.')
            }

            if (response.status === 404) return null
            if (!response.ok) throw new Error(`OpenTimestamps calendar returned HTTP ${response.status}.`)

            const bytes = await readBytes(response, maxCalendarBytes, 'OpenTimestamps calendar response')
            const context = new core.StreamDeserializationContext(bytes)
            const upgrade = core.Timestamp.deserialize(context, pendingTimestamp.msg)
            context.assertEof()

            return { pendingTimestamp, upgrade }
        })
    )

    let calendarResponded = false

    for (const outcome of outcomes) {
        if (outcome.status !== 'fulfilled') continue
        calendarResponded = true
        if (outcome.value) outcome.value.pendingTimestamp.merge(outcome.value.upgrade)
    }

    if (timestamp.hasBitcoinAttestation()) return true
    if (calendarResponded) return false

    throw new Error('OpenTimestamps calendars could not be reached. Try again later.')
}

async function verifyBitcoinAttestation(timestamp: Timestamp, core: typeof import('@otskit/core'), fetcher: Fetcher) {
    const attestations = timestamp
        .allAttestations()
        .filter(
            (entry): entry is { msg: Uint8Array; attestation: import('@otskit/core').BitcoinAttestation } =>
                entry.attestation.kind === 'bitcoin'
        )

    let lastError: unknown

    for (const { attestation, msg } of attestations) {
        try {
            const hashResponse = await fetchResponse(
                fetcher,
                `${blockstreamApi}/block-height/${attestation.height}`,
                'Bitcoin block lookup'
            )
            const blockHash = (await readText(hashResponse, 128, 'Bitcoin block hash')).trim().toLowerCase()
            if (!sha256Pattern.test(blockHash)) throw new Error('Bitcoin block lookup returned an invalid hash.')

            const headerResponse = await fetchResponse(
                fetcher,
                `${blockstreamApi}/block/${blockHash}/header`,
                'Bitcoin block header'
            )
            const rawHeaderHex = (await readText(headerResponse, 256, 'Bitcoin block header')).trim().toLowerCase()
            if (!blockHeaderPattern.test(rawHeaderHex)) throw new Error('Bitcoin block header is invalid.')

            const rawHeader = core.hexToBytes(rawHeaderHex)
            const sha256 = new core.OpSHA256()
            const calculatedBlockHash = core.bytesToHex(sha256.hashFile(sha256.hashFile(rawHeader)).reverse())
            if (calculatedBlockHash !== blockHash) throw new Error('Bitcoin block header hash does not match.')

            return {
                blockHeight: attestation.height,
                blockTime: core.verifyBitcoinAttestation(msg, attestation, rawHeader, attestation.height),
                blockUrl: `https://blockstream.info/block/${blockHash}`
            }
        } catch (error) {
            lastError = error
        }
    }

    throw lastError instanceof Error ? lastError : new Error('No Bitcoin attestation in this proof could be verified.')
}

export async function verifyOpenTimestamp(
    proofUrl: string,
    expectedSha256: string,
    fetcher: Fetcher = globalThis.fetch
): Promise<OpenTimestampVerification> {
    const normalizedSha256 = expectedSha256.toLowerCase()
    if (!sha256Pattern.test(normalizedSha256)) throw new Error('The published SHA-256 digest is invalid.')

    const core = await import('@otskit/core')
    const proofResponse = await fetchResponse(fetcher, proofUrl, 'OpenTimestamps proof')
    const proofBytes = await readBytes(proofResponse, maxProofBytes, 'OpenTimestamps proof')
    let proof: InstanceType<typeof core.DetachedTimestampFile>

    try {
        proof = core.DetachedTimestampFile.deserialize(proofBytes)
    } catch {
        throw new Error('The downloaded OpenTimestamps proof is invalid.')
    }

    const digestFile = new TextEncoder().encode(`${normalizedSha256}\n`)
    const expectedFileDigest = new core.OpSHA256().hashFile(digestFile)
    if (proof.fileHashOp.tagName !== 'sha256' || !core.bytesEqual(proof.fileDigest(), expectedFileDigest)) {
        throw new Error('The proof does not commit to the published SHA-256 digest.')
    }

    if (!proof.timestamp.hasBitcoinAttestation()) {
        const upgraded = await upgradePendingTimestamp(proof.timestamp, core, fetcher)
        if (!upgraded) return { status: 'pending' }
    }

    const verified = await verifyBitcoinAttestation(proof.timestamp, core, fetcher)
    return { status: 'verified', ...verified }
}
