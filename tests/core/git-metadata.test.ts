import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { readLatestGitCommitForPath, readLatestGitCommitsForPaths } from '../../packages/content-fs/src/git-metadata.js'

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
    return new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: {
                ...process.env,
                ...env
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

            reject(new Error(stderr.trim() || `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
        })
    })
}

test('TiO2 git metadata reads the latest path-related commit', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tio2-git-metadata-'))
    const sourcePath = path.join(rootDir, 'posts', 'alpha.md')
    const gitEnv = {
        GIT_AUTHOR_NAME: 'TiO2 Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'TiO2 Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_AUTHOR_DATE: '2026-03-30T07:08:09Z',
        GIT_COMMITTER_DATE: '2026-03-30T07:08:09Z'
    }

    try {
        await fs.ensureDir(path.dirname(sourcePath))
        await fs.writeFile(sourcePath, 'alpha')
        await run('git', ['init'], rootDir)
        await run('git', ['add', '.'], rootDir)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: add alpha'], rootDir, gitEnv)

        const commit = await readLatestGitCommitForPath('posts/alpha.md', rootDir)

        assert.equal(commit?.committedAt, '2026-03-30T07:08:09.000Z')
        assert.equal(commit?.subject, 'docs: add alpha')
        assert.match(commit?.hash ?? '', /^[a-f0-9]{40}$/u)
    } finally {
        await fs.remove(rootDir)
    }
})

test('TiO2 git metadata batches latest commits for multiple Unicode paths', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tio2-git-metadata-batch-'))
    const alphaPath = path.join(rootDir, 'posts', 'alpha.md')
    const unicodePath = path.join(rootDir, 'posts', '中文标题.md')
    const baseGitEnv = {
        GIT_AUTHOR_NAME: 'TiO2 Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'TiO2 Test',
        GIT_COMMITTER_EMAIL: 'test@example.com'
    }

    try {
        await fs.ensureDir(path.dirname(alphaPath))
        await fs.writeFile(alphaPath, 'alpha')
        await fs.writeFile(unicodePath, 'unicode')
        await run('git', ['init'], rootDir)
        await run('git', ['add', '.'], rootDir)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: add articles'], rootDir, {
            ...baseGitEnv,
            GIT_AUTHOR_DATE: '2026-03-29T07:08:09Z',
            GIT_COMMITTER_DATE: '2026-03-29T07:08:09Z'
        })

        await fs.writeFile(unicodePath, 'unicode updated')
        await run('git', ['add', '.'], rootDir)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: update unicode'], rootDir, {
            ...baseGitEnv,
            GIT_AUTHOR_DATE: '2026-03-30T08:09:10Z',
            GIT_COMMITTER_DATE: '2026-03-30T08:09:10Z'
        })

        const commits = await readLatestGitCommitsForPaths(['posts/alpha.md', 'posts/中文标题.md'], rootDir)

        assert.equal(commits.get('posts/alpha.md')?.subject, 'docs: add articles')
        assert.equal(commits.get('posts/中文标题.md')?.subject, 'docs: update unicode')
        assert.equal(commits.get('posts/中文标题.md')?.committedAt, '2026-03-30T08:09:10.000Z')
    } finally {
        await fs.remove(rootDir)
    }
})

test('TiO2 git metadata deepens shallow clones before reading modification dates', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'tio2-git-metadata-source-'))
    const cloneParent = await mkdtemp(path.join(os.tmpdir(), 'tio2-git-metadata-clone-'))
    const cloneRoot = path.join(cloneParent, 'repo')
    const alphaPath = path.join(sourceRoot, 'posts', 'alpha.md')
    const betaPath = path.join(sourceRoot, 'posts', 'beta.md')
    const previousGitRemoteUrl = process.env.TIO2_GIT_REMOTE_URL
    const baseGitEnv = {
        GIT_AUTHOR_NAME: 'TiO2 Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'TiO2 Test',
        GIT_COMMITTER_EMAIL: 'test@example.com'
    }

    try {
        await fs.ensureDir(path.dirname(alphaPath))
        await fs.writeFile(alphaPath, 'alpha')
        await run('git', ['init'], sourceRoot)
        await run('git', ['add', '.'], sourceRoot)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: add alpha'], sourceRoot, {
            ...baseGitEnv,
            GIT_AUTHOR_DATE: '2026-03-29T07:08:09Z',
            GIT_COMMITTER_DATE: '2026-03-29T07:08:09Z'
        })

        await fs.writeFile(betaPath, 'beta')
        await run('git', ['add', '.'], sourceRoot)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: add beta'], sourceRoot, {
            ...baseGitEnv,
            GIT_AUTHOR_DATE: '2026-03-30T08:09:10Z',
            GIT_COMMITTER_DATE: '2026-03-30T08:09:10Z'
        })

        await run('git', ['clone', '--depth', '1', pathToFileURL(sourceRoot).href, cloneRoot], cloneParent)
        await run('git', ['remote', 'remove', 'origin'], cloneRoot)
        process.env.TIO2_GIT_REMOTE_URL = pathToFileURL(sourceRoot).href
        assert.equal((await run('git', ['rev-parse', '--is-shallow-repository'], cloneRoot)).trim(), 'true')

        const commits = await readLatestGitCommitsForPaths(['posts/alpha.md', 'posts/beta.md'], cloneRoot)

        assert.equal(commits.get('posts/alpha.md')?.committedAt, '2026-03-29T07:08:09.000Z')
        assert.equal(commits.get('posts/beta.md')?.committedAt, '2026-03-30T08:09:10.000Z')
        assert.equal((await run('git', ['rev-parse', '--is-shallow-repository'], cloneRoot)).trim(), 'false')
    } finally {
        if (previousGitRemoteUrl === undefined) {
            delete process.env.TIO2_GIT_REMOTE_URL
        } else {
            process.env.TIO2_GIT_REMOTE_URL = previousGitRemoteUrl
        }
        await fs.remove(sourceRoot)
        await fs.remove(cloneParent)
    }
})

test('TiO2 git metadata falls back to a committed snapshot for private shallow clones', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'tio2-git-metadata-private-source-'))
    const cloneParent = await mkdtemp(path.join(os.tmpdir(), 'tio2-git-metadata-private-clone-'))
    const cloneRoot = path.join(cloneParent, 'repo')
    const alphaPath = path.join(sourceRoot, 'posts', 'alpha.md')
    const betaPath = path.join(sourceRoot, 'posts', 'beta.md')
    const previousGitRemoteUrl = process.env.TIO2_GIT_REMOTE_URL
    const baseGitEnv = {
        GIT_AUTHOR_NAME: 'TiO2 Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'TiO2 Test',
        GIT_COMMITTER_EMAIL: 'test@example.com'
    }

    try {
        delete process.env.TIO2_GIT_REMOTE_URL
        await fs.ensureDir(path.dirname(alphaPath))
        await fs.writeFile(alphaPath, 'alpha')
        await run('git', ['init'], sourceRoot)
        await run('git', ['add', '.'], sourceRoot)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: add alpha'], sourceRoot, {
            ...baseGitEnv,
            GIT_AUTHOR_DATE: '2026-03-29T07:08:09Z',
            GIT_COMMITTER_DATE: '2026-03-29T07:08:09Z'
        })
        const alphaHash = (await run('git', ['rev-parse', 'HEAD'], sourceRoot)).trim()

        await fs.writeFile(betaPath, 'beta')
        await run('git', ['add', '.'], sourceRoot)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: add beta'], sourceRoot, {
            ...baseGitEnv,
            GIT_AUTHOR_DATE: '2026-03-30T08:09:10Z',
            GIT_COMMITTER_DATE: '2026-03-30T08:09:10Z'
        })
        const betaHash = (await run('git', ['rev-parse', 'HEAD'], sourceRoot)).trim()

        await fs.ensureDir(path.join(sourceRoot, '.tio2'))
        await fs.writeJson(
            path.join(sourceRoot, '.tio2', 'git-metadata.json'),
            {
                version: 1,
                paths: {
                    'posts/alpha.md': {
                        hash: alphaHash,
                        subject: 'docs: add alpha',
                        committedAt: '2026-03-29T07:08:09.000Z',
                        timestamp: Date.parse('2026-03-29T07:08:09.000Z')
                    },
                    'posts/beta.md': {
                        hash: betaHash,
                        subject: 'docs: add beta',
                        committedAt: '2026-03-30T08:09:10.000Z',
                        timestamp: Date.parse('2026-03-30T08:09:10.000Z')
                    }
                }
            },
            { spaces: 2 }
        )
        await run('git', ['add', '.'], sourceRoot)
        await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'chore: snapshot metadata'], sourceRoot, {
            ...baseGitEnv,
            GIT_AUTHOR_DATE: '2026-03-31T09:10:11Z',
            GIT_COMMITTER_DATE: '2026-03-31T09:10:11Z'
        })

        await run('git', ['clone', '--depth', '1', pathToFileURL(sourceRoot).href, cloneRoot], cloneParent)
        await run('git', ['remote', 'remove', 'origin'], cloneRoot)
        assert.equal((await run('git', ['rev-parse', '--is-shallow-repository'], cloneRoot)).trim(), 'true')

        const commits = await readLatestGitCommitsForPaths(['posts/alpha.md', 'posts/beta.md'], cloneRoot)

        assert.equal(commits.get('posts/alpha.md')?.committedAt, '2026-03-29T07:08:09.000Z')
        assert.equal(commits.get('posts/beta.md')?.committedAt, '2026-03-30T08:09:10.000Z')
        assert.equal((await run('git', ['rev-parse', '--is-shallow-repository'], cloneRoot)).trim(), 'true')
    } finally {
        if (previousGitRemoteUrl === undefined) {
            delete process.env.TIO2_GIT_REMOTE_URL
        } else {
            process.env.TIO2_GIT_REMOTE_URL = previousGitRemoteUrl
        }
        await fs.remove(sourceRoot)
        await fs.remove(cloneParent)
    }
})

test('git metadata caches keep identical source paths in independent repositories separate', async () => {
    const roots = await Promise.all(
        ['left', 'right'].map((name) => mkdtemp(path.join(os.tmpdir(), `tio2-git-${name}-`)))
    )
    try {
        await Promise.all(
            roots.map(async (rootDir, index) => {
                await fs.outputFile(path.join(rootDir, 'posts/same.md'), `project ${index}`)
                await run('git', ['init'], rootDir)
                await run('git', ['add', '.'], rootDir)
                await run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', `docs: project ${index}`], rootDir, {
                    GIT_AUTHOR_NAME: 'TiO2 Test',
                    GIT_AUTHOR_EMAIL: 'test@example.com',
                    GIT_COMMITTER_NAME: 'TiO2 Test',
                    GIT_COMMITTER_EMAIL: 'test@example.com',
                    GIT_AUTHOR_DATE: `2026-03-${29 + index}T07:08:09Z`,
                    GIT_COMMITTER_DATE: `2026-03-${29 + index}T07:08:09Z`
                })
            })
        )
        const commits = await Promise.all(roots.map((rootDir) => readLatestGitCommitForPath('posts/same.md', rootDir)))
        assert.equal(commits[0]?.subject, 'docs: project 0')
        assert.equal(commits[1]?.subject, 'docs: project 1')
        const batches = await Promise.all(
            roots.map((rootDir) => readLatestGitCommitsForPaths(['posts/same.md'], rootDir))
        )
        assert.equal(batches[0].get('posts/same.md')?.hash, commits[0]?.hash)
        assert.equal(batches[1].get('posts/same.md')?.hash, commits[1]?.hash)
    } finally {
        await Promise.all(roots.map((rootDir) => fs.remove(rootDir)))
    }
})
