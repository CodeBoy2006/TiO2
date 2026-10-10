import { createTranslator, type Translator } from '../packages/config/src/i18n.js'
import type { TiO2Project } from '../packages/config/src/index.js'
import type MarkdownIt from 'markdown-it'
import type { BlogPost } from '../packages/content-core/src/index'
import { escapeHtmlAttribute, escapeHtmlText, renderInlineMath } from '../.vitepress/theme/markdownRendering'
import { renderAigcNote } from './aigc-note'
import { findPageRoute, readPageMeta, renderPageDocument, type SiteContent } from './page-renderer'
import { initCategory, initTags, useYearSort } from './render-helpers'
import type { ClientAssets } from './site-renderer'

/** Archives, categories and tags share one index: the same post list arranged three ways. */
type IndexView = 'archives' | 'category' | 'tags'

const indexViews = (t: Translator): { key: IndexView; label: string }[] => [
    { key: 'archives', label: t('时间线', 'Timeline') },
    { key: 'category', label: t('分类', 'Categories') },
    { key: 'tags', label: t('标签', 'Tags') }
]

export async function renderArchives(
    project: TiO2Project,
    content: SiteContent,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const posts = content.posts
    const years = useYearSort(posts)
        .map((yearPosts) => {
            const year = yearPosts[0].frontMatter.date.slice(0, 4)
            return `<section class="index-year" data-index-group><header class="index-year__head"><h2>${escapeHtmlText(year)}</h2><small>${yearPosts.length}${t(' 篇', yearPosts.length === 1 ? ' post' : ' posts')}</small></header><div class="index-year__rows">${yearPosts.map((post) => renderIndexRow(t, post, markdown)).join('')}</div></section>`
        })
        .join('')
    return renderIndexPage(project, 'archives', content, `${renderDensity(t, posts)}${years}`, clientAssets)
}

export async function renderCategories(
    project: TiO2Project,
    content: SiteContent,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const posts = content.posts
    const categories = Object.entries(initCategory(posts))
        .sort(([, left], [, right]) => right.length - left.length)
        .map(
            ([category, categoryPosts]) =>
                `<section class="index-category" data-index-group><header class="index-category__head"><h2>${escapeHtmlText(category)}</h2><small>${categoryPosts.length}</small></header>${categoryPosts.map((post) => renderIndexRow(t, post, markdown, true)).join('')}</section>`
        )
        .join('')
    return renderIndexPage(
        project,
        'category',
        content,
        `<div class="index-categories">${categories}</div>`,
        clientAssets
    )
}

export async function renderTags(
    project: TiO2Project,
    content: SiteContent,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const posts = content.posts
    const tags = Object.entries(initTags(posts))
    const buttons = tags
        .map(
            ([tag, taggedPosts], index) =>
                `<button type="button" class="index-chip" data-tag="${escapeHtmlAttribute(tag)}" aria-pressed="${index === 0 ? 'true' : 'false'}">${escapeHtmlText(tag)}<small>${taggedPosts.length}</small></button>`
        )
        .join('')
    const panels = tags
        .map(
            ([tag, taggedPosts], index) =>
                `<section class="index-tag-panel" data-tag-panel="${escapeHtmlAttribute(tag)}" data-index-group${index === 0 ? '' : ' hidden'}>${taggedPosts.map((post) => renderIndexRow(t, post, markdown)).join('')}</section>`
        )
        .join('')
    const body = `<div class="index-tags" data-tags role="group" aria-label="${t('标签', 'Tags')}">${buttons}</div><h2 class="index-tag-heading" data-tag-heading>${escapeHtmlText(tags[0]?.[0] ?? '')}</h2>${panels}`
    return renderIndexPage(project, 'tags', content, body, clientAssets)
}

async function renderIndexPage(
    project: TiO2Project,
    view: IndexView,
    content: SiteContent,
    body: string,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const posts = content.posts
    const page = await readPageMeta(project, view)
    const stats = [
        [posts.length, t('篇文章', 'Posts')],
        [Object.keys(initCategory(posts)).length, t('个分类', 'Categories')],
        [Object.keys(initTags(posts)).length, t('个标签', 'Tags')],
        [posts.filter((post) => post.frontMatter.humanWritten).length, t('篇亲笔', 'Human-written posts')]
    ]
        .map(([value, label]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
        .join('')
    const views = indexViews(t)
        .map((item) => {
            const href = findPageRoute(project, content, item.key)
            return href
                ? `<a href="${escapeHtmlAttribute(href)}"${item.key === view ? ' aria-current="page"' : ''}>${item.label}</a>`
                : ''
        })
        .join('')
    const toolbar = `<div class="index-bar"><nav class="index-switch" aria-label="${t('排列方式', 'View')}">${views}</nav><label class="index-filter"><span class="visually-hidden">${t('在标题中筛选', 'Filter by title')}</span><input type="search" placeholder="${t('在标题中筛选', 'Filter by title')}" autocomplete="off" data-index-filter></label><button type="button" class="index-toggle" aria-pressed="false" data-index-human><span aria-hidden="true"></span>${t('只看亲笔', 'Human-written only')}</button><p class="index-count" role="status" aria-live="polite" data-index-count></p></div>`
    const header = `<header class="index-head"><h1>${t('索引', 'Index')}</h1><dl class="index-stats">${stats}</dl></header>`
    return renderPageDocument(
        project,
        page.title,
        page.description,
        page.route,
        `<section class="index-page" data-index-page>${header}${toolbar}${body}<p class="index-empty" data-index-empty hidden>${t('没有符合条件的文章。', 'No matching articles.')}</p></section>`,
        clientAssets,
        { wide: true }
    )
}

function renderIndexRow(t: Translator, post: BlogPost, markdown: MarkdownIt, compact = false) {
    const { date, category, humanWritten } = post.frontMatter
    const [, month, day] = date.split('-')
    const categoryLabel =
        compact || !category ? '' : `<span class="index-row__category">${escapeHtmlText(category)}</span>`
    return `<a class="index-row${compact ? ' index-row--compact' : ''}" href="${escapeHtmlAttribute(post.regularPath)}" data-index-row${humanWritten ? ' data-human' : ''}><time datetime="${escapeHtmlAttribute(date)}">${compact ? escapeHtmlText(date.slice(0, 7).replace('-', '·')) : `${month}·${day}`}</time><span class="index-row__title">${renderInlineMath(markdown, post.frontMatter.title, post.sourcePath)}</span>${categoryLabel}<span class="index-row__note">${renderAigcNote(t, post.frontMatter)}</span></a>`
}

/** Posts per month, from the first post to the newest one; the latest year is drawn in the index blue. */
function renderDensity(t: Translator, posts: BlogPost[]) {
    const months = new Map<string, number>()
    for (const post of posts) {
        const month = post.frontMatter.date.slice(0, 7)
        if (month) months.set(month, (months.get(month) ?? 0) + 1)
    }
    const keys = [...months.keys()].sort()
    if (!keys.length) return ''

    const buckets: { key: string; count: number }[] = []
    for (let [year, month] = keys[0].split('-').map(Number); ; month += 1) {
        if (month > 12) [year, month] = [year + 1, 1]
        const key = `${year}-${String(month).padStart(2, '0')}`
        buckets.push({ key, count: months.get(key) ?? 0 })
        if (key === keys.at(-1)) break
    }
    const peak = buckets.reduce((best, bucket) => (bucket.count > best.count ? bucket : best))
    const latestYear = keys.at(-1)!.slice(0, 4)
    const bars = buckets
        .map(
            ({ key, count }) =>
                `<span class="index-density__bar${key.startsWith(latestYear) ? ' is-latest' : ''}" style="--share:${(count / peak.count).toFixed(3)}" title="${escapeHtmlAttribute(`${key.replace('-', t(' 年 ', '-'))}${t(' 月 · ', ' · ')}${count}${t(' 篇', count === 1 ? ' post' : ' posts')}`)}"></span>`
        )
        .join('')
    const axis = buckets
        .map(({ key }, index) =>
            index === 0 || key.endsWith('-01')
                ? `<span style="grid-column-start:${index + 1}">${key.slice(0, 4)}</span>`
                : ''
        )
        .join('')
    const summary = `${t('每月发文数量，', 'Monthly posts, since ')}${keys[0].replace('-', t(' 年 ', '-'))}${t(' 月至今；峰值 ', '; peak: ')}${peak.key.replace('-', t(' 年 ', '-'))}${t(' 月，', ', ')}${peak.count}${t(' 篇', peak.count === 1 ? ' post' : ' posts')}`
    return `<figure class="index-density" role="img" aria-label="${escapeHtmlAttribute(summary)}" style="--months:${buckets.length}"><div class="index-density__bars">${bars}</div><div class="index-density__axis" aria-hidden="true">${axis}</div></figure>`
}
