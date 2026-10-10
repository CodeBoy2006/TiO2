import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

test('framework source checkout excludes personal projects and blog-only maintenance files', async () => {
    for (const relative of [
        'blog',
        'posts',
        'topics',
        'foundations',
        'pages',
        'proofs',
        'assets',
        'public',
        'diagrams',
        '.tio2',
        'tio2.config.js',
        'tio2.config.mjs',
        'scripts/audit-foundations.ts',
        'scripts/generate-git-metadata.ts'
    ]) {
        await assert.rejects(fs.access(relative), { code: 'ENOENT' }, relative)
    }
})

test('packed framework excludes personal content, configuration, secrets and generated output', async () => {
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'tio2-package-boundary-'))
    const cacheRoot = 'examples/customized/.tio2-tmp'
    await fs.mkdir(cacheRoot, { recursive: true })
    const generated = await fs.mkdtemp(path.join(cacheRoot, 'package-boundary-'))
    try {
        await fs.writeFile(path.join(generated, 'not-for-package.md'), 'Generated example output must stay local.')
        const source = JSON.parse(await fs.readFile('package.json', 'utf8'))
        await execFile('pnpm', ['pack', '--pack-destination', destination])
        const tarball = path.join(destination, `${source.name}-${source.version}.tgz`)
        const { stdout } = await execFile('tar', ['-tzf', tarball])
        const entries = stdout
            .trim()
            .split('\n')
            .map((entry) => entry.replace(/^package\//u, ''))
        const allowedRoots = new Set(['bin', 'packages', 'site', 'scripts', 'apps', '.vitepress', 'examples', 'docs'])
        for (const entry of entries) {
            if (['README.md', 'LICENSE', 'package.json'].includes(entry)) continue
            assert.ok(allowedRoots.has(entry.split('/')[0]), `Unexpected package file: ${entry}`)
            assert.doesNotMatch(entry, /(?:^|\/)(?:node_modules|\.tio2-tmp|\.git|dist|blog|proofs)(?:\/|$)/u)
            assert.doesNotMatch(entry, /encryption-secrets|\.env(?:\.|$)|statusquo\.md/u)
            if (entry.endsWith('.md'))
                assert.ok(
                    /^examples\/(?:minimal|customized)\//u.test(entry) ||
                        [
                            'docs/framework.md',
                            'docs/releasing.md',
                            'docs/third-party-notices.md',
                            'docs/source-extraction.md'
                        ].includes(entry),
                    entry
                )
            if (entry.startsWith('.vitepress/')) assert.match(entry, /^\.vitepress\/theme\/[^/]+\.ts$/u)
        }
        for (const required of [
            'bin/tio2.mjs',
            'scripts/register-ts.mjs',
            'site/build-client.mts',
            'site/markdown.ts',
            'site/public/feed-icon.svg',
            'docs/framework.md',
            'docs/third-party-notices.md',
            'docs/source-extraction.md',
            'site/public/third-party-notices.txt',
            'examples/minimal/tio2.config.mjs'
        ]) {
            assert.ok(entries.includes(required), `Missing package file: ${required}`)
        }
        const { stdout: metadata } = await execFile('tar', ['-xOf', tarball, 'package/package.json'])
        const packed = JSON.parse(metadata)
        assert.equal(packed.private, true)
        assert.equal(packed.license, 'MIT')
        assert.equal(packed.dependencies.vitepress, undefined)
        assert.equal(packed.bin.tio2, 'bin/tio2.mjs')
        assert.equal(packed.exports['.'].import, './packages/config/src/index.js')
    } finally {
        await fs.rm(destination, { recursive: true, force: true })
        await fs.rm(generated, { recursive: true, force: true })
    }
})
