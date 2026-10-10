import { createTiO2Project } from '../../packages/config/src/project.js'
import type { TiO2Project } from '../../packages/config/src/types'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'fs-extra'

async function createRepositoryFixture(rootDir: string) {
    await fs.ensureDir(join(rootDir, 'posts/alpha'))
    await fs.ensureDir(join(rootDir, 'topics/TiO2/Core'))
    await fs.ensureDir(join(rootDir, 'foundations/mathematics/logic-foundations'))
    await fs.ensureDir(join(rootDir, 'pages'))

    await Promise.all([
        fs.writeFile(
            join(rootDir, 'posts/alpha.md'),
            [
                '---',
                'title: Alpha',
                'date: 2026-03-30',
                'lastUpdated: 2026-03-31 09:10:11',
                'tags: [framework]',
                '---',
                '# Intro',
                '',
                'Alpha body',
                '',
                '![Cover](./alpha/cover.txt)',
                '[Attachment](<./alpha/read me.txt>)',
                '[cover-ref]: ./alpha/cover.txt',
                '',
                '`![Inline example](./alpha/example.png)`',
                '',
                '```md',
                '![Fenced example](./alpha/example.png)',
                '```'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/Core/Guide.md'),
            [
                '---',
                'title: Guide',
                'date: 2026-03-29',
                'topics: [TiO2/Core]',
                '---',
                '# Deep Dive',
                '',
                'Guide body'
            ].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'topics/TiO2/Core/_meta.md'),
            ['---', 'title: Core Topic', '---', 'Topic body'].join('\n')
        ),
        fs.writeFile(
            join(rootDir, 'pages/about.md'),
            ['---', 'title: About', '---', '# About', '', 'About body'].join('\n')
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
                'description: 形式系统。',
                'page: true',
                '---',
                '## 形式陈述',
                '内容。'
            ].join('\n')
        ),
        fs.writeFile(join(rootDir, 'index.md'), '# Derived index should stay unmanaged'),
        fs.writeFile(join(rootDir, 'posts/alpha/cover.txt'), 'cover')
    ])
}

async function withRepositoryFixture<T>(callback: (rootDir: string, project: TiO2Project) => Promise<T>) {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'tio2-repository-'))

    try {
        await createRepositoryFixture(rootDir)
        const project = createTiO2Project(rootDir, { site: { title: 'Fixture', url: 'https://example.test' } })
        return await callback(rootDir, project)
    } finally {
        await fs.remove(rootDir)
    }
}

test('TiO2 repository snapshot lists managed content without derived root pages', async () => {
    const { loadCmsLibrarySnapshot } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (_rootDir, project) => {
        const snapshot = await loadCmsLibrarySnapshot(project, { env: 'development' })

        assert.equal(snapshot.stats.post, 1)
        assert.equal(snapshot.stats.topic, 1)
        assert.equal(snapshot.stats.foundation, 1)
        assert.equal(snapshot.stats.page, 1)
        assert.equal(snapshot.stats.topicMeta, 1)
        assert.deepEqual(snapshot.content, { topicMetaFilename: '_meta.md', foundationDomains: [] })
        assert.deepEqual(snapshot.documents.find((item) => item.kind === 'foundation')?.foundation, {
            id: 'propositional-logic',
            kind: 'model',
            equivalent_to: [],
            contrasts_with: []
        })
        assert.equal(snapshot.documents.find((item) => item.sourcePath === 'posts/alpha.md')?.date, '2026-03-30')
        assert.deepEqual(
            snapshot.documents.map((item) => item.sourcePath),
            [
                'posts/alpha.md',
                'topics/TiO2/Core/Guide.md',
                'foundations/mathematics/logic-foundations/propositional-logic.md',
                'pages/about.md',
                'topics/TiO2/Core/_meta.md'
            ]
        )
        assert.deepEqual(
            snapshot.tree.map((root) => ({ path: root.path, count: root.documentCount })),
            [
                { path: 'posts', count: 1 },
                { path: 'topics', count: 2 },
                { path: 'foundations', count: 1 },
                { path: 'pages', count: 1 }
            ]
        )
        assert.equal(snapshot.tree[1]?.children[0]?.type, 'directory')
    })
})

test('TiO2 repository production snapshot excludes ignored pages', async () => {
    const { loadCmsLibrarySnapshot } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        await fs.ensureDir(join(rootDir, 'pages/draft'))
        await fs.writeFile(
            join(rootDir, 'pages/draft/hidden.md'),
            ['---', 'title: Hidden Draft', '---', 'Draft body'].join('\n')
        )

        const developmentSnapshot = await loadCmsLibrarySnapshot(project, { env: 'development' })
        const productionSnapshot = await loadCmsLibrarySnapshot(project, { env: 'production' })

        assert.equal(
            developmentSnapshot.documents.some((item) => item.sourcePath === 'pages/draft/hidden.md'),
            true
        )
        assert.equal(
            productionSnapshot.documents.some((item) => item.sourcePath === 'pages/draft/hidden.md'),
            false
        )
    })
})

test('TiO2 repository detail loader preserves article structure and asset directory hints', async () => {
    const { readCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (_rootDir, project) => {
        const document = await readCmsDocument(project, 'posts/alpha.md')

        assert.equal(document.kind, 'post')
        assert.equal(document.title, 'Alpha')
        assert.equal(document.frontmatter.date, '2026-03-30')
        assert.equal(document.frontmatter.lastUpdated, '2026-03-31 09:10:11')
        assert.equal(document.assetDirectoryPath, 'posts/alpha')
        assert.deepEqual(document.headings, [{ level: 1, title: 'Intro', slug: 'intro' }])
        assert.match(document.body, /^# Intro\n\nAlpha body/)
    })
})

test('TiO2 repository only treats supported companion directories as assets', async () => {
    const { deleteCmsDocument, readCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        await fs.ensureDir(join(rootDir, 'pages/about'))
        await fs.writeFile(join(rootDir, 'pages/about/keep.txt'), 'keep')
        await fs.writeFile(join(rootDir, 'posts/not-a-directory.md'), '# File companion')
        await fs.writeFile(join(rootDir, 'posts/not-a-directory'), 'keep')

        const page = await readCmsDocument(project, 'pages/about.md')
        const post = await readCmsDocument(project, 'posts/not-a-directory.md')
        const result = await deleteCmsDocument(project, {
            sourcePath: 'pages/about.md',
            removeAssetDirectory: true
        })

        assert.equal(page.assetDirectoryPath, null)
        assert.equal(post.assetDirectoryPath, null)
        assert.equal(result.removedAssetDirectory, false)
        assert.equal(await fs.pathExists(join(rootDir, 'pages/about/keep.txt')), true)
        assert.equal(await fs.pathExists(join(rootDir, 'posts/not-a-directory')), true)
    })
})

test('CMS exposes configured domains and extracts public structure for non-article documents', async () => {
    const { loadCmsLibrarySnapshot, readCmsDocument } = await import('../../packages/content-fs/src/index.js')
    await withRepositoryFixture(async (rootDir) => {
        const project = createTiO2Project(rootDir, {
            site: { title: 'Fixture', url: 'https://example.test' },
            foundations: {
                groups: [
                    {
                        id: 'logic',
                        title: 'Logic',
                        englishTitle: 'Logic',
                        description: '',
                        domains: [{ id: 'logic/formal', group: 'logic', title: 'Formal systems', description: '' }]
                    }
                ]
            }
        })
        for (const path of [
            'pages/about.md',
            'topics/TiO2/Core/_meta.md',
            'foundations/mathematics/logic-foundations/propositional-logic.md'
        ]) {
            await fs.appendFile(
                join(rootDir, path),
                '\n\n## Public heading\n\n[[propositional-logic]]\n\n```md\n## Code example\n[[code-only]]\n```\n\n::: encrypt password\n## Private heading\n[[secret-only]]\n:::'
            )
            const document = await readCmsDocument(project, path)
            assert.ok(document.headings.some((heading) => heading.title === 'Public heading'))
            assert.equal(
                document.headings.some((heading) => /Private|Code/.test(heading.title)),
                false
            )
            assert.deepEqual(
                document.references.map((reference) => reference.raw),
                ['propositional-logic']
            )
            assert.doesNotMatch(document.excerpt, /secret-only/)
        }
        const snapshot = await loadCmsLibrarySnapshot(project)
        assert.deepEqual(snapshot.content.foundationDomains, [{ id: 'logic/formal', title: 'Logic / Formal systems' }])
    })
})

test('CMS foundation form creates and updates files accepted by the foundation loader', async () => {
    const { createCmsDocument, updateCmsDocument } = await import('../../packages/content-fs/src/index.js')
    const { loadFoundationDocument } = await import('../../packages/content-fs/src/foundations.js')
    const { createEmptyDraft, buildCreateInputFromDraft, createDraftFromDocument, buildUpdateInputFromDraft } =
        await import('../../apps/cms-web/src/draft.js')
    await withRepositoryFixture(async (rootDir, project) => {
        const draft = createEmptyDraft('foundation', {
            title: 'Test concept',
            description: 'A useful concept.',
            domains: ['mathematics/logic-foundations']
        })
        const created = await createCmsDocument(
            project,
            buildCreateInputFromDraft('foundations/test-concept.md', draft)
        )
        const editing = createDraftFromDocument(created)
        editing.aliasesText = 'Concept\n概念'
        editing.relations.requires = ['propositional-logic']
        editing.body = '## Definition\n\n[[propositional-logic]]'
        const saved = await updateCmsDocument(project, buildUpdateInputFromDraft(editing))
        const parsed = await loadFoundationDocument(join(rootDir, saved.sourcePath))
        assert.deepEqual(parsed.requires, ['propositional-logic'])
        assert.deepEqual(parsed.aliases, ['Concept', '概念'])
        assert.equal(saved.headings[0].title, 'Definition')
    })
})

test('TiO2 repository creator writes new markdown files and optional asset directories', async () => {
    const { createCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        const created = await createCmsDocument(project, {
            targetPath: 'posts/new-entry.md',
            frontmatter: {
                title: 'New Entry',
                date: '2026-03-31',
                tags: ['cms']
            },
            body: '# New Entry\n\nFresh content',
            createAssetDirectory: true
        })

        const persisted = await fs.readFile(join(rootDir, 'posts/new-entry.md'), 'utf8')

        assert.equal(created.title, 'New Entry')
        assert.equal(await fs.pathExists(join(rootDir, 'posts/new-entry')), true)
        assert.match(persisted, /title: New Entry/)
        assert.match(persisted, /Fresh content/)
    })
})

test('TiO2 repository updater writes editable frontmatter back to markdown sources', async () => {
    const { readCmsDocument, updateCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        const original = await readCmsDocument(project, 'posts/alpha.md')

        const updated = await updateCmsDocument(project, {
            sourcePath: 'posts/alpha.md',
            frontmatter: {
                ...original.frontmatter,
                title: 'Alpha Updated',
                description: 'Updated summary',
                tags: ['framework', 'cms'],
                topics: ['TiO2/Core'],
                order: '3',
                draftState: {
                    color: 'blue'
                }
            },
            body: '# Intro\n\nUpdated body'
        })

        const persisted = await fs.readFile(join(rootDir, 'posts/alpha.md'), 'utf8')

        assert.equal(updated.title, 'Alpha Updated')
        assert.equal(updated.frontmatter.order, 3)
        assert.deepEqual(updated.frontmatter.tags, ['framework', 'cms'])
        assert.match(persisted, /title: Alpha Updated/)
        assert.match(persisted, /description: Updated summary/)
        assert.match(persisted, /order: 3/)
        assert.match(persisted, /draftState:\n {2}color: blue/)
        assert.match(persisted, /Updated body/)
    })
})

test('TiO2 repository mover renames source files and asset directories together', async () => {
    const { moveCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        const moved = await moveCmsDocument(project, {
            sourcePath: 'posts/alpha.md',
            targetPath: 'topics/TiO2/Core/Alpha Updated.md',
            moveAssetDirectory: true
        })

        assert.equal(moved.sourcePath, 'topics/TiO2/Core/Alpha Updated.md')
        assert.equal(await fs.pathExists(join(rootDir, 'posts/alpha.md')), false)
        assert.equal(await fs.pathExists(join(rootDir, 'posts/alpha')), false)
        assert.equal(await fs.pathExists(join(rootDir, 'topics/TiO2/Core/Alpha Updated.md')), true)
        assert.equal(await fs.pathExists(join(rootDir, 'topics/TiO2/Core/Alpha Updated')), true)

        const persisted = await fs.readFile(join(rootDir, 'topics/TiO2/Core/Alpha Updated.md'), 'utf8')
        assert.match(persisted, /!\[Cover\]\(<\.\/Alpha Updated\/cover\.txt>\)/)
        assert.match(persisted, /\[Attachment\]\(<\.\/Alpha Updated\/read me\.txt>\)/)
        assert.match(persisted, /\[cover-ref\]: <\.\/Alpha Updated\/cover\.txt>/)
        assert.match(persisted, /`!\[Inline example\]\(\.\/alpha\/example\.png\)`/)
        assert.match(persisted, /!\[Fenced example\]\(\.\/alpha\/example\.png\)/)
    })
})

test('TiO2 repository mover keeps asset references valid when the companion directory stays in place', async () => {
    const { moveCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        await moveCmsDocument(project, {
            sourcePath: 'posts/alpha.md',
            targetPath: 'topics/TiO2/Core/Alpha.md',
            moveAssetDirectory: false
        })

        const persisted = await fs.readFile(join(rootDir, 'topics/TiO2/Core/Alpha.md'), 'utf8')

        assert.match(persisted, /!\[Cover\]\(\.\.\/\.\.\/\.\.\/posts\/alpha\/cover\.txt\)/)
        assert.equal(await fs.pathExists(join(rootDir, 'posts/alpha')), true)
    })
})

test('TiO2 repository rejects traversal, absolute paths, and symbolic-link paths', async () => {
    const { createCmsDocument, readCmsDocument, updateCmsDocument } = await import(
        '../../packages/content-fs/src/index.js'
    )

    await withRepositoryFixture(async (rootDir, project) => {
        await fs.symlink(join(rootDir, 'index.md'), join(rootDir, 'posts/linked.md'))

        await assert.rejects(() => readCmsDocument(project, 'posts/../index.md'), /invalid segment/)
        await assert.rejects(() => readCmsDocument(project, 'posts/line\nbreak.md'), /control characters/)
        await assert.rejects(() => readCmsDocument(project, join(rootDir, 'posts/alpha.md')), /repository-relative/)
        await assert.rejects(() => readCmsDocument(project, 'posts/linked.md'), /symbolic links/)
        await assert.rejects(
            () =>
                createCmsDocument(project, {
                    targetPath: 'posts/../../escape.md',
                    frontmatter: { title: 'Escape' },
                    body: 'Nope'
                }),
            /invalid segment/
        )
        await assert.rejects(
            () =>
                updateCmsDocument(project, {
                    sourcePath: 'posts/missing.md',
                    frontmatter: { title: 'Missing' },
                    body: 'Nope'
                }),
            /Document not found/
        )

        assert.equal(await fs.readFile(join(rootDir, 'index.md'), 'utf8'), '# Derived index should stay unmanaged')
        assert.equal(await fs.pathExists(join(rootDir, 'escape.md')), false)
        assert.equal(await fs.pathExists(join(rootDir, 'posts/missing.md')), false)
    })
})

test('TiO2 repository validates move destinations before changing source files', async () => {
    const { moveCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        await fs.ensureDir(join(rootDir, 'topics/TiO2/Core/Alpha Updated'))

        await assert.rejects(
            () =>
                moveCmsDocument(project, {
                    sourcePath: 'posts/alpha.md',
                    targetPath: 'topics/TiO2/Core/Alpha Updated.md',
                    moveAssetDirectory: true
                }),
            /Target asset directory already exists/
        )

        assert.equal(await fs.pathExists(join(rootDir, 'posts/alpha.md')), true)
        assert.equal(await fs.pathExists(join(rootDir, 'posts/alpha')), true)
        assert.equal(await fs.pathExists(join(rootDir, 'topics/TiO2/Core/Alpha Updated.md')), false)
    })
})

test('TiO2 repository deleter removes source files and optional asset directories', async () => {
    const { deleteCmsDocument } = await import('../../packages/content-fs/src/index.js')

    await withRepositoryFixture(async (rootDir, project) => {
        const result = await deleteCmsDocument(project, {
            sourcePath: 'posts/alpha.md',
            removeAssetDirectory: true
        })

        assert.equal(result.removedAssetDirectory, true)
        assert.equal(await fs.pathExists(join(rootDir, 'posts/alpha.md')), false)
        assert.equal(await fs.pathExists(join(rootDir, 'posts/alpha')), false)
        assert.equal(await fs.pathExists(join(rootDir, '.tio2-tmp')), false)
    })
})

test('TiO2 repository operations isolate configured projects without changing cwd', async () => {
    const {
        createCmsDocument,
        readCmsDocument,
        updateCmsDocument,
        moveCmsDocument,
        deleteCmsDocument,
        loadCmsLibrarySnapshot
    } = await import('../../packages/content-fs/src/index.js')
    const cwd = process.cwd()
    const directory = await mkdtemp(join(os.tmpdir(), 'tio2-repositories-'))
    const projects = ['first', 'second'].map((name) =>
        createTiO2Project(join(directory, name), {
            site: { title: name, url: `https://${name}.test` },
            content: {
                postsDir: 'writing/articles',
                topicsDir: 'knowledge/topics',
                pagesDir: 'site/pages',
                foundationsDir: 'knowledge/concepts',
                topicMetaFilename: 'summary.md'
            }
        })
    )

    try {
        await Promise.all(
            projects.map((project) =>
                createCmsDocument(project, {
                    targetPath: 'writing/articles/nested/entry.md',
                    body: `# ${project.config.site.title}\n\n![Image](./entry/image.txt)`,
                    frontmatter: { title: project.config.site.title },
                    createAssetDirectory: true
                })
            )
        )
        for (const project of projects) {
            await fs.writeFile(
                join(project.rootDir, 'writing/articles/nested/entry/image.txt'),
                project.config.site.title
            )
        }
        const [first, second] = projects
        await createCmsDocument(first, {
            targetPath: 'knowledge/topics/summary.md',
            body: 'Topic metadata',
            frontmatter: { title: 'Custom topic' }
        })
        await updateCmsDocument(first, {
            sourcePath: 'knowledge/topics/summary.md',
            body: 'Updated metadata',
            frontmatter: { title: 'Updated topic' }
        })
        assert.equal((await readCmsDocument(first, 'knowledge/topics/summary.md')).kind, 'topicMeta')
        const moved = await moveCmsDocument(first, {
            sourcePath: 'writing/articles/nested/entry.md',
            targetPath: 'knowledge/topics/moved.md',
            moveAssetDirectory: true
        })
        assert.equal(moved.title, 'first')
        assert.match(moved.body, /\.\/moved\/image\.txt/)
        assert.equal(await fs.readFile(join(first.rootDir, 'knowledge/topics/moved/image.txt'), 'utf8'), 'first')
        assert.equal(await fs.pathExists(join(first.rootDir, 'writing/articles/nested')), false)
        assert.equal(await fs.pathExists(join(first.rootDir, 'writing/articles')), true)
        const [firstSnapshot, secondSnapshot] = await Promise.all(
            projects.map((project) => loadCmsLibrarySnapshot(project))
        )
        assert.equal(firstSnapshot.stats.topicMeta, 1)
        assert.deepEqual(firstSnapshot.content, { topicMetaFilename: 'summary.md', foundationDomains: [] })
        assert.deepEqual(secondSnapshot.content, { topicMetaFilename: 'summary.md', foundationDomains: [] })
        assert.equal(firstSnapshot.stats.topic, 1)
        assert.equal(secondSnapshot.stats.post, 1)
        assert.equal(firstSnapshot.tree[0].path, 'writing/articles')
        assert.equal((await readCmsDocument(second, 'writing/articles/nested/entry.md')).title, 'second')
        await assert.rejects(
            () => readCmsDocument(first, '../second/writing/articles/nested/entry.md'),
            /invalid segment/
        )
        await fs.symlink(join(second.rootDir, 'writing/articles'), join(first.rootDir, 'knowledge/topics/linked'))
        await assert.rejects(() => readCmsDocument(first, 'knowledge/topics/linked/nested/entry.md'), /symbolic links/)
        await deleteCmsDocument(first, { sourcePath: 'knowledge/topics/moved.md', removeAssetDirectory: true })
        assert.equal(await fs.pathExists(join(first.rootDir, 'knowledge/topics/moved')), false)
        assert.equal(await fs.pathExists(join(first.rootDir, '.tio2-tmp')), false)
        assert.equal(
            await fs.readFile(join(second.rootDir, 'writing/articles/nested/entry/image.txt'), 'utf8'),
            'second'
        )
        assert.equal(process.cwd(), cwd)
    } finally {
        await fs.remove(directory)
    }
})
