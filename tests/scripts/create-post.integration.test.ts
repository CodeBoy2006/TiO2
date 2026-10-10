import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import fs from 'fs-extra'

const execFile = promisify(execFileCallback)
const scriptPath = fileURLToPath(new URL('../../scripts/create-post.mjs', import.meta.url))
const postsDir = 'content/notes/posts'
const topicsDir = 'content/collections'
const timezoneOffset = '+05:45'

async function createFixtureRoot(offset = timezoneOffset, language = 'zh-CN') {
    const tempDir = await mkdtemp(join(os.tmpdir(), 'tio2-create-post-'))
    const rootDir = join(tempDir, 'consumer')
    const foreignDir = join(tempDir, 'foreign')
    await Promise.all([
        fs.ensureDir(join(rootDir, postsDir)),
        fs.ensureDir(join(rootDir, topicsDir, 'TiO2/Core')),
        fs.ensureDir(foreignDir)
    ])

    await Promise.all([
        fs.writeFile(
            join(rootDir, 'tio2.config.mjs'),
            `export default ${JSON.stringify({
                site: {
                    title: 'Consumer site',
                    url: 'https://consumer.test',
                    timezoneOffset: offset,
                    language
                },
                content: { postsDir, topicsDir, topicMetaFilename: 'index.md' }
            })}`
        ),
        fs.writeFile(
            join(rootDir, postsDir, 'existing.md'),
            [
                '---',
                'title: Existing',
                'date: 2026-03-20 12:00:00',
                'tags: [TiO2, CLI]',
                'topics: [TiO2/Core]',
                'description: 现有文章',
                'category: 开发',
                '---'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, topicsDir, 'TiO2/Core/index.md'),
            ['---', 'title: Core', 'category: Metadata only', 'tags: [MetadataTag]', '---', 'Topic body'].join('\n')
        )
    ])

    return { tempDir, rootDir, foreignDir }
}

async function runCreatePost(
    args: string[],
    fixture: Awaited<ReturnType<typeof createFixtureRoot>>,
    projectFromCwd = false
) {
    const env: NodeJS.ProcessEnv = { ...process.env, TZ: 'UTC' }
    delete env.TIO2_PROJECT_ROOT
    if (!projectFromCwd) env.TIO2_PROJECT_ROOT = fixture.rootDir
    return execFile('node', [scriptPath, ...args], {
        cwd: projectFromCwd ? fixture.rootDir : fixture.foreignDir,
        env
    })
}

test('TiO2 create-post CLI supports dry runs without mutating the content tree', async () => {
    const fixture = await createFixtureRoot()
    const { rootDir } = fixture

    try {
        const startedAt = Date.now()
        const { stdout, stderr } = await runCreatePost(
            [
                'TiO2 Draft Post',
                '--category',
                '开发',
                '--tags',
                'TiO2, CLI, TiO2',
                '--topics',
                'TiO2\\\\Core, TiO2/Core',
                '--description',
                '给 TiO2 CLI 做测试',
                '--dry-run'
            ],
            fixture
        )

        assert.equal(stderr, '')
        assert.match(stdout, /已生成预览（未写入文件）/)
        assert.match(stdout, /content\/notes\/posts\/TiO2 Draft Post\.md/)
        assert.match(stdout, /图片目录\s+content\/notes\/posts\/TiO2 Draft Post/)
        assert.match(stdout, /tags: \[TiO2, CLI]/)
        assert.match(stdout, /topics: \[TiO2\/Core]/)
        assert.match(stdout, /description: 给 TiO2 CLI 做测试/)
        assert.match(stdout, /TiO2\/Core\s+2/)
        assert.doesNotMatch(stdout, /Metadata only|MetadataTag/)
        const date = stdout.match(/date: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)?.[1]
        assert.ok(date)
        const timestamp = Date.parse(`${date.replace(' ', 'T')}${timezoneOffset}`)
        assert.ok(timestamp >= startedAt - 1000 && timestamp <= Date.now())
        assert.equal(await fs.pathExists(join(rootDir, postsDir, 'TiO2 Draft Post.md')), false)
        assert.equal(await fs.pathExists(join(rootDir, postsDir, 'TiO2 Draft Post')), false)
        assert.deepEqual(await fs.readdir(fixture.foreignDir), [])
    } finally {
        await fs.remove(fixture.tempDir)
    }
})

test('TiO2 create-post uses English UI while preserving authored metadata', async () => {
    const fixture = await createFixtureRoot(timezoneOffset, 'en-GB')
    try {
        const { stdout } = await runCreatePost(['English draft', '--dry-run'], fixture)
        assert.match(stdout, /Preview generated \(no files written\)/)
        assert.match(stdout, /Image description/)
        assert.match(stdout, /Popular tags \(top 2 \/ 2\)/)
        assert.match(stdout, /开发/, 'Authored category names are not translated')
        assert.doesNotMatch(stdout, /已生成预览|待填写|图片目录/)
        const help = await runCreatePost(['--help'], fixture)
        assert.match(help.stdout, /Usage/)
        assert.match(help.stdout, /Article title/)
        assert.equal(await fs.pathExists(join(fixture.rootDir, postsDir, 'English draft.md')), false)
    } finally {
        await fs.remove(fixture.tempDir)
    }
})

test('TiO2 create-post CLI creates article files and asset directories for real runs', async () => {
    const fixture = await createFixtureRoot()
    const { rootDir } = fixture

    try {
        const { stdout, stderr } = await runCreatePost(
            ['真实文章', '-c', '框架', '-t', 'TiO2', '-p', 'TiO2/Core', '-d', '真实创建测试'],
            fixture
        )

        const filePath = join(rootDir, postsDir, '真实文章.md')
        const assetDir = join(rootDir, postsDir, '真实文章')
        const content = await fs.readFile(filePath, 'utf8')

        assert.equal(stderr, '')
        assert.match(stdout, /已创建新文章/)
        assert.equal(await fs.pathExists(filePath), true)
        assert.equal(await fs.pathExists(assetDir), true)
        assert.match(content, /^---\ntitle: 真实文章\n/)
        assert.match(content, /tags: \[TiO2]/)
        assert.match(content, /topics: \[TiO2\/Core]/)
        assert.match(content, /description: 真实创建测试/)
        assert.match(content, /category: 框架/)
        assert.deepEqual(await fs.readdir(fixture.foreignDir), [])
    } finally {
        await fs.remove(fixture.tempDir)
    }
})

test('TiO2 create-post CLI reports duplicate filenames as user-facing errors', async () => {
    const fixture = await createFixtureRoot()

    try {
        await assert.rejects(
            () => runCreatePost(['existing'], fixture),
            (error: unknown) => {
                assert.ok(error && typeof error === 'object')
                const stderr = String((error as { stderr?: string }).stderr ?? '')
                assert.match(stderr, /\[post:new] 文件已存在：content\/notes\/posts\/existing\.md/)
                return true
            }
        )
    } finally {
        await fs.remove(fixture.tempDir)
    }
})

test('TiO2 create-post CLI defaults to the current consumer project and its negative timezone offset', async () => {
    const fixture = await createFixtureRoot('-03:30')

    try {
        const startedAt = Date.now()
        const { stdout, stderr } = await runCreatePost(['Current project', '--dry-run'], fixture, true)
        assert.equal(stderr, '')
        assert.match(stdout, /content\/notes\/posts\/Current project\.md/)
        const date = stdout.match(/date: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)?.[1]
        assert.ok(date)
        const timestamp = Date.parse(`${date.replace(' ', 'T')}-03:30`)
        assert.ok(timestamp >= startedAt - 1000 && timestamp <= Date.now())
    } finally {
        await fs.remove(fixture.tempDir)
    }
})

test('TiO2 create-post CLI reports a missing consumer config without falling back to the installation', async () => {
    const fixture = await createFixtureRoot()

    try {
        await fs.remove(join(fixture.rootDir, 'tio2.config.mjs'))
        await assert.rejects(
            () => runCreatePost(['Missing config'], fixture),
            (error: unknown) => {
                assert.ok(error && typeof error === 'object')
                const stderr = String((error as { stderr?: string }).stderr ?? '')
                assert.ok(stderr.includes(`[post:new] Missing TiO2 configuration in ${fixture.rootDir}`))
                return true
            }
        )
        assert.equal(await fs.pathExists(join(fixture.rootDir, postsDir, 'Missing config.md')), false)
    } finally {
        await fs.remove(fixture.tempDir)
    }
})
