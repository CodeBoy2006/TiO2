import { pickedCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { createMarkdownRoute } from '../../../packages/content-core/src/route-utils'
import { createTopicAnchorId, normalizeLookup } from '../../../packages/content-core/src/reference-utils'
import { extractHeadings } from '../../../packages/content-core/src/article-parsing'
import type { CmsLibrarySnapshot } from './types'
import { fetchDocumentDetail, fetchImages } from './api'
import { t } from './i18n'

export interface LinkTarget {
    title: string
    sourcePath: string
    href: string
    wiki: string | null
    aliases: string[]
    kind: string
}

export function buildLinkTargets(library: CmsLibrarySnapshot | null): LinkTarget[] {
    if (!library) return []
    const articleTitles = new Map<string, number>()
    for (const item of library.documents) {
        if (item.kind === 'post' || item.kind === 'topic') {
            const key = normalizeLookup(item.title)
            articleTitles.set(key, (articleTitles.get(key) ?? 0) + 1)
        }
    }
    const topicRoot = library.tree.find((root) => root.rootKey === 'topics')?.path
    const pageRoot = library.tree.find((root) => root.rootKey === 'pages')?.path
    const topicIndex = library.documents.find((item) => item.sourcePath === `${pageRoot}/topics.md`)
    const targets: LinkTarget[] = []
    const topics = new Map<string, string>()
    for (const item of library.documents) {
        let wiki: string | null = null
        if (
            (item.kind === 'post' || item.kind === 'topic') &&
            articleTitles.get(normalizeLookup(item.title)) === 1 &&
            !/[[\]#|\n]/u.test(item.title) &&
            !/^(topic|foundation):/u.test(item.title)
        )
            wiki = item.title
        if (item.foundation?.id) wiki = `foundation:${item.foundation.id}`
        if (item.kind !== 'topicMeta')
            targets.push({
                title: item.title,
                sourcePath: item.sourcePath,
                href: markdownDestination(createMarkdownRoute(item.sourcePath)),
                wiki,
                aliases: item.aliases ?? [],
                kind: item.kind
            })
        const keys = [...item.topics]
        if ((item.kind === 'topicMeta' || item.kind === 'topic') && topicRoot) {
            const key = item.sourcePath
                .slice(topicRoot.length + 1)
                .split('/')
                .slice(0, -1)
                .join('/')
            if (key) {
                keys.push(key)
                if (item.kind === 'topicMeta') topics.set(key, item.title)
            }
        }
        for (const key of keys) {
            const parts = key.split('/')
            parts.forEach((part, index) => {
                const parent = parts.slice(0, index + 1).join('/')
                if (!topics.has(parent)) topics.set(parent, part)
            })
        }
    }
    if (topicIndex)
        for (const [key, title] of topics) {
            if (!/[[\]#|\n]/u.test(key))
                targets.push({
                    title,
                    sourcePath: '',
                    href: `${createMarkdownRoute(topicIndex.sourcePath)}#${createTopicAnchorId(key)}`,
                    wiki: `topic:${key}`,
                    aliases: [key],
                    kind: 'topicMeta'
                })
        }
    return targets
}

export function escapeLinkText(text: string) {
    return text.replace(/[\\[\]]/gu, '\\$&').replace(/\s*\n\s*/gu, ' ')
}

export function imageMarkdown(src: string, alt: string) {
    return `![${escapeLinkText(alt)}](${markdownDestination(src)})`
}

function markdownDestination(src: string) {
    return src.replace(/[()]/gu, (character) => `%${character.charCodeAt(0).toString(16)}`)
}

function destinationCompletion(src: string, closing: ')' | ']]' = ')'): Completion['apply'] {
    return (view, completion, from, to) => {
        const tail = view.state.doc.lineAt(to).text.slice(to - view.state.doc.lineAt(to).from)
        const suffix =
            closing === ')'
                ? /^[^\s)]*(\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?\s*\)/u.exec(tail)
                : /^[^[\]\n|]*(\|[^\]\n]*)?\]\]/u.exec(tail)
        const label = suffix?.[1] ?? ''
        applyText(
            view,
            completion,
            from,
            to + (suffix?.[0].length ?? 0),
            `${markdownDestination(src)}${label}${closing}`
        )
    }
}

function referenceCompletion(
    target: Pick<LinkTarget, 'wiki' | 'href' | 'title'>,
    prefixLength = 2
): Completion['apply'] {
    return (view, completion, start, end) => {
        const tail = view.state.doc.lineAt(end).text.slice(end - view.state.doc.lineAt(end).from)
        const suffix = /^[^[\]\n|]*(?:\|([^\]\n]*))?\]\]/u.exec(tail)
        const label = suffix?.[1]
        const text = target.wiki
            ? `[[${target.wiki}${label ? `|${label}` : ''}]]`
            : `[${escapeLinkText(label || target.title)}](${target.href})`
        applyText(view, completion, start - prefixLength, end + (suffix?.[0].length ?? 0), text)
    }
}

function matches(query: string, ...values: string[]) {
    const haystack = normalizeLookup(values.join(' '))
    return normalizeLookup(query)
        .split(/\s+/u)
        .every((word) => haystack.includes(word))
}

function applyText(view: EditorView, completion: Completion, from: number, to: number, text: string) {
    view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        annotations: pickedCompletion.of(completion),
        userEvent: 'input.complete'
    })
}

export function createWritingCompletion(
    getTargets: () => LinkTarget[],
    getSourcePath: () => string,
    onError: (message: string) => void
): CompletionSource {
    return async (context) => {
        if (context.state.readOnly) return null
        for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent!) {
            if (/^(FencedCode|CodeBlock|InlineCode|HTMLBlock|CommentBlock)$/u.test(node.name)) return null
        }
        const line = context.state.doc.lineAt(context.pos)
        const before = line.text.slice(0, context.pos - line.from)
        const wiki = /(!?)\[\[([^\n[\]|]*)$/u.exec(before)
        const destination = /(!?)\[[^\]\n]*\]\(([^)\s]*)$/u.exec(before)
        if (!wiki && !destination) return null
        const targets = getTargets()
        try {
            if (destination?.[1]) {
                const query = destination[2]
                const from = context.pos - query.length
                const assets = await fetchImages(getSourcePath())
                if (context.aborted) return null
                return {
                    from,
                    filter: false,
                    options: assets
                        .filter((asset) => asset.publicSrc || !/\.gif$/iu.test(asset.name))
                        .filter((asset) => matches(query, asset.name, asset.src))
                        .slice(0, 60)
                        .map((asset) => ({
                            label: asset.name,
                            detail: asset.src,
                            apply: destinationCompletion(asset.src)
                        }))
                }
            }
            const query = wiki ? wiki[2] : destination![2]
            const from = context.pos - query.length
            const hash = query.indexOf('#')
            if (hash >= 0) {
                const name = query.slice(0, hash)
                const target = wiki
                    ? targets.find((item) => item.wiki && normalizeLookup(item.wiki) === normalizeLookup(name))
                    : targets.find((item) => item.href === name)
                const path = name ? target?.sourcePath : getSourcePath()
                if (!path) return null
                const targetKind = (target ?? targets.find((item) => item.sourcePath === path))?.kind
                const useMarkdown = Boolean(wiki && targetKind !== 'post' && targetKind !== 'topic')
                if (useMarkdown && wiki?.[1]) return null
                const headings =
                    path === getSourcePath()
                        ? extractHeadings(context.state.doc.toString())
                        : (await fetchDocumentDetail(path)).headings
                if (context.aborted) return null
                return {
                    from: from + hash + 1,
                    filter: false,
                    options: headings
                        .filter((heading) => matches(query.slice(hash + 1), heading.title, heading.slug))
                        .map((heading) => ({
                            label: heading.title,
                            detail: `#${heading.slug}`,
                            apply: useMarkdown
                                ? referenceCompletion(
                                      {
                                          title: heading.title,
                                          wiki: null,
                                          href: `${name ? target!.href : ''}#${heading.slug}`
                                      },
                                      hash + 3
                                  )
                                : destinationCompletion(heading.slug, wiki ? ']]' : ')')
                        }))
                }
            }
            const kindLabels: Record<string, string> = {
                post: t('文章', 'Article'),
                topic: t('专题文章', 'Topic article'),
                foundation: t('知识', 'Foundation'),
                page: t('页面', 'Page'),
                topicMeta: t('专题', 'Topic')
            }
            const options: Completion[] = targets
                .filter(
                    (target) =>
                        (!wiki?.[1] || target.wiki) &&
                        matches(
                            query,
                            target.title,
                            target.wiki ?? '',
                            target.href,
                            target.sourcePath,
                            ...target.aliases
                        )
                )
                .slice(0, 80)
                .map((target) => ({
                    label: target.title,
                    detail: `${kindLabels[target.kind]} · ${target.sourcePath || target.wiki}`,
                    apply: wiki ? referenceCompletion(target) : destinationCompletion(target.href)
                }))
            return { from, filter: false, options }
        } catch (error) {
            if (!context.aborted)
                onError(
                    error instanceof Error
                        ? error.message
                        : t('加载建议失败，请重试。', 'Could not load suggestions. Try again.')
                )
            return null
        }
    }
}
