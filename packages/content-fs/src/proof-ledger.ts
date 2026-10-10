import crypto from 'node:crypto'
import path from 'node:path'
import { DetachedTimestampFile, bytesToHex } from '@otskit/core'
import fs from 'fs-extra'
import type {
    ProofLedgerCollection,
    ProofLedgerGroupNode,
    ProofLedgerNode,
    ProofLedgerProofNode
} from '../../content-core/src/index'

export type {
    ProofLedgerCollection,
    ProofLedgerGroupNode,
    ProofLedgerNode,
    ProofLedgerProofNode
} from '../../content-core/src/index'

const canonicalSha256Pattern = /^([a-f0-9]{64})\n$/u
const codenameAdjectives = [
    'Amber',
    'Brisk',
    'Clear',
    'Dawn',
    'Ember',
    'Frost',
    'Harbor',
    'Ivory',
    'Jade',
    'Lunar',
    'North',
    'Quiet',
    'Silver',
    'True',
    'Vivid',
    'Winter'
]
const codenameNouns = [
    'Anchor',
    'Atlas',
    'Beacon',
    'Cipher',
    'Foundry',
    'Keystone',
    'Lantern',
    'Matrix',
    'Meridian',
    'Nimbus',
    'Signal',
    'Summit',
    'Vector',
    'Vault',
    'Vertex',
    'Waypoint'
]

interface ProofCandidate {
    timestamp: string
    status: string
    sha256: string
    sourceShaPath: string
    sourceOtsPath: string
    proofFileName: string
}

function toPosixPath(value: string) {
    return value.split(path.sep).join('/')
}

function stableHash(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function selectByHash<T>(hash: string, values: T[], offset: number) {
    const byte = Number.parseInt(hash.slice(offset, offset + 2), 16)
    return values[byte % values.length]
}

function slugify(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

function formatGroupTitle(name: string) {
    return name
        .split(/[-_\s]+/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

function formatStatus(rawStatus: string | undefined) {
    if (!rawStatus?.trim()) return 'Private'

    return rawStatus
        .trim()
        .split(/[-_\s]+/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
}

function parseProofFilename(filename: string) {
    const stem = filename.replace(/\.sha256$/u, '')
    const parts = stem.split('-')
    const timestamp = parts[0]?.match(/^\d{8}T\d{6}Z$/u) ? parts[0] : ''
    const statusParts = parts.length > 2 ? parts.slice(2) : []

    return {
        timestamp,
        status: formatStatus(statusParts.join('-'))
    }
}

export function createProjectCodename(folderName: string) {
    const hash = stableHash(folderName)
    const adjective = selectByHash(hash, codenameAdjectives, 0)
    const noun = selectByHash(hash, codenameNouns, 2)
    const suffix = hash.slice(4, 8).toUpperCase()

    return `Project ${adjective} ${noun} ${suffix}`
}

function createProofUrl(codename: string, proofFileName: string) {
    return `/ledger-proofs/${slugify(codename)}/${proofFileName}`
}

async function readNewestProofCandidate(directoryPath: string) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true })
    const candidates: ProofCandidate[] = []

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.sha256')) continue

        const sourceShaPath = path.join(directoryPath, entry.name)
        const sourceOtsPath = `${sourceShaPath}.ots`
        if (!(await fs.pathExists(sourceOtsPath))) continue

        const digestBytes = await fs.readFile(sourceShaPath)
        const digestMatch = digestBytes.toString('utf8').match(canonicalSha256Pattern)
        if (!digestMatch) continue

        let detachedProof: DetachedTimestampFile
        try {
            detachedProof = DetachedTimestampFile.deserialize(new Uint8Array(await fs.readFile(sourceOtsPath)))
        } catch {
            continue
        }

        const timestampedFileDigest = crypto.createHash('sha256').update(digestBytes).digest('hex')
        if (
            detachedProof.fileHashOp.tagName !== 'sha256' ||
            bytesToHex(detachedProof.fileDigest()) !== timestampedFileDigest
        ) {
            continue
        }

        const { timestamp, status } = parseProofFilename(entry.name)
        candidates.push({
            timestamp,
            status,
            sha256: digestMatch[1],
            sourceShaPath,
            sourceOtsPath,
            proofFileName: `${entry.name}.ots`
        })
    }

    return candidates.sort((left, right) => {
        if (left.timestamp !== right.timestamp) return right.timestamp.localeCompare(left.timestamp)
        return right.sourceShaPath.localeCompare(left.sourceShaPath)
    })[0]
}

async function readLedgerNode(rootDir: string, directoryPath: string): Promise<ProofLedgerGroupNode | ProofLedgerProofNode | null> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true })
    const childDirectories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right))
    const relativePath = toPosixPath(path.relative(rootDir, directoryPath))
    const directoryName = path.basename(directoryPath)

    if (!childDirectories.length) {
        const candidate = await readNewestProofCandidate(directoryPath)
        if (!candidate) return null

        const codename = createProjectCodename(directoryName)
        const parentPath = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : ''
        const codenamePath = [parentPath, slugify(codename)].filter(Boolean).join('/')
        return {
            kind: 'proof',
            name: codename,
            title: codename,
            path: codenamePath,
            timestamp: candidate.timestamp,
            status: candidate.status,
            sha256: candidate.sha256,
            proofUrl: createProofUrl(codename, candidate.proofFileName),
            proofFileName: candidate.proofFileName,
            sourceOtsPath: candidate.sourceOtsPath
        }
    }

    const children = (
        await Promise.all(childDirectories.map((directory) => readLedgerNode(rootDir, path.join(directoryPath, directory))))
    ).filter((node): node is ProofLedgerNode => node !== null)

    if (!children.length) return null

    return {
        kind: 'group',
        name: directoryName,
        title: formatGroupTitle(directoryName),
        path: relativePath,
        proofCount: countProofs(children),
        children
    }
}

function countProofs(nodes: ProofLedgerNode[]) {
    return nodes.reduce((count, node) => count + (node.kind === 'proof' ? 1 : node.proofCount), 0)
}

function stripNodeSources(node: ProofLedgerNode): ProofLedgerNode {
    if (node.kind === 'group') {
        return {
            ...node,
            children: node.children.map(stripNodeSources)
        }
    }

    const { sourceOtsPath: _sourceOtsPath, ...publicNode } = node
    return publicNode
}

function collectProofNodes(nodes: ProofLedgerNode[], proofs: ProofLedgerProofNode[] = []) {
    for (const node of nodes) {
        if (node.kind === 'proof') {
            proofs.push(node)
            continue
        }

        collectProofNodes(node.children, proofs)
    }

    return proofs
}

function disambiguateProofUrls(nodes: ProofLedgerNode[]) {
    const proofsByUrl = new Map<string, ProofLedgerProofNode[]>()

    for (const proof of collectProofNodes(nodes)) {
        const matches = proofsByUrl.get(proof.proofUrl) ?? []
        matches.push(proof)
        proofsByUrl.set(proof.proofUrl, matches)
    }

    for (const [proofUrl, proofs] of proofsByUrl) {
        if (proofs.length < 2) continue

        const separatorIndex = proofUrl.lastIndexOf('/')
        const directoryPath = proofUrl.slice(0, separatorIndex)

        for (const proof of proofs) {
            const uniqueSuffix = stableHash(proof.sourceOtsPath ?? proof.path).slice(0, 12)
            proof.proofUrl = `${directoryPath}-${uniqueSuffix}/${proof.proofFileName}`
        }
    }
}

function resolveLedgerGeneratedAt(nodes: ProofLedgerNode[]) {
    const latestTimestamp = collectProofNodes(nodes)
        .map((proof) => proof.timestamp)
        .filter((timestamp) => /^\d{8}T\d{6}Z$/u.test(timestamp))
        .sort()
        .at(-1)

    if (!latestTimestamp) return new Date(0).toISOString()

    const match = latestTimestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u)
    if (!match) return new Date(0).toISOString()

    return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`).toISOString()
}

export async function buildProofLedger(proofsDir: string): Promise<ProofLedgerCollection> {
    if (!(await fs.pathExists(proofsDir))) {
        return {
            roots: [],
            proofCount: 0,
            generatedAt: new Date(0).toISOString()
        }
    }

    const entries = await fs.readdir(proofsDir, { withFileTypes: true })
    const roots = (
        await Promise.all(
            entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((left, right) => left.localeCompare(right))
                .map((directory) => readLedgerNode(proofsDir, path.join(proofsDir, directory)))
        )
    ).filter((node): node is ProofLedgerGroupNode => node?.kind === 'group')
    disambiguateProofUrls(roots)

    return {
        roots,
        proofCount: countProofs(roots),
        generatedAt: resolveLedgerGeneratedAt(roots)
    }
}

export function stripProofLedgerSources(ledger: ProofLedgerCollection): ProofLedgerCollection {
    return {
        ...ledger,
        roots: ledger.roots.map((root) => stripNodeSources(root) as ProofLedgerGroupNode)
    }
}

export async function materializeProofLedgerDownloads(ledger: ProofLedgerCollection, outputDir: string) {
    for (const node of collectProofNodes(ledger.roots)) {
        if (!node.sourceOtsPath) continue

        const targetPath = path.join(outputDir, node.proofUrl.slice(1))
        await fs.ensureDir(path.dirname(targetPath))
        await fs.copy(node.sourceOtsPath, targetPath)
    }
}

export function createProofLedgerDownloadMap(ledger: ProofLedgerCollection) {
    const proofMap = new Map<string, string>()

    for (const node of collectProofNodes(ledger.roots)) {
        if (node.sourceOtsPath) {
            proofMap.set(node.proofUrl, node.sourceOtsPath)
        }
    }

    return proofMap
}
