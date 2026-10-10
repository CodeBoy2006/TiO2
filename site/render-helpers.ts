import { createTranslator } from '../packages/config/src/i18n.js'
import type { TiO2Project } from '../packages/config/src/index.js'
import type { BacklinkEntry, BlogPost } from '../packages/content-core/src/index'

/** How this site names its knowledge library. The framework only supplies a neutral fallback. */
export function libraryIdentity(project: Pick<TiO2Project, 'config'>) {
    const { site, foundations } = project.config
    return {
        title: foundations.title?.trim() || createTranslator(site.language)('知识库', 'Foundations'),
        englishTitle: foundations.englishTitle?.trim() ?? '',
        subtitle: foundations.subtitle?.trim() ?? ''
    }
}

export function initTags(posts: BlogPost[]): Record<string, BlogPost[]> {
    const data: Record<string, BlogPost[]> = {}
    for (const post of posts) for (const tag of post.frontMatter.tags) (data[tag] ??= []).push(post)
    return Object.fromEntries(Object.entries(data).sort(([, left], [, right]) => right.length - left.length))
}

export function initCategory(posts: BlogPost[]) {
    const data: Record<string, BlogPost[]> = {}
    for (const post of posts) {
        const category = post.frontMatter.category
        if (category) (data[category] ??= []).push(post)
    }
    return data
}

export function useYearSort(posts: BlogPost[]) {
    const data: BlogPost[][] = []
    for (const post of posts) {
        if (!post.frontMatter.date) continue
        const year = post.frontMatter.date.split('-')[0]
        const current = data.at(-1)
        if (!current || current[0].frontMatter.date.split('-')[0] !== year) data.push([])
        data.at(-1)!.push(post)
    }
    return data
}

export function generatePaginationArray(pagesNum: number, currentPage: number, margin = 1): (number | string)[] {
    pagesNum = Math.max(1, pagesNum)
    margin = Math.max(0, margin)
    currentPage = Math.min(Math.max(currentPage, 1), pagesNum)
    const pages = new Set([1, pagesNum])

    if (pagesNum <= margin * 2 + 5) {
        for (let page = 2; page < pagesNum; page += 1) pages.add(page)
    } else if (currentPage <= margin + 2) {
        for (let page = 2; page <= Math.max(margin * 2 + 2, currentPage + margin); page += 1) {
            if (page < pagesNum) pages.add(page)
        }
    } else if (currentPage >= pagesNum - (margin + 1)) {
        for (let page = Math.max(2, pagesNum - (margin * 2 + 1)); page < pagesNum; page += 1) pages.add(page)
    } else {
        for (let page = currentPage - margin; page <= currentPage + margin; page += 1) pages.add(page)
        pages.add(2)
        pages.add(pagesNum - 1)
    }

    const result: (number | string)[] = []
    let previous = 0
    for (const page of [...pages].sort((left, right) => left - right)) {
        if (page - previous > 1) result.push('...')
        result.push(page)
        previous = page
    }
    return result
}

export function groupBacklinks(backlinks: BacklinkEntry[]) {
    const groups = new Map<
        string,
        {
            sourceSourcePath: string
            sourceTitle: string
            sourceHref: string
            sourcePublishedAt: string
            mentionCount: number
            hasEmbed: boolean
            contexts: string[]
        }
    >()

    for (const entry of backlinks) {
        const existing = groups.get(entry.sourceSourcePath)
        const context = resolveBacklinkContext(entry)
        if (!existing) {
            groups.set(entry.sourceSourcePath, {
                sourceSourcePath: entry.sourceSourcePath,
                sourceTitle: entry.sourceTitle,
                sourceHref: entry.sourceHref,
                sourcePublishedAt: entry.sourcePublishedAt,
                mentionCount: 1,
                hasEmbed: entry.embed,
                contexts: context ? [context] : []
            })
            continue
        }
        existing.mentionCount += 1
        existing.hasEmbed ||= entry.embed
        if (context && !existing.contexts.includes(context)) existing.contexts.push(context)
    }
    return [...groups.values()]
}

function resolveBacklinkContext(entry: BacklinkEntry) {
    const context = entry.context.replace(/\s+/gu, ' ').trim()
    const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('zh-CN')
    if (
        !context ||
        normalize(context) === normalize(entry.sourceTitle) ||
        (entry.label && normalize(context) === normalize(entry.label)) ||
        (context.length <= 48 && /^[A-Za-z0-9 _-]+$/u.test(context))
    ) {
        return ''
    }
    return context
}
