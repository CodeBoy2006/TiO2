import { execFile as execFileCallback, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCallback)
const frameworkRoot = fileURLToPath(new URL('../', import.meta.url))
const projectRoot = realpathSync(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const projectId = createHash('sha256').update(projectRoot).digest('hex')
const registerTsPath = path.join(frameworkRoot, 'scripts/register-ts.mjs')
const maxPortNumber = 65535
const defaultPortScanWindow = 20
const defaultShutdownGraceMs = 2000
const hardExitGraceMs = 1000

const launcherService = {
    name: 'cms',
    color: '\x1b[90m'
}

const serviceDefinitions = [
    {
        name: 'cms:server',
        commandEnvKey: 'TIO2_CMS_SERVER_COMMAND',
        entry: path.join(frameworkRoot, 'apps/cms-server/src/server.ts'),
        typescript: true,
        color: '\x1b[36m',
        portEnvKey: 'CMS_PORT',
        portScanWindowEnvKey: 'CMS_PORT_SCAN_WINDOW',
        defaultPort: 4321
    },
    {
        name: 'cms:web',
        commandEnvKey: 'TIO2_CMS_WEB_COMMAND',
        entry: path.join(frameworkRoot, 'scripts/run-cms-web.mts'),
        typescript: true,
        color: '\x1b[35m',
        portEnvKey: 'CMS_WEB_PORT',
        portScanWindowEnvKey: 'CMS_WEB_PORT_SCAN_WINDOW',
        defaultPort: 4173
    },
    {
        name: 'dev',
        commandEnvKey: 'TIO2_SITE_DEV_COMMAND',
        entry: path.join(frameworkRoot, 'scripts/run-site-dev.mjs'),
        color: '\x1b[33m',
        portEnvKey: 'SITE_DEV_PORT',
        portScanWindowEnvKey: 'SITE_DEV_PORT_SCAN_WINDOW',
        defaultPort: 5000
    }
].map((service) => {
    const marker = `--tio2-service=${projectId}:${service.name}`
    return {
        ...service,
        defaultCommand: [
            process.execPath,
            ...(service.typescript ? ['--import', registerTsPath] : []),
            service.entry,
            marker
        ],
        matchesCommand: (command) => command.split(/\s+/u).includes(marker) && command.includes(service.entry)
    }
})

const children = new Map()
let shuttingDown = false
let exitCode = 0
let shutdownGraceMs = defaultShutdownGraceMs
let forceShutdownTimer
let hardExitTimer

async function main() {
    shutdownGraceMs = parsePositiveInteger(
        process.env.TIO2_SHUTDOWN_GRACE_MS,
        defaultShutdownGraceMs,
        'TIO2_SHUTDOWN_GRACE_MS'
    )
    const services = await resolveServices()
    const childEnv = createChildEnv(services)

    printServiceSummary(services)

    for (const service of services) {
        children.set(service.name, startService(service, childEnv))
    }

    process.on('SIGINT', () => shutdown(0))
    process.on('SIGTERM', () => shutdown(0))
}

function parseCommand(envKey, fallback) {
    const value = process.env[envKey]
    if (!value) return fallback

    try {
        const parsed = JSON.parse(value)

        if (
            !Array.isArray(parsed) ||
            parsed.length === 0 ||
            !parsed.every((entry) => typeof entry === 'string' && entry)
        ) {
            throw new Error('command must be a non-empty JSON string array')
        }

        return parsed
    } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid command override'
        throw new Error(`[cms] Failed to parse ${envKey}: ${message}`)
    }
}

function parsePortValue(raw, fallback, label) {
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`[cms] Invalid ${label}: ${raw}`)
    }

    return parsed
}

function parsePort(envKey, fallback) {
    return parsePortValue(process.env[envKey], fallback, envKey)
}

function parsePositiveInteger(raw, fallback, label) {
    if (!raw) return fallback

    const parsed = Number(raw)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`[cms] Invalid ${label}: ${raw}`)
    }

    return parsed
}

async function resolveServices() {
    const services = []
    const reservedPorts = new Map()

    for (const definition of serviceDefinitions) {
        const service = await resolveService(definition, reservedPorts)
        services.push(service)
        reservedPorts.set(service.port, service.name)
    }

    return services
}

async function resolveService(service, reservedPorts) {
    const requestedPort = parsePort(service.portEnvKey, service.defaultPort)
    const portScanWindow = parsePort(service.portScanWindowEnvKey, defaultPortScanWindow)
    const port = await resolveServicePort(service, requestedPort, portScanWindow, reservedPorts)

    return {
        ...service,
        requestedPort,
        port,
        command: resolveCommand(service, port)
    }
}

function resolveCommand(service, port) {
    const fallback =
        typeof service.defaultCommand === 'function' ? service.defaultCommand(port) : service.defaultCommand

    return parseCommand(service.commandEnvKey, fallback)
}

async function resolveServicePort(service, requestedPort, portScanWindow, reservedPorts) {
    for (
        let candidatePort = requestedPort;
        candidatePort <= Math.min(requestedPort + portScanWindow, maxPortNumber);
        candidatePort += 1
    ) {
        const reservedBy = reservedPorts.get(candidatePort)

        if (reservedBy) {
            printLine(
                launcherService,
                `${service.name} port ${candidatePort} is already reserved by ${reservedBy}; trying ${candidatePort + 1}`,
                false
            )
            continue
        }

        const isUsable = await reclaimPort({
            ...service,
            port: candidatePort
        })

        if (isUsable) {
            if (candidatePort !== requestedPort) {
                printLine(
                    launcherService,
                    `${service.name} switched from port ${requestedPort} to ${candidatePort}`,
                    false
                )
            }

            return candidatePort
        }
    }

    throw new Error(
        `[cms] Unable to find an available port for ${service.name} between ${requestedPort} and ${Math.min(
            requestedPort + portScanWindow,
            maxPortNumber
        )}`
    )
}

async function reclaimPort(target) {
    const listeners = await listListeningProcesses(target.port)
    if (!listeners.length) return true

    const managedListeners = listeners.filter((listener) => target.matchesCommand(listener.command))
    const foreignListeners = listeners.filter((listener) => !managedListeners.includes(listener))

    if (foreignListeners.length) {
        printLine(
            launcherService,
            `${target.name} port ${target.port} is occupied by a non-managed process: ${foreignListeners
                .map((listener) => `${listener.pid} (${listener.command})`)
                .join(', ')}; trying ${target.port + 1}`,
            false
        )
        return false
    }

    printLine(
        launcherService,
        `reclaiming stale ${target.name} on port ${target.port} from ${managedListeners
            .map((listener) => `${listener.pid} (${listener.command})`)
            .join(', ')}`,
        false
    )

    for (const listener of managedListeners) {
        terminateProcess(listener.pid, 'SIGTERM')
    }

    const releasedAfterTerm = await waitForPortRelease(target.port, 1200)
    if (releasedAfterTerm) return true

    const remainingListeners = await listListeningProcesses(target.port)
    if (!remainingListeners.length) return true
    if (remainingListeners.some((listener) => !target.matchesCommand(listener.command))) return false

    printLine(
        launcherService,
        `forcing ${target.name} release on port ${target.port} from ${remainingListeners
            .map((listener) => `${listener.pid} (${listener.command})`)
            .join(', ')}`,
        true
    )

    for (const listener of remainingListeners) {
        terminateProcess(listener.pid, 'SIGKILL')
    }

    const releasedAfterKill = await waitForPortRelease(target.port, 1200)
    if (!releasedAfterKill) {
        const listeners = await listListeningProcesses(target.port)
        if (listeners.some((listener) => !target.matchesCommand(listener.command))) return false
        throw new Error(`[cms] Failed to reclaim ${target.name} on port ${target.port}`)
    }

    return true
}

function createChildEnv(services) {
    const ports = Object.fromEntries(services.map((service) => [service.portEnvKey, String(service.port)]))
    const sitePreviewOrigin = process.env.CMS_PREVIEW_ORIGIN || `http://127.0.0.1:${findService(services, 'dev').port}`

    return {
        ...process.env,
        ...ports,
        TIO2_PROJECT_ROOT: projectRoot,
        CMS_PREVIEW_ORIGIN: sitePreviewOrigin
    }
}

function findService(services, serviceName) {
    const service = services.find((entry) => entry.name === serviceName)

    if (!service) {
        throw new Error(`[cms] Missing service definition: ${serviceName}`)
    }

    return service
}

function printServiceSummary(services) {
    for (const service of services) {
        const requestedSuffix = service.port === service.requestedPort ? '' : ` (requested ${service.requestedPort})`
        printLine(launcherService, `${service.name} => http://127.0.0.1:${service.port}${requestedSuffix}`, false)
    }
}

async function waitForPortRelease(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        const listeners = await listListeningProcesses(port)
        if (!listeners.length) {
            return true
        }

        await delay(100)
    }

    return (await listListeningProcesses(port)).length === 0
}

async function listListeningProcesses(port) {
    let stdout

    try {
        const result = await execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
        stdout = result.stdout
    } catch (error) {
        const exitCode = typeof error === 'object' && error && 'code' in error ? Number(error.code) : null

        if (exitCode === 1) {
            return []
        }

        throw error
    }

    const pids = stdout
        .split(/\s+/u)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid)

    return Promise.all(
        [...new Set(pids)].map(async (pid) => ({
            pid,
            command: await getProcessCommand(pid)
        }))
    )
}

async function getProcessCommand(pid) {
    try {
        const { stdout } = await execFile('ps', ['-p', String(pid), '-o', 'command='])
        return stdout.trim() || 'unknown'
    } catch {
        return 'unknown'
    }
}

function terminateProcess(pid, signal) {
    try {
        process.kill(pid, signal)
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') {
            throw error
        }
    }
}

function startService(service, env) {
    const [command, ...args] = service.command
    const child = spawn(command, args, {
        cwd: projectRoot,
        stdio: ['inherit', 'pipe', 'pipe'],
        env,
        shell: false
    })

    pipeOutput(child.stdout, service, false)
    pipeOutput(child.stderr, service, true)

    child.on('close', (code, signal) => {
        children.delete(service.name)

        if (shuttingDown) {
            finishShutdownIfIdle()
            return
        }

        if (signal) {
            printLine(service, `stopped by signal ${signal}`, true)
            exitCode = 1
            shutdown(exitCode)
            return
        }

        if ((code ?? 0) !== 0) {
            printLine(service, `exited with code ${code}`, true)
            exitCode = code ?? 1
            shutdown(exitCode)
            return
        }

        printLine(service, 'stopped', false)
        shutdown(exitCode)
    })

    child.on('error', (error) => {
        printLine(service, `failed to start: ${error.message}`, true)
        exitCode = 1
        shutdown(exitCode)
    })

    return child
}

function pipeOutput(stream, service, useStderr) {
    if (!stream) return

    const lineReader = createInterface({ input: stream })
    lineReader.on('line', (line) => {
        printLine(service, line, useStderr)
    })
}

function printLine(service, line, useStderr) {
    const writer = useStderr ? process.stderr : process.stdout
    writer.write(`${service.color}[${service.name}]\x1b[0m ${line}\n`)
}

function shutdown(code) {
    if (!shuttingDown) {
        shuttingDown = true
        exitCode = code

        for (const child of children.values()) {
            if (child.pid && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM')
            }
        }

        forceShutdownTimer = setTimeout(forceShutdown, shutdownGraceMs)
        forceShutdownTimer.unref()
    }

    finishShutdownIfIdle()
}

function forceShutdown() {
    for (const [serviceName, child] of children) {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue

        printLine(launcherService, `forcing ${serviceName} to stop after ${shutdownGraceMs}ms`, true)
        child.kill('SIGKILL')
    }

    hardExitTimer = setTimeout(() => process.exit(exitCode || 1), hardExitGraceMs)
    hardExitTimer.unref()
}

function finishShutdownIfIdle() {
    if (children.size !== 0) return

    clearTimeout(forceShutdownTimer)
    clearTimeout(hardExitTimer)
    process.exit(exitCode)
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    printLine(launcherService, message, true)
    process.exit(1)
})
