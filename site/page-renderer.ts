import { createTranslator, resolveLanguage, type Translator } from '../packages/config/src/i18n.js'
import type MarkdownIt from 'markdown-it'
import path from 'node:path'
import type { TiO2Project } from '../packages/config/src/index.js'
import { loadCustomRenderer } from './custom-renderer'
import {
    convertDateV2,
    createMarkdownRoute,
    inferTitleFromPath,
    extractExcerpt,
    type BlogPost,
    type ProofLedgerCollection,
    type ProofLedgerNode,
    type TopicNode
} from '../packages/content-core/src/index'
import type { loadSiteContent, PublishingManifestEntry } from '../packages/content-fs/src/index'
import { readMarkdownSource } from '../packages/content-fs/src/markdown-source'
import { escapeHtmlAttribute, escapeHtmlText, renderInlineMath } from '../.vitepress/theme/markdownRendering'
import { renderAigcDisclosure, renderAigcNote, renderAigcSummary } from './aigc-note'
import { generatePaginationArray } from './render-helpers'
import {
    renderBacklinksPanel,
    renderDocument,
    type ClientAssets,
    type OutlineItem,
    type DocumentOptions
} from './site-renderer'

export type SiteContent = Awaited<ReturnType<typeof loadSiteContent>>

export async function renderArticlePage(
    project: TiO2Project,
    content: SiteContent,
    article: BlogPost,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const source = await readMarkdownSource(path.join(project.rootDir, article.sourcePath))
    const contentLanguage = readString(source.data.lang) || project.config.site.language
    const body = markdown.render(source.content, {
        relativePath: article.sourcePath,
        referenceRenderMode: 'static-html'
    })
    const publication = findPublishingEntry(content, article.sourcePath)
    const backlinks = content.references.backlinksByTargetId[article.articleTargetId] ?? []
    const previous = article.previousSourcePath
        ? content.articles.find((candidate) => candidate.sourcePath === article.previousSourcePath)
        : undefined
    const next = article.nextSourcePath
        ? content.articles.find((candidate) => candidate.sourcePath === article.nextSourcePath)
        : undefined
    const pageClass = `_${article.sourcePath.replace(/\.md$/u, '').replace(/\//gu, '_')}`
    const description = article.frontMatter.description || article.excerpt || project.config.site.description
    const contentHtml = [
        renderArticleHeader(t, articleIndexLinks(project, content), article, markdown, contentLanguage),
        `<main class="main"><div class="vp-doc ${escapeHtmlAttribute(pageClass)}" style="position:relative"><div>${body}</div></div></main>`,
        '<footer class="VPDocFooter"></footer>',
        renderArticleMeta(t, project, article),
        renderBacklinksPanel(t, article.articleTargetId, backlinks, markdown),
        renderArticlePagination(t, previous, next, markdown)
    ].join('')

    return renderDocument(project, {
        title: article.frontMatter.title,
        description,
        canonicalPath: article.regularPath,
        clientAssets,
        articleOutline: { items: extractOutline(body, markdown), readingMinutes: article.frontMatter.readingTime },
        content: contentHtml,
        language: readString(source.data.lang),
        image: article.frontMatter.cover?.src,
        imageAlt: article.frontMatter.cover?.alt,
        alternates: readStringRecord(source.data.alternates),
        article: {
            publishedAt: publication.publishedAt,
            modifiedAt: publication.updatedAt || publication.publishedAt,
            section: article.frontMatter.category ?? '',
            tags: article.frontMatter.tags,
            wordCount: article.frontMatter.wordCount
        },
        bottom: source.data.comment === false ? '' : renderComments(t, project)
    })
}

export function renderPostIndex(
    project: TiO2Project,
    content: SiteContent,
    page: number,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const posts = content.posts
    const pageCount = Math.max(1, Math.ceil(posts.length / project.config.content.pageSize))
    const visiblePosts = posts.slice(
        (page - 1) * project.config.content.pageSize,
        page * project.config.content.pageSize
    )
    const canonicalPath = page === 1 ? '/' : `/page_${page}.html`
    const title = page === 1 ? 'Home' : `Page ${page}`
    const yearCounts = countByYear(posts)
    const body = `${renderPostFeed(t, articleIndexLinks(project, content), visiblePosts, page, posts.length, yearCounts, markdown)}${renderPagination(t, pageCount, page)}`
    return renderPageDocument(project, title, project.config.site.description, canonicalPath, body, clientAssets, {
        wide: true
    })
}

export function renderNotFound(project: TiO2Project, clientAssets: ClientAssets) {
    return renderDocument(project, {
        title: '404',
        description: 'Not Found',
        canonicalPath: '/404.html',
        clientAssets,
        notFound: true,
        content: `<div class="NotFound"><p class="code">404</p><h1 class="title">PAGE NOT FOUND</h1><div class="divider"></div><blockquote class="quote">But if you don't change your direction, and if you keep looking, you may end up where you are heading.</blockquote><div class="action"><a class="link" href="/" aria-label="go to home">Take me home</a></div></div>`
    })
}

export async function renderTopics(
    project: TiO2Project,
    content: SiteContent,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const page = await readPageMeta(project, 'topics')
    const tree = content.topics.roots.length
        ? `<div class="topics-tree">${content.topics.roots.map((node) => renderTopicNode(t, node, content, markdown)).join('')}</div>`
        : `<section class="topics-empty"><p class="topics-empty__title">${t('暂时还没有专题。', 'No topics yet.')}</p><p class="topics-empty__description">${t('可以在 ', 'Create a subdirectory under ')}<code>${escapeHtmlText(project.config.content.topicsDir)}/</code>${t(' 下建立子目录并放置文章；也可以直接在文章 front matter 里添加 ', ' and add articles, or set ')}<code>topics: [${t('专题路径', 'topic/path')}]</code>${t('，让文章同时出现在专题树中。如需专题元信息，可添加 ', ' in article front matter. For topic metadata, add ')}<code>${escapeHtmlText(project.config.content.topicMetaFilename)}</code>${t('。', '.')}</p></section>`
    return renderPageDocument(
        project,
        page.title,
        page.description,
        page.route,
        `<h1>${renderInlineMath(markdown, page.title, page.sourcePath)}</h1><section class="topics-page">${tree}</section>`,
        clientAssets
    )
}

export async function renderLedger(project: TiO2Project, ledger: ProofLedgerCollection, clientAssets: ClientAssets) {
    const t = createTranslator(project.config.site.language)
    const page = await readPageMeta(project, 'ledger')
    const tree = ledger.roots.length
        ? `<div class="ledger-tree">${ledger.roots.map((node) => renderLedgerNode(node, 0)).join('')}</div>`
        : `<section class="ledger-empty"><p>${t('暂无可展示的证明。', 'No proofs to display.')}</p></section>`
    const body = `<section class="ledger-page"><header class="ledger-header"><h1>Ledger</h1><p>${ledger.proofCount} proofs</p></header><section class="ledger-intro"><p>This page publishes cryptographic timestamp commitments for selected notes and technical drafts. Each entry contains a SHA-256 digest and an OpenTimestamps proof. The full note may remain private; later disclosure can be verified by recomputing its SHA-256 digest and comparing it with the published value.</p><p>Each entry lists the latest public timestamped commitment available on this page. <strong>Earlier private notes, signed commits, local drafts, or proof files may be retained and can be disclosed when necessary to establish the full record trail.</strong></p></section>${tree}<section class="ledger-verification" aria-labelledby="ledger-verification-title"><h2 id="ledger-verification-title">Verification</h2><p>Use <strong>Verify in browser</strong> on any entry to check that its proof commits to the listed digest and reaches a Bitcoin block. Pending proofs are upgraded in memory from allowlisted OpenTimestamps calendars; no private note is uploaded.</p><p>To verify a later disclosure:</p><ol><li>Save the disclosed note as a byte-identical file.</li><li>Compute its SHA-256 digest.</li><li>Compare it with the digest listed here.</li><li>Run the browser verification for the matching entry.</li></ol><p>The browser check uses Blockstream as its view of Bitcoin. For fully independent verification, download the .ots proof and use the <a href="https://opentimestamps.org/" target="_blank" rel="noreferrer">OpenTimestamps</a> client with your own Bitcoin node.</p></section></section>`
    return renderPageDocument(project, page.title, page.description, page.route, body, clientAssets)
}

export async function renderMarkdownPage(
    project: TiO2Project,
    sourcePath: string,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const source = await readMarkdownSource(path.join(project.rootDir, sourcePath))
    const title = readString(source.data.title) || inferTitleFromPath(sourcePath)
    const description =
        readString(source.data.description) || extractExcerpt(source.content) || project.config.site.description
    const body = markdown.render(source.content, { relativePath: sourcePath, referenceRenderMode: 'static-html' })
    const modulePath = project.config.theme.pages[sourcePath]
    if (modulePath) {
        const custom = await loadCustomRenderer(project, modulePath)
        const page = { title, description, canonicalPath: createMarkdownRoute(sourcePath), content: body, clientAssets }
        const render = (overrides: Partial<DocumentOptions> = {}) => renderDocument(project, { ...page, ...overrides })
        const html = await custom({ project, sourcePath, source, markdown, render } satisfies PageRendererContext)
        if (typeof html !== 'string') throw new TypeError(modulePath + ' must return HTML')
        return html
    }
    return renderPageDocument(project, title, description, createMarkdownRoute(sourcePath), body, clientAssets)
}

export function renderPageDocument(
    project: TiO2Project,
    title: string,
    description: string,
    canonicalPath: string,
    body: string,
    clientAssets: ClientAssets,
    options: { wide?: boolean } = {}
) {
    const pageClass = `_${
        canonicalPath
            .replace(/^\//u, '')
            .replace(/\.html$/u, '')
            .replace(/\//gu, '_') || 'index'
    }`
    return renderDocument(project, {
        title,
        description,
        canonicalPath,
        clientAssets,
        wide: options.wide,
        content: `<main class="main"><div class="vp-doc ${escapeHtmlAttribute(pageClass)}" style="position:relative"><div>${body}</div></div></main><footer class="VPDocFooter"></footer>`
    })
}

function renderPostFeed(
    t: Translator,
    links: ArticleIndexLinks,
    posts: BlogPost[],
    page: number,
    totalPosts: number,
    yearCounts: Map<string, number>,
    markdown: MarkdownIt
) {
    const [first, ...rest] = posts
    const lead = page === 1 && first?.frontMatter.cover ? first : undefined
    const feed = lead ? rest : posts
    // The first page opens on the current year; later pages restate the year they start in.
    let previousYear = lead ? readYear(lead) : ''
    const entries = feed
        .map((post) => {
            const year = readYear(post)
            const pinned = post.frontMatter.order > 0
            const yearMark =
                !pinned && year && year !== previousYear
                    ? `<h2 class="post-year"><span>${escapeHtmlText(year)}</span><small>${yearCounts.get(year) ?? 0}${t(' 篇', (yearCounts.get(year) ?? 0) === 1 ? ' post' : ' posts')}</small></h2>`
                    : ''
            if (!pinned) previousYear = year
            return yearMark + renderFeedEntry(t, links, post, markdown)
        })
        .join('')
    const heading = lead
        ? `<header class="post-feed__head"><h2>${t('近期文章', 'Recent posts')}</h2>${links.archives ? `<a href="${escapeHtmlAttribute(links.archives)}">${t('全部 ', 'All ')}${totalPosts}${t(' 篇', totalPosts === 1 ? ' post' : ' posts')}</a>` : `<span>${t('共 ', 'Total: ')}${totalPosts}${t(' 篇', totalPosts === 1 ? ' post' : ' posts')}</span>`}</header>`
        : ''
    return `<section class="post-feed" aria-label="${t('文章列表', 'Posts')}">${lead ? renderLeadEntry(t, links, lead, markdown) : ''}${heading}${entries}</section>`
}

function renderLeadEntry(t: Translator, links: ArticleIndexLinks, post: BlogPost, markdown: MarkdownIt) {
    const { frontMatter } = post
    const date = `<time datetime="${escapeHtmlAttribute(frontMatter.date)}">${escapeHtmlText(frontMatter.date.replaceAll('-', ' · '))}</time>`
    return `<article class="post-list post-list--featured">${renderPostCover(t, post, 'eager')}<div class="post-copy">${renderPostKicker(t, post, `${date}<span class="post-kicker__latest">${t('最新', 'Latest')}</span>`)}${renderPostTitle(post, markdown)}${renderPostDescription(post, markdown)}${renderPostMeta(t, links, post, 3)}</div></article>`
}

function renderFeedEntry(t: Translator, links: ArticleIndexLinks, post: BlogPost, markdown: MarkdownIt) {
    const { frontMatter } = post
    if (!frontMatter.cover) {
        const aside = [frontMatter.category, `${frontMatter.readingTime}${t(' 分钟', ' min')}`]
            .filter(Boolean)
            .join(' · ')
        return `<article class="post-list post-list--compact">${renderPostDate(post)}${renderPostTitle(post, markdown)}<span class="post-list__aside"><span>${escapeHtmlText(aside)}</span>${renderAigcNote(t, frontMatter)}</span></article>`
    }
    return `<article class="post-list post-list--with-cover">${renderPostDate(post)}<div class="post-copy">${renderPostKicker(t, post)}${renderPostTitle(post, markdown)}${renderPostDescription(post, markdown)}${renderPostMeta(t, links, post, 2)}</div>${renderPostCover(t, post, 'lazy')}</article>`
}

function renderPostDate(post: BlogPost) {
    const [year, month, day] = post.frontMatter.date.split('-')
    return `<time class="post-date" datetime="${escapeHtmlAttribute(post.frontMatter.date)}">${escapeHtmlText(`${month}·${day}`)}<small>${escapeHtmlText(year)}</small></time>`
}

function renderPostKicker(t: Translator, post: BlogPost, extra = '') {
    const { category, order, date } = post.frontMatter
    const parts = [
        order > 0 ? `<span class="post-kicker__pin">${t('置顶', 'Pinned')}</span>` : '',
        category ? `<span class="post-kicker__category">${escapeHtmlText(category)}</span>` : '',
        // Phones hide the date column, so the kicker carries the date there.
        extra ||
            `<time class="post-kicker__date" datetime="${escapeHtmlAttribute(date)}">${escapeHtmlText(date.replaceAll('-', '.'))}</time>`
    ]
    return `<div class="post-kicker">${parts.join('')}</div>`
}

function renderPostTitle(post: BlogPost, markdown: MarkdownIt) {
    return `<h2 class="post-title"><a href="${escapeHtmlAttribute(post.regularPath)}">${renderInlineMath(markdown, post.frontMatter.title, post.sourcePath)}</a></h2>`
}

function renderPostDescription(post: BlogPost, markdown: MarkdownIt) {
    return post.frontMatter.description
        ? `<p class="post-description">${renderInlineMath(markdown, post.frontMatter.description, post.sourcePath)}</p>`
        : ''
}

function renderPostMeta(t: Translator, links: ArticleIndexLinks, post: BlogPost, tagLimit: number) {
    const { frontMatter } = post
    const tags = frontMatter.tags
        .slice(0, tagLimit)
        .map((tag) =>
            links.tags
                ? `<a href="${escapeHtmlAttribute(links.tags)}#tag=${encodeURIComponent(tag)}">#${escapeHtmlText(tag)}</a>`
                : `<span>#${escapeHtmlText(tag)}</span>`
        )
        .join('')
    const items = [
        `<span>${t('约 ', 'About ')}${frontMatter.readingTime}${t(' 分钟', ' min')}</span>`,
        renderAigcNote(t, frontMatter),
        tags ? `<span class="post-tags" aria-label="${t('文章标签', 'Post tags')}">${tags}</span>` : ''
    ].filter(Boolean)
    return `<div class="post-meta">${items.join('')}</div>`
}

function renderPostCover(t: Translator, post: BlogPost, loading: 'eager' | 'lazy') {
    const cover = post.frontMatter.cover
    if (!cover) return ''
    return `<a class="post-cover-link" href="${escapeHtmlAttribute(post.regularPath)}" aria-label="${t('阅读：', 'Read: ')}${escapeHtmlAttribute(post.frontMatter.title)}" tabindex="-1"><span class="post-cover${cover.fit === 'contain' ? ' post-cover--contain' : ''}">${renderImageFrame(t, cover.src, cover.alt, 'post-cover__media', loading, cover.fit, cover.position)}</span></a>`
}

function readYear(post: BlogPost | undefined) {
    return post?.frontMatter.date.slice(0, 4) ?? ''
}

function countByYear(posts: BlogPost[]) {
    const counts = new Map<string, number>()
    for (const post of posts) counts.set(readYear(post), (counts.get(readYear(post)) ?? 0) + 1)
    return counts
}

function renderPagination(t: Translator, pageCount: number, page: number) {
    if (pageCount <= 1) return ''
    const items = generatePaginationArray(pageCount, page)
        .map((item) => {
            if (item === '...') return '<span class="pagination-ellipsis" aria-hidden="true">…</span>'
            if (item === page) return `<span class="pagination-link active" aria-current="page">${item}</span>`
            return `<a class="pagination-link" href="${item === 1 ? '/' : `/page_${item}.html`}">${item}</a>`
        })
        .join('')
    return `<nav class="pagination" aria-label="${t('文章列表分页', 'Post pagination')}">${items}</nav>`
}

function renderArticleHeader(
    t: Translator,
    links: ArticleIndexLinks,
    article: BlogPost,
    markdown: MarkdownIt,
    contentLanguage: string
) {
    const { frontMatter } = article
    const category = frontMatter.category
        ? `<span aria-hidden="true">/</span>${links.category ? `<a class="article-crumbs__category" href="${escapeHtmlAttribute(links.category)}">${escapeHtmlText(frontMatter.category)}</a>` : `<span class="article-crumbs__category">${escapeHtmlText(frontMatter.category)}</span>`}`
        : ''
    const tags = frontMatter.tags
        .map((tag) =>
            links.tags
                ? `<a href="${escapeHtmlAttribute(links.tags)}#tag=${encodeURIComponent(tag)}">#${escapeHtmlText(tag)}</a>`
                : `<span>#${escapeHtmlText(tag)}</span>`
        )
        .join('')
    const crumbs = `<nav class="article-crumbs" aria-label="${t('文章位置', 'Article location')}"><a href="/">${t('文章', 'Posts')}</a>${category}${tags ? `<span class="article-crumbs__tags">${tags}</span>` : ''}</nav>`
    const description = frontMatter.description
        ? `<p class="article-header-description">${renderInlineMath(markdown, frontMatter.description, article.sourcePath)}</p>`
        : ''
    const words = new Intl.NumberFormat(t('zh-CN', 'en')).format(frontMatter.wordCount)
    const wordUnit =
        resolveLanguage(contentLanguage) === 'zh-CN'
            ? t(' 字', frontMatter.wordCount === 1 ? ' character' : ' characters')
            : t(' 词', frontMatter.wordCount === 1 ? ' word' : ' words')
    const aigc = renderAigcSummary(t, frontMatter)
    const colophon = [
        [
            t('发布', 'Published'),
            `<time datetime="${escapeHtmlAttribute(frontMatter.date)}">${escapeHtmlText(frontMatter.date.replaceAll('-', ' · '))}</time>`
        ],
        [
            t('篇幅', 'Length'),
            `${words}${wordUnit} · ${t('约 ', 'About ')}${frontMatter.readingTime}${t(' 分钟', ' min')}`
        ],
        ...(aigc ? [[t('AIGC 披露', 'AI disclosure'), aigc]] : [])
    ]
        .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
        .join('')
    return `<header class="article-header">${crumbs}<h1 class="article-header-title">${renderInlineMath(markdown, frontMatter.title, article.sourcePath)}</h1>${description}<dl class="article-colophon">${colophon}</dl></header>`
}

function renderArticleMeta(t: Translator, project: TiO2Project, article: BlogPost) {
    const revision = article.frontMatter.lastUpdated
        ? { label: t('最后更新', 'Last updated'), text: convertDateV2(article.frontMatter.lastUpdated) }
        : { label: t('发布时间', 'Published'), text: article.frontMatter.date }
    const currentYear = new Date().getFullYear()
    const startYear = project.config.site.copyrightStartYear ?? currentYear
    const copyrightRange = currentYear > startYear ? `${startYear}–${currentYear}` : String(startYear)
    const aigc = renderAigcDisclosure(t, article.frontMatter)
    const items = [
        [revision.label, escapeHtmlText(revision.text)],
        [
            t('著作权', 'Copyright'),
            `© ${copyrightRange} ${escapeHtmlText(project.config.site.title)}${project.config.site.contentLicense ? ` · ${escapeHtmlText(project.config.site.contentLicense)}` : ''}`
        ],
        ...(aigc ? [[t('AIGC 披露', 'AI disclosure'), aigc]] : [])
    ]
    return `<section class="article-meta-card" aria-label="${t('文章信息', 'Article information')}"><dl class="meta-list">${items.map(([label, value]) => `<div class="meta-item"><dt class="meta-label">${label}</dt><dd class="meta-value">${value}</dd></div>`).join('')}</dl></section>`
}

function renderTopicNode(t: Translator, node: TopicNode, content: SiteContent, markdown: MarkdownIt): string {
    const contentId = `${node.anchorId}-content`
    const articles = node.articles
        .map((article) => {
            const cover = article.frontMatter.cover
                ? `<span class="topic-article__cover${article.frontMatter.cover.fit === 'contain' ? ' topic-article__cover--contain' : ''}">${renderImageFrame(t, article.frontMatter.cover.src, article.frontMatter.cover.alt, 'topic-article__cover-media', 'lazy', article.frontMatter.cover.fit, article.frontMatter.cover.position)}</span>`
                : ''
            const description = article.frontMatter.description
                ? `<p class="topic-article__description">${renderInlineMath(markdown, article.frontMatter.description, article.sourcePath)}</p>`
                : ''
            return `<a class="topic-article${cover ? ' topic-article--with-cover' : ''}" href="${escapeHtmlAttribute(article.regularPath)}">${cover}<div class="topic-article__main"><strong class="topic-article__title">${renderInlineMath(markdown, article.frontMatter.title, article.sourcePath)}</strong>${description}</div><div class="topic-article__meta"><span>${escapeHtmlText(article.frontMatter.date)}</span><span>${article.frontMatter.readingTime}${t(' 分钟', ' min')}</span>${renderAigcNote(t, article.frontMatter)}</div></a>`
        })
        .join('')
    const articleList = articles ? `<div class="topic-node__articles">${articles}</div>` : ''
    const children = node.children.length
        ? `<div class="topic-node__children">${node.children.map((child) => renderTopicNode(t, child, content, markdown)).join('')}</div>`
        : ''
    const childCount = node.children.length
        ? `<span>${node.children.length}${t(' 个子专题', node.children.length === 1 ? ' subtopic' : ' subtopics')}</span>`
        : ''
    const description = node.description
        ? `<span class="topic-node__description">${renderInlineMath(markdown, node.description)}</span>`
        : ''
    const backlinks = renderBacklinksPanel(
        t,
        node.targetId,
        content.references.backlinksByTargetId[node.targetId] ?? [],
        markdown,
        t('这些文章也曾回望这个专题', 'Articles referencing this topic'),
        true
    )

    return `<section id="${escapeHtmlAttribute(node.anchorId)}" class="topic-node" data-open="false"><button type="button" class="topic-node__summary" aria-expanded="false" aria-controls="${escapeHtmlAttribute(contentId)}"><span class="topic-node__summary-main"><span class="topic-node__meta"><span>${node.articleCount}${t(' 篇', node.articleCount === 1 ? ' post' : ' posts')}</span>${childCount}</span><span class="topic-node__title-row"><strong class="topic-node__title">${renderInlineMath(markdown, node.title)}</strong></span>${description}</span></button><div id="${escapeHtmlAttribute(contentId)}" class="topic-node__content" hidden>${articleList}${children}${backlinks}</div></section>`
}

function renderLedgerNode(node: ProofLedgerNode, depth: number): string {
    if (node.kind === 'group') {
        const contentId = `ledger-${node.path.replace(/[^a-z0-9_-]+/giu, '-')}-content`
        const open = depth === 0
        return `<section class="ledger-node depth-${depth}" data-open="${open}"><button type="button" class="ledger-node__summary" aria-expanded="${open}" aria-controls="${escapeHtmlAttribute(contentId)}"><span class="ledger-node__title">${escapeHtmlText(node.title)}</span><span class="ledger-node__count">${node.proofCount}</span></button><div id="${escapeHtmlAttribute(contentId)}" class="ledger-node__children"${open ? '' : ' hidden'}>${node.children.map((child) => renderLedgerNode(child, depth + 1)).join('')}</div></section>`
    }

    const timestamp = formatLedgerTimestamp(node.timestamp)
    const time = timestamp
        ? `<time datetime="${escapeHtmlAttribute(node.timestamp)}">${escapeHtmlText(timestamp)}</time>`
        : ''
    return `<article class="ledger-proof depth-${depth}"><header class="ledger-proof__header"><h2><span>${escapeHtmlText(node.title)}</span><span class="ledger-proof__status">(${escapeHtmlText(node.status)})</span></h2>${time}</header><dl class="ledger-proof__body"><div><dt>SHA-256</dt><dd><code>${escapeHtmlText(node.sha256)}</code></dd></div><div><dt>Proof</dt><dd class="ledger-proof__actions"><a href="${escapeHtmlAttribute(node.proofUrl)}" download="${escapeHtmlAttribute(node.proofFileName)}">Download</a><button type="button" class="ledger-proof__verify" data-ledger-verify data-proof-url="${escapeHtmlAttribute(node.proofUrl)}" data-sha256="${escapeHtmlAttribute(node.sha256)}">Verify in browser</button></dd></div></dl><p class="ledger-proof__verification" role="status" hidden></p></article>`
}

function formatLedgerTimestamp(timestamp: string) {
    const match = timestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u)
    return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]} UTC` : timestamp
}

function renderArticlePagination(
    t: Translator,
    previous: BlogPost | undefined,
    next: BlogPost | undefined,
    markdown: MarkdownIt
) {
    if (!previous && !next) return ''
    return `<nav class="article-pagination" aria-label="${t('相邻文章', 'Adjacent articles')}">${renderPaginationCard(previous, t('上一篇', 'Previous'), false, markdown)}${renderPaginationCard(next, t('下一篇', 'Next'), true, markdown)}</nav>`
}

function renderPaginationCard(
    article: BlogPost | undefined,
    label: string,
    alignRight: boolean,
    markdown: MarkdownIt
) {
    if (!article) return '<span class="pagination-card pagination-card--empty"></span>'
    const caption = alignRight ? `${label} →` : `← ${label}`
    return `<a class="pagination-card${alignRight ? ' pagination-card--align-right' : ''}" href="${escapeHtmlAttribute(article.regularPath)}"><span class="pagination-label">${caption} · <time datetime="${escapeHtmlAttribute(article.frontMatter.date)}">${escapeHtmlText(article.frontMatter.date.replaceAll('-', '·'))}</time></span><strong class="pagination-title">${renderInlineMath(markdown, article.frontMatter.title, article.sourcePath)}</strong></a>`
}

function renderImageFrame(
    t: Translator,
    src: string,
    alt: string,
    className: string,
    loading: 'eager' | 'lazy',
    fit: string,
    position: string
) {
    return `<span class="image-load-frame image-load-frame--loaded image-load-frame--known image-load-frame--enhanced image-load-frame--fill ${className}" data-image-load-frame data-image-state="loaded"><picture class="image-load-frame__picture"><img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" width="1600" height="900" loading="${loading}" fetchpriority="${loading === 'eager' ? 'high' : 'auto'}" decoding="async" draggable="false" style="object-fit:${escapeHtmlAttribute(fit)};object-position:${escapeHtmlAttribute(position)}" class="image-load-frame__media" data-image-load-media></picture><span class="image-load-frame__placeholder" aria-hidden="true"></span><span class="image-load-frame__error" role="status" hidden>${t('图片加载失败', 'Image failed to load')}</span></span>`
}

function renderComments(t: Translator, project: TiO2Project) {
    const comment = project.config.comment
    if (!comment) return ''
    return `<section class="comment-giscus" aria-label="${t('评论', 'Comments')}" data-giscus data-repo="${escapeHtmlAttribute(comment.repo)}" data-repo-id="${escapeHtmlAttribute(comment.repoId)}" data-category="${escapeHtmlAttribute(comment.category)}" data-category-id="${escapeHtmlAttribute(comment.categoryId)}"><h2 class="comment-giscus__title">${t('讨论', 'Discussion')}</h2><p class="comment-giscus__status" role="status" data-giscus-status>${t('正在加载评论…', 'Loading comments…')}</p></section>`
}

function extractOutline(html: string, markdown: MarkdownIt): OutlineItem[] {
    return [...html.matchAll(/<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gu)].map((match) => ({
        level: match[1] === '2' ? 2 : 3,
        id: decodeHtmlAttribute(match[2]),
        title: match[3]
            .replace(/<a\b[^>]*class="header-anchor"[\s\S]*?<\/a>/gu, '')
            .replace(/<[^>]+>/gu, '')
            // Decode entities once as text; renderOutlineList escapes them at the HTML boundary.
            .replace(/&(?:#x[\da-f]+|#\d+|[a-z][\da-z]*);/giu, (entity) => markdown.utils.unescapeAll(entity))
            .replace(/\s+/gu, ' ')
            .trim()
    }))
}

function decodeHtmlAttribute(value: string) {
    return value
        .replace(/&quot;/gu, '"')
        .replace(/&amp;/gu, '&')
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
}

function findPublishingEntry(content: SiteContent, sourcePath: string): PublishingManifestEntry {
    const entry = content.publishing.entries.find((candidate) => candidate.sourcePath === sourcePath)
    if (!entry) throw new Error(`Missing publishing entry for ${sourcePath}`)
    return entry
}

export async function readPageMeta(project: TiO2Project, name: string) {
    const sourcePath = `${project.config.content.pagesDir}/${name}.md`
    const source = await readMarkdownSource(path.join(project.rootDir, sourcePath))
    return {
        sourcePath,
        title: readString(source.data.title) || inferTitleFromPath(sourcePath),
        description:
            readString(source.data.description) || extractExcerpt(source.content) || project.config.site.description,
        route: createMarkdownRoute(sourcePath)
    }
}

const pageTitles = new WeakMap<TiO2Project, Map<string, Promise<string>>>()

/** A page's own title, read once per build, so links to that page can call it by its name. */
export function readPageTitle(project: TiO2Project, name: string) {
    const known = pageTitles.get(project) ?? new Map<string, Promise<string>>()
    pageTitles.set(project, known)
    if (!known.has(name))
        known.set(
            name,
            readPageMeta(project, name).then((page) => page.title)
        )
    return known.get(name)!
}

function readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function readStringRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const entries = Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())
    )
    return entries.length ? Object.fromEntries(entries) : undefined
}

export interface PageRendererContext {
    project: TiO2Project
    sourcePath: string
    source: Awaited<ReturnType<typeof readMarkdownSource>>
    markdown: MarkdownIt
    render: (overrides?: Partial<DocumentOptions>) => Promise<string>
}

export function pageRoute(project: TiO2Project, name: string) {
    return createMarkdownRoute(`${project.config.content.pagesDir}/${name}.md`)
}

type ArticleIndexLinks = Partial<Record<'archives' | 'category' | 'tags', string>>

export function findPageRoute(project: TiO2Project, content: SiteContent, name: string) {
    const sourcePath = project.config.content.pagesDir + '/' + name + '.md'
    return content.publishing.entries.find((entry) => entry.kind === 'page' && entry.sourcePath === sourcePath)?.route
}

function articleIndexLinks(project: TiO2Project, content: SiteContent): ArticleIndexLinks {
    return Object.fromEntries(
        ['archives', 'category', 'tags'].map((name) => [name, findPageRoute(project, content, name)])
    )
}
