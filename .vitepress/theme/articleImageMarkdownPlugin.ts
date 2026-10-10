import { createTranslator, type Translator } from '../../packages/config/src/i18n.js'
import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import {
    createArticleImageKey,
    type ArticleImageManifest,
    type ArticleImageManifestEntry,
    type ArticleImageVariant
} from '../../packages/content-core/src/index'
import { escapeHtmlAttribute, escapeHtmlText, renderComponentTag } from './markdownRendering'

const STATIC_HTML_RENDER_MODE = 'static-html'
const EAGER_IMAGE_MAX_SOURCE_LINE = 20
const EAGER_IMAGE_MAX_PRECEDING_CHARACTERS = 600

interface ArticleImageTokenMeta {
    imageIndex: number
    precedingCharacters: number
    sourceLine?: number
}

interface ArticleImageGroupTokenMeta {
    images: Token[]
}

export function createArticleImageMarkdownPlugin(manifest: ArticleImageManifest, language = 'en') {
    const t = createTranslator(language)
    return (md: MarkdownIt) => {
        md.core.ruler.after('inline', 'article-image-blocks', (state) => {
            annotateImageOrder(state.tokens)
            replaceImageOnlyParagraphs(state)
        })

        md.renderer.rules.article_image_group = (tokens, index, _options, env) => {
            const meta = tokens[index].meta as ArticleImageGroupTokenMeta
            const images = meta.images.map((image) => renderImage(t, image, env, manifest))

            if (env?.referenceRenderMode === STATIC_HTML_RENDER_MODE) {
                return `<div class="article-image-group">${images.map((image) => image.staticHtml).join('')}</div>`
            }

            return `<div class="article-image-group">${images.map((image) => image.component).join('')}</div>`
        }

        md.renderer.rules.image = (tokens, index, _options, env) => {
            const token = tokens[index]
            const rendered = renderImage(t, token, env, manifest)

            if (rendered.entry?.darkSrc) {
                throw new Error(
                    `[article-images] ${env?.relativePath ?? 'unknown.md'}: a themed SVG must occupy its own image paragraph: ${token.attrGet('src') ?? ''}`
                )
            }

            const inlineProps = {
                ...rendered.imageProps,
                title: token.attrGet('title') ?? undefined
            }

            if (env?.referenceRenderMode === STATIC_HTML_RENDER_MODE) {
                return renderStaticImageFrame(t, inlineProps, {
                    className: 'article-inline-image',
                    intrinsic: true
                })
            }

            return renderComponentTag('ImageLoadFrame', {
                ...inlineProps,
                class: 'article-inline-image',
                intrinsic: true
            })
        }
    }
}

function annotateImageOrder(tokens: Token[]) {
    let imageIndex = 0
    let precedingCharacters = 0

    const visit = (items: Token[], inheritedSourceLine?: number) => {
        for (const token of items) {
            const sourceLine = token.map?.[0] ?? inheritedSourceLine

            if (token.type === 'image') {
                token.meta = {
                    ...(token.meta ?? {}),
                    imageIndex,
                    precedingCharacters,
                    sourceLine
                } satisfies ArticleImageTokenMeta
                imageIndex += 1
            }

            if (token.children?.length) {
                visit(token.children, sourceLine)
                continue
            }

            if (countsTowardImagePriority(token)) {
                precedingCharacters += token.content.length
            }
        }
    }

    visit(tokens)
}

function countsTowardImagePriority(token: Token) {
    return (
        token.type === 'text' ||
        token.type === 'code_inline' ||
        token.type === 'code_block' ||
        token.type === 'fence' ||
        token.type === 'html_block' ||
        token.type === 'html_inline' ||
        token.type.startsWith('math_')
    )
}

function replaceImageOnlyParagraphs(state: StateCore) {
    for (let index = 0; index < state.tokens.length - 2; index += 1) {
        const open = state.tokens[index]
        const inline = state.tokens[index + 1]
        const close = state.tokens[index + 2]

        if (open.type !== 'paragraph_open' || inline.type !== 'inline' || close.type !== 'paragraph_close') {
            continue
        }

        const trailingImages = splitTrailingImages(inline.children ?? [])
        if (!trailingImages) continue

        const group = createImageGroupToken(state, open, trailingImages.images)

        if (!trailingImages.prefix.length) {
            state.tokens.splice(index, 3, group)
            continue
        }

        inline.children = trailingImages.prefix
        state.tokens.splice(index + 3, 0, group)
        index += 1
    }
}

function splitTrailingImages(children: Token[]) {
    let cursor = children.length - 1
    const images: Token[] = []

    while (cursor >= 0 && isImageSeparator(children[cursor])) {
        cursor -= 1
    }

    while (cursor >= 0) {
        const token = children[cursor]

        if (token.type === 'image') {
            images.unshift(token)
            cursor -= 1
            continue
        }

        if (isImageSeparator(token)) {
            cursor -= 1
            continue
        }

        break
    }

    if (!images.length) return null
    if (cursor >= 0 && !isImageSeparator(children[cursor + 1])) return null

    const prefix = children.slice(0, cursor + 1)
    while (prefix.length && isImageSeparator(prefix.at(-1)!)) {
        prefix.pop()
    }

    return { images, prefix }
}

function createImageGroupToken(state: StateCore, open: Token, images: Token[]) {
    const group = new state.Token('article_image_group', 'div', 0)
    group.block = true
    group.level = open.level
    group.map = open.map
    group.meta = {
        images
    } satisfies ArticleImageGroupTokenMeta
    return group
}

function isImageSeparator(token: Token) {
    return (
        token.type === 'softbreak' ||
        token.type === 'hardbreak' ||
        (token.type === 'text' && token.content.trim() === '')
    )
}

function renderImage(t: Translator, token: Token, env: any, manifest: ArticleImageManifest) {
    const authoredSrc = token.attrGet('src') ?? ''
    const documentPath = typeof env?.relativePath === 'string' ? env.relativePath : ''
    const entry = manifest.entries[createArticleImageKey(documentPath, authoredSrc)]
    const meta = token.meta as ArticleImageTokenMeta | undefined
    const imageIndex = meta?.imageIndex ?? Number.MAX_SAFE_INTEGER
    const isNearTop =
        imageIndex === 0 &&
        meta?.sourceLine !== undefined &&
        meta.sourceLine <= EAGER_IMAGE_MAX_SOURCE_LINE &&
        meta.precedingCharacters <= EAGER_IMAGE_MAX_PRECEDING_CHARACTERS
    const loading = isNearTop ? 'eager' : 'lazy'
    const fetchPriority = isNearTop ? 'high' : undefined
    const src = entry?.src ?? authoredSrc
    const alt = token.content.trim()
    const caption = token.attrGet('title') ?? ''
    const imageProps = {
        src,
        alt,
        width: entry?.width,
        height: entry?.height,
        sizes: entry ? createSizes(entry) : undefined,
        'avif-srcset': entry ? createSrcset(entry.avif) : undefined,
        'webp-srcset': entry ? createSrcset(entry.webp) : undefined,
        loading,
        fetchpriority: fetchPriority
    }
    const articleProps = {
        ...imageProps,
        'viewer-src': entry?.viewerSrc ?? src,
        'dark-src': entry?.darkSrc,
        caption,
        kind: entry?.kind,
        layout: entry?.layout
    }

    return {
        component: renderComponentTag('ArticleImage', articleProps),
        entry,
        fetchPriority,
        imageProps,
        loading,
        src,
        staticHtml: renderStaticImageHtml(t, articleProps)
    }
}

function createSizes(entry: ArticleImageManifestEntry) {
    if (entry.layout === 'compact') {
        return `(max-width: 768px) calc(100vw - 48px), ${entry.width}px`
    }

    if (entry.layout === 'portrait') {
        return '(max-width: 768px) calc(100vw - 48px), 672px'
    }

    return '(max-width: 768px) calc(100vw - 48px), 960px'
}

function createSrcset(variants: ArticleImageVariant[]) {
    return variants.map((variant) => `${variant.src} ${variant.width}w`).join(', ')
}

type ImageRenderProps = Record<string, string | number | boolean | undefined>

function renderStaticImageHtml(t: Translator, props: ImageRenderProps) {
    const frame = renderStaticImageFrame(
        t,
        {
            ...props,
            'dark-src': props['dark-src']
        },
        {
            className: 'article-image__frame'
        }
    )
    const caption = props.caption
        ? `<figcaption class="article-image__caption">${escapeHtmlText(String(props.caption))}</figcaption>`
        : ''
    const layout = String(props.layout ?? 'standard')
    const kind = String(props.kind ?? 'raster')
    const figureStyle = layout === 'compact' && props.width ? ` style="max-width:${props.width}px;"` : ''
    const viewerSrc = String(props['viewer-src'] ?? props.src ?? '')
    const darkViewerSrc = props['dark-src']
        ? ` data-viewer-dark-src="${escapeHtmlAttribute(String(props['dark-src']))}"`
        : ''
    const viewerLabel = props.alt
        ? `${t('放大查看：', 'Enlarge: ')}${String(props.alt)}`
        : t('放大查看图片', 'Enlarge image')

    return `<figure class="article-image article-image--${escapeHtmlAttribute(layout)} article-image--${escapeHtmlAttribute(kind)}"${figureStyle}><button type="button" class="article-image__trigger" aria-label="${escapeHtmlAttribute(viewerLabel)}" aria-haspopup="dialog" data-article-image-viewer data-viewer-src="${escapeHtmlAttribute(viewerSrc)}"${darkViewerSrc} data-viewer-kind="${escapeHtmlAttribute(kind)}">${frame}</button>${caption}</figure>`
}

function renderStaticImageFrame(
    t: Translator,
    props: ImageRenderProps,
    options: {
        className?: string
        intrinsic?: boolean
    } = {}
) {
    const sourceTags = [
        props['avif-srcset']
            ? `<source type="image/avif" srcset="${escapeHtmlAttribute(String(props['avif-srcset']))}" sizes="${escapeHtmlAttribute(String(props.sizes ?? '100vw'))}">`
            : '',
        props['webp-srcset']
            ? `<source type="image/webp" srcset="${escapeHtmlAttribute(String(props['webp-srcset']))}" sizes="${escapeHtmlAttribute(String(props.sizes ?? '100vw'))}">`
            : ''
    ].join('')
    const attributes = [
        ['src', props.src],
        ['data-light-src', props['dark-src'] ? props.src : undefined],
        ['data-dark-src', props['dark-src']],
        ['alt', props.alt ?? ''],
        ['width', props.width],
        ['height', props.height],
        ['loading', props.loading],
        ['fetchpriority', props.fetchpriority ?? 'auto'],
        ['decoding', 'async'],
        ['draggable', 'false'],
        ['title', props.title],
        ['style', 'object-fit:contain;object-position:50% 50%;'],
        ['class', 'image-load-frame__media'],
        ['data-image-load-media', 'true']
    ]
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([name, value]) => `${name}="${escapeHtmlAttribute(String(value))}"`)
        .join(' ')
    const classes = [
        'image-load-frame',
        'image-load-frame--loaded',
        props.width && props.height ? 'image-load-frame--known' : '',
        'image-load-frame--enhanced',
        options.intrinsic ? 'image-load-frame--intrinsic' : '',
        options.className ?? ''
    ]
        .filter(Boolean)
        .join(' ')

    return `<span class="${classes}" data-image-load-frame data-image-state="loaded"><picture class="image-load-frame__picture">${sourceTags}<img ${attributes}></picture><span class="image-load-frame__placeholder" aria-hidden="true"></span><span class="image-load-frame__error" role="status" hidden>${t('图片加载失败', 'Image failed to load')}</span></span>`
}
