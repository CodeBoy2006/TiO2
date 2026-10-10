import { t } from './i18n'
import { foundationRouteHref } from './foundation-route-context'
import cytoscape from 'cytoscape'
import cola from 'cytoscape-cola'

cytoscape.use(cola)

type GraphDepth = -3 | -2 | -1 | 0 | 1 | 2 | 3
type GraphHops = 1 | 2 | 3
type GraphRelation = 'requires' | 'uses' | 'implemented_by' | 'special_case_of' | 'equivalent_to' | 'contrasts_with'

interface GraphData {
    currentId: string
    nodes: Array<{
        id: string
        title: string
        kind: string
        href: string
        dependencyDepth: GraphDepth | null
    }>
    edges: Array<{
        id: string
        source: string
        target: string
        relation: GraphRelation
    }>
}

interface ColaLayoutOptions {
    name: 'cola'
    animate: boolean
    refresh: number
    maxSimulationTime: number
    ungrabifyWhileSimulating: boolean
    fit: boolean
    padding: number
    nodeDimensionsIncludeLabels: boolean
    randomize: boolean
    avoidOverlap: boolean
    handleDisconnected: boolean
    convergenceThreshold: number
    nodeSpacing: (node: cytoscape.NodeSingular) => number
    flow: { axis: 'x' | 'y'; minSeparation: number }
    centerGraph: boolean
    edgeLength: (edge: cytoscape.EdgeSingular) => number
    unconstrIter: number
    userConstIter: number
    allConstIter: number
    infinite: boolean
    stop: () => void
}

const graphDepths = [-3, -2, -1, 0, 1, 2, 3] as const

export function bindFoundationGraph() {
    const root = document.querySelector<HTMLElement>('[data-foundation-graph]')
    const stage = root?.querySelector<HTMLElement>('[data-foundation-graph-canvas]')
    const dataElement = root?.querySelector<HTMLScriptElement>('[data-foundation-graph-data]')
    const status = root?.querySelector<HTMLElement>('[data-foundation-graph-status]')
    const selectionStatus = root?.querySelector<HTMLElement>('[data-foundation-graph-selection]')
    const hopSelect = root?.querySelector<HTMLSelectElement>('[data-foundation-graph-hop-select]')
    const relationInputs = Array.from(
        root?.querySelectorAll<HTMLInputElement>('[data-foundation-graph-relation]') ?? []
    )
    if (!root || !stage || !dataElement) return

    try {
        const data = readGraphData(dataElement.textContent ?? '')
        const compactLayout = stage.clientWidth < 640
        const positions = createGraphPositions(data, compactLayout)
        const depthById = new Map(data.nodes.map((node) => [node.id, node.dependencyDepth]))
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
        const measureLabel = createLabelMeasure(getComputedStyle(root).getPropertyValue('--vp-font-family-base'))
        const elements: cytoscape.ElementDefinition[] = [
            ...data.nodes.map((node) => {
                const proximityClass =
                    node.id === data.currentId
                        ? 'is-current'
                        : node.dependencyDepth === null
                          ? 'is-typed-relation'
                          : Math.abs(node.dependencyDepth) === 3
                            ? 'is-third-hop'
                            : Math.abs(node.dependencyDepth) === 2
                              ? 'is-second-hop'
                              : 'is-first-hop'
                return {
                    data: { ...node, label: node.title, width: measureLabel(node.title, node.id === data.currentId) },
                    position: positions.get(node.id),
                    classes: proximityClass
                }
            }),
            ...data.edges.map((edge) => {
                const dependencyDepth =
                    edge.relation === 'requires'
                        ? Math.max(Math.abs(depthById.get(edge.source) ?? 0), Math.abs(depthById.get(edge.target) ?? 0))
                        : 1
                const proximityClass =
                    dependencyDepth === 3
                        ? 'is-third-hop-edge'
                        : dependencyDepth === 2
                          ? 'is-second-hop-edge'
                          : 'is-first-hop-edge'
                return {
                    data: edge,
                    classes: [proximityClass],
                    selectable: false,
                    grabbable: false
                }
            })
        ]
        const graph = cytoscape({
            container: stage,
            elements,
            style: createGraphStyles(stage, motion.matches),
            layout: { name: 'preset', fit: true, padding: 42 },
            boxSelectionEnabled: false,
            selectionType: 'single',
            minZoom: 0.06,
            maxZoom: 3
        })

        let activeLayout: cytoscape.Layouts | undefined
        let layoutRun = 0
        let observingResize = false
        let visibleNodeSignature = ''
        const fit = () => {
            graph.resize()
            graph.fit(undefined, 42)
            root.dataset.foundationGraphView = 'full'
        }
        const resizeObserver = new ResizeObserver(() => graph.resize())
        const settle = ({ fitAfter = false }: { fitAfter?: boolean } = {}) => {
            const runId = ++layoutRun
            activeLayout?.stop()
            graph.elements().stop()
            const reducedMotion = motion.matches
            root.dataset.foundationGraphState = 'settling'

            const options: ColaLayoutOptions = {
                name: 'cola',
                animate: !reducedMotion,
                refresh: 1,
                maxSimulationTime: 1600,
                ungrabifyWhileSimulating: false,
                fit: false,
                padding: 42,
                nodeDimensionsIncludeLabels: false,
                randomize: false,
                avoidOverlap: true,
                handleDisconnected: true,
                convergenceThreshold: reducedMotion ? 0.2 : 0.01,
                nodeSpacing: (node) => (node.hasClass('is-current') ? 30 : 22),
                flow: stage.clientWidth < 640 ? { axis: 'y', minSeparation: 108 } : { axis: 'x', minSeparation: 220 },
                centerGraph: false,
                edgeLength: (edge) =>
                    stage.clientWidth < 640
                        ? edge.hasClass('is-first-hop-edge')
                            ? 124
                            : 108
                        : edge.hasClass('is-first-hop-edge')
                          ? 180
                          : 150,
                unconstrIter: reducedMotion ? 0 : 18,
                userConstIter: reducedMotion ? 2 : 30,
                allConstIter: reducedMotion ? 5 : 48,
                infinite: false,
                stop: () => {
                    if (runId !== layoutRun) return
                    activeLayout = undefined
                    if (fitAfter) fit()
                    else root.dataset.foundationGraphView = 'custom'
                    root.dataset.foundationGraphState = 'settled'
                    if (!root.hasAttribute('data-foundation-graph-ready')) {
                        status?.setAttribute('hidden', '')
                        root.setAttribute('data-foundation-graph-ready', '')
                    }
                    if (!observingResize) {
                        resizeObserver.observe(stage)
                        observingResize = true
                    }
                }
            }
            activeLayout = graph
                .elements()
                .not('.is-filtered')
                .layout(options as unknown as cytoscape.LayoutOptions)
            activeLayout.run()
        }
        const applyRelationFilter = ({ reflow = false }: { reflow?: boolean } = {}) => {
            const selectedHops = readGraphHops(hopSelect?.value ?? root.dataset.foundationGraphHops)
            const selectedRelations = new Set<GraphRelation>(
                [...relationInputs].filter((input) => input.checked).map((input) => input.value as GraphRelation)
            )
            const edgeIsWithinSelectedHops = (edge: GraphData['edges'][number]) =>
                edge.relation !== 'requires' ||
                Math.max(Math.abs(depthById.get(edge.source) ?? 0), Math.abs(depthById.get(edge.target) ?? 0)) <=
                    selectedHops
            const edgeIsVisible = (edge: GraphData['edges'][number]) =>
                selectedRelations.has(edge.relation) && edgeIsWithinSelectedHops(edge)
            const visibleNodeIds = new Set<string>([data.currentId])
            const availableEdgeCounts = new Map<GraphRelation, number>()
            let visibleEdgeCount = 0
            for (const edge of data.edges) {
                if (!edgeIsWithinSelectedHops(edge)) continue
                availableEdgeCounts.set(edge.relation, (availableEdgeCounts.get(edge.relation) ?? 0) + 1)
                if (!edgeIsVisible(edge)) continue
                visibleNodeIds.add(edge.source)
                visibleNodeIds.add(edge.target)
                visibleEdgeCount += 1
            }

            graph.batch(() => {
                graph.edges().forEach((edge) => {
                    const visible = edgeIsVisible(edge.data() as GraphData['edges'][number])
                    if (visible) edge.removeClass('is-filtered')
                    else edge.addClass('is-filtered')
                })
                graph.nodes().forEach((node) => {
                    const visible = visibleNodeIds.has(node.id())
                    if (visible) node.removeClass('is-filtered')
                    else node.addClass('is-filtered')
                })
            })

            const selectedLabels = [...relationInputs]
                .filter((input) => input.checked)
                .map((input) => input.dataset.foundationGraphRelationLabel ?? input.value)
            const relationValue = [...selectedRelations].join(' ')
            root.dataset.foundationGraphRelations = relationValue || 'none'
            root.dataset.foundationGraphHops = String(selectedHops)
            root.dataset.foundationGraphVisibleNodes = String(visibleNodeIds.size)
            root.dataset.foundationGraphVisibleEdges = String(visibleEdgeCount)
            relationInputs.forEach((input) => {
                const count = input
                    .closest('label')
                    ?.querySelector<HTMLElement>('[data-foundation-graph-relation-count]')
                if (count) count.textContent = String(availableEdgeCounts.get(input.value as GraphRelation) ?? 0)
            })
            if (selectionStatus) {
                const dependencyDepthLabel = selectedRelations.has('requires')
                    ? `${t(' · 依赖 ', ' · dependency hops: ')}${selectedHops}${t(' 跳', '')}`
                    : ''
                selectionStatus.textContent = selectedLabels.length
                    ? `${t('显示：', 'Showing: ')}${selectedLabels.join(t('、', ', '))}${dependencyDepthLabel} · ${visibleNodeIds.size}${t(' 个节点 / ', visibleNodeIds.size === 1 ? ' node / ' : ' nodes / ')}${visibleEdgeCount}${t(' 条关系', visibleEdgeCount === 1 ? ' relation' : ' relations')}`
                    : t('未选择关系 · 仅显示当前条目', 'No relation selected · showing the current entry only')
            }

            const nextSignature = [...visibleNodeIds].sort().join('|')
            const visibleNodesChanged = nextSignature !== visibleNodeSignature
            visibleNodeSignature = nextSignature
            if (!reflow) return
            if (visibleNodesChanged && visibleNodeIds.size > 1) settle()
            else {
                layoutRun += 1
                activeLayout?.stop()
                activeLayout = undefined
                graph.elements().stop()
                root.dataset.foundationGraphState = 'settled'
                graph.resize()
            }
        }
        const zoom = (factor: number) => {
            graph.zoom({
                level: Math.min(graph.maxZoom(), Math.max(graph.minZoom(), graph.zoom() * factor)),
                renderedPosition: { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }
            })
        }
        root.querySelectorAll<HTMLButtonElement>('[data-foundation-graph-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.foundationGraphAction
                if (action === 'layout') settle()
                else if (action === 'fit') fit()
                else zoom(action === 'zoom-in' ? 1.24 : 1 / 1.24)
            })
        })
        relationInputs.forEach((input) => input.addEventListener('change', () => applyRelationFilter({ reflow: true })))
        hopSelect?.addEventListener('change', () => applyRelationFilter({ reflow: true }))

        graph.on('zoom pan', () => {
            root.dataset.foundationGraphView = 'custom'
        })

        graph.on('mouseover', 'node', (event) => {
            const node = event.target
            stage.style.cursor = 'grab'
            graph.batch(() => {
                graph.elements(':visible').addClass('is-dimmed')
                node.closedNeighborhood().removeClass('is-dimmed')
                node.addClass('is-hovered')
            })
        })
        graph.on('mouseout', 'node', (event) => {
            if (root.dataset.foundationGraphState !== 'dragging') stage.style.cursor = ''
            graph.batch(() => {
                graph.elements().removeClass('is-dimmed')
                event.target.removeClass('is-hovered')
            })
        })
        graph.on('tap', 'node', (event) => {
            if (event.target.id() === data.currentId) return
            const panel = document.querySelector<HTMLDetailsElement>(
                '[data-route-context="selected"] [data-foundation-route-panel]:not([hidden])'
            )
            window.location.assign(
                foundationRouteHref(
                    event.target.data('href'),
                    location.href,
                    panel?.dataset.foundationRoutePanel ?? '',
                    new Set<string>(JSON.parse(panel?.dataset.foundationRoutePaths ?? '[]'))
                )
            )
        })
        graph.on('grab', 'node', () => {
            layoutRun += 1
            activeLayout?.stop()
            activeLayout = undefined
            graph.elements().stop()
            stage.style.cursor = 'grabbing'
            root.dataset.foundationGraphState = 'dragging'
        })
        graph.on('free', 'node', () => {
            stage.style.cursor = 'grab'
            root.dataset.foundationGraphState = 'settled'
        })
        graph.on('dragfree', 'node', (event) => {
            const position = getCollisionFreePosition(graph, event.target)
            if (!position) return

            const runId = ++layoutRun
            root.dataset.foundationGraphState = 'settling'
            if (motion.matches) {
                event.target.position(position)
                root.dataset.foundationGraphState = 'settled'
                return
            }
            event.target.animate(
                { position },
                {
                    duration: 180,
                    easing: 'ease-out',
                    queue: false,
                    complete: () => {
                        if (runId === layoutRun) root.dataset.foundationGraphState = 'settled'
                    }
                }
            )
        })

        const applyStyles = () => graph.style(createGraphStyles(stage, motion.matches))
        document.addEventListener('tio2:theme', applyStyles)
        motion.addEventListener('change', applyStyles)
        window.addEventListener('pagehide', (event) => {
            if (event.persisted) return
            layoutRun += 1
            activeLayout?.stop()
            if (observingResize) resizeObserver.disconnect()
            document.removeEventListener('tio2:theme', applyStyles)
            motion.removeEventListener('change', applyStyles)
            graph.destroy()
        })

        root.dataset.foundationGraphLayout = 'cola'
        applyRelationFilter()
        requestAnimationFrame(() => settle({ fitAfter: true }))
    } catch {
        if (status) {
            status.textContent = t(
                '交互图谱载入失败，请使用下方文字版关系。',
                'The interactive graph failed to load. Use the text relationships below.'
            )
            status.classList.add('is-error')
        }
    }
}

function readGraphData(source: string): GraphData {
    const data = JSON.parse(source) as Partial<GraphData>
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('Invalid Foundation graph data')
    return data as GraphData
}

function readGraphHops(value: string | undefined): GraphHops {
    const hops = Number(value)
    return hops === 1 || hops === 3 ? hops : 2
}

function getCollisionFreePosition(graph: cytoscape.Core, anchor: cytoscape.NodeSingular) {
    const start = anchor.position()
    const position = { ...start }
    const anchorBounds = anchor.boundingBox()
    const anchorHalfWidth = anchorBounds.w / 2
    const anchorHalfHeight = anchorBounds.h / 2
    const collisionMargin = 18
    const otherNodes = graph.nodes(':visible').not(anchor)

    // ponytail: O(n²) is bounded by this local three-hop graph; add a spatial index only if that scope grows.
    for (let pass = 0; pass < otherNodes.length; pass += 1) {
        let foundCollision = false
        otherNodes.forEach((node) => {
            const bounds = node.boundingBox()
            const target = node.position()
            const deltaX = position.x - target.x
            const deltaY = position.y - target.y
            const overlapX = anchorHalfWidth + bounds.w / 2 + collisionMargin - Math.abs(deltaX)
            const overlapY = anchorHalfHeight + bounds.h / 2 + collisionMargin - Math.abs(deltaY)
            if (overlapX <= 0 || overlapY <= 0) return

            foundCollision = true
            if (overlapX < overlapY) position.x += (deltaX > 0 ? 1 : -1) * overlapX
            else position.y += (deltaY > 0 ? 1 : -1) * overlapY
        })
        if (!foundCollision) break
    }

    return position.x === start.x && position.y === start.y ? undefined : position
}

function createGraphPositions(data: GraphData, compact: boolean) {
    const positions = new Map<string, cytoscape.Position>()
    const columnGap = compact ? 154 : 174
    const rowGap = compact ? 50 : 56
    const bandGap = compact ? 96 : 168
    let bandStart = 0

    for (const depth of graphDepths) {
        const nodes = data.nodes.filter((node) => node.dependencyDepth === depth)
        const rowsPerColumn = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 3.2)))
        const columnCount = Math.max(1, Math.ceil(nodes.length / rowsPerColumn))
        nodes.forEach((node, index) => {
            const column = Math.floor(index / rowsPerColumn)
            const row = index % rowsPerColumn
            const nodesInColumn = Math.min(rowsPerColumn, nodes.length - column * rowsPerColumn)
            const primary = bandStart + column * columnGap
            const secondary = (row - (nodesInColumn - 1) / 2) * rowGap
            positions.set(node.id, compact ? { x: secondary, y: primary } : { x: primary, y: secondary })
        })
        bandStart += columnCount * columnGap + bandGap
    }

    const typedNodes = data.nodes.filter((node) => node.dependencyDepth === null)
    const rowsPerColumn = Math.max(1, Math.ceil(Math.sqrt(typedNodes.length * 3.2)))
    typedNodes.forEach((node, index) => {
        const column = Math.floor(index / rowsPerColumn)
        const row = index % rowsPerColumn
        const nodesInColumn = Math.min(rowsPerColumn, typedNodes.length - column * rowsPerColumn)
        const primary = bandStart + column * columnGap
        const secondary = (row - (nodesInColumn - 1) / 2) * rowGap
        positions.set(node.id, compact ? { x: secondary, y: primary } : { x: primary, y: secondary })
    })

    return positions
}

/** Node pills are sized to their labels, capped so long titles truncate rather than crowd the layout. */
function createLabelMeasure(fontFamily: string) {
    const context = document.createElement('canvas').getContext('2d')
    return (label: string, current: boolean) => {
        if (!context) return 152
        context.font = `${current ? 700 : 500} ${current ? 13 : 12}px ${fontFamily || 'sans-serif'}`
        return Math.min(current ? 220 : 184, Math.ceil(context.measureText(label).width) + 28)
    }
}

function createGraphStyles(element: HTMLElement, reducedMotion: boolean): cytoscape.StylesheetJson {
    const styles = getComputedStyle(element)
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    const background = color('--vp-c-bg', '#ffffff')
    const softBackground = color('--vp-c-bg-soft', '#f6f6f7')
    const text = color('--vp-c-text-1', '#3c3c43')
    const muted = color('--vp-c-text-2', '#67676c')
    const divider = color('--vp-c-divider', '#e2e2e3')
    const brand = color('--vp-c-brand', '#2563eb')
    const relationRequires = color('--foundation-relation-requires', '#2563eb')
    const relationClassification = color('--foundation-relation-classification', '#7c3aed')
    const relationUses = color('--foundation-relation-uses', '#15803d')
    const relationImplementation = color('--foundation-relation-implementation', '#b45309')
    const relationEquivalent = color('--foundation-relation-equivalent', '#0f766e')
    const relationContrast = color('--foundation-relation-contrast', '#be123c')
    const title = color('--bt-theme-title', '#000000')
    const fontFamily = color('--vp-font-family-base', 'sans-serif')
    const transitionDuration = reducedMotion ? 0 : 120

    return [
        {
            selector: 'node',
            style: {
                width: 'data(width)',
                height: 32,
                shape: 'round-rectangle',
                'background-color': background,
                'border-width': 1,
                'border-color': divider,
                label: 'data(label)',
                color: text,
                'font-family': fontFamily,
                'font-size': 12,
                'font-weight': 500,
                'text-halign': 'center',
                'text-valign': 'center',
                'text-wrap': 'ellipsis',
                'text-max-width': 'data(width)',
                'overlay-opacity': 0,
                'transition-property': 'opacity, border-color, background-color, color',
                'transition-duration': transitionDuration
            }
        },
        {
            selector: 'node.is-first-hop',
            style: {
                'background-color': brand,
                'background-opacity': 0.08,
                'border-color': brand,
                'border-opacity': 0.5,
                color: title,
                'font-weight': 600
            }
        },
        {
            selector: 'node.is-second-hop',
            style: {
                'border-color': muted,
                'border-opacity': 0.55
            }
        },
        {
            selector: 'node.is-third-hop',
            style: {
                color: muted,
                'font-size': 11
            }
        },
        {
            selector: 'node.is-typed-relation',
            style: {
                'border-style': 'dashed',
                'border-color': muted,
                'border-opacity': 0.72
            }
        },
        {
            selector: 'node.is-current',
            style: {
                height: 38,
                'background-color': brand,
                'background-opacity': 1,
                'border-width': 0,
                color: background,
                'font-size': 13,
                'font-weight': 700
            }
        },
        {
            selector: 'node.is-hovered:not(.is-current), node:selected:not(.is-current)',
            style: {
                'background-color': softBackground,
                'border-width': 2,
                'border-style': 'solid',
                'border-color': brand,
                color: title
            }
        },
        {
            selector: 'edge',
            style: {
                width: 1.6,
                'curve-style': 'bezier',
                'control-point-step-size': 34,
                'line-color': divider,
                'target-arrow-color': divider,
                'target-arrow-shape': 'triangle',
                'arrow-scale': 0.72,
                opacity: 0.72,
                'overlay-opacity': 0,
                'transition-property': 'opacity, line-color',
                'transition-duration': transitionDuration
            }
        },
        {
            selector: 'edge[relation = "requires"]',
            style: {
                'line-color': relationRequires,
                'target-arrow-color': relationRequires,
                'line-style': 'solid'
            }
        },
        {
            selector: 'edge[relation = "special_case_of"]',
            style: {
                'line-color': relationClassification,
                'target-arrow-color': relationClassification,
                'line-style': 'dashed'
            }
        },
        {
            selector: 'edge[relation = "uses"]',
            style: {
                'line-color': relationUses,
                'target-arrow-color': relationUses,
                'target-arrow-shape': 'vee',
                'line-style': 'dotted'
            }
        },
        {
            selector: 'edge[relation = "implemented_by"]',
            style: {
                'line-color': relationImplementation,
                'target-arrow-color': relationImplementation,
                'target-arrow-shape': 'diamond',
                'line-style': 'solid'
            }
        },
        {
            selector: 'edge[relation = "equivalent_to"]',
            style: {
                'line-color': relationEquivalent,
                'target-arrow-shape': 'none',
                'line-style': 'dashed'
            }
        },
        {
            selector: 'edge[relation = "contrasts_with"]',
            style: {
                'line-color': relationContrast,
                'target-arrow-shape': 'none',
                'line-style': 'dotted'
            }
        },
        {
            selector: 'edge.is-second-hop-edge',
            style: {
                width: 1.1,
                'line-style': 'dashed',
                'arrow-scale': 0.64,
                opacity: 0.48
            }
        },
        {
            selector: 'edge.is-third-hop-edge',
            style: {
                width: 0.9,
                'line-style': 'dotted',
                'arrow-scale': 0.56,
                opacity: 0.34
            }
        },
        {
            selector: '.is-filtered',
            style: { display: 'none' }
        },
        {
            selector: '.is-dimmed',
            style: { opacity: 0.13 }
        }
    ]
}
