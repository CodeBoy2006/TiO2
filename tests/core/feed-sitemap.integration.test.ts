import { createTiO2Project } from '../../packages/config/src/project.js'
import type { TiO2Project } from '../../packages/config/src/types.js'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'fs-extra'
import { loadSiteContent } from '../../packages/content-fs/src/site-content.js'
import { writePublishingArtifacts } from '../../packages/content-fs/src/publishing.js'
const tio2Config = {
    site: {
        title: "Writer's Notebook",
        url: 'https://example.test',
        author: 'A writer',
        authorUrl: 'https://example.test/pages/about.html',
        language: 'zh-CN',
        timezoneOffset: '+08:00'
    },
    foundations: {
        groups: [
            {
                id: 'mathematics',
                title: 'Mathematics',
                englishTitle: 'Mathematics',
                description: 'Fixture domains.',
                domains: [
                    { id: 'mathematics/logic-foundations', group: 'mathematics', title: 'Logic', description: 'Logic.' }
                ]
            }
        ]
    }
}

async function createPublishingFixture(rootDir: string) {
    await fs.ensureDir(join(rootDir, 'pages'))
    await fs.ensureDir(join(rootDir, 'posts/draft'))
    await fs.ensureDir(join(rootDir, 'topics/TiO2/draft'))
    await fs.ensureDir(join(rootDir, 'foundations/mathematics/logic-foundations'))

    await Promise.all([
        fs.writeFile(
            join(rootDir, 'posts/alpha.md'),
            [
                '---',
                'title: "Alpha & Beta"',
                'description: "Alpha <tag> & desc"',
                'date: 2026-03-28 8:0:0',
                'lastUpdated: 2026-03-29 9:10:11',
                'category: Framework',
                'tags:',
                '  - alpha',
                '  - beta',
                '  - alpha',
                '---',
                'Alpha body'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'posts/beta.md'),
            ['---', 'title: Beta', 'description: Newest post', 'date: 2026-03-30', '---', 'Beta body'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'posts/draft/ignored.md'),
            ['---', 'title: Draft Post', 'date: 2026-03-31', '---', 'Should not appear in production outputs.'].join(
                '\n'
            )
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/Guide.md'),
            ['---', 'title: Guide', 'description: Topic guide', 'date: 2026-03-29', '---', 'Guide body'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/draft/ignored.md'),
            ['---', 'title: Draft Topic', 'date: 2026-03-31', '---', 'Should not appear in sitemap output.'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'pages/about.md'),
            ['---', 'title: About', 'description: About this site', 'date: 2026-03-30', '---', 'About body'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'foundations/mathematics/logic-foundations/propositional-logic.md'),
            [
                '---',
                'title: 命题逻辑',
                'id: propositional-logic',
                'aliases: [Propositional logic]',
                'kind: model',
                'domains: [mathematics/logic-foundations]',
                'requires: []',
                'uses: []',
                'implemented_by: []',
                'special_case_of: []',
                'equivalent_to: []',
                'contrasts_with: []',
                'description: 研究命题及其真值组合的形式系统。',
                'page: true',
                '---',
                'Foundation body'
            ].join('\n')
        ),
        fs.writeFile(join(rootDir, 'pages/ledger.md'), ['---', 'title: Ledger', '---', 'Proof ledger'].join('\n')),
        fs.writeFile(
            join(rootDir, 'pages/加密 说明.md'),
            ['---', 'title: 加密说明', '---', 'Encryption guide'].join('\n')
        )
    ])
}

async function withPublishingFixture<T>(callback: (rootDir: string, project: TiO2Project) => Promise<T>) {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'tio2-publish-'))

    try {
        await createPublishingFixture(rootDir)
        return await callback(rootDir, createTiO2Project(rootDir, tio2Config))
    } finally {
        await fs.remove(rootDir)
    }
}

test('TiO2 publishing pipeline generates stable feed and sitemap outputs from fixture content', async () => {
    await withPublishingFixture(async (rootDir, project) => {
        const outputDirectory = join(rootDir, '.tio2-tmp/site')
        const { publishing } = await loadSiteContent(project, { env: 'production' })
        await writePublishingArtifacts(publishing, outputDirectory, project.config.site, project.config.integrations)

        const rssFeed = await fs.readFile(join(outputDirectory, 'feed.xml'), 'utf8')
        const jsonFeed = JSON.parse(await fs.readFile(join(outputDirectory, 'feed.json'), 'utf8'))
        const atomFeed = await fs.readFile(join(outputDirectory, 'atom.xml'), 'utf8')
        const sitemap = await fs.readFile(join(outputDirectory, 'sitemap.xml'), 'utf8')

        assert.deepEqual(
            jsonFeed.items.map((item: { title: string }) => item.title),
            ['Beta', 'Alpha & Beta']
        )
        assert.deepEqual(jsonFeed.items[1].tags, ['Framework', 'alpha', 'beta'])
        assert.equal(jsonFeed.authors[0].url, project.config.site.authorUrl)
        assert.equal(jsonFeed.items[0].url, 'https://example.test/posts/beta.html')
        assert.equal(jsonFeed.items[1].url, 'https://example.test/posts/alpha.html')
        assert.equal(jsonFeed.items[0].date_published, '2026-03-29T16:00:00.000Z')
        assert.equal(jsonFeed.items[1].date_published, '2026-03-28T00:00:00.000Z')
        assert.equal(jsonFeed.items[1].date_modified, '2026-03-29T01:10:11.000Z')
        assert.equal(
            jsonFeed.items.some((item: { title: string }) => item.title === 'Draft Post'),
            false
        )
        assert.equal(
            jsonFeed.items.some((item: { title: string }) => item.title === '命题逻辑'),
            false
        )

        assert.match(rssFeed, /<title>Writer&apos;s Notebook<\/title>/)
        assert.match(rssFeed, /<category>Framework<\/category>/)
        assert.match(rssFeed, /<!\[CDATA\[Alpha <tag> & desc\]\]>/)
        assert.doesNotMatch(rssFeed, /Draft Post/)

        assert.match(atomFeed, /<title>Writer&apos;s Notebook<\/title>/)
        assert.match(atomFeed, /<uri>https:\/\/example\.test\/pages\/about\.html<\/uri>/)
        assert.doesNotMatch(atomFeed, /Draft Post/)

        assert.match(sitemap, /<loc>https:\/\/example\.test\/<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.test\/pages\/about\.html<\/loc>/)
        assert.match(sitemap, /<lastmod>2026-03-29T16:00:00\.000Z<\/lastmod>/)
        assert.match(sitemap, /<loc>https:\/\/example\.test\/pages\/ledger\.html<\/loc>/)
        assert.match(
            sitemap,
            /<loc>https:\/\/example\.test\/pages\/%E5%8A%A0%E5%AF%86%20%E8%AF%B4%E6%98%8E\.html<\/loc>/
        )
        assert.doesNotMatch(sitemap, /<loc>https:\/\/example\.test\/page_2\.html<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.test\/posts\/alpha\.html<\/loc>/)
        assert.match(sitemap, /<loc>https:\/\/example\.test\/topics\/TiO2\/Guide\.html<\/loc>/)
        assert.match(
            sitemap,
            /<loc>https:\/\/example\.test\/foundations\/mathematics\/logic-foundations\/propositional-logic\.html<\/loc>/
        )
        assert.doesNotMatch(sitemap, /draft\/ignored/)
    })
})

test('TiO2 publishing pipeline rejects an invalid output directory', async () => {
    await withPublishingFixture(async (rootDir, project) => {
        const outputPath = join(rootDir, 'blocked-output')
        const { publishing } = await loadSiteContent(project, { env: 'production' })
        await fs.writeFile(outputPath, 'not a directory')

        await assert.rejects(
            writePublishingArtifacts(publishing, outputPath, project.config.site, project.config.integrations)
        )
    })
})

test('TiO2 publishing integration flags control which artifacts are emitted', async () => {
    const outputDirectory = await mkdtemp(join(os.tmpdir(), 'tio2-publish-flags-'))
    const manifest = {
        generatedAt: '2026-07-15T00:00:00.000Z',
        entries: []
    }
    const site = {
        title: 'TiO2',
        url: 'https://example.com',
        description: 'Fixture',
        language: 'zh-CN',
        author: 'A writer',
        authorUrl: '/author'
    }

    try {
        await writePublishingArtifacts(manifest, outputDirectory, site, {
            feed: false,
            sitemap: true
        })

        assert.equal(await fs.pathExists(join(outputDirectory, 'sitemap.xml')), true)
        assert.equal(await fs.pathExists(join(outputDirectory, 'feed.xml')), false)

        await fs.emptyDir(outputDirectory)
        await writePublishingArtifacts(manifest, outputDirectory, site, {
            feed: true,
            sitemap: false
        })

        assert.equal(await fs.pathExists(join(outputDirectory, 'sitemap.xml')), false)
        assert.equal(await fs.pathExists(join(outputDirectory, 'feed.xml')), true)
        assert.equal(await fs.pathExists(join(outputDirectory, 'atom.xml')), true)
        assert.equal(await fs.pathExists(join(outputDirectory, 'feed.json')), true)
        const jsonFeed = await fs.readJson(join(outputDirectory, 'feed.json'))
        assert.equal(jsonFeed.authors[0].url, 'https://example.com/author')
        assert.match(
            await fs.readFile(join(outputDirectory, 'atom.xml'), 'utf8'),
            /<uri>https:\/\/example\.com\/author<\/uri>/
        )
    } finally {
        await fs.remove(outputDirectory)
    }
})
