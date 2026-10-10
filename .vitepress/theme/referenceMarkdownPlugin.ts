import { createTranslator, type Translator } from '../../packages/config/src/i18n.js'
import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import {
    createBlockTargetId,
    createHeadingTargetId,
    createReferenceResolver,
    matchWikiReferenceAt,
    parseBlockAnchorParagraph,
    truncateText,
    type ResolvedReference
} from '../../packages/content-core/src/index'
import type { ReferenceGraph, ReferenceTarget } from '../../packages/content-core/src/index'
import { escapeHtmlAttribute, escapeHtmlText, renderComponentTag } from './markdownRendering'

const STATIC_HTML_RENDER_MODE = 'static-html'

function createHtmlToken(state: StateCore, content: string, type: 'html_block' | 'html_inline'): Token {
    const token = new state.Token(type, '', 0)
    token.content = content
    return token
}

function renderStaticReferenceHtml(
    t: Translator,
    library: string,
    raw: string,
    resolved: ResolvedReference | null,
    embed: boolean
) {
    if (embed) return renderStaticEmbedHtml(t, library, raw, resolved)

    if (!resolved) {
        return escapeHtmlText(raw)
    }

    const href = escapeHtmlAttribute(resolved.target.href)
    const label =
        resolved.parsed.label ||
        (resolved.target.type === 'block'
            ? truncateText(resolved.target.excerpt || resolved.target.title, embed ? 58 : 18)
            : resolved.target.title)

    const link = `<a class="internal-ref__link" href="${href}">${escapeHtmlText(label)}</a>`

    const target = resolved.target
    const meta = getReferencePreviewMeta(t, library, target)
    const excerpt = target.excerpt
        ? `<span class="internal-ref__preview-excerpt">${escapeHtmlText(target.excerpt)}</span>`
        : ''

    return `<span class="internal-ref">${link}<span class="internal-ref__preview" aria-hidden="true" data-nosnippet><span class="internal-ref__preview-kind">${renderReferenceGlyphHtml(target.type, 14)}<span>${escapeHtmlText(getReferenceKindLabel(t, library, target.type))}</span></span><strong class="internal-ref__preview-title">${escapeHtmlText(getReferencePreviewTitle(t, target))}</strong>${meta ? `<span class="internal-ref__preview-meta">${escapeHtmlText(meta)}</span>` : ''}${excerpt}</span></span>`
}

function renderStaticEmbedHtml(t: Translator, library: string, raw: string, resolved: ResolvedReference | null) {
    if (!resolved) {
        return `<span class="reference-embed reference-embed--broken"><span class="reference-embed__fallback"><span class="reference-embed__mark" aria-hidden="true">“</span><span class="reference-embed__body"><strong class="reference-embed__title">${escapeHtmlText(raw)}</strong></span></span></span>`
    }

    const target = resolved.target
    const displayTitle =
        resolved.parsed.label ||
        (target.type === 'block' ? truncateText(target.excerpt || target.title, 58) : target.title)
    const title =
        target.type === 'block' ? '' : `<strong class="reference-embed__title">${escapeHtmlText(displayTitle)}</strong>`
    const excerpt = escapeHtmlText(target.excerpt || displayTitle)
    const source =
        target.type === 'block' || target.type === 'heading'
            ? target.pageTitle
                ? `${t('出自《', 'From “')}${target.pageTitle}${t('》', '”')}`
                : ''
            : target.type === 'foundation'
              ? t(`收录于${library}`, `From ${library}`)
              : ''
    const sourceLine = source ? `<span class="reference-embed__source">${escapeHtmlText(source)}</span>` : ''

    return `<span class="reference-embed"><a class="reference-embed__link" href="${escapeHtmlAttribute(target.href)}"><span class="reference-embed__mark" aria-hidden="true">“</span><span class="reference-embed__body">${title}<span class="reference-embed__excerpt">${excerpt}</span>${sourceLine}</span></a></span>`
}

export function renderReferenceGlyphHtml(kind: ReferenceTarget['type'], size: number) {
    const glyph = {
        article:
            '<path d="M8 3.5h6.8L19.5 8v12.5H8z"></path><path d="M14.5 3.5V8H19"></path><path d="M10.5 12h6M10.5 15.5h6M10.5 19h4.2"></path>',
        topic: '<path d="M5.5 8.5h11v9h-11z"></path><path d="M8 5.5h11v9"></path><path d="M8.5 11.5h5.5M8.5 14.5h4.2"></path>',
        foundation:
            '<circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="6" r="2"></circle><circle cx="18" cy="18" r="2"></circle><path d="M8 12h4M12 12V6h4M12 12v6h4"></path>',
        heading: '<path d="M6 6.5v11M10 6.5v11"></path><path d="M6 12h4M14 8h5M14 12h5M14 16h3.4"></path>',
        block: '<path d="M8.2 9.4c0-1.8 1.1-3.2 2.8-3.9l.5 1.2c-.8.4-1.4 1.1-1.4 2v.9h2v4.8H7.7V9.4z"></path><path d="M14.2 9.4c0-1.8 1.1-3.2 2.8-3.9l.5 1.2c-.8.4-1.4 1.1-1.4 2v.9h2v4.8h-4.4V9.4z"></path>'
    }[kind]

    return `<svg class="reference-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g>${glyph}</g></svg>`
}

function getReferenceKindLabel(t: Translator, library: string, kind: ReferenceTarget['type']) {
    return {
        article: t('文章', 'Article'),
        topic: t('专题', 'Topic'),
        foundation: library,
        heading: t('标题', 'Heading'),
        block: t('段落', 'Paragraph')
    }[kind]
}

function getReferencePreviewTitle(t: Translator, target: ReferenceTarget) {
    if (target.type === 'block')
        return target.pageTitle ? `${target.pageTitle} · ${t('文段', 'Passage')}` : t('文段', 'Passage')
    if (target.type === 'heading' && target.pageTitle) return `${target.pageTitle} · ${target.title}`
    return target.title
}

function getReferencePreviewMeta(t: Translator, library: string, target: ReferenceTarget) {
    if (target.type === 'article') {
        return [target.date, target.readingTime ? `${target.readingTime}${t(' 分钟阅读', ' min read')}` : '']
            .filter(Boolean)
            .join(' · ')
    }
    if (target.type === 'topic')
        return target.articleCount
            ? `${target.articleCount}${t(' 篇文章', target.articleCount === 1 ? ' article' : ' articles')}`
            : ''
    if (target.type === 'foundation') return target.aliases?.join(' · ') || library
    return target.pageTitle ?? ''
}

/** `libraryTitle` is the site's own name for its knowledge library; previews label entries with it. */
export function createReferenceMarkdownPlugin(referenceGraph: ReferenceGraph, language = 'en', libraryTitle = '') {
    const t = createTranslator(language)
    const library = libraryTitle || t('知识库', 'Foundations')
    const resolveReference = createReferenceResolver(referenceGraph)

    return (md: MarkdownIt) => {
        md.inline.ruler.before('link', 'wiki-reference', (state, silent) => {
            const matchedReference = matchWikiReferenceAt(state.src, state.pos, state.posMax)
            if (!matchedReference) return false
            if (silent) {
                state.pos = matchedReference.end
                return true
            }

            const currentSourcePath = typeof state.env.relativePath === 'string' ? state.env.relativePath : undefined
            const resolved = resolveReference(matchedReference.raw, currentSourcePath)
            if ('linkLevel' in state && typeof state.linkLevel === 'number' && state.linkLevel > 0) {
                const token = state.push('text', '', 0)
                token.content = resolved
                    ? resolved.parsed.label ||
                      (resolved.target.type === 'block'
                          ? truncateText(resolved.target.excerpt || resolved.target.title, matchedReference.embed ? 58 : 18)
                          : resolved.target.title)
                    : matchedReference.raw
                state.pos = matchedReference.end
                return true
            }
            const renderMode = state.env?.referenceRenderMode
            const componentName = matchedReference.embed ? 'ReferenceEmbed' : 'InternalRef'

            const token = state.push('html_inline', '', 0)
            token.content =
                renderMode === STATIC_HTML_RENDER_MODE
                    ? renderStaticReferenceHtml(t, library, matchedReference.raw, resolved, matchedReference.embed)
                    : renderComponentTag(componentName, {
                          'target-id': resolved?.target.id,
                          label: resolved?.parsed.label,
                          raw: matchedReference.raw
                      })

            state.pos = matchedReference.end
            return true
        })

        md.core.ruler.before('inline', 'wiki-block-anchor', (state) => {
            const sourcePath = typeof state.env.relativePath === 'string' ? state.env.relativePath : ''
            if (!sourcePath) return

            for (let index = 0; index < state.tokens.length - 2; index++) {
                const open = state.tokens[index]
                const inline = state.tokens[index + 1]
                const close = state.tokens[index + 2]

                if (open.type !== 'paragraph_open' || inline.type !== 'inline' || close.type !== 'paragraph_close') {
                    continue
                }

                const block = parseBlockAnchorParagraph(inline.content)
                if (!block) continue

                const html =
                    state.env?.referenceRenderMode === STATIC_HTML_RENDER_MODE
                        ? `<span id="${escapeHtmlAttribute(block.anchor)}"></span>`
                        : renderComponentTag('BlockAnchor', {
                              anchor: block.anchor,
                              'target-id': createBlockTargetId(sourcePath, block.anchor)
                          })

                if (!block.content) {
                    state.tokens.splice(index, 3, createHtmlToken(state, html, 'html_block'))
                    continue
                }

                inline.content = block.content
                state.tokens.splice(index + 3, 0, createHtmlToken(state, html, 'html_block'))
                index += 1
            }
        })

        md.core.ruler.push('wiki-heading-backlinks', (state) => {
            const sourcePath = typeof state.env.relativePath === 'string' ? state.env.relativePath : ''
            if (!sourcePath) return
            if (state.env?.referenceRenderMode === STATIC_HTML_RENDER_MODE) return

            for (let index = 0; index < state.tokens.length - 2; index++) {
                const headingOpen = state.tokens[index]
                const inline = state.tokens[index + 1]
                const headingClose = state.tokens[index + 2]

                if (
                    headingOpen.type !== 'heading_open' ||
                    inline.type !== 'inline' ||
                    headingClose.type !== 'heading_close'
                ) {
                    continue
                }

                const anchor = headingOpen.attrGet('id')
                if (!anchor) continue

                const targetId = createHeadingTargetId(sourcePath, anchor)
                if (!referenceGraph.backlinksByTargetId[targetId]?.length) continue

                state.tokens.splice(
                    index + 3,
                    0,
                    createHtmlToken(
                        state,
                        renderComponentTag('BacklinkBadge', {
                            'target-id': targetId,
                            mode: 'heading'
                        }),
                        'html_block'
                    )
                )
                index += 1
            }
        })
    }
}
