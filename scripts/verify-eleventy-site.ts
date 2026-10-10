import { loadTiO2Project } from '../packages/config/src/project.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { globby } from 'globby'
import {
    cmsPreviewProbeMarker,
    cmsPreviewProbePath,
    type ArticleImageManifest,
    type ProofLedgerNode
} from '../packages/content-core/src/index'
import { buildProofLedger, createAbsoluteUrl, loadSiteContent } from '../packages/content-fs/src/index'
const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const tio2Config = project.config

const outputDirectory = path.resolve(project.rootDir, process.env.TIO2_OUTPUT_DIR ?? '.tio2-tmp/site')
const clientManifestPath = path.join(project.rootDir, '.tio2-tmp', 'site-client', '.vite', 'manifest.json')
const imageManifestPath = path.join(project.rootDir, '.tio2-tmp', 'site-work', 'article-images.json')
const notFoundRoute = '/404.html'
const forbiddenComponentPattern =
    /<\/?(?:InternalRef|ReferenceEmbed|BlockAnchor|BacklinkBadge|ArticleImage|ImageLoadFrame|FoldBlock|EncryptedContent|Page|Archives|Category|Tags|Topics|Ledger|AboutExperience)\b/gu

interface ViteManifestChunk {
    file: string
    css?: string[]
    assets?: string[]
    imports?: string[]
    dynamicImports?: string[]
    isEntry?: boolean
}

async function verify() {
    const [content, imageManifest, clientManifest, ledger] = await Promise.all([
        loadSiteContent(project, { env: 'production' }),
        readJson<ArticleImageManifest>(imageManifestPath),
        readJson<Record<string, ViteManifestChunk>>(clientManifestPath),
        buildProofLedger(path.join(project.rootDir, 'proofs'))
    ])
    const clientEntry = clientManifest['site/client/main.ts']
    if (!clientEntry?.isEntry) throw new Error('Missing site/client/main.ts Vite entry')

    for (const chunk of Object.values(clientManifest)) {
        for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
            await fs.access(path.join(outputDirectory, file))
        }
    }

    const articleRoutes = new Set(content.articles.map((article) => article.regularPath))
    const expectedRoutes = new Set(content.publishing.entries.map((entry) => entry.route))
    const internalRoutes = new Set(expectedRoutes)
    internalRoutes.add(notFoundRoute)
    const localAssets = new Set<string>()
    let formulaCount = 0
    let inlineReferenceCount = 0
    let embedCount = 0
    let imageCount = 0
    let htmlBytes = 0

    for (const entry of content.publishing.entries) {
        const html = await fs.readFile(routeToOutputPath(entry.route), 'utf8')
        htmlBytes += Buffer.byteLength(html)
        const canonicalUrl = createAbsoluteUrl(entry.route, tio2Config.site.url)
        if (!html.includes(`<link rel="canonical" href="${canonicalUrl}">`)) {
            throw new Error(`${entry.route}: missing canonical ${canonicalUrl}`)
        }
        if (!html.includes(`<script type="module" src="/${clientEntry.file}"></script>`)) {
            throw new Error(`${entry.route}: missing client entry`)
        }
        for (const css of clientEntry.css ?? []) {
            if (!html.includes(`<link rel="stylesheet" href="/${css}">`)) {
                throw new Error(`${entry.route}: missing client stylesheet ${css}`)
            }
        }
        if (html.includes(' v-pre=""')) throw new Error(`${entry.route}: residual Vue v-pre directive`)
        if (html.includes('<!--::markdown-it-async::')) throw new Error(`${entry.route}: unresolved code highlight`)
        const forbiddenComponent = html.match(forbiddenComponentPattern)?.[0]
        forbiddenComponentPattern.lastIndex = 0
        if (forbiddenComponent) throw new Error(`${entry.route}: residual Vue component ${forbiddenComponent}`)
        const mathError = html.match(/data-mjx-error="([^"]+)"/u)?.[1]
        if (mathError) throw new Error(`${entry.route}: MathJax error: ${mathError}`)

        for (const match of html.matchAll(/<mjx-container\b([^>]*)>/gu)) {
            formulaCount += 1
            if (!/\bdata-tex="[^"]+"/u.test(match[1])) {
                throw new Error(`${entry.route}: MathJax container without data-tex`)
            }
        }

        const routeImages = html.match(/class="article-image article-image--/gu)?.length ?? 0
        const routeImageTriggers = html.match(/data-article-image-viewer/gu)?.length ?? 0
        if (routeImages !== routeImageTriggers) {
            throw new Error(`${entry.route}: ${routeImages} article images but ${routeImageTriggers} viewer triggers`)
        }
        imageCount += routeImages
        inlineReferenceCount += html.match(/class="internal-ref__link"/gu)?.length ?? 0
        embedCount += html.match(/class="reference-embed(?:\s|")/gu)?.length ?? 0

        const isArticle = articleRoutes.has(entry.route)
        const hasArticleMeta = html.includes('property="article:published_time"')
        const hasJsonLd = html.includes('<script type="application/ld+json">')
        if (isArticle !== hasArticleMeta || isArticle !== hasJsonLd) {
            throw new Error(`${entry.route}: article SEO metadata mismatch`)
        }
        collectLocalAssets(html, localAssets)
        assertInternalHtmlLinks(entry.route, html, internalRoutes)
    }

    const notFoundHtml = await fs.readFile(routeToOutputPath(notFoundRoute), 'utf8')
    htmlBytes += Buffer.byteLength(notFoundHtml)
    if (!notFoundHtml.includes('<meta name="robots" content="noindex,follow">')) {
        throw new Error(`${notFoundRoute}: missing noindex metadata`)
    }
    if (!tio2Config.theme.layout && !notFoundHtml.includes('<h1 class="title">PAGE NOT FOUND</h1>')) {
        throw new Error(`${notFoundRoute}: missing not-found content`)
    }
    if (!notFoundHtml.includes(`<script type="module" src="/${clientEntry.file}"></script>`)) {
        throw new Error(`${notFoundRoute}: missing client entry`)
    }
    collectLocalAssets(notFoundHtml, localAssets)
    assertInternalHtmlLinks(notFoundRoute, notFoundHtml, internalRoutes)

    for (const asset of localAssets) await fs.access(resolveLocalAsset(asset))
    for (const image of Object.values(imageManifest.entries)) {
        for (const src of [
            image.src,
            image.viewerSrc,
            image.darkSrc,
            ...image.avif.map((candidate) => candidate.src),
            ...image.webp.map((candidate) => candidate.src)
        ]) {
            if (src) await fs.access(resolveLocalAsset(src))
        }
    }
    for (const proof of collectProofUrls(ledger.roots)) await fs.access(resolveLocalAsset(proof))
    const publishingArtifacts = [
        ['sitemap.xml', tio2Config.integrations.sitemap],
        ['feed.xml', tio2Config.integrations.feed],
        ['atom.xml', tio2Config.integrations.feed],
        ['feed.json', tio2Config.integrations.feed]
    ] as const
    const notFoundUrl = createAbsoluteUrl(notFoundRoute, tio2Config.site.url)
    for (const [artifact, enabled] of publishingArtifacts) {
        const artifactPath = path.join(outputDirectory, artifact)
        if (!enabled) {
            try {
                await fs.access(artifactPath)
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
                throw error
            }
            throw new Error(`${artifact}: exists while its integration is disabled`)
        }
        await fs.access(artifactPath)
        if ((await fs.readFile(artifactPath, 'utf8')).includes(notFoundUrl)) {
            throw new Error(`${artifact}: contains non-publishing route ${notFoundRoute}`)
        }
    }
    await fs.access(path.join(outputDirectory, 'assets/search-index.json'))

    const probe = JSON.parse(await fs.readFile(routeToOutputPath(cmsPreviewProbePath), 'utf8'))
    if (probe?.marker !== cmsPreviewProbeMarker) throw new Error('Invalid CMS preview probe')
    const htmlFiles = await globby(['**/*.html', '!assets/**'], { cwd: outputDirectory, onlyFiles: true })
    const expectedHtmlCount = expectedRoutes.size + 1
    if (htmlFiles.length !== expectedHtmlCount) {
        throw new Error(`Expected ${expectedHtmlCount} HTML pages, found ${htmlFiles.length}`)
    }

    console.log(
        `[eleventy-site:verify] ${JSON.stringify({
            pages: htmlFiles.length,
            formulas: formulaCount,
            inlineReferences: inlineReferenceCount,
            embeds: embedCount,
            images: imageCount,
            localAssets: localAssets.size,
            proofs: ledger.proofCount,
            htmlBytes
        })}`
    )
}

function routeToOutputPath(route: string) {
    if (!route.startsWith('/')) throw new Error(`Unsupported route: ${route}`)
    return path.join(outputDirectory, route === '/' ? 'index.html' : decodeURIComponent(route.slice(1)))
}

function collectLocalAssets(html: string, assets: Set<string>) {
    for (const match of html.matchAll(/\b(?:src|srcset)="([^"]+)"/gu)) {
        for (const candidate of match[1].split(',')) {
            const url = candidate.trim().split(/\s+/u)[0].replace(/&amp;/gu, '&')
            if (url.startsWith('/') && !url.startsWith('//')) assets.add(url)
        }
    }
}

function resolveLocalAsset(asset: string) {
    const pathname = new URL(asset, 'https://candidate.invalid').pathname
    const outputPath = path.resolve(outputDirectory, `.${pathname}`)
    const relativePath = path.relative(outputDirectory, outputPath)
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error(`Asset escapes site output: ${asset}`)
    }
    return outputPath
}

function assertInternalHtmlLinks(sourceRoute: string, html: string, expectedRoutes: Set<string>) {
    for (const match of html.matchAll(/\bhref="(\/[^"?#]+\.html)([?#][^"]*)?"/gu)) {
        const route = match[1].replace(/&amp;/gu, '&')
        if (!expectedRoutes.has(route)) throw new Error(`${sourceRoute}: unknown internal route ${route}`)
    }
}

function collectProofUrls(nodes: ProofLedgerNode[]): string[] {
    return nodes.flatMap((node) => (node.kind === 'proof' ? [node.proofUrl] : collectProofUrls(node.children)))
}

async function readJson<T>(filePath: string): Promise<T> {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error(`Invalid JSON object: ${filePath}`)
    return parsed as T
}

await verify().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
