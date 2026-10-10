import assert from 'node:assert/strict'
import test from 'node:test'
import type { CmsLibraryItem, CmsLibraryTreeRoot } from '../../packages/cms-contract/src/index'

test('TiO2 CMS editor metrics normalize empty and multiline markdown', async () => {
    const { getEditorMetrics } = await import('../../apps/cms-web/src/editor-metrics.js')

    assert.deepEqual(getEditorMetrics(''), {
        lines: 1,
        words: 0,
        characters: 0
    })

    assert.deepEqual(getEditorMetrics('# Title\r\n\r\nHello TiO2'), {
        lines: 3,
        words: 4,
        characters: 19
    })
})

test('TiO2 CMS draft helpers create deterministic defaults and append unique suggestions', async () => {
    const {
        appendCsvValue,
        buildCreateInputFromDraft,
        buildUpdateInputFromDraft,
        createDraftFromDocument,
        createEmptyDraft,
        uniqueDraftValues
    } = await import('../../apps/cms-web/src/draft.js')
    const localDate = new Date(2026, 6, 15, 12)
    const draft = createEmptyDraft('post', { title: 'Draft' }, localDate)

    assert.equal(draft.title, 'Draft')
    assert.equal(draft.date, '2026-07-15')
    assert.equal(draft.lastUpdated, '')
    assert.equal(draft.coverSrc, '')
    assert.equal(draft.coverFit, 'cover')
    assert.equal(draft.coverPosition, 'center')
    assert.equal(createEmptyDraft('page', {}, localDate).date, '')
    const foundationDraft = createEmptyDraft('foundation', { title: '群' }, localDate)
    assert.equal(foundationDraft.date, '')
    assert.equal(foundationDraft.foundationKind, 'definition')
    assert.equal(appendCsvValue('alpha, beta', 'beta'), 'alpha, beta')
    assert.equal(appendCsvValue('alpha, beta', 'gamma'), 'alpha, beta, gamma')
    assert.deepEqual(uniqueDraftValues([' beta ', '', 'alpha', 'beta']), ['alpha', 'beta'])

    const documentDraft = createDraftFromDocument({
        sourcePath: 'posts/demo.md',
        kind: 'post',
        title: 'Demo',
        body: 'Body',
        excerpt: 'Body',
        frontmatter: {
            title: 'Demo',
            lastUpdated: '2026-07-16 12:34:56',
            cover: {
                src: '/covers/demo.svg',
                alt: 'Demo cover',
                fit: 'contain',
                position: '55% 40%'
            },
            custom: true
        },
        headings: [],
        references: [],
        assetDirectoryPath: null
    })

    assert.equal(documentDraft.coverSrc, '/covers/demo.svg')
    assert.equal(documentDraft.coverFit, 'contain')
    assert.equal(documentDraft.lastUpdated, '2026-07-16 12:34:56')
    assert.equal(documentDraft.extraFrontmatterJson, '{\n  "custom": true\n}')
    assert.equal(buildUpdateInputFromDraft(documentDraft).frontmatter.lastUpdated, '2026-07-16 12:34:56')
    assert.deepEqual(buildUpdateInputFromDraft(documentDraft).frontmatter.cover, {
        src: '/covers/demo.svg',
        alt: 'Demo cover',
        fit: 'contain',
        position: '55% 40%'
    })
    assert.equal(buildUpdateInputFromDraft(createEmptyDraft('post')).frontmatter.cover, undefined)
    assert.equal(buildUpdateInputFromDraft(createEmptyDraft('post')).frontmatter.lastUpdated, undefined)
    assert.deepEqual(buildUpdateInputFromDraft(foundationDraft).frontmatter, {
        title: '群',
        description: '',
        aliases: [],
        kind: 'definition',
        domains: [],
        requires: [],
        uses: [],
        implemented_by: [],
        special_case_of: [],
        equivalent_to: [],
        contrasts_with: [],
        page: true
    })
    assert.equal(
        buildCreateInputFromDraft('foundations/mathematics/algebra-structures/group.md', foundationDraft).frontmatter
            .id,
        'group'
    )
    assert.equal(
        buildUpdateInputFromDraft(
            createEmptyDraft('post', {
                extraFrontmatterJson: '{"cover":{"src":"/covers/legacy.svg"}}'
            })
        ).frontmatter.cover,
        undefined
    )
})

test('TiO2 CMS preview links target previewable documents and encode unicode paths', async () => {
    const {
        buildEmbeddedPreviewHref,
        buildPreviewHref,
        cmsPreviewContentOnlyMode,
        cmsPreviewModeParam,
        cmsPreviewOrigin,
        cmsPreviewRefreshParam
    } = await import('../../apps/cms-web/src/preview-link.js')

    assert.equal(
        buildPreviewHref({
            kind: 'post',
            sourcePath: 'posts/年度总结 2025.md'
        }),
        `${cmsPreviewOrigin}/posts/%E5%B9%B4%E5%BA%A6%E6%80%BB%E7%BB%93%202025`
    )

    assert.equal(
        buildPreviewHref({
            kind: 'topicMeta',
            sourcePath: 'topics/年度总结/_meta.md'
        }),
        cmsPreviewOrigin
    )

    assert.equal(
        buildEmbeddedPreviewHref(
            {
                kind: 'post',
                sourcePath: 'posts/年度总结 2025.md'
            },
            7
        ),
        `${cmsPreviewOrigin}/posts/%E5%B9%B4%E5%BA%A6%E6%80%BB%E7%BB%93%202025?${cmsPreviewRefreshParam}=7&${cmsPreviewModeParam}=${cmsPreviewContentOnlyMode}`
    )

    assert.equal(
        buildPreviewHref({
            kind: 'post',
            sourcePath: 'posts/what?#100%.md'
        }),
        `${cmsPreviewOrigin}/posts/what%3F%23100%25`
    )
})

test('CMS foundation fields round-trip without duplicate JSON fields or lost relations', async () => {
    const {
        createEmptyDraft,
        buildCreateInputFromDraft,
        createDraftFromDocument,
        buildUpdateInputFromDraft,
        suggestDocumentFileName
    } = await import('../../apps/cms-web/src/draft.js')
    const draft = createEmptyDraft('foundation', {
        title: 'Vector clock',
        description: 'Tracks causal ordering.',
        foundationKind: 'model',
        aliasesText: '向量时钟\nLogical clock\nG(n,p)\nG(n,m)',
        domains: ['systems/distributed'],
        extraFrontmatterJson: '{"custom":true}'
    })
    draft.relations.requires = ['partial-order']
    draft.relations.contrasts_with = ['lamport-clock']
    const input = buildCreateInputFromDraft('knowledge/vector-clock.md', draft)
    const reopened = createDraftFromDocument({
        kind: 'foundation',
        sourcePath: input.targetPath,
        title: draft.title,
        body: input.body,
        frontmatter: input.frontmatter,
        headings: [],
        references: [],
        excerpt: '',
        assetDirectoryPath: null
    })
    assert.deepEqual(JSON.parse(reopened.extraFrontmatterJson), { custom: true, id: 'vector-clock' })
    assert.deepEqual(buildUpdateInputFromDraft(reopened).frontmatter, input.frontmatter)
    assert.deepEqual(reopened.relations.requires, ['partial-order'])
    assert.deepEqual(reopened.domains, ['systems/distributed'])
    assert.deepEqual(input.frontmatter.aliases, ['向量时钟', 'Logical clock', 'G(n,p)', 'G(n,m)'])
    assert.equal(suggestDocumentFileName('My New Article!', 'post'), 'my-new-article')
    assert.equal(suggestDocumentFileName('年度总结 2026', 'post'), '年度总结-2026')
    assert.equal(suggestDocumentFileName('向量时钟', 'foundation'), '')
    assert.equal(suggestDocumentFileName('Vector Clock', 'foundation'), 'vector-clock')
})

test('TiO2 CMS tree helpers normalize target paths and infer topic defaults', async () => {
    const {
        buildDocumentTargetPath,
        getDefaultDirectoryForKind,
        getDocumentAncestorPaths,
        getDocumentDirectoryPath,
        getDocumentFileStem,
        inferDefaultKindForDirectory,
        inferTopicsFromTargetPath
    } = await import('../../apps/cms-web/src/library-tree.js')

    assert.deepEqual(getDocumentAncestorPaths('topics/TiO2/Core/Guide.md'), [
        'topics',
        'topics/TiO2',
        'topics/TiO2/Core'
    ])
    assert.equal(getDocumentDirectoryPath('posts/demo.md'), 'posts')
    assert.equal(getDocumentFileStem('topics/TiO2/Core/Guide.md'), 'Guide')
    const roots: CmsLibraryTreeRoot[] = [
        {
            type: 'root',
            rootKey: 'posts',
            path: 'posts',
            documentCount: 1,
            children: [
                {
                    type: 'document',
                    name: 'hello.md',
                    path: 'posts/hello.md',
                    sourcePath: 'posts/hello.md',
                    kind: 'post',
                    title: 'Hello World',
                    description: 'demo',
                    date: '2026-03-31'
                }
            ]
        },
        {
            type: 'root',
            rootKey: 'topics',
            path: 'topics',
            documentCount: 1,
            children: [
                {
                    type: 'directory',
                    name: 'TiO2',
                    path: 'topics/TiO2',
                    documentCount: 1,
                    children: [
                        {
                            type: 'document',
                            name: 'Guide.md',
                            path: 'topics/TiO2/Guide.md',
                            sourcePath: 'topics/TiO2/Guide.md',
                            kind: 'topic',
                            title: 'Core Guide',
                            description: 'topic',
                            date: '2026-03-30'
                        }
                    ]
                }
            ]
        },
        { type: 'root', rootKey: 'foundations', path: 'foundations', documentCount: 0, children: [] },
        { type: 'root', rootKey: 'pages', path: 'pages', documentCount: 0, children: [] }
    ]
    const library = { tree: roots, content: { topicMetaFilename: '_meta.md' } }

    assert.equal(buildDocumentTargetPath('posts/draft', 'hello world', 'post', library), 'posts/draft/hello world.md')
    assert.equal(
        buildDocumentTargetPath('foundations/mathematics/algebra-structures', 'group', 'foundation', library),
        'foundations/mathematics/algebra-structures/group.md'
    )
    assert.equal(
        buildDocumentTargetPath('topics/TiO2/Core', 'ignored', 'topicMeta', library),
        'topics/TiO2/Core/_meta.md'
    )
    assert.throws(() => buildDocumentTargetPath('topics/TiO2', '_meta', 'topic', library), /reserved filename/)
    assert.throws(() => buildDocumentTargetPath('posts/../pages', 'about', 'post', library), /invalid path segments/)
    assert.throws(() => buildDocumentTargetPath('outside', 'about', 'page', library), /must be within pages/)
    assert.equal(getDefaultDirectoryForKind('foundation', roots), 'foundations')
    assert.equal(inferDefaultKindForDirectory('foundations/mathematics', roots), 'foundation')
    assert.deepEqual(inferTopicsFromTargetPath('topics/TiO2/Core/Guide.md', roots), ['TiO2/Core'])
})

test('CMS identifies both additions and removals needed for reciprocal relations', async () => {
    const { createEmptyDraft, getFoundationRelationWarnings } = await import('../../apps/cms-web/src/draft.js')
    const draft = createEmptyDraft('foundation', { title: 'Vector clock', sourcePath: 'foundations/vector-clock.md' })
    const target: CmsLibraryItem = {
        kind: 'foundation',
        title: 'Logical clock',
        sourcePath: 'foundations/logical-clock.md',
        description: '',
        date: '',
        category: '',
        tags: [],
        topics: [],
        foundation: { id: 'logical-clock', kind: 'model', equivalent_to: [], contrasts_with: [] }
    }
    assert.deepEqual(getFoundationRelationWarnings(draft, [target]), [])
    draft.relations.contrasts_with = ['logical-clock']
    assert.match(getFoundationRelationWarnings(draft, [target])[0], /Logical clock: add Vector clock/)
    target.foundation!.contrasts_with = ['vector-clock']
    assert.deepEqual(getFoundationRelationWarnings(draft, [target]), [])
    draft.relations.contrasts_with = []
    assert.match(getFoundationRelationWarnings(draft, [target])[0], /Logical clock: remove Vector clock/)
})

test('CMS search returns documents directly across nested paths, titles and metadata', async () => {
    const { searchLibraryDocuments } = await import('../../apps/cms-web/src/library-tree.js')
    const documents: CmsLibraryItem[] = [
        {
            kind: 'foundation',
            sourcePath: 'knowledge/tcs/distributed/vector-clock.md',
            title: '向量时钟',
            description: 'Causal ordering',
            date: '',
            category: '',
            tags: [],
            topics: []
        },
        {
            kind: 'post',
            sourcePath: 'writing/notes.md',
            title: 'Reading notes',
            description: '',
            date: '',
            category: '',
            tags: ['Systems'],
            topics: ['Distributed']
        }
    ]
    assert.deepEqual(searchLibraryDocuments(documents, ' VECTOR-clock '), [documents[0]])
    assert.deepEqual(searchLibraryDocuments(documents, '向量 时钟'), [documents[0]])
    assert.deepEqual(searchLibraryDocuments(documents, 'tcs causal'), [documents[0]])
    assert.deepEqual(searchLibraryDocuments(documents, 'systems distributed'), [documents[1]])
    assert.deepEqual(searchLibraryDocuments(documents, 'missing'), [])
    assert.deepEqual(searchLibraryDocuments(documents, '   '), [])
})

test('TiO2 CMS tree helpers use configured nested roots and topic metadata filenames', async () => {
    const {
        buildDocumentTargetPath,
        getDefaultDirectoryForKind,
        inferDefaultKindForDirectory,
        inferTopicsFromTargetPath
    } = await import('../../apps/cms-web/src/library-tree.js')
    const roots: Pick<CmsLibraryTreeRoot, 'rootKey' | 'path'>[] = [
        { rootKey: 'posts', path: 'writing/articles' },
        { rootKey: 'topics', path: 'knowledge/topics' },
        { rootKey: 'foundations', path: 'knowledge/concepts' },
        { rootKey: 'pages', path: 'site/pages' }
    ]
    const library = { tree: roots, content: { topicMetaFilename: 'summary.md' } }

    for (const [kind, directory] of [
        ['post', 'writing/articles'],
        ['topic', 'knowledge/topics'],
        ['foundation', 'knowledge/concepts'],
        ['page', 'site/pages']
    ] as const) {
        assert.equal(getDefaultDirectoryForKind(kind, roots), directory)
        assert.equal(inferDefaultKindForDirectory(directory, roots), kind)
        assert.equal(inferDefaultKindForDirectory(`${directory}/nested`, roots), kind)
        assert.equal(
            buildDocumentTargetPath(`${directory}/nested`, 'entry.md', kind, library),
            `${directory}/nested/entry.md`
        )
        assert.throws(() => buildDocumentTargetPath(`${directory}-outside`, 'entry', kind, library), /must be within/)
        assert.throws(() => inferDefaultKindForDirectory(`${directory}-outside`, roots), /configured content root/)
    }

    assert.equal(getDefaultDirectoryForKind('topicMeta', roots), 'knowledge/topics')
    assert.equal(
        buildDocumentTargetPath('./knowledge\\topics\\Core', 'ignored', 'topicMeta', library),
        'knowledge/topics/Core/summary.md'
    )
    assert.equal(
        buildDocumentTargetPath('knowledge/topics/Core', '_meta', 'topic', library),
        'knowledge/topics/Core/_meta.md'
    )
    assert.throws(
        () => buildDocumentTargetPath('knowledge/topics/Core', 'summary.md', 'topic', library),
        /reserved filename summary.md/
    )
    assert.throws(
        () => buildDocumentTargetPath('writing/articles/../topics', 'entry', 'post', library),
        /invalid path segments/
    )
    assert.throws(
        () => buildDocumentTargetPath('writing/articles', 'entry\u0000', 'post', library),
        /invalid characters/
    )
    assert.throws(() => buildDocumentTargetPath('posts', 'entry', 'post', library), /must be within writing\/articles/)
    assert.throws(() => getDefaultDirectoryForKind('post', []), /No content directory is configured/)
    assert.deepEqual(inferTopicsFromTargetPath('knowledge/topics/Core/Guide.md', roots), ['Core'])
    assert.deepEqual(inferTopicsFromTargetPath('knowledge/topics/Core/Nested/Guide.md', roots), ['Core/Nested'])
    assert.deepEqual(inferTopicsFromTargetPath('knowledge/topics/summary.md', roots), [])
    assert.deepEqual(inferTopicsFromTargetPath('knowledge/topics-outside/Core/Guide.md', roots), [])
    assert.deepEqual(inferTopicsFromTargetPath('topics/Core/Guide.md', roots), [])
})

test('TiO2 CMS theme helpers normalize stored values and resolve effective modes', async () => {
    const { normalizeThemeMode, resolveEffectiveTheme } = await import('../../apps/cms-web/src/theme-mode.js')

    assert.equal(normalizeThemeMode('light'), 'light')
    assert.equal(normalizeThemeMode('dark'), 'dark')
    assert.equal(normalizeThemeMode('system'), 'system')
    assert.equal(normalizeThemeMode('unexpected'), 'system')
    assert.equal(normalizeThemeMode(undefined), 'system')

    assert.equal(resolveEffectiveTheme('light', true), 'light')
    assert.equal(resolveEffectiveTheme('dark', false), 'dark')
    assert.equal(resolveEffectiveTheme('system', true), 'dark')
    assert.equal(resolveEffectiveTheme('system', false), 'light')
})
