import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const cli = process.env.TIO2_TEST_CLI ?? path.resolve('bin/tio2.mjs')

test(
    'CLI builds a foreign consumer and refreshes dev content, imported configuration and theme modules',
    { timeout: 120_000 },
    async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tio2-runtime-'))
        const env = { ...process.env }
        delete env.TIO2_PROJECT_ROOT
        delete env.TIO2_OUTPUT_DIR
        const write = async (file: string, value: string) => {
            await fs.mkdir(path.dirname(path.join(rootDir, file)), { recursive: true })
            await fs.writeFile(path.join(rootDir, file), value)
        }
        const article = (text: string) => `---\ntitle: Runtime post\ndate: 2026-01-01 10:00:00\n---\n${text}\n`
        let running: ReturnType<typeof start> | undefined
        let socket: WebSocket | undefined
        let workerPid: number | undefined
        try {
            await write('identity.mjs', 'export const title = "Initial Notebook"')
            await write(
                'tio2.config.mjs',
                `import { title } from './identity.mjs'; export default {
            site: { title, url: 'https://notebook.test' },
            content: { postsDir: 'writing', pagesDir: 'info' },
            theme: { clientEntry: 'theme/client.ts', layout: 'theme/layout.mjs', pages: { 'info/about.md': 'theme/page.mjs' } }
        }`
            )
            await write(
                'theme/client.ts',
                'import "./style.css"; document.documentElement.dataset.runtimeClient = "yes"'
            )
            await write('theme/style.css', ':root { --runtime-accent: purple; }')
            await write(
                'theme/layout.mjs',
                'export default ({ render }) => render({ bodyPrelude: "<!-- first-layout -->" })'
            )
            await write(
                'theme/page.mjs',
                'export default ({ render }) => render({ content: "<main>First custom page</main>" })'
            )
            await write(
                'writing/hello.md',
                article('Initial body $x^2$\n\n$$\\frac{1}{2}$$\n\n![Diagram](./diagram.svg)')
            )
            await write(
                'writing/diagram.svg',
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path fill="black" d="M0 0h20v10H0z"/></svg>'
            )
            await write('writing/draft/note.md', article('Unpublished draft'))
            await write('info/about.md', '# About')
            // An unrelated consumer tsconfig must not alter framework runtime resolution.
            await write(
                'tsconfig.json',
                '{ "compilerOptions": { "baseUrl": ".", "paths": { "vite": ["./consumer-vite.ts"] } } }'
            )
            await execFile(process.execPath, [cli, 'build', '--root', rootDir], {
                cwd: os.tmpdir(),
                env,
                maxBuffer: 2 * 1024 * 1024
            })
            const output = path.join(rootDir, '.tio2-tmp/site')
            const html = await fs.readFile(path.join(output, 'writing/hello.html'), 'utf8')
            assert.match(html, /Initial Notebook/)
            assert.match(html, /first-layout/)
            assert.match(
                html,
                /Powered by <a class="vitepress" href="https:\/\/github.com\/CodeBoy2006\/TiO2">TiO₂<\/a> by <a class="vitepress" href="https:\/\/github.com\/CodeBoy2006">Codeboy<\/a>/u
            )
            assert.doesNotMatch(
                html.replace(/Powered by <a[^>]*>TiO₂<\/a> by <a[^>]*>Codeboy<\/a>/u, ''),
                /Codeboy|cb-about/
            )
            const mathStylesheet = html.match(/href="(\/assets\/math-[a-f0-9]{16}\.css)"/u)?.[1]
            assert.ok(mathStylesheet, 'Math styles must be linked from consumer pages')
            const mathStyles = await fs.readFile(path.join(output, mathStylesheet), 'utf8')
            assert.match(mathStyles, /mjx-assistive-mml/u)
            assert.match(mathStyles, /mjx-container\[jax="SVG"\]/u)
            assert.match(html, /<mjx-container data-tex=/u)
            await assert.rejects(fs.access(path.join(output, 'writing/draft/note.html')))
            assert.doesNotMatch(
                await fs.readFile(path.join(output, 'assets/search-index.json'), 'utf8'),
                /Unpublished draft/
            )
            assert.match(await fs.readFile(path.join(output, 'info/about.html'), 'utf8'), /First custom page/)

            const imageCache = path.join(rootDir, '.tio2-tmp/site-work/images/generated')
            const cachedImages = await fs.readdir(imageCache)
            assert.ok(cachedImages.length > 0)
            const timestamp = new Date('2000-01-01T00:00:00Z')
            for (const file of cachedImages) await fs.utimes(path.join(imageCache, file), timestamp, timestamp)
            await write('.tio2-tmp/site/writing/stale.html', 'Obsolete page')
            await execFile(process.execPath, [cli, 'build', '--root', rootDir], {
                cwd: os.tmpdir(),
                env,
                maxBuffer: 2 * 1024 * 1024
            })
            await assert.rejects(fs.access(path.join(output, 'writing/stale.html')), { code: 'ENOENT' })
            assert.equal(await fs.readFile(path.join(output, mathStylesheet), 'utf8'), mathStyles)
            for (const file of cachedImages) {
                assert.equal((await fs.stat(path.join(imageCache, file))).mtimeMs, timestamp.getTime())
            }

            const previewPort = await freePort()
            running = start(['preview', '--root', rootDir, '--port', String(previewPort)], env)
            await until(async () => (await get(previewPort, '/writing/hello.html')).includes('Initial body'), running)
            await running.stop()
            await assertPortFree(previewPort)

            await write('.tio2-tmp/watch-race/nested/output.txt', 'temporary')
            const devPort = await freePort()
            running = start(['dev', '--root', rootDir, '--port', String(devPort)], env)
            await until(
                async () => (await get(devPort, '/writing/draft/note.html')).includes('Unpublished draft'),
                running
            )
            assert.match(await get(devPort, '/writing/hello.html'), /\/@vite\/client/)
            assert.match(await get(devPort, '/writing/hello.html'), new RegExp(mathStylesheet.replaceAll('.', '\\.')))
            const devMathStyles = await fetch(`http://127.0.0.1:${devPort}${mathStylesheet}`, {
                headers: { Accept: 'text/css' }
            })
            assert.match(devMathStyles.headers.get('content-type') ?? '', /text\/css/u)
            assert.equal(await devMathStyles.text(), mathStyles)
            assert.match(await get(devPort, '/assets/search-index.json'), /Unpublished draft/)
            const messages: string[] = []
            socket = new WebSocket(`ws://127.0.0.1:${devPort}`, 'vite-hmr')
            socket.addEventListener('message', (event) => messages.push(String(event.data)))
            await until(async () => messages.some((message) => JSON.parse(message).type === 'connected'), running)

            // Recursive watchers can observe a generated directory between stat and readdir.
            const transientBuildDirectory = path.join(rootDir, '.tio2-tmp', 'watch-race')
            for (let iteration = 0; iteration < 2000; iteration += 1) {
                await fs.rm(transientBuildDirectory, { recursive: true, force: true })
                await fs.mkdir(path.join(transientBuildDirectory, 'nested'), { recursive: true })
                await fs.writeFile(path.join(transientBuildDirectory, 'nested', 'output.txt'), 'temporary')
            }
            assert.equal(running.child.exitCode, null, running.output())

            await write('identity.mjs', 'export const title = "Updated Notebook"')
            await write(
                'theme/layout.mjs',
                'export default ({ render }) => render({ bodyPrelude: "<!-- updated-layout -->" })'
            )
            await write(
                'theme/page.mjs',
                'export default ({ render }) => render({ content: "<main>Updated custom page</main>" })'
            )
            await write('theme/style.css', ':root { --runtime-accent: orange; }')
            await write('writing/hello.md', article('Updated searchable body'))
            await until(
                async () => (await get(devPort, '/writing/hello.html')).includes('Updated searchable body'),
                running
            )
            const updated = await get(devPort, '/writing/hello.html')
            assert.match(updated, /Updated Notebook/)
            assert.match(updated, /updated-layout/)
            assert.match(await get(devPort, '/info/about.html'), /Updated custom page/)
            assert.ok(/--runtime-accent:\s*orange/u.test(await get(devPort, '/assets/client/main.css')))
            assert.match(await get(devPort, '/assets/search-index.json'), /Updated Notebook|Updated searchable body/)
            assert.match(await get(devPort, '/feed.xml'), /Updated Notebook/)
            assert.ok(messages.some((message) => JSON.parse(message).type === 'full-reload'))

            await write('identity.mjs', 'this is invalid javascript')
            await until(async () => running!.output().includes('[tio2:dev] site/build-client.mts exited'), running)
            assert.match(await get(devPort, '/writing/hello.html'), /Updated searchable body/)
            await write('identity.mjs', 'export const title = "Recovered Notebook"')
            await until(async () => (await get(devPort, '/writing/hello.html')).includes('Recovered Notebook'), running)
            // Stop during a deliberately slow phase, including a child that ignores SIGTERM.
            await write(
                'tio2.config.mjs',
                `import fs from 'node:fs/promises';
                process.on('SIGTERM', () => {});
                await fs.writeFile(new URL('./.tio2-tmp/held-worker.json', import.meta.url), String(process.pid));
                await new Promise(resolve => setTimeout(resolve, 60000));
                export default { site: { title: 'Slow', url: 'https://slow.test' } };`
            )
            const workerFile = path.join(rootDir, '.tio2-tmp/held-worker.json')
            await until(async () => {
                await fs.access(workerFile)
                return true
            }, running)
            workerPid = Number(await fs.readFile(workerFile, 'utf8'))
            socket.close()
            socket = undefined
            const shutdownStarted = Date.now()
            await running.stop()
            assert.ok(Date.now() - shutdownStarted < 5000, 'Shutdown must not wait for the slow phase to finish')
            await assertPortFree(devPort)
            assert.throws(() => process.kill(workerPid!, 0), { code: 'ESRCH' })
        } finally {
            socket?.close()
            if (workerPid) {
                try {
                    process.kill(workerPid, 'SIGKILL')
                } catch (error) {
                    assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH')
                }
            }
            await running?.stop()
            await fs.rm(rootDir, { recursive: true, force: true })
        }
    }
)

function start(args: string[], env: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, [cli, ...args], { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', (chunk) => {
        output += chunk
    })
    child.stderr.on('data', (chunk) => {
        output += chunk
    })
    return {
        child,
        output: () => output,
        async stop() {
            if (child.exitCode !== null || child.signalCode !== null) return
            child.kill('SIGTERM')
            const kill = setTimeout(() => child.kill('SIGKILL'), 3000)
            try {
                const [code, signal] = await closed
                assert.equal(signal, null, output)
                assert.equal(code, 0, output)
            } finally {
                clearTimeout(kill)
            }
        }
    }
}

async function until(check: () => Promise<boolean>, running: ReturnType<typeof start>) {
    const deadline = Date.now() + 25_000
    while (Date.now() < deadline) {
        if (running.child.exitCode !== null || running.child.signalCode !== null) throw new Error(running.output())
        if (await check().catch(() => false)) return
        await delay(100)
    }
    throw new Error(`Timed out waiting for runtime output:\n${running.output()}`)
}

async function get(port: number, pathname: string) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(1000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${pathname}`)
    return response.text()
}

async function freePort() {
    const server = net.createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return address.port
}

async function assertPortFree(port: number) {
    const server = net.createServer()
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(port, '127.0.0.1', resolve)
        })
    } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
}
