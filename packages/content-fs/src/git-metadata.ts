import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

export interface GitPathCommit {
    hash: string
    subject: string
    committedAt: string
    timestamp: number
}

const commitCache = new Map<string, Promise<GitPathCommit | null>>()
const repositoryRootCache = new Map<string, Promise<string>>()
const completeHistoryCache = new Map<string, Promise<boolean>>()
const metadataSnapshotCache = new Map<string, Promise<Map<string, GitPathCommit>>>()
const trackedFilesCache = new Map<string, Promise<string[]>>()
const metadataSnapshotRelativePath = '.tio2/git-metadata.json'

function toPosixPath(value: string) {
    return value.split(path.sep).join('/')
}

function runGit(args: string[], cwd: string) {
    return new Promise<string>((resolve, reject) => {
        const child = spawn('git', args, {
            cwd,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: '0'
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false
        })
        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk)
        })
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk)
        })
        child.on('error', reject)
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout)
                return
            }

            reject(new Error(stderr.trim() || `git ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
        })
    })
}

async function getRepositoryRoot(cwd: string) {
    const normalizedCwd = path.resolve(cwd)
    const cached = repositoryRootCache.get(normalizedCwd)
    if (cached) return cached

    const pending = runGit(['rev-parse', '--show-toplevel'], normalizedCwd).then((output) => output.trim())
    repositoryRootCache.set(normalizedCwd, pending)
    return pending
}

async function getHistoryFetchSources(repositoryRoot: string) {
    const configuredSources = [process.env.TIO2_GIT_REMOTE_URL?.trim() ?? ''].filter(Boolean)
    const remoteNames = await runGit(['remote'], repositoryRoot)
        .then((output) =>
            output
                .split('\n')
                .map((value) => value.trim())
                .filter(Boolean)
        )
        .catch(() => [])
    remoteNames.sort((left, right) => Number(right === 'origin') - Number(left === 'origin'))

    return [...new Set([...configuredSources, ...remoteNames])]
}

async function ensureCompleteRepositoryHistory(repositoryRoot: string) {
    const normalizedRoot = path.resolve(repositoryRoot)
    const cached = completeHistoryCache.get(normalizedRoot)
    if (cached) return cached

    const pending = (async () => {
        try {
            const isShallow = (await runGit(['rev-parse', '--is-shallow-repository'], normalizedRoot)).trim() === 'true'
            if (!isShallow) return true

            const fetchSources = await getHistoryFetchSources(normalizedRoot)

            for (const fetchSource of fetchSources) {
                try {
                    await runGit(['fetch', '--unshallow', '--no-tags', fetchSource], normalizedRoot)
                    return true
                } catch {
                    // Hosted private clones often omit reusable provider credentials.
                }
            }

            return false
        } catch {
            return false
        }
    })()

    completeHistoryCache.set(normalizedRoot, pending)
    return pending
}

async function readGitMetadataSnapshot(repositoryRoot: string) {
    const normalizedRoot = path.resolve(repositoryRoot)
    const cached = metadataSnapshotCache.get(normalizedRoot)
    if (cached) return cached

    const pending = readFile(path.join(normalizedRoot, metadataSnapshotRelativePath), 'utf8')
        .then((contents) => {
            const parsed: unknown = JSON.parse(contents)
            if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.paths)) {
                return new Map<string, GitPathCommit>()
            }

            const commits = new Map<string, GitPathCommit>()

            for (const [sourcePath, value] of Object.entries(parsed.paths)) {
                const commit = parseSnapshotCommit(value)
                if (!commit) continue

                commits.set(sourcePath, commit)
                commits.set(sourcePath.normalize('NFC'), commit)
                commits.set(sourcePath.normalize('NFD'), commit)
            }

            return commits
        })
        .catch(() => new Map<string, GitPathCommit>())

    metadataSnapshotCache.set(normalizedRoot, pending)
    return pending
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSnapshotCommit(value: unknown): GitPathCommit | null {
    if (!isRecord(value)) return null

    const hash = typeof value.hash === 'string' ? value.hash : ''
    const subject = typeof value.subject === 'string' ? value.subject : ''
    const timestamp = typeof value.timestamp === 'number' ? value.timestamp : Number.NaN
    const committedAt = typeof value.committedAt === 'string' ? value.committedAt : ''

    if (!hash || !Number.isFinite(timestamp) || timestamp <= 0 || Date.parse(committedAt) !== timestamp) {
        return null
    }

    return {
        hash,
        subject,
        timestamp,
        committedAt
    }
}

async function getRelativeSourcePath(repositoryRoot: string, requestedSourcePath: string) {
    const directRelativePath = path.relative(repositoryRoot, requestedSourcePath)

    if (directRelativePath && !directRelativePath.startsWith('..') && !path.isAbsolute(directRelativePath)) {
        return toPosixPath(directRelativePath)
    }

    const [realRepositoryRoot, realSourceDirectory] = await Promise.all([
        realpath(repositoryRoot),
        realpath(path.dirname(requestedSourcePath))
    ])
    const realRelativeDirectory = path.relative(realRepositoryRoot, realSourceDirectory)

    if (!realRelativeDirectory.startsWith('..') && !path.isAbsolute(realRelativeDirectory)) {
        return toPosixPath(path.join(realRelativeDirectory, path.basename(requestedSourcePath)))
    }

    return path.basename(requestedSourcePath)
}

async function getTrackedFiles(repositoryRoot: string) {
    const cached = trackedFilesCache.get(repositoryRoot)
    if (cached) return cached

    const pending = runGit(['ls-files', '-z'], repositoryRoot).then((output) => output.split('\0').filter(Boolean))
    trackedFilesCache.set(repositoryRoot, pending)
    return pending
}

async function resolveTrackedSourcePath(repositoryRoot: string, relativeSourcePath: string) {
    const trackedFiles = await getTrackedFiles(repositoryRoot)
    const normalizedNfcPath = relativeSourcePath.normalize('NFC')
    const normalizedNfdPath = relativeSourcePath.normalize('NFD')

    return (
        trackedFiles.find((filePath) => filePath === relativeSourcePath) ??
        trackedFiles.find(
            (filePath) =>
                filePath.normalize('NFC') === normalizedNfcPath || filePath.normalize('NFD') === normalizedNfdPath
        ) ??
        ''
    )
}

export async function readLatestGitCommitForPath(sourcePath: string, cwd: string): Promise<GitPathCommit | null> {
    const requestedSourcePath = path.resolve(cwd, sourcePath)
    const cacheKey = requestedSourcePath

    const cached = commitCache.get(cacheKey)
    if (cached) return cached

    const pending = readLatestGitCommitUncached(requestedSourcePath, cwd).catch(() => null)
    commitCache.set(cacheKey, pending)
    return pending
}

export async function readLatestGitCommitsForPaths(sourcePaths: string[], cwd: string) {
    const commits = new Map<string, GitPathCommit | null>(sourcePaths.map((sourcePath) => [sourcePath, null]))
    const existingPaths = sourcePaths.filter((sourcePath) => existsSync(path.resolve(cwd, sourcePath)))
    if (!existingPaths.length) return commits

    let repositoryRoot: string

    try {
        repositoryRoot = await getRepositoryRoot(cwd)
    } catch {
        return commits
    }

    try {
        const trackedPathToSources = new Map<string, string[]>()

        await Promise.all(
            existingPaths.map(async (sourcePath) => {
                const requestedSourcePath = path.resolve(cwd, sourcePath)
                const relativeSourcePath = await getRelativeSourcePath(repositoryRoot, requestedSourcePath)
                const trackedSourcePath = await resolveTrackedSourcePath(repositoryRoot, relativeSourcePath)
                if (!trackedSourcePath) return

                const sources = trackedPathToSources.get(trackedSourcePath) ?? []
                sources.push(sourcePath)
                trackedPathToSources.set(trackedSourcePath, sources)
            })
        )

        const trackedPaths = [...trackedPathToSources.keys()]
        if (!trackedPaths.length) return commits

        if (!(await ensureCompleteRepositoryHistory(repositoryRoot))) {
            const snapshot = await readGitMetadataSnapshot(repositoryRoot)

            for (const [trackedPath, matchingSources] of trackedPathToSources) {
                const commit = snapshot.get(trackedPath)
                if (!commit) continue

                for (const sourcePath of matchingSources) {
                    commits.set(sourcePath, commit)
                    commitCache.set(path.resolve(cwd, sourcePath), Promise.resolve(commit))
                }
            }

            return commits
        }

        const output = await runGit(
            [
                '-c',
                'log.showSignature=false',
                '-c',
                'core.quotepath=false',
                'log',
                '--format=%x1e%H%x1f%ct%x1f%s',
                '--name-only',
                '--',
                ...trackedPaths
            ],
            repositoryRoot
        )

        for (const record of output.split('\x1e')) {
            if (!record.trim()) continue

            const firstNewlineIndex = record.indexOf('\n')
            const header = firstNewlineIndex >= 0 ? record.slice(0, firstNewlineIndex) : record
            const changedPaths = firstNewlineIndex >= 0 ? record.slice(firstNewlineIndex + 1) : ''
            const [hash = '', timestampRaw = '', subject = ''] = header.trim().split('\x1f')
            const commit = createCommit(hash, timestampRaw, subject)
            if (!commit) continue

            for (const changedPath of changedPaths
                .split('\n')
                .map((value) => value.trim())
                .filter(Boolean)) {
                const matchingSources = trackedPathToSources.get(changedPath)
                if (!matchingSources) continue

                for (const sourcePath of matchingSources) {
                    if (commits.get(sourcePath)) continue
                    commits.set(sourcePath, commit)
                    commitCache.set(path.resolve(cwd, sourcePath), Promise.resolve(commit))
                }
            }

            if ([...trackedPathToSources.values()].flat().every((sourcePath) => commits.get(sourcePath))) {
                break
            }
        }
    } catch {
        return commits
    }

    return commits
}

async function readLatestGitCommitUncached(requestedSourcePath: string, cwd: string) {
    if (!existsSync(requestedSourcePath)) return null

    const repositoryRoot = await getRepositoryRoot(cwd)
    const relativeSourcePath = await getRelativeSourcePath(repositoryRoot, requestedSourcePath)
    const trackedSourcePath = await resolveTrackedSourcePath(repositoryRoot, relativeSourcePath)
    if (!trackedSourcePath) return null
    if (!(await ensureCompleteRepositoryHistory(repositoryRoot))) {
        return (await readGitMetadataSnapshot(repositoryRoot)).get(trackedSourcePath) ?? null
    }

    const output = await runGit(
        ['-c', 'log.showSignature=false', 'log', '-1', '--follow', '--format=%ct%x00%H%x00%s', '--', trackedSourcePath],
        repositoryRoot
    )
    const [timestampRaw = '', hash = '', subject = ''] = output.trim().split('\0')
    return createCommit(hash, timestampRaw, subject)
}

function createCommit(hash: string, timestampRaw: string, subject: string): GitPathCommit | null {
    const timestamp = Number(timestampRaw) * 1000

    if (!timestampRaw || !Number.isFinite(timestamp) || timestamp <= 0 || !hash) {
        return null
    }

    return {
        hash,
        subject,
        timestamp,
        committedAt: new Date(timestamp).toISOString()
    }
}
