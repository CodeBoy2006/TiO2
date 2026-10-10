import assert from 'node:assert/strict'
import test from 'node:test'
import {
    DetachedTimestampFile,
    OpSHA256,
    StreamSerializationContext,
    Timestamp,
    bytesToHex,
    makeBitcoin,
    makePending
} from '@otskit/core'
import { verifyOpenTimestamp } from '../../site/client/open-timestamps.js'

test('browser verifier upgrades a proof and checks its Bitcoin block header', async () => {
    const digest = 'a'.repeat(64)
    const digestFile = new TextEncoder().encode(`${digest}\n`)
    const proof = DetachedTimestampFile.fromBytes(new OpSHA256(), digestFile)
    proof.timestamp.addAttestation(makePending('https://alice.btc.calendar.opentimestamps.org'))

    const blockHeight = 950_000
    const blockTime = 1_781_006_200
    const calendarTimestamp = new Timestamp(proof.timestamp.msg)
    calendarTimestamp.addAttestation(makeBitcoin(blockHeight))
    const calendarContext = new StreamSerializationContext()
    calendarTimestamp.serialize(calendarContext)

    const rawHeader = new Uint8Array(80)
    rawHeader.set(proof.timestamp.msg, 36)
    new DataView(rawHeader.buffer).setUint32(68, blockTime, true)
    const sha256 = new OpSHA256()
    const blockHash = bytesToHex(sha256.hashFile(sha256.hashFile(rawHeader)).reverse())

    const fetcher = (async (input: RequestInfo | URL) => {
        const url = String(input)

        if (url === '/proof.ots') return new Response(proof.serializeToBytes())
        if (url.includes('/timestamp/')) return new Response(calendarContext.getOutput())
        if (url.endsWith(`/block-height/${blockHeight}`)) return new Response(blockHash)
        if (url.endsWith(`/block/${blockHash}/header`)) return new Response(bytesToHex(rawHeader))

        return new Response(null, { status: 404 })
    }) as typeof fetch

    const result = await verifyOpenTimestamp('/proof.ots', digest, fetcher)

    assert.deepEqual(result, {
        status: 'verified',
        blockHeight,
        blockTime,
        blockUrl: `https://blockstream.info/block/${blockHash}`
    })
    await assert.rejects(
        verifyOpenTimestamp('/proof.ots', 'b'.repeat(64), fetcher),
        /does not commit to the published SHA-256 digest/u
    )
})
