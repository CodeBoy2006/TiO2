import { createTiO2Project } from '../../packages/config/src/project.js'
import type { TiO2Project } from '../../packages/config/src/types.js'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'fs-extra'

const fixtureConfig = {
    site: { title: 'Fixture', url: 'https://example.com' },
    content: { productionIgnorePatterns: ['**/draft/**/*.md'] },
    foundations: {
        groups: [
            {
                id: 'mathematics',
                title: 'Math',
                englishTitle: 'Math',
                description: 'Fixture',
                domains: [
                    {
                        id: 'mathematics/logic-foundations',
                        group: 'mathematics',
                        title: 'Logic',
                        description: 'Fixture'
                    }
                ]
            }
        ]
    }
}

async function createFixtureSite(rootDir: string) {
    await fs.ensureDir(join(rootDir, 'pages'))
    await fs.ensureDir(join(rootDir, 'posts/draft'))
    await fs.ensureDir(join(rootDir, 'topics/TiO2/Core'))
    await fs.ensureDir(join(rootDir, 'topics/TiO2/draft'))
    await fs.ensureDir(join(rootDir, 'foundations/mathematics/logic-foundations/draft'))

    await Promise.all([
        fs.writeFile(join(rootDir, 'pages/topics.md'), '---\ntitle: Topics\n---\n'),
        fs.writeFile(
            join(rootDir, 'posts/alpha.md'),
            [
                '---',
                'title: Alpha',
                'date: 2026-03-28 8:0:0',
                'tags:',
                '  - alpha',
                'topics:',
                '  - TiO2/Core',
                '---',
                '# Alpha Heading',
                '',
                'Alpha intro with [[Guide#Deep Dive|guide section]] and [[topic:TiO2/Core|Core Topic]].'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'posts/beta.md'),
            ['---', 'title: Beta', 'date: 2026-03-30', 'order: 2', '---', 'Beta content.'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'posts/draft/ignored.md'),
            ['---', 'title: Draft Post', 'date: 2026-03-31', '---', 'Should be ignored in production.'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/_meta.md'),
            ['---', 'title: TiO2 Topic', 'description: Framework root topic', 'order: 5', '---', 'Ignored body.'].join(
                '\n'
            )
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/Core/_meta.md'),
            ['---', 'title: Core Topic', '---', 'Core topic body description.'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/Core/Guide.md'),
            [
                '---',
                'title: Guide',
                'date: 2026-03-29',
                'tags:',
                '  - guide',
                '---',
                '# Deep Dive',
                '',
                'Guide explanation paragraph.',
                '^proof'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/draft/ignored.md'),
            ['---', 'title: Draft Topic', 'date: 2026-03-31', '---', 'Should also be ignored in production.'].join('\n')
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
                '## 形式陈述',
                '命题由联结词组合。'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'foundations/mathematics/logic-foundations/modus-ponens.md'),
            [
                '---',
                'title: 肯定前件',
                'id: modus-ponens',
                'aliases: [Modus ponens]',
                'kind: principle',
                'domains: [mathematics/logic-foundations]',
                'requires: [propositional-logic]',
                'uses: []',
                'implemented_by: []',
                'special_case_of: []',
                'equivalent_to: []',
                'contrasts_with: []',
                'description: 从 P 与 P 蕴含 Q 推出 Q。',
                'page: true',
                '---',
                '## 形式陈述',
                '$P, P \\to Q \\vdash Q$。参见 [[foundation:propositional-logic|命题逻辑]]。'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'foundations/mathematics/logic-foundations/draft/ignored.md'),
            [
                '---',
                'title: Draft Foundation',
                'id: ignored',
                'aliases: []',
                'kind: definition',
                'domains: [mathematics/logic-foundations]',
                'requires: []',
                'uses: []',
                'implemented_by: []',
                'special_case_of: []',
                'equivalent_to: []',
                'contrasts_with: []',
                'description: Draft.',
                'page: true',
                '---',
                'Broken [[foundation:missing-foundation]].'
            ].join('\n')
        )
    ])
}

async function withFixtureSite<T>(
    production: boolean,
    callback: (rootDir: string, project: TiO2Project, env: string) => Promise<T>
) {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'tio2-server-utils-'))

    try {
        await createFixtureSite(rootDir)
        return await callback(
            rootDir,
            createTiO2Project(rootDir, fixtureConfig),
            production ? 'production' : 'development'
        )
    } finally {
        await fs.remove(rootDir)
    }
}

test('TiO2 site content orchestrates fixture content across production and development modes', async (t) => {
    const { loadPosts, loadSiteContent } = await import('../../packages/content-fs/src/site-content.js')

    await t.test('production mode ignores configured draft content and builds a coherent content graph', async () => {
        await withFixtureSite(true, async (rootDir, project, env) => {
            const { posts } = await loadPosts(project, { env })

            assert.deepEqual(
                posts.map((post) => post.sourcePath),
                ['posts/beta.md', 'posts/alpha.md']
            )
            assert.equal(posts[0].nextSourcePath, 'posts/alpha.md')
            assert.equal(posts[1].previousSourcePath, 'posts/beta.md')
            assert.equal(await fs.pathExists(join(rootDir, 'index.md')), false)
            assert.equal(await fs.pathExists(join(rootDir, 'page_2.md')), false)

            const siteContent = await loadSiteContent(project, { env })
            const [rootTopic] = siteContent.topics.roots
            const [coreTopic] = rootTopic.children

            assert.deepEqual(
                siteContent.posts.map((post) => post.sourcePath),
                ['posts/beta.md', 'posts/alpha.md']
            )
            assert.deepEqual(
                siteContent.topicArticles.map((post) => post.sourcePath),
                ['topics/TiO2/Core/Guide.md']
            )
            assert.deepEqual(
                siteContent.articles.map((post) => post.sourcePath),
                ['posts/beta.md', 'posts/alpha.md', 'topics/TiO2/Core/Guide.md']
            )
            assert.equal(siteContent.topics.topicCount, 2)
            assert.equal(siteContent.topics.articleCount, 2)
            assert.equal(siteContent.foundations.entryCount, 2)
            assert.deepEqual(
                siteContent.foundations.entries.map((entry) => entry.id),
                ['modus-ponens', 'propositional-logic']
            )
            assert.equal(siteContent.references.targets['foundation:propositional-logic']?.type, 'foundation')
            assert.deepEqual(
                siteContent.references.outgoingBySourcePath[
                    'foundations/mathematics/logic-foundations/modus-ponens.md'
                ]?.map((reference) => reference.targetId),
                ['foundation:propositional-logic']
            )
            assert.equal(
                siteContent.references.backlinksByTargetId['foundation:propositional-logic']?.[0]?.sourceSourcePath,
                'foundations/mathematics/logic-foundations/modus-ponens.md'
            )

            assert.equal(rootTopic.key, 'TiO2')
            assert.equal(rootTopic.title, 'TiO2 Topic')
            assert.equal(rootTopic.description, 'Framework root topic')
            assert.equal(rootTopic.order, 5)
            assert.equal(rootTopic.articleCount, 2)

            assert.equal(coreTopic.key, 'TiO2/Core')
            assert.equal(coreTopic.title, 'Core Topic')
            assert.equal(coreTopic.description, 'Core topic body description.')
            assert.equal(coreTopic.directArticleCount, 2)
            assert.equal(coreTopic.articleCount, 2)
            assert.deepEqual(
                coreTopic.articles.map((article) => article.sourcePath),
                ['topics/TiO2/Core/Guide.md', 'posts/alpha.md']
            )
            assert.deepEqual(coreTopic.articles[0].topicTrail, [
                { key: 'TiO2', title: 'TiO2 Topic' },
                { key: 'TiO2/Core', title: 'Core Topic' }
            ])

            assert.deepEqual(
                siteContent.references.outgoingBySourcePath['posts/alpha.md']?.map((reference) => reference.targetId),
                ['heading:topics/TiO2/Core/Guide.md#deep-dive', 'topic:TiO2/Core']
            )
            assert.equal(
                siteContent.references.backlinksByTargetId['heading:topics/TiO2/Core/Guide.md#deep-dive']?.[0]
                    ?.sourceSourcePath,
                'posts/alpha.md'
            )
            assert.equal(
                siteContent.references.backlinksByTargetId['topic:TiO2/Core']?.[0]?.sourceSourcePath,
                'posts/alpha.md'
            )
            assert.deepEqual(siteContent.references.unresolvedBySourcePath, {})
            assert.ok(
                Object.keys(siteContent.references.targets).every(
                    (targetId) => !targetId.includes('draft') && !targetId.includes('ignored')
                )
            )
        })
    })

    await t.test('development mode keeps draft content available for preview workflows', async () => {
        await withFixtureSite(false, async (_rootDir, project, env) => {
            const { posts } = await loadPosts(project, { env })
            const siteContent = await loadSiteContent(project, { env })

            assert.deepEqual(
                posts.map((post) => post.sourcePath),
                ['posts/beta.md', 'posts/draft/ignored.md', 'posts/alpha.md']
            )
            assert.ok(siteContent.topicArticles.some((post) => post.sourcePath === 'topics/TiO2/draft/ignored.md'))
            assert.ok(siteContent.foundations.entries.some((entry) => entry.id === 'ignored'))
            assert.deepEqual(
                siteContent.references.unresolvedBySourcePath[
                    'foundations/mathematics/logic-foundations/draft/ignored.md'
                ],
                ['foundation:missing-foundation']
            )
            assert.ok(
                siteContent.references.targets['article:topics/TiO2/draft/ignored.md'],
                'draft topic articles should stay visible outside production mode'
            )
        })
    })

    await t.test('production mode rejects unresolved foundation references', async () => {
        await withFixtureSite(true, async (rootDir, project, env) => {
            await fs.appendFile(
                join(rootDir, 'foundations/mathematics/logic-foundations/modus-ponens.md'),
                '\n[[foundation:missing-foundation]]'
            )

            await assert.rejects(
                loadSiteContent(project, { env }),
                /Invalid foundation references:[\s\S]*modus-ponens\.md: foundation:missing-foundation/u
            )
        })
    })
})

test('topic references only resolve when their index page is published', async () => {
    const { loadSiteContent } = await import('../../packages/content-fs/src/site-content.js')
    await withFixtureSite(true, async (rootDir, project, env) => {
        const withIndex = await loadSiteContent(project, { env })
        assert.equal(withIndex.references.targets['topic:TiO2/Core']?.href, '/pages/topics.html#topic-tio2-core')
        await fs.remove(join(rootDir, 'pages/topics.md'))
        const withoutIndex = await loadSiteContent(project, { env })
        assert.equal(withoutIndex.topics.topicCount, 2)
        assert.equal(withoutIndex.references.targets['topic:TiO2/Core'], undefined)
        assert.deepEqual(withoutIndex.references.unresolvedBySourcePath['posts/alpha.md'], ['topic:TiO2/Core|Core Topic'])
        assert.ok(
            !withoutIndex.references.outgoingBySourcePath['posts/alpha.md']?.some(
                (reference) => reference.targetId === 'topic:TiO2/Core'
            )
        )
    })
})

test('independent project roots load concurrently with custom paths, metadata and taxonomies', async () => {
    const { loadSiteContent } = await import('../../packages/content-fs/src/site-content.js')
    const cwd = process.cwd()
    const roots = await Promise.all(['left', 'right'].map((name) => mkdtemp(join(os.tmpdir(), `tio2-${name}-`))))
    try {
        const projects = await Promise.all(
            roots.map(async (rootDir, index) => {
                const name = index ? 'right' : 'left'
                const domain = `${name}/basics`
                const project = createTiO2Project(rootDir, {
                    site: { title: name, url: `https://${name}.example`, authorUrl: '/people/author' },
                    content: {
                        postsDir: `${name}/writing`,
                        topicsDir: `${name}/subjects`,
                        foundationsDir: `${name}/knowledge`,
                        pagesDir: `${name}/pages`,
                        topicMetaFilename: 'topic.md',
                        productionIgnorePatterns: ['**/draft/**/*.md']
                    },
                    foundations: {
                        groups: [
                            {
                                id: name,
                                title: name,
                                englishTitle: name,
                                description: name,
                                domains: [{ id: domain, group: name, title: name, description: name }]
                            }
                        ],
                        routes: [
                            {
                                id: name,
                                title: name,
                                audience: name,
                                promise: name,
                                type: 'core',
                                entries: ['concept', 'application']
                            },
                            {
                                id: 'draft-route',
                                title: name,
                                audience: name,
                                promise: name,
                                type: 'core',
                                entries: ['concept', 'draft-concept']
                            }
                        ]
                    }
                })
                const foundation = (id: string) =>
                    [
                        '---',
                        `title: ${name} ${id}`,
                        `id: ${id}`,
                        'aliases: []',
                        'kind: definition',
                        `domains: [${domain}]`,
                        'requires: []',
                        'uses: []',
                        'implemented_by: []',
                        'special_case_of: []',
                        'equivalent_to: []',
                        'contrasts_with: []',
                        `description: ${name}`,
                        'page: true',
                        '---',
                        'Content'
                    ].join('\n')
                await Promise.all([
                    fs.outputFile(
                        join(rootDir, project.config.content.postsDir, 'article.md'),
                        `---\ntitle: ${name}\ndate: 2026-03-30\n---\n[[foundation:concept]]`
                    ),
                    fs.outputFile(
                        join(rootDir, project.config.content.topicsDir, 'subject/topic.md'),
                        `---\ntitle: ${name} topic\n---\nDescription`
                    ),
                    fs.outputFile(
                        join(rootDir, project.config.content.topicsDir, 'subject/guide.md'),
                        `---\ntitle: ${name} guide\n---\nContent`
                    ),
                    fs.outputFile(
                        join(rootDir, project.config.content.foundationsDir, 'concept.md'),
                        foundation('concept')
                    ),
                    fs.outputFile(
                        join(rootDir, project.config.content.foundationsDir, 'application.md'),
                        foundation('application')
                    ),
                    fs.outputFile(
                        join(rootDir, project.config.content.foundationsDir, 'draft/draft-concept.md'),
                        foundation('draft-concept')
                    ),
                    fs.outputFile(
                        join(rootDir, project.config.content.pagesDir, 'about.md'),
                        `---\ntitle: ${name} page\n---\nContent`
                    )
                ])
                return project
            })
        )
        const contents = await Promise.all(projects.map((project) => loadSiteContent(project, { env: 'production' })))
        for (const [index, content] of contents.entries()) {
            const name = index ? 'right' : 'left'
            assert.equal(content.posts[0].frontMatter.title, name)
            assert.equal(content.posts[0].sourcePath, `${name}/writing/article.md`)
            assert.equal(content.topics.roots[0].title, `${name} topic`)
            assert.equal(content.topicArticles.length, 1)
            assert.deepEqual(content.foundations.entries[0].domains, [`${name}/basics`])
            assert.deepEqual(
                content.foundations.groups.map((group) => group.id),
                [name]
            )
            assert.deepEqual(
                content.foundations.routes.map((route) => route.id),
                [name]
            )
            assert.equal(
                content.publishing.entries.find((entry) => entry.kind === 'page')?.sourcePath,
                `${name}/pages/about.md`
            )
            assert.equal(content.publishing.entries[0].title, name)
            assert.deepEqual(content.references.unresolvedBySourcePath, {})
        }
        assert.equal(process.cwd(), cwd)
    } finally {
        await Promise.all(roots.map((rootDir) => fs.remove(rootDir)))
    }
})
