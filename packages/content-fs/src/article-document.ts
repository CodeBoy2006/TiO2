import {
    calculateReadingStats,
    convertDateV2,
    convertOrder,
    createArticleTargetId,
    createMarkdownRoute,
    extractBlocks,
    extractExcerpt,
    extractHeadings,
    extractRawFrontmatterValue,
    extractReferences,
    inferTitleFromPath,
    maskMarkdownContainers,
    normalizeAigcModels,
    normalizeArticleCover,
    normalizeHumanWritten,
    normalizePercentage,
    normalizeTopicKeys,
    type ArticleKind,
    type BlogPost,
    type ParsedBlock,
    type ParsedHeading,
    type ParsedRawReference
} from '../../content-core/src/index'
import { readMarkdownSource, type MarkdownSource } from './markdown-source'

export interface ParsedArticleDocument {
    post: BlogPost
    headings: ParsedHeading[]
    blocks: ParsedBlock[]
    references: ParsedRawReference[]
}

interface LoadArticleDocumentOptions {
    source?: MarkdownSource
    language?: string
}

export async function loadArticleDocument(
    sourcePath: string,
    kind: ArticleKind,
    collectionKey: string,
    options: LoadArticleDocumentOptions = {}
): Promise<ParsedArticleDocument> {
    const { rawContent, data, content: markdownContent } = options.source ?? (await readMarkdownSource(sourcePath))
    const normalizedMarkdown = markdownContent.replace(/\r\n/g, '\n')
    const publicMarkdown = maskMarkdownContainers(normalizedMarkdown, ['encrypt'], sourcePath)
    const rawDate = extractRawFrontmatterValue(rawContent, 'date')
    const rawLastUpdated = extractRawFrontmatterValue(rawContent, 'lastUpdated')
    const normalizedDate = convertDateV2(rawDate || data.date)
    const normalizedLastUpdated = convertDateV2(rawLastUpdated || data.lastUpdated)
    const aigcRate = normalizePercentage(data.aigcRate ?? data.aigc)
    const rawAigcModels = data.aigcModels ?? data.aiModels ?? data.aigcModel ?? data.aiModel
    const aigcModels = normalizeAigcModels(rawAigcModels)
    const humanWritten = readHumanWritten(sourcePath, data.humanWritten ?? data.noAI)
    if (humanWritten && ((aigcRate ?? 0) > 0 || hasListValue(rawAigcModels))) {
        const conflict = (aigcRate ?? 0) > 0 ? `aigcRate: ${aigcRate}` : 'aigcModels'
        throw new Error(
            `${sourcePath}: humanWritten: true conflicts with ${conflict}. Remove aigcRate / aigcModels or set aigcRate to 0 when declaring no AI use.`
        )
    }
    const stats = calculateReadingStats(
        publicMarkdown,
        (typeof data.lang === 'string' ? data.lang.trim() : '') || options.language
    )
    const excerpt = extractExcerpt(publicMarkdown)
    const headings = extractHeadings(publicMarkdown)
    const blocks = extractBlocks(publicMarkdown)
    const references = extractReferences(publicMarkdown)

    return {
        post: {
            frontMatter: {
                ...data,
                title:
                    typeof data.title === 'string' && data.title.trim()
                        ? data.title.trim()
                        : inferTitleFromPath(sourcePath),
                description: typeof data.description === 'string' ? data.description.trim() : '',
                date: normalizedDate.split(' ')[0],
                publishedAt: normalizedDate,
                lastUpdated: normalizedLastUpdated,
                order: convertOrder(data.order),
                aigcRate: aigcRate ?? undefined,
                aigcModels: aigcModels.length ? aigcModels : undefined,
                humanWritten: humanWritten ? true : undefined,
                tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [],
                topics: normalizeTopicKeys(data.topics),
                cover: normalizeArticleCover(data.cover),
                wordCount: stats.wordCount,
                readingTime: stats.readingTime
            },
            regularPath: createMarkdownRoute(sourcePath),
            sourcePath,
            kind,
            collectionKey,
            excerpt,
            articleTargetId: createArticleTargetId(sourcePath)
        },
        headings,
        blocks,
        references
    }
}

function readHumanWritten(sourcePath: string, input: unknown) {
    try {
        return normalizeHumanWritten(input)
    } catch (error) {
        throw new Error(`${sourcePath}: ${(error as Error).message}`)
    }
}

function hasListValue(input: unknown) {
    if (Array.isArray(input)) return input.some((value) => typeof value === 'string' && value.trim())
    return typeof input === 'string' && input.trim().length > 0
}
