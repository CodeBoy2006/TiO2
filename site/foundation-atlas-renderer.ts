import { createTranslator } from '../packages/config/src/i18n.js'
import type { TiO2Project } from '../packages/config/src/index.js'
import {
    createFoundationAtlasCurves,
    FOUNDATION_ATLAS_RELATIONS,
    FOUNDATION_KIND_LABELS,
    FOUNDATION_KIND_ENGLISH,
    FOUNDATION_KINDS,
    FOUNDATION_RELATION_FIELDS,
    foundationAtlasColor,
    foundationAtlasPoint,
    foundationAtlasWings,
    type FoundationAtlas
} from '../packages/content-core/src/index'
import { escapeHtmlAttribute as attr, escapeHtmlText as html } from '../.vitepress/theme/markdownRendering'
import { readPageMeta } from './page-renderer'
import { libraryIdentity } from './render-helpers'
import { renderDocument, type ClientAssets } from './site-renderer'

const contract = `<!--
THESIS: The complete Foundations atlas is one dial: the angle names a subject, the radius counts prerequisite depth, and the hub shows how subjects lean on each other.
OWN-WORLD: An engraved instrument inside the Annotated Monograph: paper or night ground, serif lettering on the rim, one hue per subject, the six semantic relation colors once a relation is individually readable.
STORY: See the whole corpus as a star dial, point at a concept to light its relations, select it to read them, re-centre the dial on it, continue into the canonical text.
FIRST VIEWPORT: A concise heading and corpus count above the dial; search and the relationship inspector form its readable margin.
FORM: Deterministic subject wedges and depth rings, bundled cross-subject chords, semantic zoom, and a radial neighborhood that unfolds from the chosen concept.
FINISH: Complete corpus, accessible text alternatives, static SVG/JSON exports, reduced-motion stillness, desktop/mobile verification in both themes.
-->`

export async function renderFoundationAtlasPage(
    project: TiO2Project,
    data: FoundationAtlas,
    clientAssets: ClientAssets,
    libraryRoute?: string
) {
    const t = createTranslator(project.config.site.language)
    const page = await readPageMeta(project, 'foundations-map')
    const library = libraryIdentity(project).title
    const label = (pair: readonly [string, string]) => t(...pair)
    const wings = foundationAtlasWings(data)
    const domainOptions = wings
        .map(
            ({ group, domains }) =>
                `<optgroup label="${attr(group.title)}">${domains
                    .map(
                        (domain) =>
                            `<option value="${attr(domain.id)}">${html(domain.title)} (${domain.count})</option>`
                    )
                    .join('')}</optgroup>`
        )
        .join('')
    const kindOptions = FOUNDATION_KINDS.filter(
        (kind) => kind !== 'navigation' && data.nodes.some((node) => node.kind === kind)
    )
        .map(
            (kind) =>
                `<option value="${kind}">${html(t(FOUNDATION_KIND_LABELS[kind], FOUNDATION_KIND_ENGLISH[kind]))}</option>`
        )
        .join('')
    const relations = FOUNDATION_RELATION_FIELDS.map((field) => {
        const meta = FOUNDATION_ATLAS_RELATIONS[field]
        const count = data.edges.filter((edge) => edge.relation === field).length
        return `<label data-relation="${field}" title="${attr(label(meta.direction))}"><input type="checkbox" value="${field}" data-atlas-relation checked><span class="atlas-swatch" aria-hidden="true"></span><span>${html(label(meta.label))}</span><small>${count.toLocaleString('en')}</small></label>`
    }).join('')
    const fallback = wings
        .flatMap(({ group, domains }) =>
            domains.map(
                (domain) =>
                    `<details><summary>${html(group.title)} · ${html(domain.title)} · ${domain.count}</summary><ul>${data.nodes
                        .filter((node) => node.domains[0] === domain.id)
                        .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, 'zh-Hans-CN'))
                        .map(
                            (node) =>
                                `<li><a href="${attr(node.href)}">${html(node.title)}</a><button type="button" data-atlas-select="${attr(node.id)}" hidden>${t('在图中定位', 'Locate in map')}</button></li>`
                        )
                        .join('')}</ul></details>`
            )
        )
        .join('')
    const crossCount = data.edges.filter((edge) => edge.crossDomain).length
    const icon = (path: string) =>
        `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
    const content = `<main class="foundation-atlas" data-foundation-atlas>
        <header class="atlas-header"><div>${libraryRoute ? `<a href="${attr(libraryRoute)}">${html(t(`返回${library}`, `Back to ${library}`))}</a>` : ''}<h1>${html(page.title)}</h1><p>${data.nodes.length.toLocaleString('en')}${t(' 个概念 · ', ' concepts · ')}${data.edges.length.toLocaleString('en')}${t(' 条关系 · ', ' relations · ')}${data.domains.length}${t(' 个学科', ' subjects')}</p></div><nav aria-label="${t('下载完整图谱', 'Download the complete map')}"><a href="${attr(page.route.replace('.html', '.svg'))}" download>${t('下载 SVG 全图', 'Download SVG')}</a><a href="${attr(page.route.replace('.html', '.json'))}" download>${t('图谱数据 JSON', 'Graph data JSON')}</a></nav></header>
        <noscript><style>.atlas-workspace{display:none}</style><p>${t('可下载 SVG 全图，或展开下方文字目录进入条目及其文字版关系。', 'Download the SVG or expand the text index below to browse canonical entries and text relationships.')}</p></noscript>
        <div class="atlas-workspace">            <form role="search" class="atlas-search"><label for="atlas-search">${t('在全图中找一个概念', 'Find a concept on the map')}</label><input id="atlas-search" type="search" placeholder="${t('名称、别名或关键词', 'Title, alias or keyword')}" autocomplete="off" aria-controls="atlas-results"><p data-atlas-search-count role="status" aria-live="polite"></p><ul id="atlas-results" data-atlas-results></ul></form><section class="atlas-map" aria-label="${t('完整知识关系图', 'Complete knowledge graph')}">
            <div class="atlas-stage" data-atlas-stage tabindex="0" role="application" aria-label="${t('数学与理论计算机科学全图。拖动平移，滚轮或加减键缩放，方向键移动，点选概念查看关系；搜索与文字目录提供完整的键盘操作。', 'Complete mathematics and TCS graph. Drag to pan, scroll or press plus and minus to zoom, use arrow keys to move, select a concept to inspect it; search and the text index offer full keyboard access.')}"><p data-atlas-loading role="status">${t('正在载入完整图谱…', 'Loading the complete map…')}</p></div>
            <div class="atlas-tooltip" data-atlas-tooltip hidden></div>
            <div class="atlas-toolbar" role="group" aria-label="${t('浏览范围', 'Graph scope')}"><button type="button" data-atlas-action="overview" aria-pressed="true">${t('学科全图', 'Subject map')}</button><button type="button" data-atlas-action="neighborhood" aria-pressed="false" disabled>${t('只看关联', 'Neighborhood')}</button><label>${t('关联范围', 'Distance')}<select data-atlas-hops disabled><option value="1">${t('1 跳', '1 hop')}</option><option value="2">${t('2 跳', '2 hops')}</option></select></label></div>
            <div class="atlas-zoom" role="group" aria-label="${t('图谱缩放', 'Graph zoom')}"><button type="button" data-atlas-action="in" aria-label="${t('放大', 'Zoom in')}" title="${t('放大', 'Zoom in')}">${icon('<path d="M8 3.5v9M3.5 8h9"/>')}</button><button type="button" data-atlas-action="out" aria-label="${t('缩小', 'Zoom out')}" title="${t('缩小', 'Zoom out')}">${icon('<path d="M3.5 8h9"/>')}</button><button type="button" data-atlas-action="fit" aria-label="${t('适应视野', 'Fit view')}" title="${t('适应视野', 'Fit view')}">${icon('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>')}</button></div>
            <div class="atlas-caption"><p data-atlas-count role="status" aria-live="polite"></p><p>${t('拖动平移 · 滚轮缩放 · 点选概念 · 双击展开关联', 'Drag to pan · scroll to zoom · select a concept · double-click to open its neighborhood')}</p></div>
        </section><aside class="atlas-margin" aria-label="${t('关系详情', 'Relationship details')}">

            <section class="atlas-inspector" data-atlas-inspector aria-live="polite"><h2>${t('从全局走进一个概念', 'From the map to a concept')}</h2><p>${t('搜索或点选一个节点，在这里查看正文入口及有方向的关系列表。', 'Search for or select a node to find its canonical page and directed relationships.')}</p><p>${crossCount.toLocaleString('en')}${t(' 条跨学科关系连接了这些领域。', ' cross-subject relationships connect these fields.')}</p></section>
        </aside><div class="atlas-controls">
            <fieldset class="atlas-relations"><legend>${t('关系类型与方向', 'Relation types and directions')}</legend><div>${relations}</div></fieldset>
            <div class="atlas-filters"><label>${t('学科范围', 'Subject')}<select data-atlas-domain><option value="all">${t('全部学科', 'All subjects')}</option>${domainOptions}</select></label><label>${t('条目类型', 'Entry kind')}<select data-atlas-kind><option value="all">${t('全部类型', 'All kinds')}</option>${kindOptions}</select></label><label class="atlas-cross"><input type="checkbox" data-atlas-cross>${t('只显示跨学科连线', 'Cross-subject edges only')}</label><button type="button" data-atlas-action="reset">${t('重置筛选与视图', 'Reset filters and view')}</button></div>
        </div></div>
        <details class="atlas-notes"><summary>${t('这张图怎样阅读', 'How to read this map')}</summary><p>${t('整张图是一只星盘。角度表示学科：数学在左翼，理论计算机科学在右翼，都从上方读起。半径表示前置深度：不依赖其他条目的概念贴近圆心，每多一层前置链就向外一环，顶部缺口处的刻度标出深度。每个正式概念只出现一次，按首个所属学科定位；筛选同时识别其所有学科。位置表示编排，不代表相似度或学习先后。', 'The map is a dial. The angle names a subject: mathematics on the left wing, theoretical computer science on the right, both read from the top. The radius counts prerequisite depth: concepts that require nothing sit near the centre and each further link in the longest prerequisite chain moves one ring outward; the scale in the gap at the top marks the depth. Each formal concept appears once, located in its first listed subject; filters recognize every subject membership. Coordinates are an arrangement, not similarity or a curriculum.')}</p><p>${t('圆点越大，直接关系越多。学科内部的关系沿环弯曲；跨学科的关系先汇入各自学科的入口，再一起穿过中心，所以中心的弦显示学科之间的往来。远观时连线取所属学科的颜色；放大到能分辨单条关系，或者指向、选中一个概念时，连线改用六种关系颜色与线型，并标出方向。', 'Larger dots have more direct relationships. Relations inside a subject bend along the rings; relations between subjects first gather at each subject’s gate and cross the centre together, so the chords in the hub show the traffic between subjects. From afar edges take the colour of their subject; once single relations are legible, or when a concept is pointed at or selected, they take the six relation colours and line patterns and show their direction.')}</p><p>${t('依赖箭头从前置指向后续，分类箭头从一般指向特例；使用与实现保留声明方向。等价与辨析为无向关系，每对只画一次。「只看关联」以所选概念为圆心重排：第一环按它与圆心的关系分区，第二环挂在引出它的第一环概念之后。关联范围沿所选关系双向计算最短跳数，所有连线仍保留原本方向。', 'Dependency arrows run from prerequisite to dependent; classification runs from general to special. Use and implementation retain their declared direction. Equivalence and contrast are undirected and emitted once per pair. Neighborhood re-centres the dial on the selected concept: the first ring is grouped by relation to the centre, the second ring hangs behind the first-ring concept that reaches it. Distance follows selected relations in both directions while preserving every edge direction.')}</p><p>${t('跨学科连线指两端没有共同学科的关系。图谱只使用正文明确标注的六类关系，不把学习路线或一般正文链接变成依赖；术语导航页不作为正式节点。下载始终包含完整数据。', 'Cross-subject edges join concepts with no subject in common. Only the six authored relation fields form edges; reading routes and ordinary body links do not become dependencies. Navigation pages are excluded. Downloads always contain the complete graph.')}</p><ul>${FOUNDATION_RELATION_FIELDS.map((field) => `<li><strong>${html(label(FOUNDATION_ATLAS_RELATIONS[field].label))}</strong>：${html(label(FOUNDATION_ATLAS_RELATIONS[field].direction))}</li>`).join('')}</ul></details>
        <details class="atlas-text-index"><summary>${t('文字目录与无障碍入口', 'Text index and accessible navigation')} · ${data.nodes.length}</summary><p>${t('每条目正文都附有文字版关系，无需操作图形即可继续浏览。', 'Every canonical page includes text relationships for navigation without the visual graph.')}</p>${fallback}</details>
        <script type="application/json" data-atlas-data>${JSON.stringify(data)
            .replace(/</gu, '\\u003c')
            .replace(/\u2028/gu, '\\u2028')
            .replace(/\u2029/gu, '\\u2029')}</script>
    </main>`
    return renderDocument(project, {
        title: page.title,
        description: page.description,
        canonicalPath: page.route,
        clientAssets,
        fullWidth: true,
        pageClass: 'foundation-atlas-page',
        bodyPrelude: contract,
        content
    })
}

/** The same dial as the interactive atlas, as a still chart on paper. */
export function renderFoundationAtlasSvg(data: FoundationAtlas, siteUrl: string, language = 'zh-CN', heading = '') {
    const t = createTranslator(language)
    const colors = ['#2563eb', '#15803d', '#b45309', '#7c3aed', '#0f766e', '#be123c']
    const curveOf = createFoundationAtlasCurves(data)
    const nodeById = new Map(data.nodes.map((node) => [node.id, node]))
    const hue = new Map(data.domains.map((domain) => [domain.id, foundationAtlasColor(domain.hue, 'light')]))
    const reach = data.radius + 250
    const top = reach + 250
    const fixed = (value: number) => Number(value.toFixed(1))
    const sweep = (radius: number, start: number, end: number, reverse = false) => {
        const from = foundationAtlasPoint(radius, reverse ? end : start)
        const to = foundationAtlasPoint(radius, reverse ? start : end)
        return `M${fixed(from.x)},${fixed(from.y)}A${radius},${radius} 0 ${end - start > Math.PI ? 1 : 0} ${reverse ? 0 : 1} ${fixed(to.x)},${fixed(to.y)}`
    }
    const lettering = (id: string, radius: number, start: number, end: number, size: number) => {
        const middle = (start + end) / 2
        const turned = middle > Math.PI / 2 && middle < (Math.PI * 3) / 2
        return `<path id="${id}" d="${sweep(radius + (turned ? size * 0.36 : -size * 0.36), start - 0.4, end + 0.4, turned)}" fill="none"/>`
    }
    const edges = data.edges
        .map((edge) => {
            const curve = curveOf(edge)
            const index = FOUNDATION_RELATION_FIELDS.indexOf(edge.relation)
            const symmetric = edge.relation === 'equivalent_to' || edge.relation === 'contrasts_with'
            let path = `M${curve[0]},${curve[1]}`
            for (let at = 2; at < curve.length; at += 6) path += `C${curve.slice(at, at + 6).join(' ')}`
            const dash = ['uses', 'contrasts_with'].includes(edge.relation)
                ? ' stroke-dasharray="3 6"'
                : ['special_case_of', 'equivalent_to'].includes(edge.relation)
                  ? ' stroke-dasharray="10 6"'
                  : ''
            return `<path data-relation="${edge.relation}" d="${path}" stroke="${colors[index]}"${dash}><title>${html(nodeById.get(edge.source)!.title)} ${symmetric ? '↔' : '→'} ${html(nodeById.get(edge.target)!.title)} · ${html(t(FOUNDATION_ATLAS_RELATIONS[edge.relation].label[0], FOUNDATION_ATLAS_RELATIONS[edge.relation].label[1]))}</title></path>`
        })
        .join('')
    const nodes = data.nodes
        .map((node) => {
            const left = node.x < 0
            const radius = fixed(Math.min(13, 3 + 1.5 * Math.sqrt(node.degree)))
            return `<a href="${attr(new URL(node.href, siteUrl).href)}" data-node-id="${attr(node.id)}"><title>${html(node.title)} · ${html(node.description)}</title><circle cx="${node.x}" cy="${node.y}" r="${radius}" fill="${hue.get(node.domains[0])}"/><text class="node-label" x="${node.x + (left ? -radius - 6 : radius + 6)}" y="${node.y + 6}"${left ? ' text-anchor="end"' : ''}>${html(node.title)}</text></a>`
        })
        .join('')
    const guides = data.rings
        .map(
            (radius, rank) =>
                `<circle r="${radius}" stroke-opacity="${rank % 5 === 0 || rank === data.rings.length - 1 ? 0.2 : 0.08}"/>`
        )
        .join('')
    const scale = data.rings
        .slice(0, -1)
        .map((radius, rank) =>
            rank % 5 ? '' : `<text y="${-(radius + data.rings[rank + 1]) / 2 + 9}" text-anchor="middle">${rank}</text>`
        )
        .join('')
    const rim = data.domains
        .map(
            (domain, index) =>
                `<path d="${sweep(data.radius + 12, domain.start, domain.end)}" stroke="${hue.get(domain.id)}" stroke-width="7" fill="none"/>${lettering(`subject-${index}`, data.radius + 52, domain.start, domain.end, 34)}<text font-size="34" font-weight="600"><textPath href="#subject-${index}" startOffset="50%" text-anchor="middle">${html(domain.title)} · ${domain.count}</textPath></text>`
        )
        .join('')
    const wings = data.groups
        .map(
            (group, index) =>
                `${lettering(`wing-${index}`, data.radius + 130, group.start, group.end, 54)}<text class="wing" font-size="54" font-weight="700" letter-spacing="10"><textPath href="#wing-${index}" startOffset="50%" text-anchor="middle">${html(group.title)} · ${group.count.toLocaleString('en')}</textPath></text>`
        )
        .join('')
    const legend = FOUNDATION_RELATION_FIELDS.map(
        (field, index) =>
            `<text x="${-reach + 70 + index * 420}" y="${-reach - 40}" font-size="36" style="fill:${colors[index]}">${html(t(FOUNDATION_ATLAS_RELATIONS[field].label[0], FOUNDATION_ATLAS_RELATIONS[field].label[1]))} · ${data.edges.filter((edge) => edge.relation === field).length}</text>`
    ).join('')
    const title = heading || t('概念关系全图', 'Complete concept map')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${reach * 2}" height="${top + reach}" viewBox="${-reach} ${-top} ${reach * 2} ${top + reach}" role="img" aria-labelledby="title description"><title id="title">${title}</title><desc id="description">${data.nodes.length} concepts, ${data.edges.length} typed relationships, ${data.domains.length} subjects. Angle names the subject, radius counts prerequisite depth, so dependencies run outward. Hover nodes for titles and click to open canonical pages.</desc><style>text{font-family:system-ui,sans-serif;fill:#1b1b1f}.wing{font-family:"Noto Serif SC","Songti SC",serif}.guides circle{fill:none;stroke:#1b1b1f}.edges path{fill:none;stroke-opacity:.16}.scale text{font-size:24px;fill:#67676c}.node-label{font-size:18px;display:none;paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}a:hover .node-label,a:focus .node-label{display:block}a:hover circle,a:focus circle{stroke:#1b1b1f;stroke-width:2.5}</style><rect x="${-reach}" y="${-top}" width="${reach * 2}" height="${top + reach}" fill="#fff"/><text class="wing" x="${-reach + 70}" y="${-top + 96}" font-size="68" font-weight="700">${title}</text><text x="${-reach + 70}" y="${-top + 150}" font-size="32">${data.nodes.length} ${t('个概念', 'concepts')} · ${data.edges.length} ${t('条关系', 'relations')} · ${data.domains.length} ${t('个学科', 'subjects')} · ${t('角度表示学科，半径表示前置深度；悬停查看概念，点选进入正文。', 'Angle names the subject, radius counts prerequisite depth; hover for titles, click for canonical pages.')}</text>${legend}<g class="guides">${guides}<circle r="${data.gate}" stroke-opacity=".14"/></g><g class="scale">${scale}</g><g class="edges">${edges}</g>${rim}${wings}${nodes}</svg>`
}
