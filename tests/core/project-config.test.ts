import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { defineTiO2Config, FRAMEWORK_META } from '../../packages/config/src/index.js'
import { createTiO2Project, loadTiO2Project } from '../../packages/config/src/project.js'
import type { TiO2ConfigInput } from '../../packages/config/src/types'

const identity = { title: 'Example', url: 'https://example.test' }

test('config resolves neutral defaults and nested overrides through real runtime exports', () => {
    const config = defineTiO2Config({ site: identity, theme: { search: { miniSearch: { boost: { title: 9 } } } } })
    assert.equal(config.site.authorUrl, 'https://example.test')
    assert.equal(config.comment, false)
    assert.equal(config.integrations.vercelAnalytics, false)
    assert.deepEqual(config.theme.nav, [])
    assert.deepEqual(config.theme.socialLinks, [])
    assert.equal(config.theme.clientEntry, '')
    assert.equal(config.theme.layout, '')
    assert.deepEqual(config.theme.pages, {})
    assert.equal(config.site.copyrightStartYear, null)
    assert.equal(config.site.contentLicense, '')
    assert.deepEqual(config.foundations, { groups: [], routes: [] })
    assert.deepEqual(config.theme.search.miniSearch, { fuzzy: 0.2, prefix: true, boost: { title: 9, text: 2 } })
    assert.deepEqual(FRAMEWORK_META, { name: 'TiO₂', asciiName: 'TiO2' })
    assert.equal('framework' in config, false)
    const another = defineTiO2Config({ site: identity })
    another.theme.nav.push({ text: 'Home', link: '/' })
    assert.deepEqual(defineTiO2Config({ site: identity }).theme.nav, [])
})

test("config carries the knowledge library's own name and rejects an empty one", () => {
    const named = defineTiO2Config({
        site: identity,
        foundations: { title: '理路', englishTitle: 'Theoryroad', subtitle: '数学与理论计算机科学' }
    })
    assert.deepEqual(named.foundations, {
        groups: [],
        routes: [],
        title: '理路',
        englishTitle: 'Theoryroad',
        subtitle: '数学与理论计算机科学'
    })
    for (const field of ['title', 'englishTitle', 'subtitle'] as const)
        assert.throws(
            () => defineTiO2Config({ site: identity, foundations: { [field]: ' ' } }),
            new RegExp(`foundations\\.${field} must be a non-empty string`, 'u')
        )
})

test('config normalizes contained content roots and rejects invalid values', () => {
    assert.equal(
        defineTiO2Config({ site: identity, content: { postsDir: './content//articles/' } }).content.postsDir,
        'content/articles'
    )
    assert.equal(
        defineTiO2Config({ site: identity, content: { pagesDir: 'custom/pages' } }).site.authorUrl,
        'https://example.test'
    )
    const invalid = [
        { site: { ...identity, title: '' } },
        { site: { ...identity, url: 'javascript:alert(1)' } },
        { site: { ...identity, authorUrl: '//external.test' } },
        { site: identity, content: { postsDir: '../articles' } },
        { site: identity, content: { postsDir: '/articles' } },
        { site: identity, content: { postsDir: 'C:\\articles' } },
        { site: identity, content: { postsDir: 'topics/articles' } },
        { site: identity, content: { postsDir: 'topics' } },
        { site: identity, content: { postsDir: '@(posts)' } },
        { site: identity, content: { postsDir: '+(posts)' } },
        { site: identity, content: { postsDir: '!posts' } },
        { site: identity, content: { topicMetaFilename: '@(summary).md' } },
        { site: identity, content: { topicMetaFilename: '../_meta.md' } },
        { site: identity, content: { pageSize: 0 } },
        { site: identity, content: { pageSize: 1.5 } },
        { site: identity, integrations: { feed: 'yes' } },
        { site: identity, comment: {} },
        { site: { ...identity, copyrightStartYear: 0 } },
        { site: identity, theme: { clientEntry: '../client.ts' } },
        { site: identity, theme: { layout: '/layout.mjs' } },
        { site: identity, theme: { pages: { 'posts/about.md': 'theme/about.mjs' } } },
        { site: identity, theme: { pages: { 'pages/about.md': '../theme/about.mjs' } } },
        { site: identity, theme: { nav: [{ text: 'Home', link: '/', activeMatch: '[' }] } }
    ]
    for (const input of invalid) assert.throws(() => defineTiO2Config(input as TiO2ConfigInput), TypeError)
})

test('projects load their own JS and MJS configs without changing cwd or using framework fallback', async () => {
    const cwd = process.cwd()
    const temp = await mkdtemp(path.join(os.tmpdir(), 'tio2-project-config-'))
    try {
        const first = path.join(temp, 'first'),
            second = path.join(temp, 'second'),
            missing = path.join(temp, 'missing')
        await Promise.all([mkdir(first), mkdir(second), mkdir(missing)])
        await writeFile(path.join(first, 'package.json'), JSON.stringify({ type: 'module' }))
        await writeFile(
            path.join(first, 'tio2.config.js'),
            `export default ${JSON.stringify({ site: { ...identity, title: 'First' }, content: { postsDir: 'articles', topicMetaFilename: 'summary.md' } })}`
        )
        await writeFile(
            path.join(second, 'tio2.config.mjs'),
            `export default ${JSON.stringify({ site: { title: 'Second', url: 'https://second.test' }, content: { topicsDir: 'knowledge' } })}`
        )
        const [a, b] = await Promise.all([loadTiO2Project(first), loadTiO2Project(second)])
        assert.equal(a.rootDir, first)
        assert.equal(a.config.site.title, 'First')
        assert.equal(a.config.content.postsDir, 'articles')
        assert.equal(a.config.content.topicMetaFilename, 'summary.md')
        assert.equal(b.config.site.title, 'Second')
        assert.equal(b.config.content.topicsDir, 'knowledge')
        assert.equal(b.config.content.postsDir, 'posts')
        assert.equal(process.cwd(), cwd)
        await assert.rejects(loadTiO2Project(missing), /Missing TiO2 configuration/)
        await writeFile(path.join(missing, 'tio2.config.mjs'), 'export default {site: {title: "Bad"}}')
        await assert.rejects(loadTiO2Project(missing), /Invalid TiO2 configuration.*site.url/)
        assert.throws(() => createTiO2Project('', { site: identity }), /rootDir/)
        assert.equal(createTiO2Project('.', { site: identity }).rootDir, cwd)
        assert.equal(process.cwd(), cwd)
    } finally {
        await rm(temp, { recursive: true, force: true })
    }
})
