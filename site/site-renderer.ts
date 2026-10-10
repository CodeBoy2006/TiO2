import { createTranslator, type Translator } from '../packages/config/src/i18n.js'
import type MarkdownIt from 'markdown-it'
import { createBlogPostingJsonLd } from './seo'
import { escapeHtmlAttribute, escapeHtmlText, renderInlineMath } from '../.vitepress/theme/markdownRendering'
import { renderReferenceGlyphHtml } from '../.vitepress/theme/referenceMarkdownPlugin'
import type { BacklinkEntry } from '../packages/content-core/src/index'
import { createAbsoluteUrl } from '../packages/content-fs/src/index'
import { FRAMEWORK_META, type TiO2Project } from '../packages/config/src/index.js'
import { loadCustomRenderer } from './custom-renderer'
import { groupBacklinks } from './render-helpers'

export interface ClientAssets {
    stylesheets: string[]
    modulePreloads: string[]
    script: string
}

export interface OutlineItem {
    id: string
    title: string
    level: 2 | 3
}

export interface ArticleOutline {
    items: OutlineItem[]
    readingMinutes: number
}

interface ArticleSeo {
    publishedAt: string
    modifiedAt: string
    section: string
    tags: string[]
    wordCount: number
}

export interface DocumentOptions {
    title: string
    description: string
    canonicalPath: string
    content: string
    clientAssets: ClientAssets
    articleOutline?: ArticleOutline
    language?: string
    image?: string
    imageAlt?: string
    article?: ArticleSeo
    alternates?: Record<string, string>
    bottom?: string
    copyright?: boolean
    fullWidth?: boolean
    pageClass?: string
    wide?: boolean
    bodyPrelude?: string
    /** Trusted markup appended to the document head, such as a page-scoped style rule. */
    head?: string
    notFound?: boolean
}

export interface LayoutRendererContext {
    project: TiO2Project
    page: DocumentOptions
    render: (overrides?: Partial<DocumentOptions>) => string
}

export async function renderDocument(project: TiO2Project, options: DocumentOptions): Promise<string> {
    const render = (overrides: Partial<DocumentOptions> = {}) =>
        renderDefaultDocument(project, { ...options, ...overrides })
    if (!project.config.theme.layout) return render()
    const custom = await loadCustomRenderer(project, project.config.theme.layout)
    const html = await custom({ project, page: options, render } satisfies LayoutRendererContext)
    if (typeof html !== 'string') throw new TypeError('Custom layout renderer must return HTML')
    return html
}

function renderDefaultDocument(project: TiO2Project, options: DocumentOptions) {
    const t = createTranslator(project.config.site.language)
    const { site, theme, integrations } = project.config
    const language = options.language || site.language
    const title = options.canonicalPath === '/' ? site.title : `${options.title} | ${site.title}`
    const canonicalUrl = createAbsoluteUrl(options.canonicalPath, site.url)
    const image = options.image || site.socialImage
    const socialImage = image ? createAbsoluteUrl(image, site.url) : ''
    const socialImageAlt = options.imageAlt || site.title
    const navItems = theme.nav.map((item) => {
        const href = normalizeNavHref(item.link)
        const active = item.activeMatch
            ? new RegExp(item.activeMatch, 'u').test(options.canonicalPath)
            : href === options.canonicalPath
        return { href, text: escapeHtmlText(item.text), current: active ? ' aria-current="page"' : '' }
    })
    const nav = navItems
        .map(
            (item) =>
                `<a class="VPLink link VPNavBarMenuLink${item.current ? ' active' : ''}" href="${escapeHtmlAttribute(item.href)}"${item.current}><span>${item.text}</span></a>`
        )
        .join('')
    const screenNav = navItems
        .map(
            (item) =>
                `<a class="VPLink link VPNavScreenMenuLink" href="${escapeHtmlAttribute(item.href)}"${item.current}><span>${item.text}</span></a>`
        )
        .join('')
    const currentYear = new Date().getFullYear()
    const startYear = site.copyrightStartYear ?? currentYear
    const copyrightRange = currentYear > startYear ? `${startYear}-${currentYear}` : String(startYear)
    const feedLinks = integrations.feed
        ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtmlAttribute(`${site.title} RSS`)}" href="/feed.xml"><link rel="alternate" type="application/atom+xml" title="${escapeHtmlAttribute(`${site.title} Atom`)}" href="/atom.xml"><link rel="alternate" type="application/feed+json" title="${escapeHtmlAttribute(`${site.title} JSON Feed`)}" href="/feed.json">`
        : ''
    const socialLinks = theme.socialLinks
        .map(
            (item) =>
                `<a class="VPSocialLink no-icon" href="${escapeHtmlAttribute(item.link)}" aria-label="${escapeHtmlAttribute(item.icon)}" target="_blank" rel="noopener"><span class="vpi-social-${escapeHtmlAttribute(item.icon)}"></span></a>`
        )
        .join('')
    const subscribeEntry = integrations.feed
        ? `<a class="subscribe-entry" href="/feed.xml" target="_blank" rel="noopener" title="${t('订阅 RSS / Atom', 'Subscribe via RSS / Atom')}" aria-label="${t('订阅 RSS / Atom', 'Subscribe via RSS / Atom')}"><img class="subscribe-entry__icon" src="/feed-icon.svg" alt="" aria-hidden="true" decoding="async"></a>`
        : ''
    const appearanceSwitch =
        '<button class="VPSwitch VPSwitchAppearance" type="button" role="switch" title="Switch to dark theme" aria-checked="false"><span class="check"><span class="icon"><span class="vpi-sun sun"></span><span class="vpi-moon moon"></span></span></span></button>'
    const socialLinksList = `<div class="VPSocialLinks VPNavBarSocialLinks social-links">${socialLinks}</div>`
    const extra = `<div class="VPFlyout VPNavBarExtra extra"><button type="button" class="button" aria-haspopup="true" aria-expanded="false" aria-label="extra navigation"><span class="vpi-more-horizontal icon"></span></button><div class="menu"><div class="VPMenu"><div class="group"><div class="item appearance"><p class="label">Appearance</p><div class="appearance-action">${appearanceSwitch}</div></div></div><div class="group"><div class="item social-links"><div class="VPSocialLinks social-links-list">${socialLinks}</div></div></div></div></div></div>`
    const search = `<div class="VPNavBarSearch search"><div id="local-search"><button type="button" class="DocSearch DocSearch-Button" aria-label="${t('搜索', 'Search')}"><span class="DocSearch-Button-Container"><span class="vp-icon DocSearch-Search-Icon"></span><span class="DocSearch-Button-Placeholder">${t('搜索文章与概念', 'Search articles and concepts')}</span></span><span class="DocSearch-Button-Keys"><kbd class="DocSearch-Button-Key"></kbd><kbd class="DocSearch-Button-Key">K</kbd></span></button></div></div>`
    const navBar = `<header class="VPNav"><div class="VPNavBar top"><div class="wrapper"><div class="container"><div class="title"><div class="VPNavBarTitle"><a class="title" href="/"><span>${escapeHtmlText(site.title)}</span></a></div></div><div class="content"><div class="content-body">${search}<nav aria-labelledby="main-nav-aria-label" class="VPNavBarMenu menu"><span id="main-nav-aria-label" class="visually-hidden"> Main Navigation </span>${nav}</nav><div class="VPNavBarAppearance appearance">${appearanceSwitch}</div>${socialLinksList}${extra}${subscribeEntry}<button type="button" class="VPNavBarHamburger hamburger" aria-label="mobile navigation" aria-expanded="false" aria-controls="VPNavScreen"><span class="container"><span class="top"></span><span class="middle"></span><span class="bottom"></span></span></button></div></div></div></div><div class="divider"><div class="divider-line"></div></div></div></header>`
    const navScreen = `<div class="VPNavScreen" id="VPNavScreen" hidden><div class="container"><nav class="VPNavScreenMenu menu">${screenNav}</nav><div class="VPNavScreenAppearance appearance"><p class="text">Appearance</p>${appearanceSwitch}</div><div class="VPSocialLinks VPNavScreenSocialLinks social-links">${socialLinks}</div></div></div>`
    const footer =
        options.copyright === false
            ? ''
            : `<div class="site-footer">${site.contentLicense ? `${escapeHtmlText(site.contentLicense)} | ` : ''}Copyright © ${copyrightRange} <a class="vitepress" href="${escapeHtmlAttribute(site.url)}">${escapeHtmlText(site.title)}</a><br>Powered by <a class="vitepress" href="https://github.com/CodeBoy2006/TiO2">${FRAMEWORK_META.name}</a> by <a class="vitepress" href="https://github.com/CodeBoy2006">Codeboy</a></div>`
    const clientHead = [
        ...options.clientAssets.stylesheets.map(
            (href) => `<link rel="stylesheet" href="${escapeHtmlAttribute(href)}">`
        ),
        ...options.clientAssets.modulePreloads.map(
            (href) => `<link rel="modulepreload" href="${escapeHtmlAttribute(href)}">`
        ),
        `<script type="module" src="${escapeHtmlAttribute(options.clientAssets.script)}"></script>`
    ].join('')
    const bootstrap = `<script id="check-dark-mode">;(()=>{const p=localStorage.getItem('vitepress-theme-appearance')||'auto';if(p==='dark'||(p==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')})()</script><script id="check-client-mode">document.documentElement.classList.toggle('mac',/Mac|iPhone|iPod|iPad/i.test(navigator.platform));if(new URLSearchParams(location.search).get('__tio2_cms_mode')==='content-only')document.documentElement.classList.add('content-only-preview')</script>`
    const articleHead = options.article
        ? `<meta property="article:published_time" content="${escapeHtmlAttribute(options.article.publishedAt)}"><meta property="article:modified_time" content="${escapeHtmlAttribute(options.article.modifiedAt)}">${options.article.section ? `<meta property="article:section" content="${escapeHtmlAttribute(options.article.section)}">` : ''}${options.article.tags.map((tag) => `<meta property="article:tag" content="${escapeHtmlAttribute(tag)}">`).join('')}<meta property="article:author" content="${escapeHtmlAttribute(site.author)}"><script type="application/ld+json">${createBlogPostingJsonLd({ title: options.title, description: options.description, url: canonicalUrl, image: socialImage, language, author: site.author, authorUrl: createAbsoluteUrl(site.authorUrl, site.url), publishedAt: options.article.publishedAt, modifiedAt: options.article.modifiedAt, section: options.article.section, tags: options.article.tags, wordCount: options.article.wordCount })}</script>`
        : ''
    const alternates = Object.entries(options.alternates ?? {})
        .map(
            ([lang, route]) =>
                `<link rel="alternate" hreflang="${escapeHtmlAttribute(lang)}" href="${escapeHtmlAttribute(createAbsoluteUrl(route, site.url))}">`
        )
        .join('')
    const outerClass = escapeHtmlAttribute(options.pageClass ?? '')
    const pageContent = options.notFound
        ? options.content
        : options.fullWidth
          ? `<div class="VPPage">${options.content}</div>`
          : options.articleOutline
            ? renderArticleLayout(t, options.content, options.articleOutline, options.bottom ?? '', theme.outlineLabel)
            : `<div class="VPDoc${options.wide ? ' VPDoc--wide' : ''}"><div class="container"><div class="content"><div class="content-container">${options.content}</div></div></div>${options.bottom ?? ''}</div>`

    return `<!doctype html><html data-ui-language="${escapeHtmlAttribute(site.language)}" lang="${escapeHtmlAttribute(language)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtmlText(title)}</title><meta name="generator" content="${FRAMEWORK_META.name}"><meta name="description" content="${escapeHtmlAttribute(options.description)}"><link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}">${theme.head}${clientHead}${options.head ?? ''}${feedLinks}${alternates}<meta name="theme-color" content="${escapeHtmlAttribute(site.themeColor)}"><meta name="author" content="${escapeHtmlAttribute(site.author)}"><meta name="robots" content="${options.notFound ? 'noindex,follow' : 'index,follow,max-image-preview:large'}"><meta property="og:site_name" content="${escapeHtmlAttribute(site.title)}"><meta property="og:title" content="${escapeHtmlAttribute(title)}"><meta property="og:description" content="${escapeHtmlAttribute(options.description)}"><meta property="og:type" content="${options.article ? 'article' : 'website'}"><meta property="og:url" content="${escapeHtmlAttribute(canonicalUrl)}"><meta property="og:locale" content="${escapeHtmlAttribute(language.replace('-', '_'))}">${socialImage ? `<meta property="og:image" content="${escapeHtmlAttribute(socialImage)}"><meta property="og:image:alt" content="${escapeHtmlAttribute(socialImageAlt)}">` : ''}<meta name="twitter:card" content="${socialImage ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escapeHtmlAttribute(title)}"><meta name="twitter:description" content="${escapeHtmlAttribute(options.description)}">${socialImage ? `<meta name="twitter:image" content="${escapeHtmlAttribute(socialImage)}"><meta name="twitter:image:alt" content="${escapeHtmlAttribute(socialImageAlt)}">` : ''}${articleHead}${bootstrap}</head><body>${options.bodyPrelude ?? ''}<div id="app"><div class="${outerClass}"><div class="Layout"><span tabindex="-1"></span><a href="#VPContent" class="VPSkipLink visually-hidden">Skip to content</a>${navBar}${navScreen}<div class="VPContent" id="VPContent">${pageContent}</div></div>${footer}</div></div></body></html>`
}

export function renderBacklinksPanel(
    t: Translator,
    targetId: string,
    backlinks: BacklinkEntry[],
    markdown: MarkdownIt,
    title = t('反向链接', 'Backlinks'),
    compact = false
) {
    if (!backlinks.length) return ''
    const contentId = `backlinks-panel-${targetId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const entries = groupBacklinks(backlinks)
        .map((group) => {
            const date = group.sourcePublishedAt.split(' ')[0]
            const mentions =
                group.mentionCount > 1
                    ? `<span>${group.mentionCount}${t(' 处', group.mentionCount === 1 ? ' reference' : ' references')}</span>`
                    : ''
            const embed = group.hasEmbed
                ? `<span class="backlinks-entry__embed" title="${t('包含嵌入引用', 'Includes an embedded reference')}">${renderReferenceGlyphHtml('block', 12)}</span>`
                : ''
            const contexts = group.contexts.length
                ? `<div class="backlinks-entry__contexts">${group.contexts.map((context) => `<p class="backlinks-entry__context">“${escapeHtmlText(context)}”</p>`).join('')}</div>`
                : ''
            return `<article class="backlinks-entry"><div class="backlinks-entry__header"><a class="backlinks-entry__title" href="${escapeHtmlAttribute(group.sourceHref)}">${renderInlineMath(markdown, group.sourceTitle, group.sourceSourcePath)}</a><div class="backlinks-entry__meta"><span>${escapeHtmlText(date)}</span>${mentions}${embed}</div></div>${contexts}</article>`
        })
        .join('')
    return `<section class="backlinks-panel${compact ? ' backlinks-panel--compact' : ''}" data-open="false" data-nosnippet><button type="button" class="backlinks-panel__header" aria-expanded="false" aria-controls="${escapeHtmlAttribute(contentId)}"><div class="backlinks-panel__header-main"><span class="backlinks-panel__chevron" aria-hidden="true"></span><${compact ? 'strong' : 'h2'} class="backlinks-panel__title${compact ? ' backlinks-panel__title--compact' : ''}">${renderInlineMath(markdown, title)}</${compact ? 'strong' : 'h2'}></div><span class="backlinks-panel__count">${backlinks.length}${t(' 处', backlinks.length === 1 ? ' reference' : ' references')}</span></button><div style="display:none" id="${escapeHtmlAttribute(contentId)}" class="backlinks-panel__content"><div class="backlinks-panel__list">${entries}</div></div></section>`
}

const OUTLINE_ICON =
    '<svg class="reading-bar__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>'
const TOP_ICON =
    '<svg class="reading-bar__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>'
const SHARE_ICON =
    '<svg class="reading-bar__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>'

// The desktop outline is drawn as a dial: article-reading.ts bends the rail and slides the marker along it.
const OUTLINE_RAIL =
    '<svg class="article-toc__rail" aria-hidden="true" focusable="false"><defs><linearGradient id="article-toc-rail-read" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-opacity="0"/><stop offset="0.5" stop-opacity="0.85"/></linearGradient></defs><path class="article-toc__rail-track" pathLength="1"/><path class="article-toc__rail-read" pathLength="1"/></svg><span class="article-toc__ghost" aria-hidden="true"></span><span class="article-toc__marker" aria-hidden="true"></span>'
const PROGRESS_RING =
    '<svg class="article-toc__ring" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="6" pathLength="1" data-reading-ring/></svg>'

function renderArticleLayout(
    t: Translator,
    content: string,
    outline: ArticleOutline,
    bottom: string,
    outlineLabel: string
) {
    const label = escapeHtmlText(outlineLabel)
    const hasOutline = outline.items.length > 0
    const toc = hasOutline
        ? `<nav class="article-toc" aria-labelledby="article-toc-title" data-article-toc data-reading-minutes="${outline.readingMinutes}"><p class="article-toc__title" id="article-toc-title">${label}</p><div class="article-toc__dial">${OUTLINE_RAIL}${renderOutlineList(outline.items)}</div><p class="article-toc__status" aria-hidden="true"><span class="article-toc__progress">${PROGRESS_RING}<span data-reading-percent>0%</span></span><span data-reading-left>${t('约 ', 'About ')}${outline.readingMinutes}${t(' 分钟', ' min')}</span></p></nav>`
        : ''
    const readingBar = hasOutline
        ? `<div class="reading-bar" data-reading-bar><div class="reading-bar__outline" id="reading-bar-outline" hidden><p class="reading-bar__outline-title">${label}</p>${renderOutlineList(outline.items)}</div><div class="reading-bar__body"><button type="button" class="reading-bar__button" aria-expanded="false" aria-controls="reading-bar-outline" aria-label="${label}">${OUTLINE_ICON}</button><span class="reading-bar__current" data-reading-current>${escapeHtmlText(outline.items[0].title)}</span><button type="button" class="reading-bar__button" data-reading-top aria-label="${t('回到顶部', 'Back to top')}">${TOP_ICON}</button><span class="reading-bar__progress" aria-hidden="true"><span data-reading-progress></span></span></div></div>`
        : ''
    // Footnotes double as margin notes on wide screens; the reader can fold the column away.
    const margin = content.includes('class="footnote-ref"')
        ? `<aside class="article-margin" aria-label="${t('边注', 'Margin notes')}" data-article-margin><div class="article-margin__head"><span>${t('边注', 'Margin notes')}</span><button type="button" class="article-margin__toggle" aria-pressed="true" data-article-margin-toggle>${t('收起', 'Collapse')}</button></div><div class="article-margin__notes" data-article-margin-notes></div></aside>`
        : ''
    const dock = `<div class="reading-dock" data-reading-dock><button type="button" class="reading-dock__button" data-reading-top aria-label="${t('回到顶部', 'Back to top')}">${TOP_ICON}</button><button type="button" class="reading-dock__button" data-reading-share aria-label="${t('复制文章链接', 'Copy article link')}">${SHARE_ICON}</button><span class="reading-dock__status" role="status" aria-live="polite"></span></div>`
    return `<div class="VPDoc article-doc"><div class="article-layout" data-article-layout>${toc}<div class="article-column">${content}</div>${margin}</div>${bottom}${readingBar}${dock}</div>`
}

function renderOutlineList(items: OutlineItem[]) {
    return `<ol class="article-outline">${items.map((item) => `<li class="article-outline__item" data-level="${item.level}"><a href="#${escapeHtmlAttribute(item.id)}">${escapeHtmlText(item.title)}</a></li>`).join('')}</ol>`
}

function normalizeNavHref(href: string) {
    if (/^(?:https?:)?\/\//u.test(href)) return href
    const url = new URL(href, 'https://tio2.invalid')
    if (!url.pathname.endsWith('/') && !/\.[^/]+$/u.test(url.pathname)) url.pathname += '.html'
    return `${url.pathname}${url.search}${url.hash}`
}
