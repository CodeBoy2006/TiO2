import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const repoRoot = await realpath(process.cwd())
const scriptPath = `${repoRoot}/scripts/run-cms-dev.mjs`
const serviceStartupGraceMs = 500

test('TiO2 cms launcher starts CMS and site dev services with prefixed output', async () => {
    const { stdout, stderr } = await execFile('node', [scriptPath], {
        cwd: repoRoot,
        env: await createLauncherEnv()
    })

    assert.match(stdout, /\[cms:server\].*server ready/)
    assert.match(stdout, /\[cms:web\].*web ready/)
    assert.match(stdout, /\[dev\].*site ready/)
    assert.equal(stderr, '')
})

test('TiO2 cms launcher reclaims occupied CMS server ports before startup', async () => {
    const occupiedServerPort = await getFreePort()
    const launcherEnv = await createLauncherEnv({
        CMS_PORT: String(occupiedServerPort)
    })
    const blocker = startPortBlocker(
        occupiedServerPort,
        serviceSignature('cms:server', 'apps/cms-server/src/server.ts')
    )

    const blockerExit = onceChildExit(blocker)

    try {
        await waitForStdoutLine(blocker, /occupied/)

        const { stdout, stderr } = await execFile('node', [scriptPath], {
            cwd: repoRoot,
            env: launcherEnv
        })

        const [code, signal] = await waitForChildExit(blockerExit, 'stale CMS server blocker')

        assert.equal(code, 0)
        assert.equal(signal, null)
        assert.match(stdout, new RegExp(`\\[cms\\].*reclaiming stale cms:server on port ${occupiedServerPort}`))
        assert.match(stdout, /\[cms:server\].*server ready/)
        assert.match(stdout, /\[cms:web\].*web ready/)
        assert.match(stdout, /\[dev\].*site ready/)
        assert.equal(stderr, '')
    } finally {
        await stopChild(blocker, blockerExit)
    }
})

test('TiO2 cms launcher reclaims occupied site dev port before startup', async () => {
    const occupiedSiteDevPort = await getFreePort()
    const launcherEnv = await createLauncherEnv({
        SITE_DEV_PORT: String(occupiedSiteDevPort)
    })
    const blocker = startPortBlocker(occupiedSiteDevPort, serviceSignature('dev', 'scripts/run-site-dev.mjs'))

    const blockerExit = onceChildExit(blocker)

    try {
        await waitForStdoutLine(blocker, /occupied/)

        const { stdout, stderr } = await execFile('node', [scriptPath], {
            cwd: repoRoot,
            env: launcherEnv
        })

        const [code, signal] = await waitForChildExit(blockerExit, 'stale site dev blocker')

        assert.equal(code, 0)
        assert.equal(signal, null)
        assert.match(stdout, new RegExp(`\\[cms\\].*reclaiming stale dev on port ${occupiedSiteDevPort}`))
        assert.match(stdout, /\[cms:server\].*server ready/)
        assert.match(stdout, /\[cms:web\].*web ready/)
        assert.match(stdout, /\[dev\].*site ready/)
        assert.equal(stderr, '')
    } finally {
        await stopChild(blocker, blockerExit)
    }
})

test('TiO2 cms launcher shifts CMS server to the next free port when a foreign process owns the requested port', async () => {
    const [occupiedServerPort, shiftedServerPort] = await getContiguousPortRange(2)
    const launcherEnv = await createLauncherEnv(
        {
            CMS_PORT: String(occupiedServerPort)
        },
        createEnvSnapshotCommands()
    )
    const blocker = startPortBlocker(occupiedServerPort)

    const blockerExit = onceChildExit(blocker)

    try {
        await waitForStdoutLine(blocker, /occupied/)

        const { stdout, stderr } = await execFile('node', [scriptPath], {
            cwd: repoRoot,
            env: launcherEnv
        })

        assert.match(
            stdout,
            new RegExp(`\\[cms\\].*cms:server port ${occupiedServerPort} is occupied by a non-managed process`)
        )
        assert.match(
            stdout,
            new RegExp(`\\[cms\\].*cms:server switched from port ${occupiedServerPort} to ${shiftedServerPort}`)
        )
        assert.match(
            stdout,
            new RegExp(
                `\\[cms\\].*cms:server => http://127\\.0\\.0\\.1:${shiftedServerPort} \\(requested ${occupiedServerPort}\\)`
            )
        )
        assert.match(stdout, new RegExp(`"CMS_PORT":"${shiftedServerPort}"`))
        assert.equal(stderr, '')
    } finally {
        await stopChild(blocker, blockerExit)
    }
})

test('TiO2 cms launcher reclaims only its own project, role and framework entry', async () => {
    const serverEntry = 'apps/cms-server/src/server.ts'
    const foreignSignatures = [
        serviceSignature('cms:server', serverEntry, `${repoRoot}/another-project`),
        serviceSignature('cms:web', serverEntry),
        serviceSignature('cms:server', 'scripts/run-cms-web.mts'),
        [`${repoRoot}/${serverEntry}`],
        [`${repoRoot}/${serverEntry}`, `${serviceSignature('cms:server', serverEntry)[1]}:other`]
    ]

    for (const signature of foreignSignatures) {
        const [occupiedPort, shiftedPort] = await getContiguousPortRange(2)
        const blocker = startPortBlocker(occupiedPort, signature)
        const blockerExit = onceChildExit(blocker)
        try {
            await waitForStdoutLine(blocker, /occupied/)
            const { stdout, stderr } = await execFile(process.execPath, [scriptPath], {
                cwd: repoRoot,
                env: await createLauncherEnv({ CMS_PORT: String(occupiedPort) }, createEnvSnapshotCommands())
            })
            assert.match(stdout, new RegExp(`"CMS_PORT":"${shiftedPort}"`))
            assert.doesNotMatch(stdout, /reclaiming stale/)
            assert.equal(blocker.exitCode, null)
            assert.equal(blocker.signalCode, null)
            assert.equal(stderr, '')
        } finally {
            await stopChild(blocker, blockerExit)
        }
    }
})

test('TiO2 cms launcher reclaims an owned CMS web process', async () => {
    const occupiedPort = await getFreePort()
    const blocker = startPortBlocker(occupiedPort, serviceSignature('cms:web', 'scripts/run-cms-web.mts'))
    const blockerExit = onceChildExit(blocker)
    try {
        await waitForStdoutLine(blocker, /occupied/)
        const { stdout, stderr } = await execFile(process.execPath, [scriptPath], {
            cwd: repoRoot,
            env: await createLauncherEnv({ CMS_WEB_PORT: String(occupiedPort) })
        })
        await waitForChildExit(blockerExit, 'stale CMS web blocker')
        assert.match(stdout, new RegExp(`reclaiming stale cms:web on port ${occupiedPort}`))
        assert.equal(stderr, '')
    } finally {
        await stopChild(blocker, blockerExit)
    }
})

test('TiO2 cms launcher rechecks foreign ownership after attempting stale recovery', async () => {
    const [occupiedPort, shiftedPort] = await getContiguousPortRange(2)
    const blocker = startPortBlocker(
        occupiedPort,
        serviceSignature('cms:server', 'apps/cms-server/src/server.ts'),
        true
    )
    const blockerExit = onceChildExit(blocker)
    try {
        await waitForStdoutLine(blocker, /occupied/)
        const { stdout, stderr } = await execFile(process.execPath, [scriptPath], {
            cwd: repoRoot,
            env: await createLauncherEnv({ CMS_PORT: String(occupiedPort) }, createEnvSnapshotCommands())
        })
        assert.match(stdout, new RegExp(`"CMS_PORT":"${shiftedPort}"`))
        assert.equal(blocker.exitCode, null)
        assert.equal(blocker.signalCode, null)
        assert.equal(stderr, '')
    } finally {
        await stopChild(blocker, blockerExit)
    }
})

test('TiO2 cms launcher passes the real consumer project root and cwd to all services', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tio2-cms-project-'))
    const projectRoot = await realpath(temporaryRoot)
    const projectAlias = `${temporaryRoot}-alias`
    try {
        await symlink(projectRoot, projectAlias)
        const { stdout, stderr } = await execFile(process.execPath, [scriptPath], {
            cwd: repoRoot,
            env: await createLauncherEnv({ TIO2_PROJECT_ROOT: projectAlias }, createEnvSnapshotCommands())
        })
        const snapshots = stdout
            .split('\n')
            .filter((line) => line.includes('"label":'))
            .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as { cwd: string; TIO2_PROJECT_ROOT: string })
        assert.equal(snapshots.length, 3)
        for (const snapshot of snapshots) {
            assert.equal(snapshot.cwd, projectRoot)
            assert.equal(snapshot.TIO2_PROJECT_ROOT, projectRoot)
        }
        assert.equal(stderr, '')
    } finally {
        await rm(projectAlias, { force: true })
        await rm(temporaryRoot, { recursive: true, force: true })
    }
})

test('TiO2 cms launcher shifts CMS web to the next free port when a foreign process owns the requested port', async () => {
    const [occupiedWebPort, shiftedWebPort] = await getContiguousPortRange(2)
    const launcherEnv = await createLauncherEnv(
        {
            CMS_WEB_PORT: String(occupiedWebPort)
        },
        createEnvSnapshotCommands()
    )
    const blocker = startPortBlocker(occupiedWebPort)

    const blockerExit = onceChildExit(blocker)

    try {
        await waitForStdoutLine(blocker, /occupied/)

        const { stdout, stderr } = await execFile('node', [scriptPath], {
            cwd: repoRoot,
            env: launcherEnv
        })

        assert.match(
            stdout,
            new RegExp(`\\[cms\\].*cms:web port ${occupiedWebPort} is occupied by a non-managed process`)
        )
        assert.match(
            stdout,
            new RegExp(`\\[cms\\].*cms:web switched from port ${occupiedWebPort} to ${shiftedWebPort}`)
        )
        assert.match(
            stdout,
            new RegExp(
                `\\[cms\\].*cms:web => http://127\\.0\\.0\\.1:${shiftedWebPort} \\(requested ${occupiedWebPort}\\)`
            )
        )
        assert.match(stdout, new RegExp(`"CMS_WEB_PORT":"${shiftedWebPort}"`))
        assert.equal(stderr, '')
    } finally {
        await stopChild(blocker, blockerExit)
    }
})

test('TiO2 cms launcher shifts site dev to the next free port when a foreign process owns the requested port', async () => {
    const [occupiedSiteDevPort, shiftedSiteDevPort] = await getContiguousPortRange(2)
    const launcherEnv = await createLauncherEnv(
        {
            SITE_DEV_PORT: String(occupiedSiteDevPort)
        },
        createEnvSnapshotCommands()
    )
    const blocker = startPortBlocker(occupiedSiteDevPort)

    const blockerExit = onceChildExit(blocker)

    try {
        await waitForStdoutLine(blocker, /occupied/)

        const { stdout, stderr } = await execFile('node', [scriptPath], {
            cwd: repoRoot,
            env: launcherEnv
        })

        assert.match(
            stdout,
            new RegExp(`\\[cms\\].*dev port ${occupiedSiteDevPort} is occupied by a non-managed process`)
        )
        assert.match(
            stdout,
            new RegExp(`\\[cms\\].*dev switched from port ${occupiedSiteDevPort} to ${shiftedSiteDevPort}`)
        )
        assert.match(
            stdout,
            new RegExp(
                `\\[cms\\].*dev => http://127\\.0\\.0\\.1:${shiftedSiteDevPort} \\(requested ${occupiedSiteDevPort}\\)`
            )
        )
        assert.match(stdout, new RegExp(`"SITE_DEV_PORT":"${shiftedSiteDevPort}"`))
        assert.match(stdout, new RegExp(`"CMS_PREVIEW_ORIGIN":"http://127\\.0\\.0\\.1:${shiftedSiteDevPort}"`))
        assert.equal(stderr, '')
    } finally {
        await stopChild(blocker, blockerExit)
    }
})

test('TiO2 cms launcher fails when no alternative CMS web port exists within the scan window', async () => {
    const [occupiedWebPort, nextOccupiedWebPort] = await getContiguousPortRange(2)
    const launcherEnv = await createLauncherEnv({
        CMS_WEB_PORT: String(occupiedWebPort),
        CMS_WEB_PORT_SCAN_WINDOW: '1'
    })
    const blocker = startPortBlocker(occupiedWebPort)
    const blockerNext = startPortBlocker(nextOccupiedWebPort)

    const blockerExit = onceChildExit(blocker)
    const blockerNextExit = onceChildExit(blockerNext)

    try {
        await waitForStdoutLine(blocker, /occupied/)
        await waitForStdoutLine(blockerNext, /occupied/)

        await assert.rejects(
            () =>
                execFile('node', [scriptPath], {
                    cwd: repoRoot,
                    env: launcherEnv
                }),
            (error: unknown) => {
                assert.ok(error && typeof error === 'object')
                const failure = error as { code?: number; stdout?: string; stderr?: string }

                assert.equal(failure.code, 1)
                assert.match(
                    String(failure.stderr),
                    new RegExp(
                        `\\[cms\\].*Unable to find an available port for cms:web between ${occupiedWebPort} and ${nextOccupiedWebPort}`
                    )
                )

                return true
            }
        )

        assert.equal(blocker.exitCode, null)
        assert.equal(blocker.signalCode, null)
    } finally {
        await stopChild(blocker, blockerExit)
        await stopChild(blockerNext, blockerNextExit)
    }
})

test('TiO2 cms launcher stops sibling processes and returns failing exit code', async () => {
    const launcherEnv = await createLauncherEnv({
        TIO2_CMS_SERVER_COMMAND: JSON.stringify(
            createTimedExitCommand('server boom', serviceStartupGraceMs, { exitCode: 4, useStderr: true })
        ),
        TIO2_CMS_WEB_COMMAND: JSON.stringify(createPersistentCommand('web boot')),
        TIO2_SITE_DEV_COMMAND: JSON.stringify(createPersistentCommand('site boot'))
    })

    await assert.rejects(
        () =>
            execFile('node', [scriptPath], {
                cwd: repoRoot,
                env: launcherEnv
            }),
        (error: unknown) => {
            assert.ok(error && typeof error === 'object')
            const failure = error as { code?: number; stdout?: string; stderr?: string }

            assert.equal(failure.code, 4)
            assert.match(String(failure.stdout), /\[cms:web\].*web boot/)
            assert.match(String(failure.stdout), /\[dev\].*site boot/)
            assert.match(String(failure.stderr), /\[cms:server\].*server boom/)
            assert.match(String(failure.stderr), /\[cms:server\].*exited with code 4/)

            return true
        }
    )
})

test('TiO2 cms launcher force-stops sibling processes that ignore SIGTERM', async () => {
    const launcherEnv = await createLauncherEnv({
        TIO2_CMS_SERVER_COMMAND: JSON.stringify(
            createTimedExitCommand('server boom', serviceStartupGraceMs, { exitCode: 4, useStderr: true })
        ),
        TIO2_CMS_WEB_COMMAND: JSON.stringify(createPersistentCommand('stubborn web', { ignoreSigterm: true })),
        TIO2_SITE_DEV_COMMAND: JSON.stringify(createPersistentCommand('site boot')),
        TIO2_SHUTDOWN_GRACE_MS: '50'
    })

    await assert.rejects(
        () =>
            execFile('node', [scriptPath], {
                cwd: repoRoot,
                env: launcherEnv
            }),
        (error: unknown) => {
            assert.ok(error && typeof error === 'object')
            const failure = error as { code?: number; stdout?: string; stderr?: string }

            assert.equal(failure.code, 4)
            assert.match(String(failure.stdout), /\[cms:web\].*stubborn web/)
            assert.match(String(failure.stderr), /\[cms\].*forcing cms:web to stop after 50ms/)

            return true
        }
    )
})

test('TiO2 cms launcher exits cleanly when a service command cannot be spawned', async () => {
    const launcherEnv = await createLauncherEnv({
        TIO2_CMS_SERVER_COMMAND: JSON.stringify(['tio2-command-that-does-not-exist']),
        TIO2_CMS_WEB_COMMAND: JSON.stringify(createPersistentCommand('web boot')),
        TIO2_SITE_DEV_COMMAND: JSON.stringify(createPersistentCommand('site boot')),
        TIO2_SHUTDOWN_GRACE_MS: '50'
    })

    await assert.rejects(
        () =>
            execFile('node', [scriptPath], {
                cwd: repoRoot,
                env: launcherEnv
            }),
        (error: unknown) => {
            assert.ok(error && typeof error === 'object')
            const failure = error as { code?: number; stderr?: string }

            assert.equal(failure.code, 1)
            assert.match(String(failure.stderr), /\[cms:server\].*failed to start: spawn .* ENOENT/)

            return true
        }
    )
})

async function createLauncherEnv(
    overrides: Record<string, string> = {},
    commandOverrides: { server?: string[]; web?: string[]; dev?: string[] } = {}
) {
    const isolatedPorts = await getIsolatedPorts()

    return {
        ...process.env,
        TIO2_PROJECT_ROOT: repoRoot,
        CMS_PORT: String(isolatedPorts.cmsPort),
        CMS_WEB_PORT: String(isolatedPorts.cmsWebPort),
        SITE_DEV_PORT: String(isolatedPorts.siteDevPort),
        TIO2_CMS_SERVER_COMMAND: JSON.stringify(commandOverrides.server ?? createPersistentCommand('server ready')),
        TIO2_CMS_WEB_COMMAND: JSON.stringify(commandOverrides.web ?? createPersistentCommand('web ready')),
        TIO2_SITE_DEV_COMMAND: JSON.stringify(
            commandOverrides.dev ?? createTimedExitCommand('site ready', serviceStartupGraceMs)
        ),
        ...overrides
    }
}

function createTimedExitCommand(
    message: string,
    exitDelayMs: number,
    options: { exitCode?: number; useStderr?: boolean } = {}
) {
    const { exitCode = 0, useStderr = false } = options
    const writer = useStderr ? 'error' : 'log'

    return [
        process.execPath,
        '-e',
        `console.${writer}(${JSON.stringify(message)}); setTimeout(() => process.exit(${exitCode}), ${exitDelayMs})`
    ]
}

function createPersistentCommand(message: string, options: { ignoreSigterm?: boolean } = {}) {
    const signalHandler = options.ignoreSigterm ? "process.on('SIGTERM', () => {})" : ''
    return [
        process.execPath,
        '-e',
        `${signalHandler}; console.log(${JSON.stringify(message)}); setInterval(() => {}, 1000)`
    ]
}

function createEnvSnapshotCommands() {
    return {
        server: createEnvSnapshotCommand('server env'),
        web: createEnvSnapshotCommand('web env'),
        dev: createEnvSnapshotCommand('dev env')
    }
}

function createEnvSnapshotCommand(label: string) {
    const payload = `console.log(JSON.stringify({
        label: ${JSON.stringify(label)},
        CMS_PORT: process.env.CMS_PORT,
        CMS_WEB_PORT: process.env.CMS_WEB_PORT,
        SITE_DEV_PORT: process.env.SITE_DEV_PORT,
        CMS_PREVIEW_ORIGIN: process.env.CMS_PREVIEW_ORIGIN,
        TIO2_PROJECT_ROOT: process.env.TIO2_PROJECT_ROOT,
        cwd: process.cwd()
    })); setTimeout(() => process.exit(0), 30)`

    return [process.execPath, '-e', payload]
}

async function getIsolatedPorts() {
    return {
        cmsPort: await getFreePort(),
        cmsWebPort: await getFreePort(),
        siteDevPort: await getFreePort()
    }
}

async function getContiguousPortRange(size: number) {
    const searchStart = 20000
    const searchEnd = 60000 - size

    for (let basePort = searchStart; basePort <= searchEnd; basePort += 1) {
        let allFree = true

        for (let offset = 0; offset < size; offset += 1) {
            const canUsePort = await canBindPort(basePort + offset)
            if (!canUsePort) {
                allFree = false
                break
            }
        }

        if (allFree) {
            return Array.from({ length: size }, (_, offset) => basePort + offset)
        }
    }

    throw new Error(`Failed to find ${size} contiguous free ports`)
}

async function getFreePort() {
    const server = net.createServer()

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => resolve())
        })

        const address = server.address()
        assert.ok(address && typeof address === 'object')
        return address.port
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error)
                    return
                }

                resolve()
            })
        })
    }
}

async function canBindPort(port: number) {
    const server = net.createServer()

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(port, '127.0.0.1', () => resolve())
        })

        return true
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
            return false
        }

        throw error
    } finally {
        if (server.listening) {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error)
                        return
                    }

                    resolve()
                })
            })
        }
    }
}

async function waitForChildExit(
    exitPromise: Promise<[code: number | null, signal: NodeJS.Signals | null]>,
    label: string
) {
    return Promise.race([
        exitPromise,
        delay(1000).then(() => {
            throw new Error(`Timed out waiting for ${label} to exit`)
        })
    ])
}

function onceChildExit(child: ReturnType<typeof spawn>) {
    return once(child, 'exit') as Promise<[code: number | null, signal: NodeJS.Signals | null]>
}

async function waitForStdoutLine(child: ReturnType<typeof spawn>, pattern: RegExp) {
    const stdout = child.stdout
    assert.ok(stdout)

    let buffer = ''

    await Promise.race([
        new Promise<void>((resolve, reject) => {
            stdout.on('data', (chunk: Buffer | string) => {
                buffer += String(chunk)

                if (pattern.test(buffer)) {
                    resolve()
                }
            })

            child.once('exit', () => {
                reject(new Error(`Process exited before matching ${pattern}; captured output: ${buffer}`))
            })
            child.once('error', reject)
        }),
        delay(1000).then(() => {
            throw new Error(`Timed out waiting for output matching ${pattern}; captured output: ${buffer}`)
        })
    ])
}

function serviceSignature(role: string, entry: string, projectRoot = repoRoot) {
    const projectId = createHash('sha256').update(projectRoot).digest('hex')
    return [`${repoRoot}/${entry}`, `--tio2-service=${projectId}:${role}`]
}

function startPortBlocker(port: number, signatureArgs: string[] = [], becomeForeignOnSigterm = false) {
    const args = [
        '-e',
        [
            "const net = require('node:net')",
            'const server = net.createServer(() => {})',
            'const stop = () => process.exit(0)',
            becomeForeignOnSigterm
                ? "process.once('SIGTERM', () => { process.title = 'tio2-foreign-listener'; process.on('SIGTERM', stop) })"
                : "process.on('SIGTERM', stop)",
            "process.on('SIGINT', stop)",
            "server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('occupied'))"
        ].join(';')
    ]

    args.push('--', ...signatureArgs)

    return spawn(process.execPath, args, {
        cwd: repoRoot,
        env: {
            ...process.env,
            PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'inherit']
    })
}

async function stopChild(
    child: ReturnType<typeof spawn>,
    exitPromise: Promise<[code: number | null, signal: NodeJS.Signals | null]>
) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return
    }

    child.kill('SIGTERM')
    await waitForChildExit(exitPromise, 'cleanup child')
}
