import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { loadTiO2Project } from '../../packages/config/src/project.js'
import { cmsPreviewProbeMarker, cmsPreviewProbePath } from '../../packages/content-core/src/index'
import { loadSiteContent } from '../../packages/content-fs/src/index'
import { renderDocument } from '../../site/site-renderer'

const execFile = promisify(execFileCallback)
const frameworkRoot = fileURLToPath(new URL('../../', import.meta.url))

async function runScript(script: string, rootDir: string, env: NodeJS.ProcessEnv = {}, cwd = frameworkRoot) {
    return execFile(
        process.execPath,
        [
            '--import',
            path.join(frameworkRoot, 'node_modules/tsx/dist/loader.mjs'),
            path.join(frameworkRoot, 'scripts', script)
        ],
        { cwd, env: { ...process.env, TIO2_PROJECT_ROOT: rootDir, TIO2_OUTPUT_DIR: 'output', ...env } }
    )
}

async function write(rootDir: string, filename: string, content: string) {
    const target = path.join(rootDir, filename)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
}

test('search and publishing scripts honor consumer paths and development/production visibility', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tio2-artifacts-'))
    try {
        await write(
            rootDir,
            'tio2.config.mjs',
            `export default ${JSON.stringify({
                site: { title: 'Neutral Consumer', url: 'https://consumer.test' },
                content: { postsDir: 'writing', productionIgnorePatterns: ['draft.md'] }
            })}`
        )
        await write(rootDir, 'writing/live.md', '---\ntitle: Live\ndate: 2026-10-01\n---\nPublished content.')
        await write(rootDir, 'writing/draft.md', '---\ntitle: Draft\ndate: 2026-10-02\n---\nDraft content.')
        for (const [env, documents] of [
            ['development', 2],
            ['production', 1]
        ] as const) {
            const { stdout } = await runScript('build-search-index.ts', rootDir, { NODE_ENV: env })
            assert.match(stdout, new RegExp(`"documents":${documents}`))
            const index = JSON.parse(await readFile(path.join(rootDir, 'output/assets/search-index.json'), 'utf8'))
            assert.equal(index.documentCount, documents)
            await runScript('write-site-artifacts.ts', rootDir, { NODE_ENV: env })
            const feed = JSON.parse(await readFile(path.join(rootDir, 'output/feed.json'), 'utf8'))
            assert.equal(feed.items.length, documents)
            assert.equal(feed.title, 'Neutral Consumer')
            assert.equal(
                feed.items.some((item: { title: string }) => item.title === 'Draft'),
                env === 'development'
            )
        }
        await runScript(
            'build-search-index.ts',
            rootDir,
            { TIO2_PROJECT_ROOT: undefined, TIO2_OUTPUT_DIR: undefined, NODE_ENV: undefined },
            rootDir
        )
        const defaultIndex = JSON.parse(
            await readFile(path.join(rootDir, '.tio2-tmp/site/assets/search-index.json'), 'utf8')
        )
        assert.equal(defaultIndex.documentCount, 2)
    } finally {
        await rm(rootDir, { recursive: true, force: true })
    }
})

test('consumer verifiers accept custom layout, query navigation and disabled artifacts while rejecting stale output', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tio2-verify-'))
    try {
        await write(
            rootDir,
            'tio2.config.mjs',
            `export default ${JSON.stringify({
                site: { title: 'Neutral Consumer', url: 'https://consumer.test' },
                content: { postsDir: 'writing', pagesDir: 'website/pages', productionIgnorePatterns: ['draft.md'] },
                theme: {
                    layout: 'theme/layout.mjs',
                    pages: { 'website/pages/custom.md': 'theme/page.mjs' },
                    nav: [{ text: 'Custom', link: '/website/pages/custom?view=all#section' }]
                },
                integrations: { feed: false, sitemap: false }
            })}`
        )
        await write(
            rootDir,
            'theme/layout.mjs',
            'export default ({ page, render }) => render(page.notFound ? { content: "<h1>Consumer not found</h1>" } : {})'
        )
        await write(rootDir, 'theme/page.mjs', 'export default () => "<p>Custom page</p>"')
        await write(rootDir, 'website/pages/custom.md', '# Custom page')
        await write(rootDir, 'writing/draft.md', '---\ntitle: Draft\ndate: 2026-10-02\n---\nHidden draft.')
        const clientFile = 'assets/client/main.js'
        const dynamicSources = ['foundation-graph', 'foundation-life', 'image-viewer', 'search']
        const manifest = {
            'site/client/main.ts': { file: clientFile, isEntry: true },
            ...Object.fromEntries(
                dynamicSources.map((name) => [
                    `site/client/${name}.ts`,
                    { file: `assets/client/${name}.js`, src: `site/client/${name}.ts`, isDynamicEntry: true }
                ])
            )
        }
        for (const chunk of Object.values(manifest)) {
            await write(rootDir, `.tio2-tmp/site-client/${chunk.file}`, 'export {};')
            await write(rootDir, `output/${chunk.file}`, 'export {};')
        }
        await write(rootDir, '.tio2-tmp/site-client/.vite/manifest.json', JSON.stringify(manifest))
        await write(rootDir, '.tio2-tmp/site-work/article-images.json', JSON.stringify({ version: 1, entries: {} }))
        const project = await loadTiO2Project(rootDir)
        const content = await loadSiteContent(project, { env: 'production' })
        for (const route of [...content.publishing.entries.map((entry) => entry.route), '/404.html']) {
            const html = await renderDocument(project, {
                title: 'Consumer',
                description: '',
                canonicalPath: route,
                content: '<p>Consumer content</p>',
                clientAssets: { script: `/${clientFile}`, stylesheets: [], modulePreloads: [] },
                notFound: route === '/404.html'
            })
            await write(rootDir, `output/${route === '/' ? 'index.html' : route.slice(1)}`, html)
        }
        await write(rootDir, `output${cmsPreviewProbePath}`, JSON.stringify({ marker: cmsPreviewProbeMarker }))
        await runScript('build-search-index.ts', rootDir, { NODE_ENV: 'production' })
        const { stdout } = await runScript('verify-eleventy-site.ts', rootDir, { NODE_ENV: 'development' })
        assert.match(stdout, /"pages":3/)
        const client = await runScript('verify-site-client.ts', rootDir)
        assert.match(client.stdout, /"dynamicEntries":4/)

        await write(rootDir, 'output/feed.xml', '<rss/>')
        await assert.rejects(
            runScript('verify-eleventy-site.ts', rootDir),
            /feed.xml: exists while its integration is disabled/
        )
        await rm(path.join(rootDir, 'output/feed.xml'))
        await write(rootDir, 'output/sitemap.xml', '<urlset/>')
        await assert.rejects(
            runScript('verify-eleventy-site.ts', rootDir),
            /sitemap.xml: exists while its integration is disabled/
        )
        await rm(path.join(rootDir, 'output/sitemap.xml'))
        const homePath = path.join(rootDir, 'output/index.html')
        await writeFile(homePath, `${await readFile(homePath, 'utf8')}<a href="/missing.html?view=all">Missing</a>`)
        await assert.rejects(runScript('verify-eleventy-site.ts', rootDir), /unknown internal route \/missing.html/)
    } finally {
        await rm(rootDir, { recursive: true, force: true })
    }
})
