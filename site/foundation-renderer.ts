import { createTranslator, type Translator } from '../packages/config/src/i18n.js'
import path from 'node:path'
import { existsSync } from 'node:fs'
import type { TiO2Project } from '../packages/config/src/index.js'
import { findPageRoute, pageRoute, readPageMeta, readPageTitle } from './page-renderer'
import { libraryIdentity } from './render-helpers'
import type MarkdownIt from 'markdown-it'
import {
    createFoundationAtlas,
    createFoundationPageData,
    createFoundationTargetId,
    foundationAtlasColor,
    foundationAtlasWings,
    FOUNDATION_KIND_ENGLISH,
    FOUNDATION_KINDS,
    FOUNDATION_KIND_LABELS,
    type FoundationAtlas,
    type FoundationCollection,
    type FoundationDependencyDepth,
    type FoundationEntry,
    type FoundationPageRuntimeData,
    type FoundationRelationField,
    type FoundationRelationGraph,
    type FoundationRoute
} from '../packages/content-core/src/index'
import type { loadSiteContent } from '../packages/content-fs/src/index'
import { readMarkdownSource } from '../packages/content-fs/src/markdown-source'
import { escapeHtmlAttribute, escapeHtmlText, renderInlineMath } from '../.vitepress/theme/markdownRendering'
import { renderBacklinksPanel, renderDocument, type ClientAssets } from './site-renderer'

type SiteContent = Awaited<ReturnType<typeof loadSiteContent>>

const FOUNDATION_ENTRY_DIRECTION_CONTRACT = `<!--
THESIS: A concept page that shows where the concept stands before it says what the concept is.
OWN-WORLD: Paper White and Reading Black, one Index Blue thread, Noto Serif SC, flat ruled surfaces; the thread marks the path, the formal statement and the reader's progress.
STORY: See what the concept rests on and what follows from it, read the always-visible formal statement, continue along a learning route, then explore the relationship graph.
FIRST VIEWPORT: Title and truthful ledger beside the local path (prerequisites, this entry, successors); the formal statement begins below.
FORM: Path header → Reading → Continuation → Relationships.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`
/** Library pages cross-fade into each other where the browser supports it; other pages are unaffected. */
const FOUNDATION_VIEW_TRANSITION =
    '<style>@media (prefers-reduced-motion: no-preference){@view-transition{navigation:auto}}</style>'
const DISCLOSURE_MARKER = '<span class="foundation-disclosure-marker" aria-hidden="true"></span>'
const DEFAULT_FOUNDATION_GRAPH_HOPS = 2
const graphRelations = (t: Translator): Array<{ field: FoundationRelationField; label: string }> => [
    { field: 'requires', label: t('依赖', 'Dependencies') },
    { field: 'special_case_of', label: t('分类', 'Classification') },
    { field: 'uses', label: t('使用', 'Use') },
    { field: 'implemented_by', label: t('实现', 'Implementation') },
    { field: 'equivalent_to', label: t('等价', 'Equivalence') },
    { field: 'contrasts_with', label: t('对比', 'Contrast') }
]

export async function renderFoundationPage(
    project: TiO2Project,
    content: SiteContent,
    entry: FoundationEntry,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const source = await readMarkdownSource(path.join(project.rootDir, entry.sourcePath))
    const foundation = createFoundationPageData(content.foundations, entry.id)
    if (!foundation) throw new Error(`Missing Foundation page data for ${entry.id}`)

    const bodyHtml = markdown.render(source.content, {
        relativePath: entry.sourcePath,
        referenceRenderMode: 'static-html'
    })
    const targetId = createFoundationTargetId(entry.id)
    const backlinks = content.references.backlinksByTargetId[targetId] ?? []
    const sourcePageClass = `_${entry.sourcePath.replace(/\.md$/u, '').replace(/\//g, '_')}`
    const mapTitle =
        findPageRoute(project, content, 'foundations-map') && entry.kind !== 'navigation'
            ? await readPageTitle(project, 'foundations-map')
            : ''
    const atlasLink = mapTitle
        ? {
              href: `${pageRoute(project, 'foundations-map')}#concept=${entry.id}`,
              label: t(`在全库的${mapTitle}中查看此概念`, `See this concept in the ${mapTitle}`)
          }
        : undefined
    const dependentCounts = foundationDependentCounts(content.foundations)
    const header = renderFoundationHeader(
        t,
        libraryIdentity(project).title,
        findPageRoute(project, content, 'foundations'),
        entry,
        content.foundations.groups,
        markdown,
        renderFoundationPath(t, foundation, markdown, (id) => dependentCounts.get(id) ?? 0)
    )

    return renderDocument(project, {
        title: entry.title,
        description: entry.description,
        canonicalPath: entry.regularPath,
        clientAssets,
        pageClass: 'foundation-entry-page',
        bodyPrelude: FOUNDATION_ENTRY_DIRECTION_CONTRACT,
        head: FOUNDATION_VIEW_TRANSITION,
        content: `<section class="foundation-entry" data-foundation-entry-page>${renderFoundationRouteBar(t, foundation)}${header}<main class="foundation-entry__article main" aria-label="${t('条目正文', 'Entry content')}"><div class="vp-doc foundation-entry__document ${escapeHtmlAttribute(sourcePageClass)}"><div>${bodyHtml}</div></div>${renderFoundationReadingRoutes(t, foundation, markdown)}</main>${renderFoundationRelations(t, foundation, markdown, atlasLink)}${renderBacklinksPanel(t, targetId, backlinks, markdown)}</section>`
    })
}

const dependentCountCache = new WeakMap<FoundationCollection, Map<string, number>>()

/** How many entries list each entry as a direct prerequisite. */
function foundationDependentCounts(collection: FoundationCollection) {
    let counts = dependentCountCache.get(collection)
    if (!counts) {
        counts = new Map()
        for (const entry of collection.entries) {
            for (const requiredId of entry.requires) counts.set(requiredId, (counts.get(requiredId) ?? 0) + 1)
        }
        dependentCountCache.set(collection, counts)
    }
    return counts
}

export async function renderFoundationsIndex(
    project: TiO2Project,
    collection: FoundationCollection,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const { sourcePath, title: pageTitle, description: pageDescription } = await readPageMeta(project, 'foundations')
    const dependentCounts = foundationDependentCounts(collection)
    const atlas = createFoundationAtlas(collection)
    const atlasNodes = new Map(atlas.nodes.map((node) => [node.id, node]))
    const atlasDomains = new Map(atlas.domains.map((domain) => [domain.id, domain]))

    const routesIndex = existsSync(path.join(project.rootDir, project.config.content.pagesDir, 'foundations-routes.md'))
        ? pageRoute(project, 'foundations-routes')
        : ''
    const routes = renderFoundationRoutes(t, collection, markdown, routesIndex)

    const kindButtons = [
        `<button type="button" aria-pressed="true" data-foundation-kind="all">${t('全部', 'All')}<small>${collection.entryCount}</small></button>`,
        ...FOUNDATION_KINDS.flatMap((kind) => {
            const count = collection.entries.filter((entry) => entry.kind === kind).length
            return count
                ? [
                      `<button type="button" aria-pressed="false" data-foundation-kind="${escapeHtmlAttribute(kind)}">${escapeHtmlText(t(FOUNDATION_KIND_LABELS[kind], FOUNDATION_KIND_ENGLISH[kind]))}<small>${count}</small></button>`
                  ]
                : []
        })
    ].join('')

    const domainFilter = `<label class="foundations-domain-filter">${t('学科', 'Subject')}<select name="domain" data-foundation-domain-filter><option value="all">${t('全部学科', 'All subjects')}</option>${collection.groups
        .map(
            (group) =>
                `<optgroup label="${escapeHtmlAttribute(group.title)}">${group.domains.map((domain) => `<option value="${escapeHtmlAttribute(domain.id)}">${escapeHtmlText(domain.title)}</option>`).join('')}</optgroup>`
        )
        .join('')}</select></label>`

    const library = libraryIdentity(project)
    const mapTitle = existsSync(path.join(project.rootDir, project.config.content.pagesDir, 'foundations-map.md'))
        ? await readPageTitle(project, 'foundations-map')
        : ''
    const mapRoute = mapTitle ? pageRoute(project, 'foundations-map') : ''
    const atlasLink = mapTitle
        ? `<a class="foundations-atlas-link" href="${escapeHtmlAttribute(mapRoute)}">${escapeHtmlText(t(`打开${mapTitle}`, `Open the ${mapTitle}`))}</a>`
        : ''
    // The display band carries the library's Latin name; without one it repeats the page title.
    const lettering = escapeHtmlText(library.englishTitle || pageTitle)
    const subtitle = library.subtitle
        ? `<p class="foundations-intro__subtitle">${renderInlineMath(markdown, library.subtitle)}</p>`
        : ''
    const lead = `<p class="foundations-intro__lead">${renderInlineMath(markdown, pageDescription)}</p>`

    const domainCount = collection.groups.reduce((count, group) => count + group.domains.length, 0)
    const memberCounts = new Map(
        collection.groups.flatMap((group) =>
            group.domains.map((domain) => [
                domain.id,
                collection.entries.filter((entry) => entry.domains.includes(domain.id)).length
            ])
        )
    )
    const catalog = collection.groups
        .map((group) => {
            const groupEntries = collection.entries.filter((entry) =>
                entry.domains.some((id) => group.domains.some((domain) => domain.id === id))
            )
            const domains = group.domains
                .map((domain) => {
                    const entries = collection.entries.filter((entry) => entry.domains.includes(domain.id))
                    const estimatedBlockSize = 4 + entries.length * 5.5
                    const estimatedMobileBlockSize = 4 + entries.length * 8
                    const entryList = entries
                        .map((entry) => {
                            // A concept sits on the dial once, under its first subject.
                            const node = entry.domains[0] === domain.id ? atlasNodes.get(entry.id) : undefined
                            return renderFoundationIndexEntry(
                                t,
                                entry,
                                dependentCounts.get(entry.id) ?? 0,
                                markdown,
                                node ? `${Math.round(node.x)},${Math.round(node.y)},${dialWeight(node.degree)}` : ''
                            )
                        })
                        .join('')
                    const hue = atlasDomains.get(domain.id)?.hue
                    const subject =
                        hue === undefined
                            ? ''
                            : `--foundation-subject:${foundationAtlasColor(hue, 'light')};--foundation-subject-dark:${foundationAtlasColor(hue, 'dark')};`

                    return `<details id="domain-${escapeHtmlAttribute(domain.id.replaceAll('/', '-'))}" class="foundations-domain" name="foundation-domain" data-foundation-domain="${escapeHtmlAttribute(domain.id)}" style="${subject}--foundation-domain-estimated-size:${estimatedBlockSize}rem;--foundation-domain-estimated-size-mobile:${estimatedMobileBlockSize}rem"><summary class="foundations-domain__header"><i class="foundations-domain__key" aria-hidden="true"></i><h3>${renderInlineMath(markdown, domain.title)}</h3><p>${renderInlineMath(markdown, domain.description)}</p><span class="foundations-domain__count" data-foundation-domain-count>${entries.length}</span>${DISCLOSURE_MARKER}</summary><ol class="foundations-entry-list">${entryList}</ol></details>`
                })
                .join('')

            return `<section class="foundations-group" data-foundation-group="${escapeHtmlAttribute(group.id)}"><header class="foundations-group__header"><div><p lang="en">${escapeHtmlText(group.englishTitle)}</p><h2>${renderInlineMath(markdown, group.title)}</h2></div><span data-foundation-group-count>${groupEntries.length}${t(' 条', groupEntries.length === 1 ? ' entry' : ' entries')}</span></header><p class="foundations-group__description">${renderInlineMath(markdown, group.description)}</p>${domains}</section>`
        })
        .join('')

    const directory = `<section class="foundations-directory" data-foundation-directory aria-labelledby="foundations-directory-title"><header class="foundations-section-header"><h2 id="foundations-directory-title">${t('按学科浏览', 'Browse by subject')}</h2><p>${domainCount}${t(' 个学科', domainCount === 1 ? ' subject' : ' subjects')}</p></header><div class="foundations-directory__body">${renderFoundationDial(t, atlas, memberCounts, mapTitle, mapRoute, markdown)}<div id="foundations-catalog" class="foundations-catalog">${catalog}</div></div></section>`
    const results = `<section class="foundations-results" id="foundation-results" data-foundation-results hidden aria-label="${t('检索结果', 'Search results')}"><ol class="foundations-entry-list foundations-result-list"></ol><button type="button" data-foundation-more hidden></button><section class="foundations-empty" hidden><h2>${t('没有匹配的条目', 'No matching entries')}</h2><p>${t('换一个关键词或清除类型、学科筛选，再从目录继续浏览。', 'Try another keyword or clear the type and subject filters to browse all entries.')}</p><button type="button" data-foundation-clear>${t('查看全部条目', 'View all entries')}</button></section></section>`

    const page = `<section class="foundations-page"><header class="foundations-intro"><div class="foundations-intro__copy"><h1>${renderInlineMath(markdown, pageTitle, sourcePath)}</h1>${subtitle}${lead}${atlasLink}</div><div class="foundations-marquee" aria-hidden="true"><div class="foundations-marquee__track"><span class="foundations-marquee__item"><span class="foundations-marquee__word">${lettering}</span></span><span class="foundations-marquee__item"><span class="foundations-marquee__word">${lettering}</span></span></div></div>${renderFoundationLife(t)}</header><nav class="foundations-shortcuts" aria-label="${t('知识库入口', 'Library navigation')}"><a href="#foundation-search">${t('查概念', 'Find a concept')}</a><a href="#foundations-directory-title">${t('按学科浏览', 'Browse subjects')}</a><a href="#foundation-routes-title">${t('从问题开始', 'Start with a question')}</a></nav><form class="foundations-tools" role="search"><label class="visually-hidden" for="foundation-search">${t('查找概念、别名或描述', 'Find concepts, aliases or descriptions')}</label><div class="foundations-search-row"><input id="foundation-search" type="search" name="q" autocomplete="off" placeholder="${t('查一个概念：谱定理、NP 完全性、Paxos、Bayes……', 'Find a concept, alias or keyword…')}" aria-controls="foundation-results" value=""><button type="button" data-foundation-clear hidden>${t('清除筛选', 'Clear filters')}</button></div><div class="foundations-kind-filter" aria-label="${t('按条目类型筛选', 'Filter by entry type')}">${kindButtons}</div>${domainFilter}<p class="foundations-result-count" role="status" aria-live="polite">${t('共 ', 'Total: ')}${collection.entryCount}${t(' 个概念条目', collection.entryCount === 1 ? ' entry' : ' entries')}</p></form>${results}${directory}${routes}</section>`

    return renderDocument(project, {
        title: pageTitle,
        description: pageDescription,
        canonicalPath: pageRoute(project, 'foundations'),
        clientAssets,
        head: FOUNDATION_VIEW_TRANSITION,
        content: `<main class="main"><div class="vp-doc _pages_foundations" style="position:relative"><div>${page}</div></div></main><footer class="VPDocFooter"></footer>`
    })
}

export async function renderFoundationRoutesPage(
    project: TiO2Project,
    collection: FoundationCollection,
    markdown: MarkdownIt,
    clientAssets: ClientAssets
) {
    const t = createTranslator(project.config.site.language)
    const page = await readPageMeta(project, 'foundations-routes')
    const libraryRoute = existsSync(path.join(project.rootDir, project.config.content.pagesDir, 'foundations.md'))
        ? pageRoute(project, 'foundations')
        : ''
    return renderDocument(project, {
        title: page.title,
        description: page.description,
        canonicalPath: page.route,
        clientAssets,
        head: FOUNDATION_VIEW_TRANSITION,
        content: `<main class="main"><div class="vp-doc _pages_foundations"><section class="foundations-page foundations-route-index"><header class="foundations-route-index__header">${libraryRoute ? `<a href="${escapeHtmlAttribute(libraryRoute)}">${escapeHtmlText(t(`返回${libraryIdentity(project).title}`, `Back to ${libraryIdentity(project).title}`))}</a>` : ''}<h1>${renderInlineMath(markdown, page.title)}</h1><p>${renderInlineMath(markdown, page.description)}</p></header>${renderFoundationRoutes(t, collection, markdown)}</section></div></main>`
    })
}

function renderFoundationRoutes(t: Translator, collection: FoundationCollection, markdown: MarkdownIt, indexHref = '') {
    const entryById = new Map(collection.entries.map((entry) => [entry.id, entry]))
    const featuredCount = collection.routes.filter((route) => route.featured).length
    const featuredRoutes: string[] = []
    const moreRoutes: string[] = []
    for (const route of collection.routes) {
        if (indexHref && !route.featured) continue
        const stations = route.entries.flatMap((id) => {
            const entry = entryById.get(id)
            return entry ? [entry] : []
        })
        const featured = route.featured === true
        // Featured routes are numbered first so the "all" view reads as one continuous list.
        const position = featured ? featuredRoutes.length + 1 : featuredCount + moreRoutes.length + 1
        const list = featured ? featuredRoutes : moreRoutes
        // The first featured route starts unfolded so the station line explains every other row.
        list.push(renderFoundationRoute(t, route, stations, position, featured && !featuredRoutes.length, markdown))
    }
    const moreRoutesDisclosure = moreRoutes.length
        ? `<details class="foundation-routes__more" open><summary>${t('更多学习路线（', 'More learning routes (')}${moreRoutes.length}${t(' 条）', ')')}</summary><ol class="foundation-routes__list">${moreRoutes.join('')}</ol></details>`
        : ''

    const routeFilters = indexHref
        ? ''
        : [
              ['featured', `${t('精选 ', 'Featured ')}${featuredRoutes.length}`],
              ['core', t('核心', 'Core')],
              ['advanced', t('进阶', 'Advanced')],
              ['all', `${t('全部 ', 'All ')}${collection.routes.length}`]
          ]
              .map(
                  ([key, label]) =>
                      `<button type="button" aria-pressed="${key === 'all'}" data-route-filter="${key}">${label}</button>`
              )
              .join('')

    const allRoutesLink = indexHref
        ? `<a class="foundation-routes__index-link" href="${escapeHtmlAttribute(indexHref)}">${t(`查看全部 ${collection.routes.length} 条学习路线`, `Browse all ${collection.routes.length} learning routes`)}</a>`
        : ''
    return `<section class="foundation-routes" aria-labelledby="foundation-routes-title"><header class="foundations-section-header foundation-routes__header"><h2 id="foundation-routes-title">${t('从一个问题开始', 'Start with a question')}</h2><div class="foundation-routes__filter" role="group" aria-label="${t('筛选学习路线', 'Filter learning routes')}" data-route-filters hidden>${routeFilters}</div></header><ol class="foundation-routes__list">${featuredRoutes.join('')}</ol>${moreRoutesDisclosure}${allRoutesLink}</section>`
}

/** Dot size on the miniature dial follows connectivity, as on the complete map. */
function dialWeight(degree: number) {
    return degree >= 25 ? 3 : degree >= 12 ? 2 : degree >= 5 ? 1 : 0
}

/**
 * The complete map in miniature: every concept at its true position, one hue per subject.
 * Positions travel on the catalogue rows; pointing at an entry locates it on the dial.
 */
function renderFoundationDial(
    t: Translator,
    atlas: FoundationAtlas,
    memberCounts: Map<string, number>,
    mapTitle: string,
    mapRoute: string,
    markdown: MarkdownIt
) {
    const number = (value: number) => value.toLocaleString('en')
    const data = {
        radius: atlas.radius,
        hub: atlas.rings[0] ?? atlas.radius,
        rings: atlas.rings,
        domains: atlas.domains.map(({ id, title, start, end, hue }) => ({
            id,
            title,
            // The directory lists every entry of a subject, so the dial quotes the same figure.
            count: memberCounts.get(id) ?? 0,
            start,
            end,
            light: foundationAtlasColor(hue, 'light'),
            dark: foundationAtlasColor(hue, 'dark')
        }))
    }
    const best = (nodes: FoundationAtlas['nodes']) =>
        [...nodes]
            .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
            .slice(0, 5)
            .map(
                (node) =>
                    `<li><a href="${escapeHtmlAttribute(node.href)}">${renderInlineMath(markdown, node.title)}</a><small>${node.degree}</small></li>`
            )
            .join('')
    const subjects = foundationAtlasWings(atlas).flatMap(({ domains }) => domains)
    const leaders = [
        `<ol data-dial-top="">${best(atlas.nodes)}</ol>`,
        ...subjects.map(
            (domain) =>
                `<ol data-dial-top="${escapeHtmlAttribute(domain.id)}" hidden>${best(atlas.nodes.filter((node) => node.domains[0] === domain.id))}</ol>`
        )
    ].join('')
    const facts = [
        [t('关系', 'Relations'), number(atlas.edges.length)],
        [t('跨学科', 'Cross-subject'), number(atlas.edges.filter((edge) => edge.crossDomain).length)],
        [t('最深前置链', 'Deepest chain'), number(Math.max(0, atlas.rings.length - 2))]
    ]
        .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
        .join('')
    const mapLink = mapTitle
        ? `<a class="foundations-dial__map" href="${escapeHtmlAttribute(mapRoute)}">${escapeHtmlText(t(`在${mapTitle}中展开全部关系`, `Explore every relation in the ${mapTitle}`))}</a>`
        : ''

    return `<aside class="foundations-dial" data-foundation-dial aria-label="${t('学科星盘', 'Subject dial')}"><div class="foundations-dial__stage" data-dial-stage hidden></div><p class="foundations-dial__caption" data-dial-caption hidden><strong data-dial-title>${subjects.length}${t(' 个学科', subjects.length === 1 ? ' subject' : ' subjects')}</strong><span data-dial-note>${t('角度是学科，半径是前置深度', 'Angle: subject · radius: prerequisite depth')}</span></p><dl class="foundations-dial__facts">${facts}</dl><div class="foundations-dial__leaders"><p>${t('关系最多的概念', 'Best-connected concepts')}</p>${leaders}</div>${mapLink}<script type="application/json" data-dial-data>${serializeJsonForHtml(data)}</script></aside>`
}

function renderFoundationRoute(
    t: Translator,
    route: FoundationRoute,
    stations: FoundationEntry[],
    position: number,
    open: boolean,
    markdown: MarkdownIt
) {
    const title = (entry: FoundationEntry) => renderInlineMath(markdown, entry.title, entry.sourcePath)
    const path = stations
        .map(
            (entry) =>
                `<li><a href="${escapeHtmlAttribute(readingRouteHref(entry.regularPath, route.id))}">${title(entry)}</a></li>`
        )
        .join('')
    // The promise may end with a self-test; both unfold together with the station line.
    const [summary, selfTest] = route.promise.split(/(?:终点)?自测：|Self-test:/iu)
    const notes = `<div class="foundation-route__notes"><p>${renderInlineMath(markdown, summary.trim())}</p>${selfTest ? `<p><strong>${t('自测', 'Self-test')}</strong>${renderInlineMath(markdown, selfTest.trim())}</p>` : ''}<p class="foundation-route__audience">${t('适合：', 'For: ')}${renderInlineMath(markdown, route.audience)}</p></div>`
    const start = stations[0]
        ? `<a class="foundation-route__start" href="${escapeHtmlAttribute(readingRouteHref(stations[0].regularPath, route.id))}">${t('从第 1 站开始', 'Start at the first stop')}</a>`
        : ''
    const capstone = route.capstoneHref
        ? `<a class="foundation-route__start foundation-route__capstone" href="${escapeHtmlAttribute(route.capstoneHref)}">${t('单元练习与解答', 'Exercises and worked answers')}</a>`
        : ''
    // Folded, a route shows where it starts, where it ends and how many stops lie between.
    const span =
        stations.length > 1
            ? `<span class="foundation-route__span" aria-hidden="true"><span>${title(stations[0])}</span><i style="--stops:${stations.length}"></i><span>${title(stations.at(-1)!)}</span></span>`
            : ''
    return `<li id="${escapeHtmlAttribute(route.id)}" class="foundation-route" data-route-type="${route.type}"${route.featured === true ? ' data-featured' : ''}><details name="foundation-route"${open ? ' open' : ''}><summary><span class="foundation-route__index" aria-hidden="true">${String(position).padStart(2, '0')}</span><span class="foundation-route__heading"><h3>${renderInlineMath(markdown, route.title)}</h3><span class="foundation-route__badge">${route.type === 'core' ? t('核心', 'Core') : t('进阶', 'Advanced')}</span></span><span class="foundation-route__length">${stations.length}${t(' 站', stations.length === 1 ? ' stop' : ' stops')}</span>${DISCLOSURE_MARKER}${span}</summary><div class="foundation-route__body"><ol class="foundation-route__path" aria-label="${escapeHtmlAttribute(t(`${route.title}阅读顺序`, `${route.title} reading order`))}">${path}</ol>${notes}<footer>${start}${capstone}</footer></div></details></li>`
}

function renderFoundationHeader(
    t: Translator,
    libraryTitle: string,
    libraryRoute: string | undefined,
    entry: FoundationEntry,
    groups: FoundationCollection['groups'],
    markdown: MarkdownIt,
    pathHtml = ''
) {
    const domainById = new Map(groups.flatMap((group) => group.domains.map((domain) => [domain.id, domain])))
    const domains = entry.domains.flatMap((id) => {
        const domain = domainById.get(id)
        return domain ? [domain] : []
    })
    const group = groups.find((candidate) => candidate.domains.some((domain) => domain.id === domains[0]?.id))
    // The breadcrumb carries the library, the discipline and every domain index that lists this entry.
    const trail = [
        libraryRoute
            ? `<a class="foundation-header__library" href="${escapeHtmlAttribute(libraryRoute)}">${escapeHtmlText(libraryTitle)}</a>`
            : `<span class="foundation-header__library">${escapeHtmlText(libraryTitle)}</span>`,
        ...(group ? [`<span>${escapeHtmlText(group.title)}</span>`] : []),
        domains
            .map((domain) =>
                libraryRoute
                    ? `<a class="foundation-header__domain" href="${escapeHtmlAttribute(libraryRoute)}#domain-${escapeHtmlAttribute(domain.id.replaceAll('/', '-'))}">${escapeHtmlText(domain.title)}</a>`
                    : `<span class="foundation-header__domain">${escapeHtmlText(domain.title)}</span>`
            )
            .join('<span aria-hidden="true">·</span>')
    ]
        .filter(Boolean)
        .join('<span aria-hidden="true">/</span>')
    const aliases = entry.aliases.length
        ? `<p class="foundation-header__aliases">${entry.kind === 'navigation' ? t('检索别名：', 'Search aliases: ') : ''}${entry.aliases.map((alias) => renderInlineMath(markdown, alias, entry.sourcePath)).join(' · ')}</p>`
        : ''
    const titleLength = Array.from(entry.title).length
    const titleClass =
        titleLength > 28
            ? ' foundation-header--very-long-title'
            : titleLength > 18
              ? ' foundation-header--long-title'
              : ''

    return `<header class="foundation-header${titleClass}${pathHtml ? ' foundation-header--with-path' : ''}"><div class="foundation-header__primary"><nav class="foundation-header__context" aria-label="${t('面包屑', 'Breadcrumb')}">${trail}</nav><p class="foundation-header__kind">${escapeHtmlText(t(FOUNDATION_KIND_LABELS[entry.kind], FOUNDATION_KIND_ENGLISH[entry.kind]))}${t(`<span lang="en">${FOUNDATION_KIND_ENGLISH[entry.kind]}</span>`, '')}</p><h1 class="foundation-header__title">${renderInlineMath(markdown, entry.title, entry.sourcePath)}</h1>${aliases}<p class="foundation-header__description">${renderInlineMath(markdown, entry.description, entry.sourcePath)}</p></div>${pathHtml}</header>`
}

const PATH_ROW_HEIGHT = 30
const PATH_ROWS = 5

/**
 * The entry's own stretch of the path: what it rests on, itself, and what follows from it.
 * Each row is a link; the threads only repeat in line what the two lists already say.
 */
export function renderFoundationPath(
    t: Translator,
    foundation: FoundationPageRuntimeData,
    markdown: MarkdownIt,
    weight: (id: string) => number = () => 0
) {
    const { current, prerequisites, dependents } = foundation
    if (current.kind === 'navigation' || (!prerequisites.length && !dependents.length)) return ''

    const shown = (entries: FoundationEntry[]) =>
        entries.slice(0, entries.length > PATH_ROWS ? PATH_ROWS - 1 : PATH_ROWS)
    const before = shown(prerequisites)
    // Successors that carry the most further entries read as the main roads onward.
    const after = shown([...dependents].sort((a, b) => weight(b.id) - weight(a.id)))
    const rows = (entries: FoundationEntry[], total: number) =>
        Math.max(1, entries.length + (total > entries.length ? 1 : 0))
    const beforeRows = rows(before, prerequisites.length)
    const afterRows = rows(after, dependents.length)
    const height = Math.max(beforeRows, afterRows) * PATH_ROW_HEIGHT
    const middle = height / 2
    const rowY = (index: number, count: number) =>
        (height - count * PATH_ROW_HEIGHT) / 2 + (index + 0.5) * PATH_ROW_HEIGHT
    const curves = [
        ...Array.from({ length: prerequisites.length ? beforeRows : 0 }, (_, index) => {
            const y = rowY(index, beforeRows)
            return `<path data-side="before" data-row="${index + 1}"${index >= before.length ? ' data-more' : ''} pathLength="1" d="M0 ${y}C24 ${y} 20 ${middle} 42 ${middle}"/>`
        }),
        ...Array.from({ length: dependents.length ? afterRows : 0 }, (_, index) => {
            const y = rowY(index, afterRows)
            return `<path data-side="after" data-row="${index + 1}"${index >= after.length ? ' data-more' : ''} pathLength="1" d="M58 ${middle}C80 ${middle} 76 ${y} 100 ${y}"/>`
        })
    ].join('')
    const side = (
        key: 'before' | 'after',
        label: string,
        entries: FoundationEntry[],
        total: number,
        emptyMessage: string,
        moreLabel: (rest: number) => string
    ) => {
        const rest = total - entries.length
        const items = entries
            .map(
                (entry) =>
                    `<li><a href="${escapeHtmlAttribute(entry.regularPath)}">${renderInlineMath(markdown, entry.title, entry.sourcePath)}</a></li>`
            )
            .join('')
        const more = rest
            ? `<li><a class="foundation-path__more" href="#foundation-relations-title" aria-label="${escapeHtmlAttribute(moreLabel(rest))}">${t('另 ', '+')}${rest}${t(' 项', ' more')}</a></li>`
            : ''
        const body = total
            ? `<ol>${items}${more}</ol>`
            : `<p class="foundation-path__empty">${escapeHtmlText(emptyMessage)}</p>`
        return `<div class="foundation-path__side" data-side="${key}"><p class="foundation-path__label">${label}${total ? `<small>${total}</small>` : ''}</p>${body}</div>`
    }

    return `<nav class="foundation-path" aria-label="${t('概念位置', 'Position of this concept')}" style="--foundation-path-height:${height}px">${side(
        'before',
        t('直接前置', 'Prerequisites'),
        before,
        prerequisites.length,
        t('无需前置', 'No prerequisites'),
        (rest) =>
            `${t('查看其他 ', 'View other ')}${rest}${t(' 个直接前置', rest === 1 ? ' direct prerequisite' : ' direct prerequisites')}`
    )}<div class="foundation-path__thread" aria-hidden="true"><svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" focusable="false">${curves}</svg><span class="foundation-path__node"></span></div>${side(
        'after',
        t('直接后续', 'Direct dependents'),
        after,
        dependents.length,
        t('暂未收录', 'None yet'),
        (rest) =>
            `${t('查看其他 ', 'View other ')}${rest}${t(' 个直接后续', rest === 1 ? ' direct dependent' : ' direct dependents')}`
    )}</nav>`
}

function readingRouteHref(path: string, routeId: string) {
    const url = new URL(path, 'https://foundation.invalid')
    url.searchParams.set('route', routeId)
    return `${url.pathname}${url.search}${url.hash}`
}

/** Shown only once a route is chosen; the client fills it from that route's panel below the text. */
function renderFoundationRouteBar(t: Translator, foundation: FoundationPageRuntimeData) {
    if (!foundation.readingRoutes.length) return ''
    return `<nav class="foundation-route-bar" data-foundation-route-bar hidden aria-label="${t('当前学习路线', 'Current learning route')}"><span class="foundation-route-bar__label">${t('学习路线', 'Learning route')}</span><a class="foundation-route-bar__title" data-foundation-route-bar-title href="#foundation-reading-routes"></a><span class="foundation-route-bar__position" data-foundation-route-bar-position></span><span class="foundation-route-bar__track"><i></i></span><a class="foundation-route-bar__step" data-foundation-route-bar-step="previous" hidden><span>${t('上一站', 'Previous stop')}</span><strong></strong></a><a class="foundation-route-bar__step" data-foundation-route-bar-step="next" hidden><span>${t('下一站', 'Next stop')}</span><strong></strong></a></nav>`
}

/** Every learning route through this entry, each with its own previous and next stop. */
export function renderFoundationReadingRoutes(
    t: Translator,
    foundation: FoundationPageRuntimeData,
    markdown: MarkdownIt
) {
    const { current, readingRoutes } = foundation
    if (!readingRoutes.length) return ''
    const choices = readingRoutes
        .map(
            (route) =>
                `<li><a data-foundation-route-choice="${escapeHtmlAttribute(route.id)}" href="${escapeHtmlAttribute(readingRouteHref(current.regularPath, route.id))}#foundation-reading-routes">${renderInlineMath(markdown, route.title)}</a></li>`
        )
        .join('')
    const panels = readingRoutes
        .map((route) => {
            const stopLink = (entry: FoundationEntry, step: 'previous' | 'next', label: string) =>
                `<a data-foundation-route-step="${step}" href="${escapeHtmlAttribute(readingRouteHref(entry.regularPath, route.id))}"><span>${label}</span>${renderInlineMath(markdown, entry.title, entry.sourcePath)}</a>`
            const previous = route.previous
                ? stopLink(route.previous, 'previous', t('上一站', 'Previous stop'))
                : `<p>${t('路线起点', 'First stop')}</p>`
            const next = route.next
                ? stopLink(route.next, 'next', t('下一站', 'Next stop'))
                : `<p data-foundation-route-end>${t('已到本路线终点', 'End of this route')}</p>`
            const capstone =
                !route.next && route.capstoneHref
                    ? `<a class="foundation-reading-routes__capstone" href="${escapeHtmlAttribute(route.capstoneHref)}">${t('单元练习与解答', 'Exercises and worked answers')}</a>`
                    : ''
            return `<details data-foundation-route-panel="${escapeHtmlAttribute(route.id)}" data-foundation-route-paths="${escapeHtmlAttribute(JSON.stringify(route.entryPaths))}" style="--foundation-route-progress:${(route.position / route.total).toFixed(3)}"${readingRoutes.length === 1 ? ' open' : ''}><summary><strong>${renderInlineMath(markdown, route.title)}</strong>${DISCLOSURE_MARKER}<span class="foundation-reading-routes__position">${t(`第 ${route.position} / ${route.total} 站`, `Stop ${route.position} of ${route.total}`)}</span><span class="foundation-reading-routes__track" aria-hidden="true"><i></i></span></summary><div class="foundation-reading-routes__stops">${previous}${next}${capstone}</div></details>`
        })
        .join('')
    return `<nav id="foundation-reading-routes" class="foundation-reading-routes" data-foundation-reading-routes aria-labelledby="foundation-reading-routes-title"><h2 id="foundation-reading-routes-title" class="foundation-reading-routes__title">${t('沿学习路线继续', 'Continue along a learning route')}<small>${readingRoutes.length}</small></h2>${readingRoutes.length > 1 ? `<p data-foundation-route-prompt>${t('选择一条阅读路线；每条路线的前后站点分别列在下方。', 'Choose a reading route. Each route’s previous and next stops are listed below.')}</p>` : ''}<p data-foundation-route-invalid hidden role="status">${t('链接中的路线不包含本条目，请重新选择。', 'The linked route does not contain this entry. Choose a route below.')}</p><details data-foundation-route-choices hidden><summary><span>${t('选择阅读路线', 'Choose a reading route')} (${readingRoutes.length})</span>${DISCLOSURE_MARKER}</summary><ul>${choices}</ul></details>${panels}<a data-foundation-route-clear hidden href="${escapeHtmlAttribute(current.regularPath)}#foundation-reading-routes">${t('查看全部路线', 'Show all routes')}</a></nav>`
}

export function renderFoundationRelations(
    t: Translator,
    foundation: FoundationPageRuntimeData,
    markdown: MarkdownIt,
    atlasLink?: { href: string; label: string }
) {
    if (foundation.current.kind === 'navigation') {
        return `<details class="foundation-relations foundation-relations--navigation" data-foundation-relations open><summary id="foundation-relations-title"><span class="foundation-relations__summary-copy"><strong role="heading" aria-level="2">${t('术语导航', 'Terminology guide')}</strong><small>${t('仅作分流', 'Navigation only')}</small></span>${DISCLOSURE_MARKER}</summary><div class="foundation-relations__body" aria-labelledby="foundation-relations-title"><p class="foundation-relations__note">${t('沿正文链接进入正式概念页；本页不参与六类关系。', 'Follow the links in this page to canonical concepts. This navigation page has no typed relations.')}</p></div></details>`
    }

    const graph = foundation.relationGraph
    const hasDependencyPath = graph.edges.some((edge) => edge.relation === 'requires')
    const hasGraphRelations = graph.edges.length > 0
    const relationCount = new Set(graph.edges.map((edge) => edge.relation)).size
    const graphSection = hasGraphRelations
        ? `<section class="foundation-graph" data-foundation-graph data-foundation-graph-hops="${DEFAULT_FOUNDATION_GRAPH_HOPS}" aria-labelledby="foundation-graph-description"><div class="foundation-graph__toolbar"><p id="foundation-graph-description">${t('拖动节点调整位置。', 'Drag nodes to adjust their positions.')}</p><div role="group" aria-label="${t('图谱视图控制', 'Graph controls')}" aria-controls="foundation-graph-canvas"><button type="button" data-foundation-graph-action="zoom-out">${t('缩小', 'Zoom out')}</button><button type="button" data-foundation-graph-action="layout">${t('重排', 'Rearrange')}</button><button type="button" data-foundation-graph-action="fit">${t('全图', 'Fit all')}</button><button type="button" data-foundation-graph-action="zoom-in">${t('放大', 'Zoom in')}</button></div></div>${renderGraphRelationFilters(t, graph)}<div id="foundation-graph-canvas" class="foundation-graph__stage" data-foundation-graph-canvas role="img" aria-label="${escapeHtmlAttribute(`${foundation.current.title}${t(' 的局部多关系图', ' — local relationship graph')}`)}"><p class="foundation-graph__status" data-foundation-graph-status role="status">${t('正在载入交互图谱…', 'Loading interactive graph…')}</p></div>${hasDependencyPath ? `<ol class="foundation-graph__legend" aria-label="${t('依赖关系层级', 'Dependency levels')}"><li data-depth="-3"><span aria-hidden="true"></span>${t('前置三跳', 'Prerequisites: 3 hops')}</li><li data-depth="-2"><span aria-hidden="true"></span>${t('前置二跳', 'Prerequisites: 2 hops')}</li><li data-depth="-1"><span aria-hidden="true"></span>${t('前置一跳', 'Prerequisites: 1 hop')}</li><li data-depth="0"><span aria-hidden="true"></span>${t('当前条目', 'Current entry')}</li><li data-depth="1"><span aria-hidden="true"></span>${t('后续一跳', 'Dependents: 1 hop')}</li><li data-depth="2"><span aria-hidden="true"></span>${t('后续二跳', 'Dependents: 2 hops')}</li><li data-depth="3"><span aria-hidden="true"></span>${t('后续三跳', 'Dependents: 3 hops')}</li></ol>` : ''}<script type="application/json" data-foundation-graph-data>${serializeJsonForHtml(graph)}</script></section>${hasDependencyPath ? renderDependencyGraphFallback(t, graph, markdown) : ''}`
        : ''
    const summaryDetail = hasGraphRelations
        ? `${graph.nodes.length - 1}${t(' 个相邻概念 · ', graph.nodes.length - 1 === 1 ? ' neighboring concept · ' : ' neighboring concepts · ')}${relationCount}${t(' 类关系', relationCount === 1 ? ' relation type' : ' relation types')}`
        : t('暂无已标注关系', 'No relationships specified')
    const classification = renderClassificationRelations(t, foundation, markdown)
    const typedRelations = renderTypedRelations(t, foundation, markdown)
    const atlasNav = atlasLink
        ? `<nav class="foundation-atlas-entry-link"><a href="${escapeHtmlAttribute(atlasLink.href)}">${escapeHtmlText(atlasLink.label)}</a></nav>`
        : ''

    return `<details class="foundation-relations" data-foundation-relations open><summary id="foundation-relations-title"><span class="foundation-relations__summary-copy"><strong role="heading" aria-level="2">${t('关系图谱', 'Relationships')}</strong><small>${summaryDetail}</small></span>${DISCLOSURE_MARKER}</summary><div class="foundation-relations__body" aria-labelledby="foundation-relations-title">${graphSection}${classification}${typedRelations}${atlasNav}</div></details>`
}

function renderGraphRelationFilters(t: Translator, graph: FoundationRelationGraph) {
    const dependencyDepthById = new Map(graph.nodes.map((node) => [node.id, node.dependencyDepth]))
    const relationCounts = new Map<FoundationRelationField, number>()
    for (const edge of graph.edges) {
        const withinDefaultHops =
            edge.relation !== 'requires' ||
            Math.max(
                Math.abs(dependencyDepthById.get(edge.source) ?? 0),
                Math.abs(dependencyDepthById.get(edge.target) ?? 0)
            ) <= DEFAULT_FOUNDATION_GRAPH_HOPS
        if (!withinDefaultHops) continue
        relationCounts.set(edge.relation, (relationCounts.get(edge.relation) ?? 0) + 1)
    }
    const hasDependencyPath = graph.edges.some((edge) => edge.relation === 'requires')
    const defaultRelation = relationCounts.has('requires')
        ? 'requires'
        : graphRelations(t).find(({ field }) => relationCounts.has(field))?.field

    const controls = graphRelations(t)
        .map(({ field, label }) => {
            const count = relationCounts.get(field) ?? 0
            const checked = field === defaultRelation ? ' checked' : ''
            const disabled = count ? '' : ' disabled'
            return `<label data-relation="${escapeHtmlAttribute(field)}"><input type="checkbox" value="${escapeHtmlAttribute(field)}" data-foundation-graph-relation data-foundation-graph-relation-label="${escapeHtmlAttribute(label)}"${checked}${disabled}><span class="foundation-graph__relation-swatch" aria-hidden="true"></span><span>${escapeHtmlText(label)}</span><small data-foundation-graph-relation-count>${count}</small></label>`
        })
        .join('')
    const defaultLabel =
        graphRelations(t).find(({ field }) => field === defaultRelation)?.label ??
        t('未选择关系', 'No relation selected')

    return `<fieldset class="foundation-graph__relations"><legend>${t('显示关系', 'Show relations')}</legend><div class="foundation-graph__filter-row"><div class="foundation-graph__relation-options">${controls}</div><label class="foundation-graph__hops"><span>${t('依赖跳数', 'Dependency hops')}</span><select data-foundation-graph-hop-select aria-controls="foundation-graph-canvas"${hasDependencyPath ? '' : ' disabled'}><option value="1">${t('1 跳', '1 hop')}</option><option value="2" selected>${t('2 跳', '2 hops')}</option><option value="3">${t('3 跳', '3 hops')}</option></select></label></div><p data-foundation-graph-selection role="status" aria-live="polite">${t('显示：', 'Showing: ')}${escapeHtmlText(defaultLabel)}</p></fieldset>`
}

function renderDependencyGraphFallback(t: Translator, graph: FoundationRelationGraph, markdown: MarkdownIt) {
    const group = (id: string, label: string, depth: FoundationDependencyDepth, emptyMessage: string) => {
        const nodes = graph.nodes.filter((node) => node.dependencyDepth === depth)
        const content = nodes.length
            ? `<ul>${nodes.map((node) => renderDependencyGraphEntry(t, node, markdown)).join('')}</ul>`
            : `<p class="foundation-relations__empty">${escapeHtmlText(emptyMessage)}</p>`
        return `<section class="foundation-relations__group" aria-labelledby="${escapeHtmlAttribute(id)}"><p id="${escapeHtmlAttribute(id)}" class="foundation-relations__label">${escapeHtmlText(label)}</p>${content}</section>`
    }

    return `<details class="foundation-relations__section foundation-relations__text"><summary><span class="foundation-relations__section-heading"><strong id="foundation-dependency-text-title" role="heading" aria-level="3">${t('文字版关系', 'Relationships as text')}</strong><small>${t('按与当前条目的最短距离分组', 'Grouped by shortest distance from this entry')}</small></span>${DISCLOSURE_MARKER}</summary><nav class="foundation-relations__groups foundation-relations__groups--dependency" aria-labelledby="foundation-dependency-text-title">${group('foundation-upstream-three-title', t('前置三跳', 'Prerequisites: 3 hops'), -3, t('没有更早的前置节点。', 'No earlier prerequisites.'))}${group('foundation-upstream-two-title', t('前置二跳', 'Prerequisites: 2 hops'), -2, t('没有二跳前置节点。', 'No prerequisites at two hops.'))}${group('foundation-upstream-one-title', t('前置一跳', 'Prerequisites: 1 hop'), -1, t('暂未标注直接前置。', 'No direct prerequisites specified.'))}${group('foundation-downstream-one-title', t('后续一跳', 'Dependents: 1 hop'), 1, t('暂未收录直接后续。', 'No direct dependents yet.'))}${group('foundation-downstream-two-title', t('后续二跳', 'Dependents: 2 hops'), 2, t('没有二跳后续节点。', 'No dependents at two hops.'))}${group('foundation-downstream-three-title', t('后续三跳', 'Dependents: 3 hops'), 3, t('没有更远的后续节点。', 'No further dependents.'))}</nav></details>`
}

function renderDependencyGraphEntry(
    t: Translator,
    node: FoundationRelationGraph['nodes'][number],
    markdown: MarkdownIt
) {
    return `<li><a href="${escapeHtmlAttribute(node.href)}"><span>${renderInlineMath(markdown, node.title)}</span><small>${escapeHtmlText(t(FOUNDATION_KIND_LABELS[node.kind], FOUNDATION_KIND_ENGLISH[node.kind]))}</small></a></li>`
}

function renderClassificationRelations(t: Translator, foundation: FoundationPageRuntimeData, markdown: MarkdownIt) {
    const { broader, narrower } = foundation.classification
    if (!broader.length && !narrower.length) return ''

    return `<details class="foundation-relations__section"><summary><span class="foundation-relations__section-heading"><strong id="foundation-classification-title" role="heading" aria-level="3">${t('分类位置', 'Classification')}</strong></span>${DISCLOSURE_MARKER}</summary><div class="foundation-relations__groups">${renderRelationGroup(t, 'foundation-broader-title', t('上位 / 更一般', 'Broader concepts'), broader, markdown, t('暂未标注直接上位概念。', 'No broader concepts specified.'))}${renderRelationGroup(t, 'foundation-narrower-title', t('下位 / 直接特例', 'Direct special cases'), narrower, markdown, t('暂未标注直接特例。', 'No direct special cases specified.'))}</div></details>`
}

function renderTypedRelations(t: Translator, foundation: FoundationPageRuntimeData, markdown: MarkdownIt) {
    const groups = [
        ['foundation-uses-title', t('使用的工具', 'Tools used'), foundation.typedRelations.uses],
        ['foundation-used-by-title', t('被这些条目使用', 'Used by'), foundation.typedRelations.usedBy],
        ['foundation-implemented-by-title', t('具体实现', 'Implemented by'), foundation.typedRelations.implementedBy],
        ['foundation-implements-title', t('实现的抽象', 'Implements'), foundation.typedRelations.implements],
        [
            'foundation-equivalent-title',
            t('限定层次等价', 'Equivalent at the stated level'),
            foundation.typedRelations.equivalentTo
        ],
        ['foundation-contrasts-title', t('并列辨析', 'Contrasts with'), foundation.typedRelations.contrastsWith]
    ] as const
    const populatedGroups = groups.filter(([, , entries]) => entries.length)
    if (!populatedGroups.length) return ''

    return `<details class="foundation-relations__section"><summary><span class="foundation-relations__section-heading"><strong id="foundation-typed-relations-title" role="heading" aria-level="3">${t('类型化关系', 'Typed relations')}</strong></span>${DISCLOSURE_MARKER}</summary><div class="foundation-relations__groups">${populatedGroups
        .map(([id, label, entries]) => renderRelationGroup(t, id, label, entries, markdown))
        .join('')}</div></details>`
}

function renderRelationGroup(
    t: Translator,
    id: string,
    label: string,
    entries: FoundationEntry[],
    markdown: MarkdownIt,
    emptyMessage = ''
) {
    const content = entries.length
        ? `<ul>${entries.map((entry) => renderRelationEntry(t, entry, markdown)).join('')}</ul>`
        : `<p class="foundation-relations__empty">${escapeHtmlText(emptyMessage)}</p>`

    return `<section class="foundation-relations__group" aria-labelledby="${escapeHtmlAttribute(id)}"><p id="${escapeHtmlAttribute(id)}" class="foundation-relations__label">${escapeHtmlText(label)}</p>${content}</section>`
}

function renderRelationEntry(t: Translator, entry: FoundationEntry, markdown: MarkdownIt) {
    return `<li><a href="${escapeHtmlAttribute(entry.regularPath)}"><span>${renderInlineMath(markdown, entry.title, entry.sourcePath)}</span><small>${escapeHtmlText(t(FOUNDATION_KIND_LABELS[entry.kind], FOUNDATION_KIND_ENGLISH[entry.kind]))}</small></a></li>`
}

function serializeJsonForHtml(value: unknown) {
    return JSON.stringify(value)
        .replace(/</gu, '\\u003c')
        .replace(/\u2028/gu, '\\u2028')
        .replace(/\u2029/gu, '\\u2029')
}

function renderFoundationIndexEntry(
    t: Translator,
    entry: FoundationEntry,
    dependentCount: number,
    markdown: MarkdownIt,
    dial = ''
) {
    const alias = entry.aliases[0]
        ? `<small>${renderInlineMath(markdown, entry.aliases[0], entry.sourcePath)}</small>`
        : ''
    const searchAliases = entry.aliases.length > 1 ? JSON.stringify(entry.aliases.slice(1)) : ''
    const searchAliasAttribute = searchAliases ? ` data-search-aliases="${escapeHtmlAttribute(searchAliases)}"` : ''
    const prerequisites = entry.requires.length
        ? `<small>${entry.requires.length}${t(' 个前置', entry.requires.length === 1 ? ' prerequisite' : ' prerequisites')}</small>`
        : ''
    const dependents = dependentCount
        ? `<small>${dependentCount}${t(' 个后续', dependentCount === 1 ? ' dependent' : ' dependents')}</small>`
        : ''

    return `<li data-foundation-entry data-kind="${escapeHtmlAttribute(entry.kind)}"${searchAliasAttribute}${dial ? ` data-dial="${dial}"` : ''}><a href="${escapeHtmlAttribute(entry.regularPath)}" class="foundations-entry"><span class="foundations-entry__kind">${escapeHtmlText(t(FOUNDATION_KIND_LABELS[entry.kind], FOUNDATION_KIND_ENGLISH[entry.kind]))}</span><span class="foundations-entry__body"><span class="foundations-entry__title-row"><strong>${renderInlineMath(markdown, entry.title, entry.sourcePath)}</strong>${alias}</span><span class="foundations-entry__description">${renderInlineMath(markdown, entry.description, entry.sourcePath)}</span></span><span class="foundations-entry__relations">${prerequisites}${dependents}</span></a></li>`
}

function renderFoundationLife(t: Translator) {
    return `<div class="foundation-life foundations-life" data-foundation-life><canvas class="foundation-life__canvas" role="application" tabindex="0" aria-label="${t('康威生命游戏。鼠标经过格子可切换状态；方向键选择格子，空格或回车切换。', 'Conway’s Game of Life. Move the pointer over cells to toggle them; use arrow keys to select a cell and Space or Enter to toggle it.')}" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Space Enter">${t('康威生命游戏。', 'Conway’s Game of Life.')}</canvas></div>`
}
