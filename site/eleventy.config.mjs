import { loadTiO2Project } from '../packages/config/src/project.js'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { globby } from 'globby'
import { fileURLToPath } from 'node:url'
import { createMarkdownRenderer } from './markdown.ts'
import {
    cmsPreviewProbeMarker,
    cmsPreviewProbePath,
    createFoundationAtlas
} from '../packages/content-core/src/index.ts'
import {
    buildProofLedger,
    createProofLedgerDownloadMap,
    generateArticleImages,
    loadSiteContent,
    stripProofLedgerSources
} from '../packages/content-fs/src/index.ts'
import { createArticleImageMarkdownPlugin } from '../.vitepress/theme/articleImageMarkdownPlugin.ts'
import { createEncryptedMarkdownPlugin } from '../.vitepress/theme/encryptedMarkdownPlugin.ts'
import { createFoldMarkdownPlugin } from '../.vitepress/theme/foldMarkdownPlugin.ts'
import { createFoundationMarkdownPlugin } from '../.vitepress/theme/foundationMarkdownPlugin.ts'
import { createLatexMathMarkdownPlugin } from '../.vitepress/theme/latexMathMarkdownPlugin.ts'
import { annotateMathSource } from '../.vitepress/theme/markdownRendering.ts'
import { reuseMathJaxRenderer } from '../.vitepress/theme/mathjaxRenderer.ts'
import { createReferenceMarkdownPlugin } from '../.vitepress/theme/referenceMarkdownPlugin.ts'
import { renderFoundationPage, renderFoundationsIndex, renderFoundationRoutesPage } from './foundation-renderer.ts'
import { renderFoundationAtlasPage, renderFoundationAtlasSvg } from './foundation-atlas-renderer.ts'
import { markdownMathOptions } from './math-config.ts'
import { renderArchives, renderCategories, renderTags } from './index-renderer.ts'
import {
    renderArticlePage,
    renderLedger,
    renderMarkdownPage,
    renderNotFound,
    renderPostIndex,
    renderTopics,
    findPageRoute,
    readPageTitle
} from './page-renderer.ts'
import { libraryIdentity } from './render-helpers.ts'

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default async function (eleventyConfig) {
    return configureSite(eleventyConfig, await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd()))
}

export async function configureSite(eleventyConfig, project) {
    eleventyConfig.setTemplateFormats(['11ty.js'])
    const repoRoot = project.rootDir
    const { content, theme } = project.config
    const candidateWorkDirectory = path.join(repoRoot, '.tio2-tmp', 'site-work')
    const generatedImageDirectory = path.join(candidateWorkDirectory, 'images', 'generated')
    const imageManifestPath = path.join(candidateWorkDirectory, 'article-images.json')
    const clientBuildDirectory = path.join(repoRoot, '.tio2-tmp', 'site-client')
    eleventyConfig.setWatchJavaScriptDependencies(false)
    for (const target of [
        `${content.postsDir}/**/*`,
        `${content.topicsDir}/**/*`,
        `${content.foundationsDir}/**/*`,
        `${content.pagesDir}/**/*`,
        'assets/images/**/*',
        'proofs/**/*',
        'tio2.config.js',
        'tio2.config.mjs',
        ...[theme.clientEntry, theme.layout, ...Object.values(theme.pages)]
            .filter(Boolean)
            .map((file) => path.posix.join(path.posix.dirname(file), '**/*'))
    ]) {
        eleventyConfig.addWatchTarget(path.join(repoRoot, target), { resetConfig: true })
    }
    for (const target of ['site/**/*.ts', 'site/*.mjs', '.vitepress/theme/*.ts', 'packages/**/*.ts']) {
        eleventyConfig.addWatchTarget(path.join(frameworkRoot, target), { resetConfig: true })
    }
    const clientAssets = await loadClientAssets(clientBuildDirectory)
    const imageManifest = await generateArticleImages({
        repoRoot,
        contentDirectories: [content.postsDir, content.topicsDir, content.foundationsDir, content.pagesDir],
        outputDirectory: generatedImageDirectory,
        manifestPath: imageManifestPath,
        quiet: true
    })
    const siteContent = await loadSiteContent(project, {
        env: process.env.NODE_ENV === 'production' ? 'production' : undefined
    })
    const sourceProofLedger = await buildProofLedger(path.join(repoRoot, 'proofs'))
    const proofLedger = stripProofLedgerSources(sourceProofLedger)
    const proofDownloads = Object.fromEntries(
        [...createProofLedgerDownloadMap(sourceProofLedger)].map(([url, sourcePath]) => [sourcePath, url.slice(1)])
    )
    const markdown = await createMarkdownRenderer()
    const mathStyles = reuseMathJaxRenderer(markdown, markdownMathOptions)
    markdown
        .use(createLatexMathMarkdownPlugin())
        .use(
            createReferenceMarkdownPlugin(
                siteContent.references,
                project.config.site.language,
                libraryIdentity(project).title
            )
        )
        .use(createEncryptedMarkdownPlugin(project.rootDir, project.config.site.language))
        .use(createFoldMarkdownPlugin(project.config.site.language))
        .use(createFoundationMarkdownPlugin(content.foundationsDir))
        .use(createArticleImageMarkdownPlugin(imageManifest, project.config.site.language))
    annotateMathSource(markdown)
    const mathStylesheet = `/assets/math-${createHash('sha256').update(mathStyles).digest('hex').slice(0, 16)}.css`
    clientAssets.stylesheets.push(mathStylesheet)
    eleventyConfig.addTemplate('virtual/math.css.11ty.js', () => mathStyles, { permalink: mathStylesheet })

    eleventyConfig.setConcurrency(1)
    const frameworkPublic = path.join(frameworkRoot, 'site/public')
    const defaultAssets = Object.fromEntries(
        (await globby('**/*', { cwd: frameworkPublic, onlyFiles: true }))
            .filter((file) => !existsSync(path.join(repoRoot, 'public', file)))
            .map((file) => [path.join(frameworkPublic, file), file])
    )
    eleventyConfig.addPassthroughCopy({
        ...defaultAssets,
        [path.join(repoRoot, 'public')]: '.',
        [path.join(clientBuildDirectory, 'assets')]: 'assets',
        ...proofDownloads
    })

    for (const entry of siteContent.foundations.entries) {
        const virtualInputPath = `virtual/${entry.sourcePath.replace(/\.md$/u, '')}.11ty.js`
        eleventyConfig.addTemplate(
            virtualInputPath,
            async () => {
                try {
                    return await renderFoundationPage(project, siteContent, entry, markdown, clientAssets)
                } catch (error) {
                    throw new Error(`Failed to render ${entry.sourcePath}`, { cause: error })
                }
            },
            { permalink: decodeURIComponent(entry.regularPath) }
        )
    }

    eleventyConfig.addTemplate('virtual/404.11ty.js', () => renderNotFound(project, clientAssets), {
        permalink: '/404.html'
    })

    for (const article of siteContent.articles) {
        eleventyConfig.addTemplate(
            `virtual/${article.sourcePath.replace(/\.md$/u, '')}.11ty.js`,
            () => renderArticlePage(project, siteContent, article, markdown, clientAssets),
            { permalink: decodeURIComponent(article.regularPath) }
        )
    }

    const pageCount = Math.max(1, Math.ceil(siteContent.posts.length / content.pageSize))
    for (let page = 1; page <= pageCount; page += 1) {
        eleventyConfig.addTemplate(
            `virtual/${page === 1 ? 'index' : `page_${page}`}.11ty.js`,
            () => renderPostIndex(project, siteContent, page, markdown, clientAssets),
            { permalink: page === 1 ? '/' : `/page_${page}.html` }
        )
    }

    const atlasPage = siteContent.publishing.entries.find(
        (entry) => entry.kind === 'page' && entry.sourcePath === `${content.pagesDir}/foundations-map.md`
    )
    const atlas = atlasPage ? createFoundationAtlas(siteContent.foundations) : undefined
    if (atlasPage && atlas && !theme.pages[atlasPage.sourcePath]) {
        eleventyConfig.addTemplate(
            'virtual/foundations-map.svg.11ty.js',
            async () =>
                renderFoundationAtlasSvg(
                    atlas,
                    project.config.site.url,
                    project.config.site.language,
                    `${libraryIdentity(project).title} · ${await readPageTitle(project, 'foundations-map')}`
                ),
            { permalink: atlasPage.route.replace('.html', '.svg') }
        )
        eleventyConfig.addTemplate('virtual/foundations-map.json.11ty.js', () => JSON.stringify(atlas), {
            permalink: atlasPage.route.replace('.html', '.json')
        })
    }
    const builtInPages = {
        archives: () => renderArchives(project, siteContent, markdown, clientAssets),
        category: () => renderCategories(project, siteContent, markdown, clientAssets),
        tags: () => renderTags(project, siteContent, markdown, clientAssets),
        topics: () => renderTopics(project, siteContent, markdown, clientAssets),
        foundations: () => renderFoundationsIndex(project, siteContent.foundations, markdown, clientAssets),
        'foundations-routes': () =>
            renderFoundationRoutesPage(project, siteContent.foundations, markdown, clientAssets),
        'foundations-map': () =>
            renderFoundationAtlasPage(project, atlas, clientAssets, findPageRoute(project, siteContent, 'foundations')),
        ledger: () => renderLedger(project, proofLedger, clientAssets)
    }
    for (const page of siteContent.publishing.entries.filter((entry) => entry.kind === 'page')) {
        const name = path.posix.relative(content.pagesDir, page.sourcePath).replace(/\.md$/u, '')
        const render =
            !theme.pages[page.sourcePath] && Object.hasOwn(builtInPages, name)
                ? builtInPages[name]
                : () => renderMarkdownPage(project, page.sourcePath, markdown, clientAssets)
        eleventyConfig.addTemplate('virtual/' + page.sourcePath.replace(/\.md$/u, '') + '.11ty.js', render, {
            permalink: decodeURIComponent(page.route)
        })
    }
    eleventyConfig.addTemplate(
        'virtual/__tio2/cms-preview-probe.11ty.js',
        () => JSON.stringify({ marker: cmsPreviewProbeMarker }),
        { permalink: cmsPreviewProbePath, eleventyAllowMissingExtension: true }
    )

    eleventyConfig.addTransform('reject-mathjax-errors', function (html) {
        const mathError = html.match(/data-mjx-error="([^"]+)"/u)?.[1]
        if (mathError) throw new Error(`MathJax error in ${this.page.inputPath}: ${mathError}`)
        return html
    })
}

async function loadClientAssets(clientBuildDirectory) {
    const clientManifestPath = path.join(clientBuildDirectory, '.vite/manifest.json')
    const manifest = JSON.parse(await fs.readFile(clientManifestPath, 'utf8'))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(`Invalid Vite manifest: ${clientManifestPath}`)
    }

    const entries = Object.entries(manifest).filter(([, chunk]) => chunk?.isEntry === true)
    if (entries.length !== 1 || entries[0][0] !== 'site/client/main.ts') {
        throw new Error(
            `Expected one Vite entry named site/client/main.ts, found ${entries.map(([key]) => key).join(', ')}`
        )
    }

    const stylesheets = new Set()
    const modulePreloads = new Set()
    const visited = new Set()
    const visit = async (key, preload = false) => {
        if (visited.has(key)) return
        visited.add(key)
        const chunk = manifest[key]
        if (!chunk || typeof chunk.file !== 'string') throw new Error(`Missing Vite manifest chunk: ${key}`)
        await assertClientAsset(clientBuildDirectory, chunk.file)
        if (preload) modulePreloads.add(`/${chunk.file}`)
        for (const css of chunk.css ?? []) {
            await assertClientAsset(clientBuildDirectory, css)
            stylesheets.add(`/${css}`)
        }
        for (const imported of chunk.imports ?? []) await visit(imported, true)
    }

    for (const [key, chunk] of Object.entries(manifest)) {
        if (!chunk || typeof chunk.file !== 'string') throw new Error(`Invalid Vite manifest chunk: ${key}`)
        await assertClientAsset(clientBuildDirectory, chunk.file)
        for (const asset of [...(chunk.css ?? []), ...(chunk.assets ?? [])])
            await assertClientAsset(clientBuildDirectory, asset)
        for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
            if (!manifest[dependency]) throw new Error(`Missing Vite manifest dependency: ${dependency}`)
        }
    }

    const entry = entries[0][1]
    await visit(entries[0][0])
    return {
        stylesheets: [...stylesheets],
        modulePreloads: [...modulePreloads],
        script: `/${entry.file}`
    }
}

async function assertClientAsset(clientBuildDirectory, file) {
    if (typeof file !== 'string' || !file.startsWith('assets/client/') || file.includes('..')) {
        throw new Error(`Unsafe Vite manifest asset: ${String(file)}`)
    }
    await fs.access(path.join(clientBuildDirectory, file))
}
