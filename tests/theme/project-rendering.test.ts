import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'vite'
import { createTiO2Project } from '../../packages/config/src/project.js'
import { renderDocument } from '../../site/site-renderer.js'
import { createClientConfig } from '../../site/vite.config.js'
// Eleventy and its JavaScript configuration do not expose TypeScript declarations.
// @ts-expect-error -- verified against the installed Eleventy 3.1.6 API.
import Eleventy from '@11ty/eleventy'
// @ts-expect-error -- JavaScript configuration shared with the Eleventy entry point.
import { configureSite } from '../../site/eleventy.config.mjs'

test('document rendering keeps project identity and optional integrations isolated', async () => {
    const first = createTiO2Project('/tmp/first-renderer', {
        site: {
            title: 'First',
            url: 'https://first.test',
            authorUrl: '/authors/first',
            copyrightStartYear: 2020,
            contentLicense: 'CC BY'
        },
        theme: {
            head: '<meta name="consumer" content="first">',
            nav: [
                { text: 'Section', link: '/writing/example?view=all#section' },
                { text: 'Feed', link: '/feed.xml' }
            ]
        }
    })
    const second = createTiO2Project('/tmp/second-renderer', {
        site: { title: 'Second', url: 'https://second.test', language: 'zh-CN' },
        integrations: { feed: false }
    })
    const options = {
        title: 'Example',
        description: 'Description',
        canonicalPath: '/writing/example.html',
        content: '<p>Body</p>',
        clientAssets: { stylesheets: [], modulePreloads: [], script: '/client.js' },
        article: { publishedAt: '2026-10-01', modifiedAt: '2026-10-01', section: '', tags: [], wordCount: 1 }
    }
    const [a, b] = await Promise.all([renderDocument(first, options), renderDocument(second, options)])
    assert.match(a, /Example \| First/)
    assert.match(a, /https:\/\/first.test\/authors\/first/)
    assert.match(a, /CC BY \| Copyright © 2020-/)
    assert.match(a, /name="consumer" content="first"/)
    assert.match(a, /href="\/feed.xml"/)
    assert.match(a, /href="\/writing\/example.html\?view=all#section"/)
    assert.doesNotMatch(a, /feed.xml.html/)
    assert.match(b, /Example \| Second/)
    assert.match(b, /Powered by TiO₂/)
    assert.match(b, /name="generator" content="TiO₂"/)
    assert.doesNotMatch(b, /First|first.test|CC BY|MIT Licensed|feed.xml|favicon|cinzel|og:image|twitter:image/)
    assert.doesNotMatch(b, /Powered by.*Eleventy/)
    assert.match(a, /Search articles and concepts/)
    assert.doesNotMatch(a, /\p{Script=Han}/u)
    assert.match(b, /搜索文章与概念/)
    assert.match(b, /data-ui-language="zh-CN"/)
})

test('article HTML resolves author and image URLs without treating absolute URLs as paths', async () => {
    const siteUrl = 'https://example.test'
    const image = 'https://cdn.example/cover%20image.webp?width=1200&format=webp'
    for (const authorUrl of [
        `${siteUrl}/pages/about.html`,
        'https://author.example/about.html?view=full#bio',
        '/pages/about.html'
    ]) {
        const project = createTiO2Project('/tmp/article-seo', {
            site: { title: 'Article SEO', url: siteUrl, authorUrl, socialImage: image }
        })
        const html = await renderDocument(project, {
            title: 'Example',
            description: 'Description',
            canonicalPath: '/posts/example.html',
            content: '<p>Body</p>',
            clientAssets: { stylesheets: [], modulePreloads: [], script: '/client.js' },
            article: { publishedAt: '2026-10-01', modifiedAt: '2026-10-01', section: '', tags: [], wordCount: 1 }
        })
        const jsonLd = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/u)
        assert.ok(jsonLd)
        const article = JSON.parse(jsonLd[1])
        assert.equal(article['@type'], 'BlogPosting')
        assert.equal(article.author.url, new URL(authorUrl, siteUrl).href)
        assert.equal(article.publisher.url, new URL(authorUrl, siteUrl).href)
        assert.equal(article.url, `${siteUrl}/posts/example.html`)
        assert.equal(article.image, image)
        const escapedImage = image.replaceAll('&', '&amp;')
        assert.ok(html.includes(`<meta property="og:image" content="${escapedImage}">`))
        assert.ok(html.includes(`<meta name="twitter:image" content="${escapedImage}">`))
    }
})

test('a foreign consumer builds configured pages, layout, client entry and framework assets', async () => {
    const cwd = process.cwd()
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tio2-render-consumer-'))
    try {
        await Promise.all(
            ['writing', 'website/pages', 'knowledge/concepts', 'theme', 'public'].map((dir) =>
                mkdir(path.join(rootDir, dir), { recursive: true })
            )
        )
        await Promise.all([
            writeFile(
                path.join(rootDir, 'writing/hello.md'),
                '---\ntitle: Hello\ndate: 2026-10-01 12:00:00\ndescription: A consumer post\ncategory: Notes\ntags: [Example]\nhumanWritten: true\n---\nHello from the consumer.\n\n## A section\n\n[[foundation:example]]\n\n::: fold\nExtra detail.\n:::\n\n::: encrypt password="test-only-passphrase" hint="Fixture"\nPrivate.\n:::\n\n![Example](../public/cover.svg)\n'
            ),
            writeFile(path.join(rootDir, 'website/pages/archives.md'), '---\ntitle: Archive\n---\n'),
            writeFile(path.join(rootDir, 'website/pages/plain.md'), '# A plain page\n\nNo front matter required.\n'),
            writeFile(path.join(rootDir, 'website/pages/foundations.md'), '---\ntitle: Concepts\n---\n'),
            writeFile(
                path.join(rootDir, 'knowledge/concepts/example.md'),
                [
                    '---',
                    'title: Example concept',
                    'id: example',
                    'aliases: []',
                    'kind: definition',
                    'domains: [knowledge/basics]',
                    'requires: []',
                    'uses: []',
                    'implemented_by: []',
                    'special_case_of: []',
                    'equivalent_to: []',
                    'contrasts_with: []',
                    'description: A consumer concept',
                    'page: true',
                    '---',
                    '## Formal statement',
                    'Definition.',
                    '## Intuition',
                    'Intuition.'
                ].join('\n')
            ),
            writeFile(
                path.join(rootDir, 'website/pages/about.md'),
                '---\ntitle: Consumer About\n---\nOrdinary about text.\n'
            ),
            writeFile(
                path.join(rootDir, 'website/pages/custom.md'),
                '---\ntitle: Custom\n---\nSource for custom page.\n'
            ),
            writeFile(
                path.join(rootDir, 'theme/page.mjs'),
                'export default ({ render }) => render({ content: "<main data-custom-page>Custom page</main>", fullWidth: true })'
            ),
            writeFile(
                path.join(rootDir, 'theme/layout.mjs'),
                'export default ({ render }) => render({ bodyPrelude: "<!-- consumer-layout -->" })'
            ),
            writeFile(
                path.join(rootDir, 'theme/client.ts'),
                'import "./custom.css"; document.documentElement.dataset.consumerClient = "yes"'
            ),
            writeFile(path.join(rootDir, 'theme/custom.css'), ':root { --consumer-color: purple; }'),
            writeFile(path.join(rootDir, 'public/consumer.txt'), 'Consumer asset'),
            writeFile(
                path.join(rootDir, 'public/cover.svg'),
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'
            ),
            writeFile(path.join(rootDir, 'public/feed-icon.svg'), '<svg data-consumer-icon="true"></svg>')
        ])
        await Promise.all(
            ['category', 'tags', 'topics', 'ledger'].map((name) =>
                writeFile(path.join(rootDir, `website/pages/${name}.md`), `---\ntitle: ${name}\n---\n`)
            )
        )
        const project = createTiO2Project(rootDir, {
            site: { title: 'Independent Consumer', url: 'https://consumer.test' },
            content: { postsDir: 'writing', pagesDir: 'website/pages', foundationsDir: 'knowledge/concepts' },
            foundations: {
                groups: [
                    {
                        id: 'knowledge',
                        title: 'Knowledge',
                        englishTitle: 'Knowledge',
                        description: 'Consumer concepts',
                        domains: [
                            {
                                id: 'knowledge/basics',
                                group: 'knowledge',
                                title: 'Basics',
                                description: 'Basic concepts'
                            }
                        ]
                    }
                ]
            },
            theme: {
                clientEntry: 'theme/client.ts',
                layout: 'theme/layout.mjs',
                pages: { 'website/pages/custom.md': 'theme/page.mjs' }
            },
            integrations: { feed: false, sitemap: false }
        })
        await build({ ...createClientConfig(project), configFile: false, logLevel: 'silent' })
        const output = path.join(rootDir, '.tio2-tmp/site')
        const eleventy = new Eleventy(rootDir, output, {
            configPath: false,
            config: (config: unknown) => configureSite(config, project)
        })
        eleventy.setIsVerbose(false)
        await eleventy.write()
        const [article, archive, about, custom, home, manifest, foundation] = await Promise.all([
            readFile(path.join(output, 'writing/hello.html'), 'utf8'),
            readFile(path.join(output, 'website/pages/archives.html'), 'utf8'),
            readFile(path.join(output, 'website/pages/about.html'), 'utf8'),
            readFile(path.join(output, 'website/pages/custom.html'), 'utf8'),
            readFile(path.join(output, 'index.html'), 'utf8'),
            readFile(path.join(rootDir, '.tio2-tmp/site-client/.vite/manifest.json'), 'utf8'),
            readFile(path.join(output, 'knowledge/concepts/example.html'), 'utf8')
        ])
        const otherIndexes = await Promise.all(
            ['category', 'tags', 'topics', 'ledger', 'foundations'].map((name) =>
                readFile(path.join(output, `website/pages/${name}.html`), 'utf8')
            )
        )
        for (const html of [article, archive, about, custom, home, foundation, ...otherIndexes]) {
            assert.match(html, /Independent Consumer/)
            assert.match(html, /consumer-layout/)
            assert.match(html, /Powered by TiO₂ by <a class="vitepress" href="https:\/\/github.com\/CodeBoy2006">Codeboy<\/a>/u)
            assert.doesNotMatch(html.replace(/ by <a[^>]*>Codeboy<\/a>/u, ''), /CodeBoy|Codeboy|cb-about|cinzel|giscus/)
            assert.doesNotMatch(html, /href="\/pages\//)
            assert.doesNotMatch(html, /\p{Script=Han}/u, 'English projects must not emit Chinese framework text')
        }
        assert.match(article, /Hello from the consumer/)
        assert.match(archive, /href="\/website\/pages\/archives.html"/)
        assert.match(about, /Ordinary about text/)
        assert.match(custom, /data-custom-page/)
        const plain = await readFile(path.join(output, 'website/pages/plain.html'), 'utf8')
        assert.match(plain, /<title>plain \| Independent Consumer<\/title>/)
        assert.match(plain, /No front matter required/)
        assert.match(foundation, /class="foundation-header__library" href="\/website\/pages\/foundations.html"/)
        assert.match(foundation, /<details class="foundation-section" data-foundation-section="intuition"/)
        assert.match(foundation, /href="#formal-statement"/)
        assert.match(foundation, /<summary id="intuition">/)
        assert.doesNotMatch(foundation, /foundation-folio/)
        assert.match(article, /data-expand-text="Expand"/)
        assert.match(article, /Protected content/)
        assert.match(article, /aria-label="Enlarge: Example"/)
        assert.match(article, /Human-written/)
        assert.doesNotMatch(manifest, /blog\/about|about-experience/)
        const clientManifest = JSON.parse(manifest)
        const entry = clientManifest['site/client/main.ts']
        assert.ok(entry?.isEntry)
        const client = await readFile(path.join(output, entry.file), 'utf8')
        assert.match(client, /consumerClient/)
        assert.equal(await readFile(path.join(output, 'consumer.txt'), 'utf8'), 'Consumer asset')
        assert.match(await readFile(path.join(output, 'feed-icon.svg'), 'utf8'), /data-consumer-icon="true"/)
        assert.match(await readFile(path.join(output, 'ai-icons/openai.svg'), 'utf8'), /<svg/)
        assert.equal(process.cwd(), cwd)
    } finally {
        await rm(rootDir, { recursive: true, force: true })
    }
})
