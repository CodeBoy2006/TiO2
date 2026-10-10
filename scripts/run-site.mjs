import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import fs from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, preview as vitePreview } from 'vite'
import { loadTiO2Project } from '../packages/config/src/project.js'

const frameworkRoot = fileURLToPath(new URL('../', import.meta.url))
const registerTs = path.join(frameworkRoot, 'scripts/register-ts.mjs')
const phases = [
    'site/build-client.mts',
    'site/build-site.mts',
    'scripts/build-search-index.ts',
    'scripts/write-site-artifacts.ts'
]

function buildHeapFromEnv() {
    const heap = Number(process.env.TIO2_BUILD_HEAP_MB ?? 4096)
    if (!Number.isSafeInteger(heap) || heap < 128 || heap > 65536) {
        throw new Error('Invalid TIO2_BUILD_HEAP_MB: expected an integer from 128 to 65536 MiB')
    }
    return heap
}

async function buildProject(rootDir, outputDirectory, mode, signal) {
    const heap = buildHeapFromEnv()
    const env = { ...process.env, TIO2_PROJECT_ROOT: rootDir, TIO2_OUTPUT_DIR: outputDirectory, NODE_ENV: mode }
    const entries =
        mode === 'production' ? [...phases, 'scripts/verify-eleventy-site.ts', 'scripts/verify-site-client.ts'] : phases
    for (const entry of entries) {
        signal.throwIfAborted()
        const startedAt = performance.now()
        // Each phase releases its heap and module cache before the next one starts.
        await new Promise((resolve, reject) => {
            const child = spawn(
                process.execPath,
                [`--max-old-space-size=${heap}`, '--import', registerTs, path.join(frameworkRoot, entry)],
                { cwd: rootDir, env, stdio: 'inherit' }
            )
            let killTimer
            const abort = () => {
                child.kill('SIGTERM')
                killTimer = setTimeout(() => child.kill('SIGKILL'), 1000)
            }
            signal.addEventListener('abort', abort, { once: true })
            child.once('error', reject)
            // Wait for actual process exit; an AbortError is not evidence that the worker stopped.
            child.once('exit', (code, exitSignal) => {
                clearTimeout(killTimer)
                signal.removeEventListener('abort', abort)
                if (code === 0) resolve()
                else reject(new Error(`${entry} exited with ${code ?? exitSignal}`))
            })
        })
        console.log(`[tio2:build] ${entry}: ${((performance.now() - startedAt) / 1000).toFixed(2)}s`)
    }
}

export async function build() {
    const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
        await buildProject(
            project.rootDir,
            path.join(project.rootDir, '.tio2-tmp/site'),
            'production',
            controller.signal
        )
    } finally {
        process.removeListener('SIGINT', stop)
        process.removeListener('SIGTERM', stop)
    }
}

function portFromEnv(name, fallback) {
    const port = Number(process.env[name] ?? fallback)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid ${name}: ${port}`)
    return port
}

async function serve(rootDir, outputDirectory, port) {
    const server = await vitePreview({
        configFile: false,
        root: rootDir,
        appType: 'mpa',
        publicDir: false,
        build: { outDir: outputDirectory },
        preview: { host: '127.0.0.1', port, strictPort: true }
    })
    server.printUrls()
    return server
}

export async function preview() {
    const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
    const server = await serve(
        project.rootDir,
        path.join(project.rootDir, '.tio2-tmp/site'),
        portFromEnv('TIO2_PREVIEW_PORT', 4173)
    )
    const stop = () => {
        // Vite also handles SIGTERM; an intentional TiO2 shutdown succeeds.
        process.exitCode ??= 0
        return server.close().catch((error) => {
            console.error(error)
            process.exitCode = 1
        })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
}

export function isTransientBuildWatchError(error, rootDir) {
    if (error.code !== 'ENOENT' || error.syscall !== 'scandir' ||
        typeof error.path !== 'string' || !path.isAbsolute(error.path)) return false
    // rootDir is already realpathed; require a path component boundary, not a string prefix.
    const relative = path.relative(path.join(rootDir, '.tio2-tmp'), error.path)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export async function dev() {
    // Reject invalid build configuration before starting persistent watchers.
    buildHeapFromEnv()
    const rootDir = await fs.realpath(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
    const port = portFromEnv('SITE_DEV_PORT', 5000)
    const outputDirectory = path.join(rootDir, '.tio2-tmp/site-dev')
    const stagingDirectory = `${outputDirectory}-next`
    const previousDirectory = `${outputDirectory}-previous`
    const controller = new AbortController()
    const watchers = []
    let timer
    let server
    let httpServer
    let dirty = false
    let building = false
    let stopping = false

    async function stop() {
        if (stopping) return
        stopping = true
        clearTimeout(timer)
        watchers.forEach((watcher) => watcher.close())
        controller.abort()
        await server?.close()
        if (httpServer?.listening) {
            await new Promise((resolve, reject) => {
                httpServer.close((error) => (error ? reject(error) : resolve()))
                httpServer.closeAllConnections()
            })
        }
    }

    async function rebuild() {
        dirty = true
        if (building || stopping) return
        building = true
        try {
            while (dirty && !stopping) {
                dirty = false
                try {
                    await buildProject(rootDir, stagingDirectory, 'development', controller.signal)
                    if (stopping) break
                    await fs.rm(previousDirectory, { recursive: true, force: true })
                    try {
                        await fs.rename(outputDirectory, previousDirectory)
                    } catch (error) {
                        if (error.code !== 'ENOENT') throw error
                    }
                    try {
                        await fs.rename(stagingDirectory, outputDirectory)
                    } catch (error) {
                        await fs.rename(previousDirectory, outputDirectory).catch(() => {})
                        throw error
                    }
                    await fs.rm(previousDirectory, { recursive: true, force: true })
                    if (!server) {
                        httpServer = createHttpServer()
                        server = await createServer({
                            configFile: false,
                            root: outputDirectory,
                            appType: 'mpa',
                            publicDir: false,
                            optimizeDeps: { noDiscovery: true, include: [] },
                            // Middleware mode leaves signal handling and worker shutdown to this supervisor.
                            server: {
                                host: '127.0.0.1',
                                port,
                                middlewareMode: true,
                                hmr: { server: httpServer },
                                watch: null
                            }
                        })
                        httpServer.on('request', server.middlewares)
                        try {
                            await new Promise((resolve, reject) => {
                                httpServer.once('error', reject)
                                httpServer.listen(port, '127.0.0.1', resolve)
                            })
                        } catch (error) {
                            console.error(error)
                            process.exitCode = 1
                            await stop()
                            break
                        }
                        console.log(`  Local: http://127.0.0.1:${port}/`)
                    }
                    if (stopping) {
                        await server.close()
                        httpServer.close()
                        break
                    }
                    server.moduleGraph.invalidateAll()
                    server.ws.send({ type: 'full-reload' })
                    console.log('[tio2:dev] Site, search and publishing artifacts refreshed.')
                } catch (error) {
                    if (!stopping) console.error('[tio2:dev]', error.message)
                }
            }
        } finally {
            building = false
        }
    }

    const ignore = /(?:^|[/\\])(?:node_modules|\.git|\.tio2-tmp|\.claude|\.codex|\.agents)(?:[/\\]|$)/u
    const changed = (_event, filename) => {
        if (filename && (ignore.test(String(filename)) || String(filename) === 'statusquo.md')) return
        clearTimeout(timer)
        timer = setTimeout(() => void rebuild(), 150)
    }
    const onSignal = () =>
        stop().catch((error) => {
            console.error(error)
            process.exitCode = 1
        })
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    try {
        const targets = [rootDir]
        if ((await fs.realpath(frameworkRoot)) !== rootDir) {
            targets.push(
                ...['site', 'packages', '.vitepress/theme', 'scripts'].map((dir) => path.join(frameworkRoot, dir))
            )
        }
        for (const target of targets) {
            const watcher = watch(target, { recursive: true }, changed)
            watcher.on('error', (error) => {
                // Node's recursive scan can race with rebuilding intentionally ignored output.
                if (isTransientBuildWatchError(error, rootDir)) return
                console.error(error)
                process.exitCode = 1
                void onSignal()
            })
            watchers.push(watcher)
        }
        await rebuild()
    } catch (error) {
        await stop()
        throw error
    }
}
