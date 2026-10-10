import type Token from 'markdown-it/lib/token.mjs'
import MarkdownIt from 'markdown-it'
import { resolveLanguage } from '../../config/src/i18n.js'
import type { AigcModelKey, ArticleCover } from './types'
import {
    cleanMarkdownText,
    matchWikiReferenceAt,
    parseBlockAnchorParagraph,
    parseWikiReference,
    slugifyFragment,
    truncateText,
    type WikiReferenceMatch
} from './reference-utils'

const markdownParser = new MarkdownIt({
    html: true
})
const referenceParser = new MarkdownIt({
    html: true
})

referenceParser.inline.ruler.before('link', 'wiki-reference-extraction', (state, silent) => {
    const matchedReference = matchWikiReferenceAt(state.src, state.pos, state.posMax)
    if (!matchedReference) return false

    if (!silent) {
        const token = state.push('wiki_reference', '', 0)
        token.content = matchedReference.raw
        token.meta = matchedReference
    }

    state.pos = matchedReference.end
    return true
})
const AIGC_MODEL_ALIASES: Record<string, AigcModelKey> = {
    openai: 'openai',
    chatgpt: 'openai',
    gpt: 'openai',
    'gpt-4': 'openai',
    gpt4: 'openai',
    'gpt-4o': 'openai',
    gpt4o: 'openai',
    claude: 'claude',
    anthropic: 'claude',
    'claude-ai': 'claude',
    gemini: 'gemini',
    google: 'gemini',
    'google-gemini': 'gemini'
}

export interface ParsedHeading {
    level: number
    title: string
    slug: string
}

export interface ParsedBlock {
    anchor: string
    excerpt: string
}

export interface ParsedRawReference {
    raw: string
    label: string
    embed: boolean
    context: string
}

export function extractRawFrontmatterValue(content: string, key: string) {
    const normalized = content.replace(/^\uFEFF/u, '').replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    if (lines[0]?.trim() !== '---') return ''

    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const keyPattern = new RegExp(`^${escapedKey}\\s*:\\s*(.*)$`, 'u')

    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim() === '---' || line.trim() === '...') break

        const match = line.match(keyPattern)
        if (!match) continue

        const rawValue = stripYamlInlineComment(match[1]).trim()
        if (
            rawValue.length >= 2 &&
            ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
                (rawValue.startsWith("'") && rawValue.endsWith("'")))
        ) {
            return rawValue.slice(1, -1)
        }

        return rawValue
    }

    return ''
}

export function calculateReadingStats(markdownContent: string, language = 'en') {
    const plainText = extractReadableText(markdownContent)
    const chinese = resolveLanguage(language) === 'zh-CN'
    const wordCount = chinese
        ? plainText.length
        : [...new Intl.Segmenter('en', { granularity: 'word' }).segment(plainText)].filter((part) => part.isWordLike)
              .length
    const readingTime = Math.max(1, Math.ceil(wordCount / (chinese ? 450 : 200)))

    return {
        wordCount,
        readingTime
    }
}

export function extractExcerpt(markdownContent: string) {
    return truncateText(extractReadableText(markdownContent), 180)
}

export function extractHeadings(markdownContent: string) {
    const normalized = markdownContent.replace(/\r\n/g, '\n')
    const tokens = markdownParser.parse(maskDisplayMath(normalized), {})
    const headings: ParsedHeading[] = []
    const usedSlugs = new Set<string>()

    for (let index = 0; index < tokens.length - 1; index += 1) {
        const headingOpen = tokens[index]
        const inline = tokens[index + 1]
        if (headingOpen.type !== 'heading_open' || inline.type !== 'inline') continue

        const title = (inline.children ?? [])
            .filter((token) => token.type === 'text' || token.type === 'code_inline')
            .map((token) => token.content)
            .join('')
            .trim()
        if (!title) continue

        const baseSlug = slugifyFragment(title)
        let slug = baseSlug
        let duplicateIndex = 1

        while (usedSlugs.has(slug)) {
            slug = `${baseSlug}-${duplicateIndex}`
            duplicateIndex += 1
        }
        usedSlugs.add(slug)

        headings.push({
            level: Number(headingOpen.tag.slice(1)),
            title,
            slug
        })
    }

    return headings
}

function maskDisplayMath(markdownContent: string) {
    let closingDelimiter = ''

    return markdownContent
        .split('\n')
        .map((line) => {
            const trimmed = line.trim()
            if (closingDelimiter) {
                if (trimmed === closingDelimiter) closingDelimiter = ''
                return ''
            }
            if (trimmed === '\\[') closingDelimiter = '\\]'
            if (trimmed === '$$') closingDelimiter = '$$'
            return closingDelimiter ? '' : line
        })
        .join('\n')
}

export function extractBlocks(markdownContent: string) {
    const normalized = markdownContent.replace(/\r\n/g, '\n')
    const tokens = markdownParser.parse(normalized, {})
    const blocks: ParsedBlock[] = []

    for (let index = 0; index < tokens.length - 2; index += 1) {
        const open = tokens[index]
        const inline = tokens[index + 1]
        const close = tokens[index + 2]

        if (open.type !== 'paragraph_open' || inline.type !== 'inline' || close.type !== 'paragraph_close') {
            continue
        }

        const block = parseBlockAnchorParagraph(inline.content)
        if (!block) continue
        blocks.push({
            anchor: block.anchor,
            excerpt: extractBlockSnippet(tokens, index, block.content)
        })
    }

    return blocks
}

export function extractReferences(markdownContent: string) {
    const normalized = markdownContent.replace(/\r\n/g, '\n')
    const references: ParsedRawReference[] = []
    const tokens = referenceParser.parse(normalized, {})

    for (const token of tokens) {
        if (token.type !== 'inline' || !token.children) continue

        const context = createReferenceContext(token.children)

        for (const child of token.children) {
            if (child.type !== 'wiki_reference') continue

            const matchedReference = child.meta as WikiReferenceMatch
            references.push({
                raw: matchedReference.raw,
                label: parseWikiReference(matchedReference.raw).label,
                embed: matchedReference.embed,
                context
            })
        }
    }

    return references
}

export function normalizePercentage(input?: unknown): number | null {
    if (input === undefined || input === null) return null

    const rawValue =
        typeof input === 'string'
            ? input.trim().replace(/％/g, '%').replace(/%$/, '')
            : typeof input === 'number'
              ? input
              : Number(input)

    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)

    if (!Number.isFinite(value)) return null

    return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

export function normalizeHumanWritten(input: unknown): boolean {
    if (input === undefined || input === null || input === false) return false
    if (input === true) return true

    throw new TypeError(`humanWritten must be true or false; received ${JSON.stringify(input)}`)
}

export function normalizeAigcModels(input: unknown): AigcModelKey[] {
    const values = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[，,、|/]+/g) : []

    const models = values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .map((value) => AIGC_MODEL_ALIASES[value] ?? null)
        .filter((value): value is AigcModelKey => Boolean(value))

    return models.filter((value, index) => models.indexOf(value) === index)
}

export function normalizeArticleCover(input: unknown): ArticleCover | undefined {
    if (!isPlainObject(input)) return undefined

    const src = typeof input.src === 'string' ? input.src.trim() : ''
    if (!src) return undefined

    return {
        src,
        alt: typeof input.alt === 'string' ? input.alt.trim() : '',
        fit: input.fit === 'contain' ? 'contain' : 'cover',
        position: typeof input.position === 'string' && input.position.trim() ? input.position.trim() : 'center'
    }
}

export function inferTitleFromPath(filePath: string) {
    const normalizedPath = filePath.replace(/\\/gu, '/')
    const fileName = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
    return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
}

function extractReadableText(markdownContent: string) {
    return cleanMarkdownText(
        markdownContent
            .replace(/(!)?\[\[([^\]]+?)\]\]/g, (_, _embed, inner) => {
                const parsed = parseWikiReference(inner)
                return parsed.label || parsed.target || parsed.anchor
            })
            .replace(/^\^([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/gm, ' ')
    )
}

function createReferenceContext(tokens: Token[]) {
    const visibleText = tokens
        .map((token) => {
            if (token.type === 'text') return token.content
            if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
            if (token.type !== 'wiki_reference') return ''

            const matchedReference = token.meta as WikiReferenceMatch
            const parsed = parseWikiReference(matchedReference.raw)
            return parsed.label || parsed.target || parsed.anchor
        })
        .join('')

    return truncateText(cleanMarkdownText(visibleText), 96)
}

function extractBlockSnippet(tokens: Token[], paragraphIndex: number, paragraphContent: string) {
    const ownSnippet = cleanMarkdownText(paragraphContent)
    if (ownSnippet) return truncateText(ownSnippet, 140)

    for (let index = paragraphIndex - 1; index >= 0; index -= 1) {
        const token = tokens[index]
        if (token.type !== 'inline') continue

        const previousBlock = parseBlockAnchorParagraph(token.content)
        const previousSnippet = cleanMarkdownText(previousBlock?.content ?? token.content)
        if (previousSnippet) {
            return truncateText(previousSnippet, 140)
        }
    }

    return ''
}

function stripYamlInlineComment(value: string) {
    let quote = ''

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]

        if (quote) {
            if (character === quote && (quote === "'" || value[index - 1] !== '\\')) {
                quote = ''
            }
            continue
        }

        if (character === '"' || character === "'") {
            quote = character
            continue
        }

        if (character === '#' && (index === 0 || /\s/u.test(value[index - 1]))) {
            return value.slice(0, index)
        }
    }

    return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
