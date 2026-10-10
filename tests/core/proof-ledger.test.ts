import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { DetachedTimestampFile, OpSHA256, makePending } from '@otskit/core'
import fs from 'fs-extra'
import {
    buildProofLedger,
    createProjectCodename,
    materializeProofLedgerDownloads,
    type ProofLedgerGroupNode,
    type ProofLedgerProofNode
} from '../../packages/content-fs/src/index.js'

const tmpRoot = path.join(process.cwd(), 'tmp', 'proof-ledger-test')

async function resetFixture() {
    await fs.remove(tmpRoot)
    await fs.ensureDir(tmpRoot)
}

async function writeProof(relativeDir: string, stamp: string, digest: string) {
    const proofDir = path.join(tmpRoot, 'proofs', relativeDir)
    const shaPath = path.join(proofDir, `${stamp}.sha256`)
    const otsPath = `${shaPath}.ots`
    const digestBytes = new TextEncoder().encode(`${digest}\n`)
    const proof = DetachedTimestampFile.fromBytes(new OpSHA256(), digestBytes)
    proof.timestamp.addAttestation(makePending('https://alice.btc.calendar.opentimestamps.org'))
    const proofBytes = proof.serializeToBytes()

    await fs.ensureDir(proofDir)
    await fs.writeFile(shaPath, digestBytes)
    await fs.writeFile(otsPath, proofBytes)

    return { proofBytes, shaPath }
}

function asGroup(node: ProofLedgerGroupNode | ProofLedgerProofNode | undefined): ProofLedgerGroupNode {
    assert.equal(node?.kind, 'group')
    return node
}

function asProof(node: ProofLedgerGroupNode | ProofLedgerProofNode | undefined): ProofLedgerProofNode {
    assert.equal(node?.kind, 'proof')
    return node
}

function collectProofs(nodes: Array<ProofLedgerGroupNode | ProofLedgerProofNode>) {
    return nodes.flatMap((node): ProofLedgerProofNode[] =>
        node.kind === 'proof' ? [node] : collectProofs(node.children)
    )
}

test('proof ledger keeps only the newest valid proof per leaf and masks leaf folder names', async () => {
    await resetFixture()

    const olderHash = 'a'.repeat(64)
    const newestHash = 'b'.repeat(64)
    const siblingHash = 'c'.repeat(64)

    await writeProof('ideas/security/password-keystroke-dynamics', '20260609T112817Z-47afd7ce', olderHash)
    await writeProof('ideas/security/password-keystroke-dynamics', '20260610T112817Z-47afd7ce', newestHash)
    await writeProof('research/system/adaptive-probe', '20260609T112829Z-47afd7ce', siblingHash)
    await writeProof(
        'ideas/security/model-contingent-agent-memory-architectures',
        '20260609T112815Z-47afd7ce',
        'not-a-hash'
    )

    const ledger = await buildProofLedger(path.join(tmpRoot, 'proofs'))
    const ideas = asGroup(ledger.roots.find((node) => node.name === 'ideas'))
    const security = asGroup(ideas.children.find((node) => node.name === 'security'))
    const securityProofs = security?.children.filter((node) => node.kind === 'proof') ?? []

    assert.equal(ledger.proofCount, 2)
    assert.equal(securityProofs.length, 1)
    assert.equal(securityProofs[0].name, createProjectCodename('password-keystroke-dynamics'))
    assert.equal(securityProofs[0].status, 'Private')
    assert.equal(securityProofs[0].sha256, newestHash)
    assert.match(securityProofs[0].proofUrl, /^\/ledger-proofs\/[a-z0-9-]+\/20260610T112817Z-47afd7ce\.sha256\.ots$/)
    assert.ok(!securityProofs[0].proofUrl.includes('password-keystroke-dynamics'))
    assert.equal(ledger.generatedAt, '2026-06-10T11:28:17.000Z')
})

test('proof ledger reads optional status from the sha256 filename before the file type', async () => {
    await resetFixture()

    const digest = 'e'.repeat(64)
    await writeProof('ideas/release/auditable-note', '20260609T112747Z-47afd7ce-Public', digest)

    const ledger = await buildProofLedger(path.join(tmpRoot, 'proofs'))
    const proofNode = asProof(asGroup(asGroup(ledger.roots[0]).children[0]).children[0])

    assert.equal(proofNode.status, 'Public')
    assert.equal(proofNode.proofFileName, '20260609T112747Z-47afd7ce-Public.sha256.ots')
})

test('proof ledger materializes selected OTS downloads to deterministic public paths', async () => {
    await resetFixture()

    const digest = 'd'.repeat(64)
    const { proofBytes } = await writeProof('ideas/game/ant-simulator', '20260609T112747Z-47afd7ce', digest)

    const ledger = await buildProofLedger(path.join(tmpRoot, 'proofs'))
    const outputDir = path.join(tmpRoot, 'dist')

    await materializeProofLedgerDownloads(ledger, outputDir)

    const proofNode = asProof(asGroup(asGroup(ledger.roots[0]).children[0]).children[0])
    assert.deepEqual(await fs.readFile(path.join(outputDir, proofNode.proofUrl.slice(1))), Buffer.from(proofBytes))
})

test('proof ledger rejects a proof that timestamps different digest-file bytes', async () => {
    await resetFixture()

    const { shaPath } = await writeProof('ideas/security/mismatched-proof', '20260609T112817Z-47afd7ce', 'a'.repeat(64))
    await fs.writeFile(shaPath, `${'b'.repeat(64)}\n`)

    const ledger = await buildProofLedger(path.join(tmpRoot, 'proofs'))

    assert.equal(ledger.proofCount, 0)
})

test('proof ledger disambiguates colliding proof download URLs without exposing leaf names', async () => {
    await resetFixture()

    const stamp = '20260609T112747Z-47afd7ce'
    await writeProof('ideas/group-a/shared-leaf', stamp, 'a'.repeat(64))
    await writeProof('research/group-b/shared-leaf', stamp, 'b'.repeat(64))

    const ledger = await buildProofLedger(path.join(tmpRoot, 'proofs'))
    const proofs = collectProofs(ledger.roots)
    const proofUrls = proofs.map((proof) => proof.proofUrl)

    assert.equal(proofs.length, 2)
    assert.equal(new Set(proofUrls).size, 2)
    assert.ok(proofUrls.every((proofUrl) => !proofUrl.includes('shared-leaf')))
    assert.ok(proofUrls.every((proofUrl) => /-[a-f0-9]{12}\//u.test(proofUrl)))
})
