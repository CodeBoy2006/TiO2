import { t } from './i18n'
import { foundationMatchRank, normalizeFoundationQuery } from './foundation-search'
import { createAtlasScene } from './foundation-atlas-scene'
import {
    FOUNDATION_ATLAS_RELATIONS,
    foundationAtlasColor,
    layoutFoundationNeighborhood,
    projectFoundationAtlas,
    type FoundationAtlas
} from '../../packages/content-core/src/foundation-atlas'
import {
    FOUNDATION_KIND_LABELS,
    FOUNDATION_KIND_ENGLISH,
    FOUNDATION_KINDS,
    FOUNDATION_RELATION_FIELDS
} from '../../packages/content-core/src/foundations'
import type { FoundationRelationField } from '../../packages/content-core/src/types'

type AtlasNode = FoundationAtlas['nodes'][number]

export function bindFoundationAtlas() {
    const root = document.querySelector<HTMLElement>('[data-foundation-atlas]')
    const stage = root?.querySelector<HTMLElement>('[data-atlas-stage]')
    const loading = root?.querySelector<HTMLElement>('[data-atlas-loading]')
    if (!root || !stage || !loading) return
    try {
        const data = JSON.parse(root.querySelector('[data-atlas-data]')!.textContent!) as FoundationAtlas
        const nodeById = new Map(data.nodes.map((node) => [node.id, node]))
        const domainById = new Map(data.domains.map((domain) => [domain.id, domain]))
        const groupById = new Map(data.groups.map((group) => [group.id, group]))
        const domain = root.querySelector<HTMLSelectElement>('[data-atlas-domain]')!
        const kind = root.querySelector<HTMLSelectElement>('[data-atlas-kind]')!
        const hops = root.querySelector<HTMLSelectElement>('[data-atlas-hops]')!
        const cross = root.querySelector<HTMLInputElement>('[data-atlas-cross]')!
        const search = root.querySelector<HTMLInputElement>('#atlas-search')!
        const results = root.querySelector<HTMLUListElement>('[data-atlas-results]')!
        const inspector = root.querySelector<HTMLElement>('[data-atlas-inspector]')!
        const tooltip = root.querySelector<HTMLElement>('[data-atlas-tooltip]')!
        const relationInputs = Array.from(root.querySelectorAll<HTMLInputElement>('[data-atlas-relation]'))
        const neighborhoodButton = root.querySelector<HTMLButtonElement>('[data-atlas-action="neighborhood"]')!
        let focusId: string | undefined
        let neighborhood = false

        const number = (value: number) => value.toLocaleString('en')
        const kindName = (node: AtlasNode) => t(FOUNDATION_KIND_LABELS[node.kind], FOUNDATION_KIND_ENGLISH[node.kind])
        const subjectColor = (id: string) =>
            foundationAtlasColor(
                domainById.get(id)!.hue,
                document.documentElement.classList.contains('dark') ? 'dark' : 'light'
            )
        const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
            const result = document.createElement(tag)
            if (text !== undefined) result.textContent = text
            if (className) result.className = className
            return result
        }
        const dot = (id: string) => {
            const mark = element('i', undefined, 'atlas-dot')
            mark.dataset.atlasSubject = id
            mark.style.setProperty('--atlas-dot', subjectColor(id))
            return mark
        }
        const button = (label: string, detail: string | undefined, dataset: Record<string, string>) => {
            const result = element('button')
            result.type = 'button'
            Object.assign(result.dataset, dataset)
            result.append(element('span', label))
            if (detail !== undefined) result.append(element('small', detail))
            return result
        }
        const facts = (items: Array<[string, string]>) => {
            const list = element('dl', undefined, 'atlas-facts')
            for (const [term, value] of items) {
                const item = element('div')
                item.append(element('dt', term), element('dd', value))
                list.append(item)
            }
            return list
        }
        // Dependency counts are fixed by the corpus, whatever the display filters hide.
        const prerequisites = new Map<string, number>()
        const dependents = new Map<string, number>()
        for (const edge of data.edges) {
            if (edge.relation !== 'requires') continue
            dependents.set(edge.source, (dependents.get(edge.source) ?? 0) + 1)
            prerequisites.set(edge.target, (prerequisites.get(edge.target) ?? 0) + 1)
        }

        const scene = createAtlasScene({
            stage,
            tooltip,
            reserved: Array.from(root.querySelectorAll<HTMLElement>('.atlas-toolbar, .atlas-zoom, .atlas-caption')),
            data,
            intro: !location.hash.includes('concept='),
            sectorLabel: (relation, direction) => {
                const pair = FOUNDATION_ATLAS_RELATIONS[relation][direction === 'incoming' ? 'incoming' : 'outgoing']
                return t(pair[0], pair[1])
            },
            depthLabel: t('前置深度', 'Depth'),
            onHover(target) {
                if (target?.node) {
                    const node = nodeById.get(target.node)!
                    const meta = element('p', undefined, 'atlas-tooltip-meta')
                    meta.append(dot(node.domains[0]), `${kindName(node)} · ${domainById.get(node.domains[0])!.title}`)
                    tooltip.replaceChildren(
                        meta,
                        element('strong', node.title),
                        element('p', node.description),
                        element(
                            'p',
                            `${t('深度 ', 'Depth ')}${node.rank} · ${t('前置 ', 'Requires ')}${prerequisites.get(node.id) ?? 0} · ${t('后续 ', 'Leads to ')}${dependents.get(node.id) ?? 0} · ${t('关系 ', 'Relations ')}${node.degree}`,
                            'atlas-tooltip-facts'
                        )
                    )
                } else if (target?.domain) {
                    const subject = domainById.get(target.domain)!
                    const meta = element('p', undefined, 'atlas-tooltip-meta')
                    meta.append(dot(subject.id), groupById.get(subject.group)!.title)
                    tooltip.replaceChildren(
                        meta,
                        element('strong', subject.title),
                        element(
                            'p',
                            `${number(subject.count)}${t(' 个概念 · 点选只看这个学科', ' concepts · select to isolate this subject')}`,
                            'atlas-tooltip-facts'
                        )
                    )
                }
            },
            onSelect: (id) => selectNode(id, false),
            onOpen(id) {
                neighborhood = true
                selectNode(id, false)
            },
            onDomain(id) {
                domain.value = domain.value === id ? 'all' : id
                neighborhood = false
                if (focusId && domain.value !== 'all' && !nodeById.get(focusId)!.domains.includes(id)) clearFocus()
                renderInspector()
                applyFilter()
            },
            onBackground() {
                if (neighborhood) return
                if (!focusId) return
                clearFocus()
                renderInspector()
                applyFilter({ frame: 'keep' })
            },
            onZoom(zoom) {
                root.dataset.atlasZoom = zoom.toFixed(4)
            },
            onSettle(settled) {
                root.dataset.atlasState = settled ? 'settled' : 'moving'
            }
        })

        const clearFocus = () => {
            focusId = undefined
            neighborhood = false
            neighborhoodButton.disabled = true
            delete root.dataset.atlasFocus
            history.replaceState(null, '', location.pathname + location.search)
        }
        const applyFilter = (mode: { frame?: 'fit' | 'keep'; animate?: boolean } = {}) => {
            const projection = projectFoundationAtlas(data, {
                domain: domain.value,
                kind: kind.value,
                relations: new Set(
                    relationInputs
                        .filter((input) => input.checked)
                        .map((input) => input.value as FoundationRelationField)
                ),
                crossDomainOnly: cross.checked,
                focusId: neighborhood ? focusId : undefined,
                hops: Number(hops.value)
            })
            scene.setView(
                {
                    nodeIds: projection.nodeIds,
                    edges: projection.edges,
                    focusId: focusId && projection.nodeIds.has(focusId) ? focusId : undefined,
                    neighborhood:
                        neighborhood && focusId ? layoutFoundationNeighborhood(data, projection, focusId) : undefined
                },
                mode
            )
            root.dataset.atlasMode = neighborhood ? 'neighborhood' : 'overview'
            root.dataset.atlasNodes = String(projection.nodeIds.size)
            root.dataset.atlasEdges = String(projection.edges.length)
            const shown = `${number(projection.nodeIds.size)}${t(' 个概念 / ', ' concepts / ')}${number(projection.edges.length)}${t(' 条关系', ' relations')}`
            root.querySelector<HTMLElement>('[data-atlas-count]')!.textContent = !projection.nodeIds.size
                ? t(
                      '当前筛选没有匹配的概念，可重置筛选继续浏览。',
                      'No concepts match these filters. Reset filters to continue.'
                  )
                : neighborhood && focusId
                  ? `${t('以「', 'Around “')}${nodeById.get(focusId)!.title}${t('」为中心 · ', '” · ')}${shown}`
                  : `${t('当前显示 ', 'Showing ')}${shown}`
            root.querySelectorAll<HTMLButtonElement>(
                '.atlas-toolbar [data-atlas-action="overview"], .atlas-toolbar [data-atlas-action="neighborhood"]'
            ).forEach((control) =>
                control.setAttribute(
                    'aria-pressed',
                    String((control.dataset.atlasAction === 'neighborhood') === neighborhood)
                )
            )
            hops.disabled = !neighborhood
            inspector
                .querySelector<HTMLButtonElement>('[data-atlas-toggle]')
                ?.replaceChildren(
                    neighborhood ? t('回到学科全图', 'Back to the subject map') : t('以它为中心展开', 'Re-centre on it')
                )
            renderSearch()
        }

        const heading = (text: string) => element('h3', text)
        const renderOverview = () => {
            const title = element('h2', t('从全局走进一个概念', 'From the map to a concept'))
            const lead = element(
                'p',
                t(
                    '指向星盘上的圆点预览它的关系；点选后在这里阅读，双击以它为中心重排。',
                    'Point at a dot to preview its relations; select it to read them here, double-click to re-centre the dial on it.'
                )
            )
            const kinds = element('ul', undefined, 'atlas-bars')
            const tally = FOUNDATION_KINDS.map((name) => ({
                name,
                count: data.nodes.filter((node) => node.kind === name).length
            }))
                .filter((item) => item.count)
                .sort((a, b) => b.count - a.count)
            for (const item of tally) {
                const row = element('li')
                const pick = button(
                    t(FOUNDATION_KIND_LABELS[item.name], FOUNDATION_KIND_ENGLISH[item.name]),
                    number(item.count),
                    { atlasKindPick: item.name }
                )
                pick.style.setProperty('--atlas-share', `${(item.count / tally[0].count) * 100}%`)
                pick.setAttribute('aria-pressed', String(kind.value === item.name))
                row.append(pick)
                kinds.append(row)
            }
            const roam = button(t('随机漫游到一个概念', 'Wander to a random concept'), undefined, {
                atlasAction: 'random'
            })
            roam.className = 'atlas-quiet-action'
            inspector.replaceChildren(
                element('p', t('图谱概览', 'Map overview'), 'atlas-inspector-meta'),
                title,
                lead,
                facts([
                    [t('概念', 'Concepts'), number(data.nodes.length)],
                    [t('关系', 'Relations'), number(data.edges.length)],
                    [t('跨学科', 'Cross-subject'), number(data.edges.filter((edge) => edge.crossDomain).length)],
                    [t('最深前置链', 'Deepest chain'), String(Math.max(...data.nodes.map((node) => node.rank)))]
                ]),
                heading(t('条目类型 · 点选筛选', 'Entry kinds · select to filter')),
                kinds,
                roam
            )
        }
        const renderSubject = (id: string) => {
            const subject = domainById.get(id)!
            const members = data.nodes.filter((node) => node.domains[0] === id)
            const inside = new Set(members.map((node) => node.id))
            const traffic = new Map<string, number>()
            let internal = 0
            for (const edge of data.edges) {
                const a = inside.has(edge.source)
                const b = inside.has(edge.target)
                if (a && b) internal++
                else if (a || b) {
                    const other = nodeById.get(a ? edge.target : edge.source)!.domains[0]
                    traffic.set(other, (traffic.get(other) ?? 0) + 1)
                }
            }
            const title = element('h2')
            title.append(dot(id), subject.title)
            const partners = element('ul', undefined, 'atlas-bars')
            const busiest = [...traffic].sort((a, b) => b[1] - a[1]).slice(0, 6)
            for (const [other, count] of busiest) {
                const row = element('li')
                const pick = button(domainById.get(other)!.title, number(count), { atlasDomainPick: other })
                pick.prepend(dot(other))
                pick.style.setProperty('--atlas-share', `${(count / busiest[0][1]) * 100}%`)
                row.append(pick)
                partners.append(row)
            }
            const hubs = element('ul', undefined, 'atlas-list')
            for (const node of [...members].sort((a, b) => b.degree - a.degree).slice(0, 8)) {
                const row = element('li')
                row.append(button(node.title, `${node.degree}`, { atlasSelect: node.id }))
                hubs.append(row)
            }
            const back = button(t('回到全部学科', 'Back to all subjects'), undefined, { atlasDomainPick: 'all' })
            back.className = 'atlas-quiet-action'
            const depths = members.map((node) => node.rank)
            inspector.replaceChildren(
                element(
                    'p',
                    `${groupById.get(subject.group)!.title} · ${t('学科', 'Subject')}`,
                    'atlas-inspector-meta'
                ),
                title,
                facts([
                    [t('概念', 'Concepts'), number(members.length)],
                    [t('内部关系', 'Internal'), number(internal)],
                    [t('对外关系', 'External'), number([...traffic.values()].reduce((sum, value) => sum + value, 0))],
                    [t('前置深度', 'Depth'), `${Math.min(...depths)}–${Math.max(...depths)}`]
                ]),
                heading(t('往来最多的学科', 'Closest subjects')),
                partners,
                heading(t('关系最多的概念', 'Best-connected concepts')),
                hubs,
                back
            )
        }
        const renderInspector = () => {
            const node = focusId ? nodeById.get(focusId) : undefined
            if (!node) {
                if (domain.value !== 'all') renderSubject(domain.value)
                else renderOverview()
                return
            }
            const meta = element('p', undefined, 'atlas-inspector-meta')
            meta.append(
                dot(node.domains[0]),
                `${kindName(node)} · ${node.domains.map((id) => domainById.get(id)?.title).join(' / ')}`
            )
            const link = element('a', t('阅读完整条目', 'Read the canonical page'), 'atlas-read-entry')
            link.href = node.href
            const toggle = element('button', '', 'atlas-quiet-action')
            toggle.type = 'button'
            toggle.dataset.atlasToggle = ''
            const actions = element('p', undefined, 'atlas-actions')
            actions.append(link, toggle)
            inspector.replaceChildren(meta, element('h2', node.title))
            if (node.aliases.length) inspector.append(element('p', node.aliases.join(' · '), 'atlas-aliases'))
            inspector.append(
                element('p', node.description),
                actions,
                facts([
                    [t('前置深度', 'Depth'), String(node.rank)],
                    [t('直接前置', 'Requires'), String(prerequisites.get(node.id) ?? 0)],
                    [t('直接后续', 'Leads to'), String(dependents.get(node.id) ?? 0)],
                    [t('全部关系', 'Relations'), String(node.degree)]
                ]),
                element('p', t('已标注的全部直接关系', 'All authored direct relationships'), 'atlas-inspector-meta')
            )
            for (const relation of FOUNDATION_RELATION_FIELDS) {
                const symmetric = relation === 'equivalent_to' || relation === 'contrasts_with'
                for (const direction of symmetric ? ['both'] : ['incoming', 'outgoing']) {
                    const edges = data.edges.filter(
                        (edge) =>
                            edge.relation === relation &&
                            (direction === 'incoming'
                                ? edge.target === node.id
                                : direction === 'outgoing'
                                  ? edge.source === node.id
                                  : edge.source === node.id || edge.target === node.id)
                    )
                    if (!edges.length) continue
                    const pair =
                        direction === 'incoming'
                            ? FOUNDATION_ATLAS_RELATIONS[relation].incoming
                            : FOUNDATION_ATLAS_RELATIONS[relation].outgoing
                    const details = element('details')
                    details.dataset.relation = relation
                    details.open = edges.length <= 6
                    const summary = element('summary')
                    summary.append(
                        element('span', undefined, 'atlas-swatch'),
                        `${t(pair[0], pair[1])} · ${edges.length}`
                    )
                    const list = element('ul', undefined, 'atlas-list')
                    for (const edge of edges) {
                        const target = nodeById.get(edge.source === node.id ? edge.target : edge.source)!
                        const item = element('li')
                        const pick = button(target.title, domainById.get(target.domains[0])!.title, {
                            atlasSelect: target.id
                        })
                        pick.prepend(dot(target.domains[0]))
                        item.append(pick)
                        list.append(item)
                    }
                    details.append(summary, list)
                    inspector.append(details)
                }
            }
        }

        const normalized = normalizeFoundationQuery
        const searchText = new Map(
            data.nodes.map((node) => [
                node.id,
                normalized([node.id, node.title, ...node.aliases, node.description].join(' '))
            ])
        )
        const renderSearch = () => {
            const query = normalized(search.value)
            const matches = query
                ? data.nodes.filter((node) => searchText.get(node.id)!.includes(query))
                : [...data.nodes].sort((a, b) => b.degree - a.degree)
            if (query) {
                const relevance = (node: AtlasNode) => {
                    const names = [node.id, node.title, ...node.aliases].map(normalized)
                    return foundationMatchRank(query, names, searchText.get(node.id)!)
                }
                matches.sort((a, b) => relevance(a) - relevance(b) || b.degree - a.degree)
            }
            const limit = query ? 20 : 5
            results.replaceChildren(
                ...matches.slice(0, limit).map((node) => {
                    const item = element('li')
                    const pick = button(node.title, domainById.get(node.domains[0])!.title, { atlasSelect: node.id })
                    pick.prepend(dot(node.domains[0]))
                    item.append(pick)
                    return item
                })
            )
            scene.mark(query && !neighborhood ? matches.map((node) => node.id) : undefined)
            root.querySelector<HTMLElement>('[data-atlas-search-count]')!.textContent = query
                ? `${matches.length}${t(' 个匹配', ' matches')}${matches.length > limit ? t(' · 显示前 20 个，请细化关键词', ' · first 20 shown; refine your search') : t(' · 已在图中点亮', ' · lit on the dial')}`
                : t('关联较多的概念 · 点选进入', 'Well-connected concepts · select to explore')
        }
        const selectNode = (id: string, reveal = true) => {
            const node = nodeById.get(id)
            if (!node) return
            focusId = id
            root.dataset.atlasFocus = id
            neighborhoodButton.disabled = false
            if (
                (domain.value !== 'all' && !node.domains.includes(domain.value)) ||
                (kind.value !== 'all' && node.kind !== kind.value)
            ) {
                domain.value = 'all'
                kind.value = 'all'
            }
            history.replaceState(null, '', `#concept=${encodeURIComponent(id)}`)
            renderInspector()
            applyFilter({ frame: neighborhood ? 'fit' : 'keep' })
            if (!neighborhood && reveal) scene.reveal(id)
        }
        const focusSelection = () => {
            const target = window.matchMedia('(max-width: 760px)').matches
                ? inspector.querySelector<HTMLAnchorElement>('.atlas-read-entry')
                : neighborhoodButton
            target?.focus()
        }
        root.addEventListener('click', (event) => {
            const target = (event.target as Element).closest<HTMLElement>(
                '[data-atlas-select], [data-atlas-action], [data-atlas-toggle], [data-atlas-kind-pick], [data-atlas-domain-pick]'
            )
            if (!target) return
            if (target.dataset.atlasSelect) {
                selectNode(target.dataset.atlasSelect)
                if (
                    target.closest('.atlas-inspector, .atlas-text-index') ||
                    (target.closest('.atlas-search') && window.matchMedia('(max-width: 760px)').matches)
                )
                    focusSelection()
                if (target.closest('.atlas-text-index')) stage.scrollIntoView({ block: 'center' })
                return
            }
            if (target.dataset.atlasKindPick) {
                kind.value = kind.value === target.dataset.atlasKindPick ? 'all' : target.dataset.atlasKindPick
                renderInspector()
                applyFilter()
                return
            }
            if (target.dataset.atlasDomainPick) {
                domain.value = target.dataset.atlasDomainPick
                renderInspector()
                applyFilter()
                return
            }
            const action = target.dataset.atlasAction
            if (action === 'fit') scene.fit()
            else if (action === 'in' || action === 'out') scene.zoomBy(action === 'in' ? 1.5 : 1 / 1.5)
            else if (action === 'random') {
                const pool = data.nodes.filter((node) => node.degree >= 4)
                selectNode((pool.length ? pool : data.nodes)[Math.floor(Math.random() * (pool.length || 1))].id)
            } else if (action === 'reset') {
                domain.value = 'all'
                kind.value = 'all'
                cross.checked = false
                search.value = ''
                hops.value = '1'
                relationInputs.forEach((input) => {
                    input.checked = true
                })
                clearFocus()
                renderInspector()
                applyFilter()
            } else {
                neighborhood =
                    ('atlasToggle' in target.dataset ? !neighborhood : action === 'neighborhood') && Boolean(focusId)
                applyFilter()
            }
        })
        root.querySelector('form')!.addEventListener('submit', (event) => {
            event.preventDefault()
            const first = results.querySelector<HTMLButtonElement>('button')
            if (first) {
                selectNode(first.dataset.atlasSelect!)
                focusSelection()
            }
        })
        // Arrow keys walk the result list from the search field and back.
        root.querySelector('form')!.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            const picks = Array.from(results.querySelectorAll<HTMLButtonElement>('button'))
            const at = picks.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'ArrowDown' ? picks[at + 1] : at > 0 ? picks[at - 1] : search
            if (!next) return
            event.preventDefault()
            next.focus()
        })
        search.addEventListener('input', renderSearch)
        // Any listed concept lights up on the dial while it is pointed at or focused.
        const preview = (event: Event) => {
            const pick = (event.target as Element).closest<HTMLElement>('.atlas-margin [data-atlas-select]')
            if (!pick) return
            scene.hover(event.type === 'pointerout' || event.type === 'focusout' ? undefined : pick.dataset.atlasSelect)
        }
        for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout']) root.addEventListener(type, preview)
        for (const input of [domain, kind]) {
            input.addEventListener('change', () => {
                if (!focusId) renderInspector()
                applyFilter()
            })
        }
        for (const input of [hops, cross, ...relationInputs])
            input.addEventListener('change', () => applyFilter({ frame: neighborhood ? 'fit' : 'keep' }))
        const onTheme = () => {
            scene.theme()
            root.querySelectorAll<HTMLElement>('[data-atlas-subject]').forEach((mark) =>
                mark.style.setProperty('--atlas-dot', subjectColor(mark.dataset.atlasSubject!))
            )
        }
        document.addEventListener('tio2:theme', onTheme)
        const readHash = () => {
            const id = new URLSearchParams(location.hash.slice(1)).get('concept')
            if (id && nodeById.has(id)) {
                neighborhood = true
                selectNode(id)
            }
        }
        window.addEventListener('hashchange', readHash)
        const onShow = (event: PageTransitionEvent) => {
            if (event.persisted) scene.resume()
        }
        window.addEventListener('pageshow', onShow)
        window.addEventListener('pagehide', (event) => {
            // A cached Back navigation restores this live document without rerunning initialization.
            if (event.persisted) return
            document.removeEventListener('tio2:theme', onTheme)
            window.removeEventListener('hashchange', readHash)
            window.removeEventListener('pageshow', onShow)
            scene.destroy()
        })
        root.querySelectorAll<HTMLElement>('[data-atlas-select][hidden]').forEach((pick) => {
            pick.hidden = false
        })
        renderInspector()
        applyFilter({ animate: false })
        readHash()
        loading.hidden = true
        root.dataset.atlasReady = ''
    } catch {
        loading.textContent = t(
            '交互图谱未能载入。可下载 SVG 全图，或使用下方文字目录。',
            'The interactive atlas could not load. Download the SVG or use the text index below.'
        )
        loading.classList.add('is-error')
    }
}
