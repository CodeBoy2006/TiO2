import type Token from 'markdown-it/lib/token.mjs'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { globby } from 'globby'
import MarkdownIt from 'markdown-it'
import sharp, { type Metadata } from 'sharp'
import {
    ARTICLE_IMAGE_MANIFEST_VERSION,
    classifyArticleImage,
    createArticleImageKey,
    normalizeAuthoredImageSource,
    type ArticleImageManifest,
    type ArticleImageManifestEntry,
    type ArticleImageVariant
} from '../../content-core/src/index'

const PIPELINE_VERSION = 'article-images-v1'
const DARK_SVG_PIPELINE_VERSION = 'article-images-dark-svg-v1'
const DARK_SVG_INK = 'rgb(92%,93%,95%)'
const DARK_SVG_COLORS: Array<[RegExp, string]> = [
    // White fills are paper surfaces; white strokes can carry meaning and must stay bright.
    [/(\bfill\s*[:=]\s*["']?)(?:#fff(?:fff)?\b|white\b|rgb\(\s*100%\s*,\s*100%\s*,\s*100%\s*\))/giu, '$1#1b1b1f'],
    [/#(?:f6f6f7|fafafa|f7f7f7|ebebeb)\b/giu, '#202127'],
    [/#(?:eef3fd|e9effd|f0f4fe|ebf1fd|f2f6fe|f4f7fe)\b/giu, '#202127'],
    [/#(?:ecf5ef|e8f2ec|eff6f1)\b/giu, '#202127'],
    [/#(?:f9eded|f8e8e8)\b/giu, '#202127'],
    [/(\bfill\s*[:=]\s*["']?)rgb\(\s*89\.\d+%\s*,\s*90\.\d+%\s*,\s*92\.\d+%\s*\)/giu, '$1#202127'],
    [/#2563eb\b/giu, '#60a5fa'],
    [/#b91c1c\b/giu, '#f87171'],
    [/#15803d\b/giu, '#4ade80'],
    [/#6b7280\b/giu, '#9ca3af'],
    [/rgb\(\s*14\.\d+%\s*,\s*38\.\d+%\s*,\s*92\.\d+%\s*\)/giu, '#60a5fa'],
    [/rgb\(\s*72\.\d+%\s*,\s*10\.\d+%\s*,\s*10\.\d+%\s*\)/giu, '#f87171'],
    [/rgb\(\s*8\.\d+%\s*,\s*50\.\d+%\s*,\s*23\.\d+%\s*\)/giu, '#4ade80'],
    [/rgb\(\s*41\.\d+%\s*,\s*44\.\d+%\s*,\s*50\.\d+%\s*\)/giu, '#9ca3af']
]
const RASTER_EXTENSIONS = new Set(['.avif', '.jpeg', '.jpg', '.png', '.webp'])
const TARGET_WIDTHS = [480, 768, 960, 1280, 1600, 1920]

export interface GenerateArticleImagesOptions {
    repoRoot: string
    contentDirectories: string[]
    imageSourceDirectory?: string
    outputDirectory?: string
    manifestPath?: string
    quiet?: boolean
}

interface ImageReference {
    authoredSrc: string
    documentPath: string
    key: string
    sourcePath: string
}

interface ProcessedImage {
    entry: Omit<ArticleImageManifestEntry, 'authoredSrc' | 'documentPath'>
    outputPaths: string[]
}

export async function generateArticleImages(options: GenerateArticleImagesOptions) {
    const repoRoot = path.resolve(options.repoRoot)
    const sourceDirectory = path.resolve(repoRoot, options.imageSourceDirectory ?? path.join('assets', 'images'))
    const outputDirectory = path.resolve(
        repoRoot,
        options.outputDirectory ?? path.join('public', 'images', 'generated')
    )
    const manifestPath = path.resolve(
        repoRoot,
        options.manifestPath ?? path.join('.vitepress', 'generated', 'article-images.json')
    )
    const references = await collectImageReferences(repoRoot, options.contentDirectories, sourceDirectory)
    const processedBySourcePath = new Map<string, ProcessedImage>()
    const expectedOutputPaths = new Set<string>()
    const entries: Record<string, ArticleImageManifestEntry> = {}

    await fs.mkdir(outputDirectory, { recursive: true })

    for (const reference of references) {
        let processed = processedBySourcePath.get(reference.sourcePath)

        if (!processed) {
            processed = await processImage(reference.sourcePath, outputDirectory)
            processedBySourcePath.set(reference.sourcePath, processed)
            processed.outputPaths.forEach((outputPath) => expectedOutputPaths.add(outputPath))
        }

        entries[reference.key] = {
            ...processed.entry,
            authoredSrc: reference.authoredSrc,
            documentPath: reference.documentPath
        }
    }

    await removeStaleOutputs(outputDirectory, expectedOutputPaths)

    const manifest: ArticleImageManifest = {
        version: ARTICLE_IMAGE_MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        entries
    }

    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    if (!options.quiet) {
        const sourceBytes = await sumFileSizes(processedBySourcePath.keys())
        const outputBytes = await sumFileSizes(expectedOutputPaths)
        console.log(
            `[article-images] ${processedBySourcePath.size} sources -> ${expectedOutputPaths.size} files ` +
                `(${formatBytes(sourceBytes)} source, ${formatBytes(outputBytes)} generated)`
        )
    }

    return manifest
}

async function collectImageReferences(repoRoot: string, contentDirectories: string[], imageSourceDirectory: string) {
    const markdown = new MarkdownIt()
    const patterns = [...contentDirectories.map((directory) => `${toPosixPath(directory)}/**/*.md`), '*.md']
    const documentPaths = await globby(patterns, {
        cwd: repoRoot,
        absolute: false,
        gitignore: true
    })
    const references = new Map<string, ImageReference>()

    for (const documentPath of documentPaths.sort()) {
        const source = await fs.readFile(path.join(repoRoot, documentPath), 'utf8')
        const tokens = markdown.parse(source, {})

        for (const authoredSrc of collectTokenImageSources(tokens)) {
            const normalizedSource = normalizeAuthoredImageSource(authoredSrc)
            const sourcePath = resolveImageSourcePath(repoRoot, documentPath, normalizedSource, imageSourceDirectory)

            if (!sourcePath) continue

            const key = createArticleImageKey(documentPath, authoredSrc)
            references.set(key, {
                authoredSrc,
                documentPath: toPosixPath(documentPath),
                key,
                sourcePath
            })
        }
    }

    return [...references.values()]
}

function collectTokenImageSources(tokens: Token[]) {
    const sources: string[] = []

    for (const token of tokens) {
        if (token.type === 'image') {
            const src = token.attrGet('src')
            if (src) sources.push(src)
        }

        if (token.children?.length) {
            sources.push(...collectTokenImageSources(token.children))
        }
    }

    return sources
}

function resolveImageSourcePath(
    repoRoot: string,
    documentPath: string,
    normalizedSource: string,
    imageSourceDirectory: string
) {
    if (!normalizedSource || isRemoteSource(normalizedSource) || normalizedSource.startsWith('#')) {
        return null
    }

    const sourcePath = normalizedSource.startsWith('/images/')
        ? path.resolve(imageSourceDirectory, normalizedSource.slice('/images/'.length))
        : normalizedSource.startsWith('/')
          ? null
          : path.resolve(repoRoot, path.dirname(documentPath), normalizedSource)

    if (!sourcePath) return null

    const relativePath = path.relative(repoRoot, sourcePath)
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error(`[article-images] ${documentPath} references an image outside the project: ${normalizedSource}`)
    }

    return sourcePath
}

function isRemoteSource(source: string) {
    return source.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source)
}

async function processImage(sourcePath: string, outputDirectory: string): Promise<ProcessedImage> {
    const extension = path.extname(sourcePath).toLowerCase()

    try {
        await fs.access(sourcePath)
    } catch {
        throw new Error(`[article-images] Image source file not found: ${sourcePath}`)
    }

    if (extension === '.svg') {
        return processSvg(sourcePath, outputDirectory)
    }

    if (!RASTER_EXTENSIONS.has(extension)) {
        throw new Error(`[article-images] Unsupported image format: ${sourcePath}`)
    }

    return processRaster(sourcePath, outputDirectory)
}

async function processRaster(sourcePath: string, outputDirectory: string): Promise<ProcessedImage> {
    const sourceBuffer = await fs.readFile(sourcePath)
    const contentHash = createContentHash(sourceBuffer)
    const metadata = await sharp(sourceBuffer).metadata()
    const { width, height } = getOrientedDimensions(metadata, sourcePath)
    const widths = createTargetWidths(width)
    const avif: ArticleImageVariant[] = []
    const webp: ArticleImageVariant[] = []
    const outputPaths: string[] = []

    for (const targetWidth of widths) {
        const avifFileName = `${contentHash}-${targetWidth}.avif`
        const webpFileName = `${contentHash}-${targetWidth}.webp`
        const avifPath = path.join(outputDirectory, avifFileName)
        const webpPath = path.join(outputDirectory, webpFileName)

        await Promise.all([
            writeIfMissing(avifPath, (temporaryPath) =>
                sharp(sourceBuffer)
                    .autoOrient()
                    .resize({ width: targetWidth, withoutEnlargement: true })
                    .avif({ quality: 60, effort: 4, chromaSubsampling: '4:4:4' })
                    .toFile(temporaryPath)
            ),
            writeIfMissing(webpPath, (temporaryPath) =>
                sharp(sourceBuffer)
                    .autoOrient()
                    .resize({ width: targetWidth, withoutEnlargement: true })
                    .webp({ quality: 86, effort: 4, smartSubsample: false })
                    .toFile(temporaryPath)
            )
        ])

        avif.push({ src: toPublicImageUrl(avifFileName), width: targetWidth })
        webp.push({ src: toPublicImageUrl(webpFileName), width: targetWidth })
        outputPaths.push(avifPath, webpPath)
    }

    const largestWebp = webp.at(-1)
    if (!largestWebp) {
        throw new Error(`[article-images] No WebP image generated: ${sourcePath}`)
    }

    return {
        entry: {
            avif,
            height,
            kind: 'raster',
            layout: classifyArticleImage(width, height),
            src: largestWebp.src,
            viewerSrc: largestWebp.src,
            webp,
            width
        },
        outputPaths
    }
}

async function processSvg(sourcePath: string, outputDirectory: string): Promise<ProcessedImage> {
    const sourceBuffer = await fs.readFile(sourcePath)
    const contentHash = createContentHash(sourceBuffer)
    const metadata = await sharp(sourceBuffer).metadata()
    const { width, height } = getOrientedDimensions(metadata, sourcePath)
    const fileName = `${contentHash}.svg`
    const outputPath = path.join(outputDirectory, fileName)

    await writeIfMissing(outputPath, (temporaryPath) => fs.copyFile(sourcePath, temporaryPath))

    const src = toPublicImageUrl(fileName)
    const darkBuffer = createDarkSvgVariant(sourceBuffer)
    const darkFileName = darkBuffer
        ? `${createHash('sha256')
              .update(DARK_SVG_PIPELINE_VERSION)
              .update(darkBuffer)
              .digest('hex')
              .slice(0, 16)}-dark.svg`
        : undefined
    const darkOutputPath = darkFileName ? path.join(outputDirectory, darkFileName) : undefined

    if (darkBuffer && darkOutputPath) {
        await writeIfMissing(darkOutputPath, (temporaryPath) => fs.writeFile(temporaryPath, darkBuffer))
    }

    return {
        entry: {
            avif: [],
            darkSrc: darkFileName ? toPublicImageUrl(darkFileName) : undefined,
            height,
            kind: 'svg',
            layout: classifyArticleImage(width, height),
            src,
            viewerSrc: src,
            webp: [],
            width
        },
        outputPaths: darkOutputPath ? [outputPath, darkOutputPath] : [outputPath]
    }
}

function createDarkSvgVariant(source: Buffer) {
    const svg = source.toString('utf8')
    const darkSvg = DARK_SVG_COLORS.reduce((result, [color, replacement]) => result.replace(color, replacement), svg)
        .replace(/rgb\(\s*0%\s*,\s*0%\s*,\s*0%\s*\)/giu, DARK_SVG_INK)
        .replace(/#000000\b/giu, '#ebeef2')
        .replace(/#000\b/giu, '#ebeef2')
        .replace(/\bblack\b/giu, '#ebeef2')

    return darkSvg === svg ? null : Buffer.from(darkSvg)
}

function getOrientedDimensions(metadata: Metadata, sourcePath: string) {
    if (!metadata.width || !metadata.height) {
        throw new Error(`[article-images] Cannot read image dimensions: ${sourcePath}`)
    }

    const swapsAxes = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8

    return swapsAxes
        ? { width: metadata.height, height: metadata.width }
        : { width: metadata.width, height: metadata.height }
}

function createTargetWidths(sourceWidth: number) {
    const maximumWidth = Math.min(sourceWidth, TARGET_WIDTHS.at(-1) ?? sourceWidth)

    return [...new Set([...TARGET_WIDTHS.filter((width) => width < maximumWidth), maximumWidth])].sort(
        (left, right) => left - right
    )
}

function createContentHash(source: Buffer) {
    return createHash('sha256').update(PIPELINE_VERSION).update(source).digest('hex').slice(0, 16)
}

async function writeIfMissing(outputPath: string, write: (temporaryPath: string) => Promise<unknown>) {
    try {
        await fs.access(outputPath)
        return
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    // Only completed images enter the persistent cache, even if a build is interrupted.
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`
    try {
        await write(temporaryPath)
        await fs.rename(temporaryPath, outputPath)
    } finally {
        await fs.rm(temporaryPath, { force: true })
    }
}

async function removeStaleOutputs(outputDirectory: string, expectedOutputPaths: Set<string>) {
    const existingFileNames = await fs.readdir(outputDirectory)

    await Promise.all(
        existingFileNames.map(async (fileName) => {
            const outputPath = path.join(outputDirectory, fileName)
            if (!expectedOutputPaths.has(outputPath)) {
                await fs.rm(outputPath, { force: true, recursive: true })
            }
        })
    )
}

async function sumFileSizes(paths: Iterable<string>) {
    let total = 0

    for (const filePath of paths) {
        total += (await fs.stat(filePath)).size
    }

    return total
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function toPublicImageUrl(fileName: string) {
    return `/images/generated/${fileName}`
}

function toPosixPath(value: string) {
    return value.replace(/\\/g, '/')
}
