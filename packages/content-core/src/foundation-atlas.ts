import { FOUNDATION_RELATION_FIELDS } from './foundations'
import type { FoundationCollection, FoundationEntryKind, FoundationRelationField } from './types'

export const FOUNDATION_ATLAS_RELATIONS = {
    requires: {
        label: ['依赖', 'Dependencies'],
        direction: ['前置 → 后续', 'Prerequisite → dependent'],
        outgoing: ['直接后续', 'Direct dependents'],
        incoming: ['直接前置', 'Direct prerequisites']
    },
    uses: {
        label: ['使用', 'Use'],
        direction: ['条目 → 使用的工具', 'Entry → tool used'],
        outgoing: ['使用的工具', 'Tools used'],
        incoming: ['被这些条目使用', 'Used by']
    },
    implemented_by: {
        label: ['实现', 'Implementation'],
        direction: ['抽象 → 具体实现', 'Abstraction → implementation'],
        outgoing: ['具体实现', 'Implementations'],
        incoming: ['实现的抽象', 'Abstractions implemented']
    },
    special_case_of: {
        label: ['分类', 'Classification'],
        direction: ['一般 → 特例', 'General → special case'],
        outgoing: ['直接特例', 'Direct special cases'],
        incoming: ['更一般的概念', 'Broader concepts']
    },
    equivalent_to: {
        label: ['等价', 'Equivalence'],
        direction: ['限定层次等价 · 无向', 'Equivalence at the stated level · undirected'],
        outgoing: ['限定层次等价', 'Equivalent at the stated level'],
        incoming: ['限定层次等价', 'Equivalent at the stated level']
    },
    contrasts_with: {
        label: ['辨析', 'Contrast'],
        direction: ['并列辨析 · 无向', 'Comparison · undirected'],
        outgoing: ['并列辨析', 'Contrasts with'],
        incoming: ['并列辨析', 'Contrasts with']
    }
} as const

export type FoundationAtlasDirection = 'incoming' | 'outgoing' | 'both'

/**
 * A dial: the angle names the subject, the radius counts prerequisite depth.
 * Angles are radians measured clockwise from twelve o'clock.
 */
export interface FoundationAtlas {
    nodes: Array<{
        id: string
        title: string
        aliases: string[]
        description: string
        kind: FoundationEntryKind
        domains: string[]
        href: string
        rank: number
        degree: number
        x: number
        y: number
    }>
    edges: Array<{
        id: string
        source: string
        target: string
        relation: FoundationRelationField
        crossDomain: boolean
    }>
    domains: Array<{
        id: string
        title: string
        group: string
        count: number
        start: number
        end: number
        hue: number
    }>
    groups: Array<{ id: string; title: string; count: number; start: number; end: number }>
    /** Inner boundary of every depth band, followed by the rim. */
    rings: number[]
    /** Cross-subject relations gather on this circle before crossing the centre. */
    gate: number
    radius: number
}

const TAU = Math.PI * 2
const NODE_SPACING = 26
const ROW_GAP = 24
const BAND_GAP = 12
const WEDGE_PADDING = 14
const FIRST_RING = 340
const GATE = 290
const GROUP_GAP = 0.17
const DOMAIN_GAP = 0.03
const round = (value: number) => Math.round(value * 100) / 100

export function foundationAtlasPoint(radius: number, angle: number) {
    return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) }
}

/** Clockwise angle from twelve o'clock, in [0, 2π). */
export function foundationAtlasAngle(x: number, y: number) {
    return (Math.atan2(x, -y) + TAU) % TAU
}

/** Requires and classification point from foundation to consequence; symmetric assertions appear once. */
export function createFoundationAtlas(collection: FoundationCollection): FoundationAtlas {
    const entries = collection.entries.filter((entry) => entry.kind !== 'navigation')
    const entryById = new Map(entries.map((entry) => [entry.id, entry]))
    const ranks = new Map<string, number>()
    const rankFor = (id: string): number => {
        const known = ranks.get(id)
        if (known !== undefined) return known
        const prerequisites = entryById.get(id)?.requires ?? []
        const rank = prerequisites.length ? 1 + Math.max(...prerequisites.map(rankFor)) : 0
        ranks.set(id, rank)
        return rank
    }
    const edges: FoundationAtlas['edges'] = []
    const degrees = new Map<string, number>()
    for (const entry of entries) {
        for (const relation of FOUNDATION_RELATION_FIELDS) {
            for (const targetId of entry[relation]) {
                if ((relation === 'equivalent_to' || relation === 'contrasts_with') && entry.id > targetId) continue
                const target = entryById.get(targetId)!
                const reversed = relation === 'requires' || relation === 'special_case_of'
                const sourceId = reversed ? targetId : entry.id
                const destinationId = reversed ? entry.id : targetId
                edges.push({
                    id: `${relation}:${sourceId}->${destinationId}`,
                    source: sourceId,
                    target: destinationId,
                    relation,
                    crossDomain: !entry.domains.some((domain) => target.domains.includes(domain))
                })
                for (const id of [entry.id, targetId]) degrees.set(id, (degrees.get(id) ?? 0) + 1)
            }
        }
    }

    // The first wing reads down the left side and later wings down the right, so both begin at the top.
    const [firstGroup, ...laterGroups] = collection.groups
    const dial = [
        ...laterGroups.map((group) => ({ group, domains: group.domains })),
        ...(firstGroup ? [{ group: firstGroup, domains: [...firstGroup.domains].reverse() }] : [])
    ]
    const members = new Map<string, typeof entries>()
    for (const entry of entries) {
        const list = members.get(entry.domains[0]) ?? []
        list.push(entry)
        members.set(entry.domains[0], list)
    }
    const weight = (id: string) => Math.max(1, members.get(id)?.length ?? 0) ** 0.85
    const domainTotal = dial.reduce((sum, wing) => sum + wing.domains.length, 0)
    const available = TAU - Math.max(1, dial.length) * GROUP_GAP - Math.max(0, domainTotal - dial.length) * DOMAIN_GAP
    const weightTotal = dial.reduce(
        (sum, wing) => sum + wing.domains.reduce((inner, domain) => inner + weight(domain.id), 0),
        0
    )
    const domains: FoundationAtlas['domains'] = []
    const groups: FoundationAtlas['groups'] = []
    let cursor = GROUP_GAP / 2
    for (const wing of dial) {
        const start = cursor
        let count = 0
        wing.domains.forEach((domain, index) => {
            const span = (available * weight(domain.id)) / weightTotal
            const middle = cursor + span / 2
            domains.push({
                id: domain.id,
                title: domain.title,
                group: wing.group.id,
                count: members.get(domain.id)?.length ?? 0,
                start: cursor,
                end: cursor + span,
                hue: Math.round(195 + 260 * (1 - middle / TAU)) % 360
            })
            count += members.get(domain.id)?.length ?? 0
            cursor += span + (index < wing.domains.length - 1 ? DOMAIN_GAP : 0)
        })
        groups.push({ id: wing.group.id, title: wing.group.title, count, start, end: cursor })
        cursor += GROUP_GAP
    }

    const nodes: FoundationAtlas['nodes'] = []
    const rings: number[] = []
    const depth = Math.max(0, ...entries.map((entry) => rankFor(entry.id)))
    let boundary = FIRST_RING
    for (let rank = 0; rank <= depth; rank++) {
        rings.push(boundary)
        const firstRow = boundary + (ROW_GAP + BAND_GAP) / 2
        let rows = 1
        for (const domain of domains) {
            const cell = (members.get(domain.id) ?? [])
                .filter((entry) => rankFor(entry.id) === rank)
                .sort((a, b) => (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0) || a.id.localeCompare(b.id))
            if (!cell.length) continue
            const capacities: number[] = []
            let capacity = 0
            while (capacity < cell.length) {
                const arc = (domain.end - domain.start) * (firstRow + capacities.length * ROW_GAP)
                capacities.push(Math.max(1, Math.floor((arc - 2 * WEDGE_PADDING) / NODE_SPACING) + 1))
                capacity += capacities.at(-1)!
            }
            rows = Math.max(rows, capacities.length)
            let placed = 0
            capacities.forEach((size, row) => {
                const radius = firstRow + row * ROW_GAP
                const count =
                    row === capacities.length - 1
                        ? cell.length - placed
                        : Math.min(size, cell.length - placed, Math.ceil((cell.length * size) / capacity))
                // Better-connected concepts take the axis of the subject; the row grows outward from it.
                const slots = Array.from({ length: count }, (_, slot) => slot - (count - 1) / 2).sort(
                    (a, b) => Math.abs(a) - Math.abs(b) || a - b
                )
                slots.forEach((slot, index) => {
                    const entry = cell[placed + index]
                    const point = foundationAtlasPoint(
                        radius,
                        (domain.start + domain.end) / 2 + (slot * NODE_SPACING) / radius
                    )
                    nodes.push({
                        id: entry.id,
                        title: entry.title,
                        aliases: entry.aliases,
                        description: entry.description,
                        kind: entry.kind,
                        domains: entry.domains,
                        href: entry.regularPath,
                        rank,
                        degree: degrees.get(entry.id) ?? 0,
                        x: round(point.x),
                        y: round(point.y)
                    })
                })
                placed += count
            })
        }
        boundary += rows * ROW_GAP + BAND_GAP
    }
    rings.push(boundary)
    return { nodes, edges, domains, groups, rings, gate: GATE, radius: boundary }
}

/** Wings and their subjects in authored reading order; the dial itself stores them clockwise. */
export function foundationAtlasWings(atlas: Pick<FoundationAtlas, 'groups' | 'domains'>) {
    const groups = atlas.groups.length ? [atlas.groups.at(-1)!, ...atlas.groups.slice(0, -1)] : []
    return groups.map((group, index) => {
        const domains = atlas.domains.filter((domain) => domain.group === group.id)
        return { group, domains: index ? domains : domains.reverse() }
    })
}

/**
 * Relations inside a subject bow gently along the dial. Relations between subjects descend to the
 * subject's gate, cross the hub together and rise again, so the centre reads as a chord diagram.
 * Returns a start point followed by cubic Bézier triples: [x0, y0, (c1x, c1y, c2x, c2y, x, y)…].
 */
export function createFoundationAtlasCurves(atlas: FoundationAtlas) {
    const nodeById = new Map(atlas.nodes.map((node) => [node.id, node]))
    const middle = new Map(atlas.domains.map((domain) => [domain.id, (domain.start + domain.end) / 2]))
    return (edge: Pick<FoundationAtlas['edges'][number], 'source' | 'target'>) => {
        const source = nodeById.get(edge.source)!
        const target = nodeById.get(edge.target)!
        if (source.domains[0] === target.domains[0]) {
            const from = foundationAtlasAngle(source.x, source.y)
            const to = foundationAtlasAngle(target.x, target.y)
            const radius =
                (Math.hypot(source.x, source.y) + Math.hypot(target.x, target.y)) / 2 / Math.cos((to - from) / 2)
            const bend = foundationAtlasPoint(radius, (from + to) / 2)
            return [
                source.x,
                source.y,
                source.x + ((bend.x - source.x) * 2) / 3,
                source.y + ((bend.y - source.y) * 2) / 3,
                target.x + ((bend.x - target.x) * 2) / 3,
                target.y + ((bend.y - target.y) * 2) / 3,
                target.x,
                target.y
            ].map(round)
        }
        const from = middle.get(source.domains[0])!
        const to = middle.get(target.domains[0])!
        const control = [
            source,
            source,
            source,
            foundationAtlasPoint(atlas.gate, from),
            foundationAtlasPoint(atlas.gate * 0.56, from),
            foundationAtlasPoint(atlas.gate * 0.56, to),
            foundationAtlasPoint(atlas.gate, to),
            target,
            target,
            target
        ]
        const curve = [source.x, source.y]
        for (let index = 0; index + 3 < control.length; index++) {
            const [, b, c, d] = control.slice(index, index + 4)
            curve.push(
                (2 * b.x + c.x) / 3,
                (2 * b.y + c.y) / 3,
                (b.x + 2 * c.x) / 3,
                (b.y + 2 * c.y) / 3,
                (b.x + 4 * c.x + d.x) / 6,
                (b.y + 4 * c.y + d.y) / 6
            )
        }
        return curve.map(round)
    }
}

/** A subject's colour in sRGB hex. Lightness and chroma are constant in OKLCH, so no subject shouts. */
export function foundationAtlasColor(hue: number, theme: 'light' | 'dark', emphasis = 0) {
    const lightness = (theme === 'dark' ? 0.78 : 0.53) + emphasis * (theme === 'dark' ? 0.1 : -0.1)
    const chroma = theme === 'dark' ? 0.125 : 0.15
    const a = chroma * Math.cos((hue * Math.PI) / 180)
    const b = chroma * Math.sin((hue * Math.PI) / 180)
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
    return `#${[
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ]
        .map((channel) => {
            const linear = Math.min(1, Math.max(0, channel))
            const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
            return Math.round(encoded * 255)
                .toString(16)
                .padStart(2, '0')
        })
        .join('')}`
}

export interface FoundationAtlasFilter {
    domain: string
    kind: string
    relations: Set<FoundationRelationField>
    crossDomainOnly: boolean
    focusId?: string
    hops: number
}

/** Retain isolated nodes in the overview; neighborhood traversal never invents shortcut edges. */
export function projectFoundationAtlas(data: FoundationAtlas, filter: FoundationAtlasFilter) {
    const eligible = new Set(
        data.nodes
            .filter(
                (node) =>
                    (filter.domain === 'all' || node.domains.includes(filter.domain)) &&
                    (filter.kind === 'all' || node.kind === filter.kind)
            )
            .map((node) => node.id)
    )
    let edges = data.edges.filter(
        (edge) =>
            filter.relations.has(edge.relation) &&
            (!filter.crossDomainOnly || edge.crossDomain) &&
            eligible.has(edge.source) &&
            eligible.has(edge.target)
    )
    let nodeIds = eligible
    if (filter.focusId) {
        nodeIds = new Set(eligible.has(filter.focusId) ? [filter.focusId] : [])
        const adjacent = new Map<string, string[]>()
        for (const edge of edges) {
            for (const [a, b] of [
                [edge.source, edge.target],
                [edge.target, edge.source]
            ]) {
                const neighbours = adjacent.get(a) ?? []
                neighbours.push(b)
                adjacent.set(a, neighbours)
            }
        }
        let frontier = [...nodeIds]
        for (let hop = 0; hop < filter.hops; hop++) {
            const next: string[] = []
            for (const id of frontier) {
                for (const neighbour of adjacent.get(id) ?? []) {
                    if (nodeIds.has(neighbour)) continue
                    nodeIds.add(neighbour)
                    next.push(neighbour)
                }
            }
            frontier = next
        }
        edges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    }
    return { nodeIds, edges }
}

export interface FoundationAtlasNeighborhood {
    /** `ring` is the hop distance; `parent` is the first-hop concept a second-hop concept hangs from. */
    positions: Map<string, { x: number; y: number; angle: number; ring: number; parent?: string }>
    /** Radius of each hop ring, starting with the first hop. */
    rings: number[]
    /** How the first hop relates to the focus, clockwise from twelve o'clock. */
    sectors: Array<{
        relation: FoundationRelationField
        direction: FoundationAtlasDirection
        start: number
        end: number
        count: number
    }>
    radius: number
}

// What follows from the focus opens to the right, lateral assertions sit below, what it rests on is on the left.
const NEIGHBORHOOD_SECTORS: Array<[FoundationRelationField, FoundationAtlasDirection]> = [
    ['requires', 'outgoing'],
    ['special_case_of', 'outgoing'],
    ['implemented_by', 'outgoing'],
    ['uses', 'incoming'],
    ['equivalent_to', 'both'],
    ['contrasts_with', 'both'],
    ['uses', 'outgoing'],
    ['implemented_by', 'incoming'],
    ['special_case_of', 'incoming'],
    ['requires', 'incoming']
]
const SECTOR_PRIORITY: FoundationRelationField[] = [
    'requires',
    'special_case_of',
    'implemented_by',
    'uses',
    'equivalent_to',
    'contrasts_with'
]

/**
 * Re-centre a projected neighborhood on its focus: first-hop concepts are grouped by their relation
 * to it, second-hop concepts fan out behind the first-hop concept that reaches them.
 */
export function layoutFoundationNeighborhood(
    data: FoundationAtlas,
    projection: ReturnType<typeof projectFoundationAtlas>,
    focusId: string
): FoundationAtlasNeighborhood {
    const positions: FoundationAtlasNeighborhood['positions'] = new Map()
    if (!projection.nodeIds.has(focusId)) return { positions, rings: [], sectors: [], radius: 0 }
    positions.set(focusId, { x: 0, y: 0, angle: 0, ring: 0 })
    const nodeById = new Map(data.nodes.map((node) => [node.id, node]))
    const dialOrder = new Map(data.domains.map((domain, index) => [domain.id, index]))
    const order = (a: string, b: string) => {
        const left = nodeById.get(a)!
        const right = nodeById.get(b)!
        return (
            dialOrder.get(left.domains[0])! - dialOrder.get(right.domains[0])! ||
            right.degree - left.degree ||
            a.localeCompare(b)
        )
    }
    const adjacent = new Map<string, Set<string>>()
    const sectorOf = new Map<string, number>()
    for (const edge of projection.edges) {
        for (const [a, b] of [
            [edge.source, edge.target],
            [edge.target, edge.source]
        ]) {
            if (!adjacent.has(a)) adjacent.set(a, new Set())
            adjacent.get(a)!.add(b)
        }
        if (edge.source !== focusId && edge.target !== focusId) continue
        const other = edge.source === focusId ? edge.target : edge.source
        const symmetric = edge.relation === 'equivalent_to' || edge.relation === 'contrasts_with'
        const direction = symmetric ? 'both' : edge.source === focusId ? 'outgoing' : 'incoming'
        const sector = NEIGHBORHOOD_SECTORS.findIndex(
            ([relation, side]) => relation === edge.relation && side === direction
        )
        const known = sectorOf.get(other)
        if (
            known === undefined ||
            SECTOR_PRIORITY.indexOf(edge.relation) < SECTOR_PRIORITY.indexOf(NEIGHBORHOOD_SECTORS[known][0])
        )
            sectorOf.set(other, sector)
    }
    const first = [...sectorOf.keys()].sort((a, b) => sectorOf.get(a)! - sectorOf.get(b)! || order(a, b))
    if (!first.length) return { positions, rings: [], sectors: [], radius: 0 }
    const children = new Map<string, string[]>(first.map((id) => [id, []]))
    for (const id of [...projection.nodeIds].sort(order)) {
        if (id === focusId || sectorOf.has(id)) continue
        const parent = first.find((candidate) => adjacent.get(candidate)?.has(id))
        if (parent) children.get(parent)!.push(id)
    }
    const outer = first.reduce((sum, id) => sum + children.get(id)!.length, 0)
    // A childless concept still needs room among siblings that carry long fans.
    const floor = Math.max(1, Math.round(outer / first.length))
    const weights = first.map((id) => Math.max(floor, children.get(id)!.length))
    const used = [...new Set(first.map((id) => sectorOf.get(id)!))]
    const gap = used.length > 1 ? 0.14 : 0
    const unit = (TAU - gap * used.length) / weights.reduce((sum, value) => sum + value, 0)
    const sectors: FoundationAtlasNeighborhood['sectors'] = []
    const angles = new Map<string, number>()
    const fans: Array<{ id: string; angle: number; parent: string }> = []
    let cursor = gap / 2
    let firstStep = TAU
    let outerStep = TAU
    first.forEach((id, index) => {
        const sector = sectorOf.get(id)!
        if (!index || sectorOf.get(first[index - 1]) !== sector)
            sectors.push({
                relation: NEIGHBORHOOD_SECTORS[sector][0],
                direction: NEIGHBORHOOD_SECTORS[sector][1],
                start: cursor,
                end: cursor,
                count: 0
            })
        const span = weights[index] * unit
        const angle = cursor + span / 2
        if (index) firstStep = Math.min(firstStep, angle - angles.get(first[index - 1])!)
        angles.set(id, angle)
        const fan = children.get(id)!
        fan.forEach((child, slot) =>
            fans.push({ id: child, angle: cursor + ((slot + 0.5) * span) / fan.length, parent: id })
        )
        if (fan.length) outerStep = Math.min(outerStep, span / fan.length)
        cursor += span
        sectors.at(-1)!.end = cursor
        sectors.at(-1)!.count += 1
        if (sectorOf.get(first[index + 1]) !== sector) cursor += gap
    })
    if (first.length > 1) firstStep = Math.min(firstStep, TAU - angles.get(first.at(-1)!)! + angles.get(first[0])!)
    const firstRing = Math.max(230, 30 / firstStep)
    const rings = [round(firstRing)]
    for (const id of first) {
        const point = foundationAtlasPoint(firstRing, angles.get(id)!)
        positions.set(id, { x: round(point.x), y: round(point.y), angle: angles.get(id)!, ring: 1 })
    }
    if (fans.length) {
        const outerRing = Math.max(firstRing + 280, 22 / outerStep)
        rings.push(round(outerRing))
        for (const fan of fans) {
            const point = foundationAtlasPoint(outerRing, fan.angle)
            positions.set(fan.id, {
                x: round(point.x),
                y: round(point.y),
                angle: fan.angle,
                ring: 2,
                parent: fan.parent
            })
        }
    }
    return { positions, rings, sectors, radius: rings.at(-1)! }
}
