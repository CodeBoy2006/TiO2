import matter from 'gray-matter'
import { maskEncryptedMarkdown } from '../.vitepress/theme/encryptedMarkdownPlugin'

export function prepareSearchMarkdown(src: string, relativePath: string) {
    const parsed = matter(src)
    const frontmatter = parsed.data as Record<string, unknown>
    if (frontmatter.search === false) return null

    const searchableSource = maskEncryptedMarkdown(parsed.content, relativePath)
    const searchMetadataMarkdown = createSearchMetadataMarkdown(frontmatter)
    const title = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : ''

    if (!title) {
        return {
            frontmatter,
            markdown: searchableSource
        }
    }

    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const titleRegex = new RegExp(`^#\\s+${escapedTitle}\\s*$`, 'm')
    if (titleRegex.test(searchableSource)) {
        return {
            frontmatter,
            markdown: searchMetadataMarkdown
                ? searchableSource.replace(titleRegex, (heading) => `${heading}${searchMetadataMarkdown}`)
                : searchableSource
        }
    }

    return {
        frontmatter,
        markdown: `# ${title}${searchMetadataMarkdown}\n\n${searchableSource}`
    }
}

/** The one-line context shown beside a search result: kind and domains for entries, category and date for articles. */
export function describeSearchEntry(
    kind: string,
    details: { publishedAt?: string; category?: string; entryKind?: string; domains?: string[] }
) {
    if (kind === 'foundation') return [details.entryKind, ...(details.domains ?? [])].filter(Boolean).join(' · ')
    if (kind === 'post' || kind === 'topic')
        return [details.category, details.publishedAt?.slice(0, 10)].filter(Boolean).join(' · ')
    return ''
}

export function tokenizeSearchText(text: string, language = 'en') {
    return [...new Intl.Segmenter(language, { granularity: 'word' }).segment(text.normalize('NFKC'))]
        .filter((segment) => segment.isWordLike)
        .map((segment) => segment.segment)
}

function createSearchMetadataMarkdown(frontmatter: Record<string, unknown>) {
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : []
    const metadata = [frontmatter.description, frontmatter.category, ...tags]
        .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        .map((value) => value.trim())
        .join('\n')

    return metadata ? `\n\n${metadata}\n` : ''
}
