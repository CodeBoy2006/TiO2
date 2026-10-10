import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'fs-extra'
import { loadArticleDocument } from '../../packages/content-fs/src/index.js'

test('TiO2 article document loader hydrates metadata and extracted structures', async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), 'tio2-article-loader-'))
    const sourcePath = join(tempDir, 'TiO2 Loader.md')

    try {
        await fs.writeFile(
            sourcePath,
            [
                '---',
                'title: " TiO2 Loader "',
                'description: "  Article summary  "',
                'date: 2026-03-30 7:8:9',
                'lastUpdated: 2026-03-31 9:10:11',
                'order: "7"',
                'aigc: "76.66%"',
                'aiModel: "GPT-4 / Claude / gpt4"',
                'tags:',
                '  - framework',
                '  - 123',
                'topics:',
                '  - " TiO2 \\\\ Core "',
                '  - "TiO2/Core"',
                'cover:',
                '  src: " /covers/loader.svg "',
                '  alt: " Loader cover "',
                '  fit: contain',
                '  position: " 40% 50% "',
                '---',
                '# Intro',
                '',
                'Proof overview paragraph.',
                '^proof',
                '',
                'Paragraph with [[Reference Target|Visible Label]] and ![[topic:TiO2|TiO2 Topic]].',
                '',
                '```md',
                '## Hidden',
                '![[Ignored]]',
                '```'
            ].join('\n')
        )

        const document = await loadArticleDocument(sourcePath, 'post', 'all')

        assert.equal(document.post.frontMatter.title, 'TiO2 Loader')
        assert.equal(document.post.frontMatter.description, 'Article summary')
        assert.equal(document.post.frontMatter.date, '2026-03-30')
        assert.equal(document.post.frontMatter.publishedAt, '2026-03-30 07:08:09')
        assert.equal(document.post.frontMatter.lastUpdated, '2026-03-31 09:10:11')
        assert.equal(document.post.frontMatter.order, 7)
        assert.equal(document.post.frontMatter.aigcRate, 76.7)
        assert.deepEqual(document.post.frontMatter.aigcModels, ['openai', 'claude'])
        assert.deepEqual(document.post.frontMatter.tags, ['framework'])
        assert.deepEqual(document.post.frontMatter.topics, ['TiO2/Core'])
        assert.deepEqual(document.post.frontMatter.cover, {
            src: '/covers/loader.svg',
            alt: 'Loader cover',
            fit: 'contain',
            position: '40% 50%'
        })
        assert.equal(document.post.kind, 'post')
        assert.equal(document.post.collectionKey, 'all')
        assert.equal(document.post.sourcePath, sourcePath)
        assert.ok(document.post.regularPath.endsWith('.html'))
        assert.ok(document.post.articleTargetId.endsWith(sourcePath))
        assert.match(document.post.excerpt, /^Intro Proof overview paragraph\./)
        assert.ok(!document.post.excerpt.includes('[['))
        assert.ok(document.post.frontMatter.wordCount > 0)
        assert.equal(document.post.frontMatter.readingTime, 1)

        assert.deepEqual(document.headings, [{ level: 1, title: 'Intro', slug: 'intro' }])
        assert.deepEqual(document.blocks, [{ anchor: 'proof', excerpt: 'Proof overview paragraph.' }])
        assert.deepEqual(document.references, [
            {
                raw: 'Reference Target|Visible Label',
                label: 'Visible Label',
                embed: false,
                context: 'Paragraph with Visible Label and TiO2 Topic.'
            },
            {
                raw: 'topic:TiO2|TiO2 Topic',
                label: 'TiO2 Topic',
                embed: true,
                context: 'Paragraph with Visible Label and TiO2 Topic.'
            }
        ])
    } finally {
        await fs.remove(tempDir)
    }
})

test('TiO2 article document loader falls back to filename titles and safe defaults', async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), 'tio2-article-loader-fallback-'))
    const sourcePath = join(tempDir, 'Fallback Demo.md')

    try {
        await fs.writeFile(sourcePath, 'Body without frontmatter.')

        const document = await loadArticleDocument(sourcePath, 'topic', 'topics')

        assert.equal(document.post.frontMatter.title, 'Fallback Demo')
        assert.equal(document.post.frontMatter.description, '')
        assert.equal(document.post.frontMatter.date, '')
        assert.equal(document.post.frontMatter.publishedAt, '')
        assert.equal(document.post.frontMatter.lastUpdated, '')
        assert.equal(document.post.frontMatter.order, 0)
        assert.equal(document.post.frontMatter.aigcRate, undefined)
        assert.equal(document.post.frontMatter.aigcModels, undefined)
        assert.equal(document.post.frontMatter.humanWritten, undefined)
        assert.deepEqual(document.post.frontMatter.tags, [])
        assert.deepEqual(document.post.frontMatter.topics, [])
        assert.equal(document.post.frontMatter.cover, undefined)
        assert.equal(document.post.kind, 'topic')
        assert.equal(document.post.collectionKey, 'topics')
        assert.deepEqual(document.headings, [])
        assert.deepEqual(document.blocks, [])
        assert.deepEqual(document.references, [])
        assert.match(document.post.excerpt, /^Body without frontmatter\./)
    } finally {
        await fs.remove(tempDir)
    }
})

test('TiO2 article document loader excludes encrypted content from public metadata', async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), 'tio2-article-loader-encrypted-'))
    const sourcePath = join(tempDir, 'Encrypted Demo.md')

    try {
        await fs.writeFile(
            sourcePath,
            [
                '---',
                'title: Encrypted Demo',
                'date: 2026-07-15',
                '---',
                '::: encrypt password="demo"',
                '# Secret heading',
                '',
                'Secret excerpt with [[Hidden Target]].',
                '^secret-anchor',
                ':::',
                '',
                '# Public heading',
                '',
                'Public excerpt with [[Visible Target]].'
            ].join('\n')
        )

        const document = await loadArticleDocument(sourcePath, 'post', 'posts')

        assert.match(document.post.excerpt, /^Public heading Public excerpt with Visible Target\./)
        assert.ok(!document.post.excerpt.includes('Secret'))
        assert.deepEqual(document.headings, [{ level: 1, title: 'Public heading', slug: 'public-heading' }])
        assert.deepEqual(document.blocks, [])
        assert.deepEqual(document.references, [
            {
                raw: 'Visible Target',
                label: '',
                embed: false,
                context: 'Public excerpt with Visible Target.'
            }
        ])
    } finally {
        await fs.remove(tempDir)
    }
})

test('TiO2 article document loader reads the human-written declaration and rejects contradictions', async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), 'tio2-article-loader-human-'))
    const load = async (name: string, frontmatter: string[]) => {
        const sourcePath = join(tempDir, `${name}.md`)
        await fs.writeFile(
            sourcePath,
            ['---', `title: ${name}`, 'date: 2026-09-23', ...frontmatter, '---', 'Body.'].join('\n')
        )
        return loadArticleDocument(sourcePath, 'post', 'posts')
    }

    try {
        const declared = await load('Declared', ['humanWritten: true'])
        assert.equal(declared.post.frontMatter.humanWritten, true)
        assert.equal(declared.post.frontMatter.aigcRate, undefined)

        const alias = await load('Alias', ['noAI: true'])
        assert.equal(alias.post.frontMatter.humanWritten, true)

        const zeroRate = await load('Zero Rate', ['humanWritten: true', 'aigcRate: 0'])
        assert.equal(zeroRate.post.frontMatter.humanWritten, true)
        assert.equal(zeroRate.post.frontMatter.aigcRate, 0)

        const notDeclared = await load('Not Declared', ['humanWritten: false', 'aigcRate: 40'])
        assert.equal(notDeclared.post.frontMatter.humanWritten, undefined)
        assert.equal(notDeclared.post.frontMatter.aigcRate, 40)

        await assert.rejects(
            load('Rate Conflict', ['humanWritten: true', 'aigcRate: 40']),
            /Rate Conflict\.md: humanWritten: true conflicts with aigcRate: 40/
        )
        await assert.rejects(
            load('Model Conflict', ['humanWritten: true', 'aigcModels: [deepseek]']),
            /Model Conflict\.md: humanWritten: true conflicts with aigcModels/
        )
        await assert.rejects(
            load('Invalid Value', ['humanWritten: "yes"']),
            /Invalid Value\.md: humanWritten must be true or false/
        )
    } finally {
        await fs.remove(tempDir)
    }
})
