export const ARTICLE_IMAGE_MANIFEST_VERSION = 1

export type ArticleImageKind = 'raster' | 'svg'
export type ArticleImageLayout = 'compact' | 'panorama' | 'portrait' | 'standard'

export interface ArticleImageVariant {
    src: string
    width: number
}

export interface ArticleImageManifestEntry {
    authoredSrc: string
    documentPath: string
    height: number
    kind: ArticleImageKind
    layout: ArticleImageLayout
    darkSrc?: string
    src: string
    viewerSrc: string
    width: number
    avif: ArticleImageVariant[]
    webp: ArticleImageVariant[]
}

export interface ArticleImageManifest {
    version: typeof ARTICLE_IMAGE_MANIFEST_VERSION
    generatedAt: string
    entries: Record<string, ArticleImageManifestEntry>
}

export function createArticleImageKey(documentPath: string, authoredSrc: string) {
    return `${normalizeDocumentPath(documentPath)}\n${normalizeAuthoredImageSource(authoredSrc)}`
}

export function classifyArticleImage(width: number, height: number): ArticleImageLayout {
    const aspectRatio = width / height

    if (aspectRatio >= 2.25) return 'panorama'
    if (aspectRatio <= 0.78) return 'portrait'
    if (width <= 640) return 'compact'
    return 'standard'
}

export function normalizeAuthoredImageSource(source: string) {
    const suffixIndex = findSuffixIndex(source)
    const pathOnly = suffixIndex >= 0 ? source.slice(0, suffixIndex) : source

    try {
        return decodeURIComponent(pathOnly)
    } catch {
        return pathOnly
    }
}

function normalizeDocumentPath(documentPath: string) {
    return documentPath.replace(/\\/g, '/').replace(/^\.?\//u, '')
}

function findSuffixIndex(source: string) {
    const queryIndex = source.indexOf('?')
    const hashIndex = source.indexOf('#')
    const indices = [queryIndex, hashIndex].filter((index) => index >= 0)
    return indices.length ? Math.min(...indices) : -1
}
