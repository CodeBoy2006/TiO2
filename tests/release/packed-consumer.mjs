import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const frameworkRoot = fileURLToPath(new URL('../../', import.meta.url))

test(
    'packed framework installs, builds both examples and runs the installed dev/preview CLI',
    { timeout: 300_000 },
    async () => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tio2-packed-')))
        const env = { ...process.env }
        for (const key of [
            'TIO2_PROJECT_ROOT',
            'TIO2_OUTPUT_DIR',
            'TIO2_TEST_CLI',
            'NODE_PATH',
            'BLOG_ENCRYPTION_SECRETS',
            'BLOG_ENCRYPTION_SECRETS_FILE'
        ])
            delete env[key]
        const run = (command, args, cwd = frameworkRoot, extraEnv = {}) =>
            execFile(command, args, {
                cwd,
                env: { ...env, ...extraEnv },
                timeout: 180_000,
                maxBuffer: 4 * 1024 * 1024
            })
        try {
            const metadata = JSON.parse(await fs.readFile(path.join(frameworkRoot, 'package.json'), 'utf8'))
            await run('pnpm', ['pack', '--pack-destination', root])
            const tarball = path.join(root, `${metadata.name}-${metadata.version}.tgz`)
            for (const example of ['minimal', 'customized']) {
                const consumer = path.join(root, example)
                await fs.cp(path.join(frameworkRoot, 'examples', example), consumer, { recursive: true })
                // A fresh store and project ensure repository overrides/hoisted modules cannot mask missing dependencies.
                await run('pnpm', ['add', tarball, '--store-dir', path.join(root, 'store')], consumer)
                const installed = await fs.realpath(path.join(consumer, 'node_modules/tio2'))
                assert.ok(installed.startsWith(`${root}${path.sep}`))
                await run('pnpm', ['exec', 'tio2', 'build'], consumer)
                const output = path.join(consumer, '.tio2-tmp/site')
                const home = await fs.readFile(path.join(output, 'index.html'), 'utf8')
                assert.match(home, /Powered by TiO₂ by <a class="vitepress" href="https:\/\/github.com\/CodeBoy2006">Codeboy<\/a>/u)
                assert.doesNotMatch(home.replace(/ by <a[^>]*>Codeboy<\/a>/u, ''), /Codeboy|cb-about/u)
                const script = home.match(/<script type="module" src="([^"]+)"/u)?.[1]
                assert.ok(script)
                assert.match(
                    await fs.readFile(path.join(output, script), 'utf8'),
                    /sources: \/third-party-notices.txt/u
                )
                assert.match(
                    await fs.readFile(path.join(output, 'assets/third-party-licenses.md'), 'utf8'),
                    /Licenses/u
                )
                assert.match(await fs.readFile(path.join(output, 'third-party-notices.txt'), 'utf8'), /VitePress/u)
                await run('pnpm', ['exec', 'tio2', 'new', 'Packed smoke test', '--dry-run'], consumer)
                if (example === 'customized') {
                    assert.match(await fs.readFile(path.join(output, 'info/about.html'), 'utf8'), /Workshop Notes/u)
                    assert.match(
                        await fs.readFile(path.join(output, 'info/foundations.html'), 'utf8'),
                        /href="\/knowledge\/hypothesis.html#formal-statement"/u
                    )
                    for (const file of ['feed.xml', 'sitemap.xml'])
                        await assert.rejects(fs.access(path.join(output, file)), { code: 'ENOENT' })
                    await run(
                        process.execPath,
                        ['--import', 'tsx', '--test', 'tests/scripts/site-runtime.integration.test.ts'],
                        frameworkRoot,
                        {
                            TIO2_TEST_CLI: path.join(installed, 'bin/tio2.mjs')
                        }
                    )
                }
                console.log(`Packed ${example}: installed build and CLI checks passed`)
            }
        } finally {
            await fs.rm(root, { recursive: true, force: true })
        }
    }
)
