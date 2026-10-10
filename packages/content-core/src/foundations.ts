import type {
    FoundationCollection,
    FoundationDependencyDepth,
    FoundationRelationGraph,
    FoundationDomain,
    FoundationEntry,
    FoundationEntryKind,
    FoundationGroupDefinition,
    FoundationRelationField,
    FoundationRoute
} from './types'
import { createFoundationTargetId, normalizeLookup } from './reference-utils'
import { createMarkdownRoute } from './route-utils'

export interface FoundationEntryInput {
    title: string
    id: string
    aliases: string[]
    kind: string
    domains: string[]
    requires: string[]
    uses: string[]
    implemented_by: string[]
    special_case_of: string[]
    equivalent_to: string[]
    contrasts_with: string[]
    description: string
    sourcePath: string
    regularPath: string
}

export const FOUNDATION_KINDS: FoundationEntryKind[] = [
    'axiom',
    'principle',
    'definition',
    'model',
    'method',
    'algorithm',
    'theorem',
    'application',
    'navigation'
]

export const FOUNDATION_KIND_LABELS: Record<FoundationEntryKind, string> = {
    axiom: '公理',
    principle: '原则',
    definition: '定义',
    model: '模型',
    method: '方法',
    algorithm: '算法',
    theorem: '定理',
    application: '应用',
    navigation: '导航'
}

export const FOUNDATION_KIND_ENGLISH: Record<FoundationEntryKind, string> = {
    axiom: 'Axiom',
    principle: 'Principle',
    definition: 'Definition',
    model: 'Model',
    method: 'Method',
    algorithm: 'Algorithm',
    theorem: 'Theorem',
    application: 'Application',
    navigation: 'Navigation'
}

export const FOUNDATION_RELATION_FIELDS: FoundationRelationField[] = [
    'requires',
    'uses',
    'implemented_by',
    'special_case_of',
    'equivalent_to',
    'contrasts_with'
]

const foundationKindSet = new Set<string>(FOUNDATION_KINDS)
const foundationIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

function isLocalHtmlUrl(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\/[^?\s"<>\\#]+\.html(?:#[^\s"<>\\]+)?$/u.test(value)) return false
    const pathname = value.split('#')[0]
    try {
        const segments = pathname.slice(1).split('/').map(decodeURIComponent)
        return (
            segments.every((part) => part && part !== '.' && part !== '..' && !/[/\\\p{Cc}]/u.test(part)) &&
            createMarkdownRoute(segments.join('/')) === pathname
        )
    } catch {
        return false
    }
}

export interface FoundationCollectionOptions {
    groups: FoundationGroupDefinition[]
    routes?: FoundationRoute[]
}

export function createFoundationCollection(
    inputs: FoundationEntryInput[],
    { groups, routes = [] }: FoundationCollectionOptions
): FoundationCollection {
    const errors: string[] = []
    const inputById = new Map<string, FoundationEntryInput>()
    const groupIds = new Set<string>()
    const foundationDomainSet = new Set<string>()
    const domainAnchors = new Set<string>()

    for (const group of groups) {
        if (!foundationIdPattern.test(group.id)) {
            errors.push(`foundation group id “${group.id}” must use lowercase kebab-case`)
        }
        if (groupIds.has(group.id)) errors.push(`duplicate foundation group id “${group.id}”`)
        groupIds.add(group.id)
        for (const domain of group.domains) {
            if (!/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u.test(domain.id)) {
                errors.push(`foundation domain id “${domain.id}” must use lowercase kebab-case segments`)
            }
            if (domain.group !== group.id) {
                errors.push(`foundation domain “${domain.id}” belongs to “${domain.group}”, expected “${group.id}”`)
            }
            if (foundationDomainSet.has(domain.id)) {
                errors.push(`duplicate foundation domain id “${domain.id}”`)
            }
            const anchor = domain.id.replaceAll('/', '-')
            if (domainAnchors.has(anchor)) {
                errors.push(`ambiguous foundation domain anchor “${anchor}”`)
            }
            foundationDomainSet.add(domain.id)
            domainAnchors.add(anchor)
        }
    }

    for (const input of inputs) {
        if (!foundationIdPattern.test(input.id)) {
            errors.push(`${input.sourcePath}: id “${input.id}” must use lowercase kebab-case`)
        }
        if (inputById.has(input.id)) {
            errors.push(`${input.sourcePath}: duplicate id “${input.id}”`)
        } else {
            inputById.set(input.id, input)
        }
        if (!foundationKindSet.has(input.kind)) {
            errors.push(`${input.sourcePath}: unknown kind “${input.kind}”`)
        }
        if (!input.domains.length) {
            errors.push(`${input.sourcePath}: domains must contain at least one domain`)
        }
        for (const domain of input.domains) {
            if (!foundationDomainSet.has(domain)) {
                errors.push(`${input.sourcePath}: unknown domain “${domain}”`)
            }
        }

        const populatedNavigationFields = FOUNDATION_RELATION_FIELDS.filter(
            (field) => Array.isArray(input[field]) && input[field].length
        )
        if (input.kind === 'navigation' && populatedNavigationFields.length) {
            errors.push(
                `${input.sourcePath}: navigation entries must keep all six relation fields empty (found ${populatedNavigationFields.join(', ')})`
            )
        }

        for (const field of FOUNDATION_RELATION_FIELDS) {
            const targets = input[field]
            if (!Array.isArray(targets)) {
                errors.push(`${input.sourcePath}: ${field} must be an array`)
                continue
            }

            const seen = new Set<string>()
            for (const targetId of targets) {
                if (targetId === input.id) {
                    errors.push(
                        field === 'requires'
                            ? `${input.sourcePath}: “${input.id}” cannot require itself`
                            : `${input.sourcePath}: “${input.id}” cannot reference itself through ${field}`
                    )
                }
                if (seen.has(targetId)) {
                    errors.push(`${input.sourcePath}: duplicate ${field} target “${targetId}”`)
                }
                seen.add(targetId)
            }
        }
    }

    for (const input of inputs) {
        for (const field of FOUNDATION_RELATION_FIELDS) {
            const targets = input[field]
            if (!Array.isArray(targets)) continue

            for (const targetId of targets) {
                const target = inputById.get(targetId)
                if (!target) {
                    errors.push(
                        field === 'requires'
                            ? `${input.sourcePath}: missing prerequisite “${targetId}”`
                            : `${input.sourcePath}: missing ${field} target “${targetId}”`
                    )
                    continue
                }
                if (target.kind === 'navigation') {
                    errors.push(`${input.sourcePath}: navigation entry “${targetId}” cannot be a ${field} target`)
                }
            }
        }

        for (const field of ['equivalent_to', 'contrasts_with'] as const) {
            for (const targetId of input[field]) {
                const target = inputById.get(targetId)
                if (!target || target.kind === 'navigation' || !Array.isArray(target[field])) continue
                if (!target[field].includes(input.id)) {
                    errors.push(
                        `${input.sourcePath}: ${field} relation “${input.id}” → “${targetId}” must be symmetric`
                    )
                }
            }
        }

        const contrasts = new Set(input.contrasts_with)
        for (const targetId of input.equivalent_to) {
            if (contrasts.has(targetId)) {
                errors.push(
                    `${input.sourcePath}: “${input.id}” and “${targetId}” cannot be both equivalent_to and contrasts_with`
                )
            }
        }
    }

    const dependencyCycle = findRelationCycle(inputById, 'requires')
    if (dependencyCycle) {
        errors.push(`dependency cycle: ${dependencyCycle.join(' → ')}`)
    }
    const classificationCycle = findRelationCycle(inputById, 'special_case_of')
    if (classificationCycle) {
        errors.push(`classification cycle: ${classificationCycle.join(' → ')}`)
    }

    const routeIds = new Set<string>()
    for (const route of routes) {
        if (route.capstoneHref !== undefined && !isLocalHtmlUrl(route.capstoneHref)) {
            errors.push(`foundation route “${route.id}” capstoneHref must be a local HTML URL`)
        }
        if (route.featured !== undefined && typeof route.featured !== 'boolean') {
            errors.push(`foundation route “${route.id}” featured must be a boolean`)
        }
        if (routeIds.has(route.id)) {
            errors.push(`duplicate foundation route id “${route.id}”`)
        }
        routeIds.add(route.id)
        if (route.entries.length < 2) {
            errors.push(`foundation route “${route.id}” must contain at least two entries`)
        }
        for (const entryId of route.entries) {
            if (!inputById.has(entryId)) {
                errors.push(`foundation route “${route.id}” references missing entry “${entryId}”`)
            }
        }
    }

    if (errors.length) {
        throw new Error(`Invalid foundations collection:\n- ${errors.join('\n- ')}`)
    }

    const entries = inputs.map((input) => ({
        ...input,
        kind: input.kind as FoundationEntryKind,
        domains: input.domains as FoundationDomain[]
    }))
    entries.sort(compareFoundationEntries)

    return {
        entries,
        groups,
        routes,
        entryCount: entries.length
    }
}

export function createFoundationPageData(collection: FoundationCollection, id: string) {
    const current = collection.entries.find((entry) => entry.id === id)
    if (!current) return null

    const entryById = new Map(collection.entries.map((entry) => [entry.id, entry]))
    const entriesFor = (ids: string[]) => ids.map((entryId) => entryById.get(entryId) as FoundationEntry)
    const dependentsById = new Map<string, FoundationEntry[]>()
    for (const entry of collection.entries) {
        for (const prerequisiteId of entry.requires) {
            const dependents = dependentsById.get(prerequisiteId) ?? []
            dependents.push(entry)
            dependentsById.set(prerequisiteId, dependents)
        }
    }
    const readingRoutes = collection.routes.flatMap((route) => {
        const index = route.entries.indexOf(id)
        if (index < 0) return []
        return [{
            id: route.id,
            title: route.title,
            position: index + 1,
            total: route.entries.length,
            previous: entryById.get(route.entries[index - 1]) ?? null,
            next: entryById.get(route.entries[index + 1]) ?? null,
            capstoneHref: route.capstoneHref,
            entryPaths: entriesFor(route.entries).map((entry) => entry.regularPath)
        }]
    })
    // A direct arrival must never inherit whichever route happens to be listed first.
    const unambiguousRoute = readingRoutes.length === 1 ? readingRoutes[0] : null
    return {
        current,
        prerequisites: entriesFor(current.requires),
        dependents: dependentsById.get(id) ?? [],
        relationGraph: createLocalRelationGraph(collection, current, entryById, dependentsById),
        classification: {
            broader: entriesFor(current.special_case_of),
            narrower: collection.entries.filter((entry) => entry.special_case_of.includes(id))
        },
        typedRelations: {
            uses: entriesFor(current.uses),
            usedBy: collection.entries.filter((entry) => entry.uses.includes(id)),
            implementedBy: entriesFor(current.implemented_by),
            implements: collection.entries.filter((entry) => entry.implemented_by.includes(id)),
            equivalentTo: entriesFor(current.equivalent_to),
            contrastsWith: entriesFor(current.contrasts_with)
        },
        readingRoutes,
        recommendedNext: unambiguousRoute?.next
            ? { entry: unambiguousRoute.next, routeTitle: unambiguousRoute.title }
            : null
    }
}

function createLocalRelationGraph(
    collection: FoundationCollection,
    current: FoundationEntry,
    entryById: Map<string, FoundationEntry>,
    dependentsById: Map<string, FoundationEntry[]>
): FoundationRelationGraph {
    const depthById = new Map<string, FoundationDependencyDepth>([[current.id, 0]])
    const walk = (direction: -1 | 1, neighboursFor: (entry: FoundationEntry) => FoundationEntry[]) => {
        let frontier = [current]
        for (let hop = 1; hop <= 3; hop += 1) {
            const next = new Map<string, FoundationEntry>()
            for (const entry of frontier) {
                for (const neighbour of neighboursFor(entry)) {
                    if (depthById.has(neighbour.id)) continue
                    depthById.set(neighbour.id, (direction * hop) as FoundationDependencyDepth)
                    next.set(neighbour.id, neighbour)
                }
            }
            frontier = [...next.values()]
        }
    }

    walk(-1, (entry) => entry.requires.map((requiredId) => entryById.get(requiredId) as FoundationEntry))
    walk(1, (entry) => dependentsById.get(entry.id) ?? [])

    const dependencyNodeIds = new Set(depthById.keys())
    const graphNodeIds = new Set(dependencyNodeIds)
    const edges: FoundationRelationGraph['edges'] = collection.entries.flatMap((target) =>
        dependencyNodeIds.has(target.id)
            ? target.requires.flatMap((source) =>
                  dependencyNodeIds.has(source)
                      ? [{ id: `${source}->${target.id}`, source, target: target.id, relation: 'requires' }]
                      : []
              )
            : []
    )
    for (const relation of FOUNDATION_RELATION_FIELDS.filter((field) => field !== 'requires')) {
        for (const entry of collection.entries) {
            for (const relatedId of entry[relation]) {
                if (entry.id !== current.id && relatedId !== current.id) continue

                // Display classification from general to specific, and emit symmetric assertions once from the focus.
                let source = entry.id
                let target = relatedId
                if (relation === 'special_case_of') [source, target] = [target, source]
                if ((relation === 'equivalent_to' || relation === 'contrasts_with') && entry.id !== current.id) {
                    continue
                }

                const edgeId = `${relation}:${source}->${target}`
                graphNodeIds.add(source)
                graphNodeIds.add(target)
                edges.push({ id: edgeId, source, target, relation })
            }
        }
    }

    return {
        currentId: current.id,
        nodes: collection.entries.flatMap((entry) => {
            if (!graphNodeIds.has(entry.id)) return []
            return [
                {
                    id: entry.id,
                    title: entry.title,
                    kind: entry.kind,
                    href: entry.regularPath,
                    dependencyDepth: depthById.get(entry.id) ?? null
                }
            ]
        }),
        edges
    }
}

export interface FoundationGraphAuditOptions {
    redundantEdgeAllowlist?: Iterable<string>
}

export const FOUNDATION_CONTENT_SECTIONS = {
    'zh-CN': ['形式陈述', '直觉', '例子与边界', '推论与应用', '参考资料'],
    en: ['Formal statement', 'Intuition', 'Examples and boundaries', 'Consequences and applications', 'References']
}

export interface FoundationContentContractEntry {
    id: string
    title: string
    description: string
    aliases: string[]
    kind: FoundationEntryKind
    requires: string[]
    uses: string[]
    implemented_by: string[]
    special_case_of: string[]
    equivalent_to: string[]
    contrasts_with: string[]
    sections: string[]
    bodyReferenceTargetIds: string[]
}

export function auditFoundationContentContract(entries: FoundationContentContractEntry[]) {
    const lookupOwners = new Map<string, Set<string>>()
    const metadataErrors: string[] = []
    const relationWitnessErrors: string[] = []
    const sectionErrors: string[] = []

    for (const entry of entries) {
        for (const [field, values] of [
            ['title', [entry.title]],
            ['description', [entry.description]],
            ['aliases', entry.aliases],
            ...FOUNDATION_RELATION_FIELDS.map((field) => [field, entry[field]] as const)
        ] as const) {
            if (values.some((value) => value.includes('[[') || value.includes(']]'))) {
                metadataErrors.push(`${entry.id}: ${field} contains body-only wiki markup`)
            }
        }

        const referenceAliases = entry.kind === 'navigation' ? [] : entry.aliases
        for (const lookup of [entry.id, entry.title, ...referenceAliases]) {
            const key = normalizeLookup(lookup)
            const owners = lookupOwners.get(key) ?? new Set<string>()
            owners.add(entry.id)
            lookupOwners.set(key, owners)
        }

        if (
            entry.kind !== 'navigation' &&
            !Object.values(FOUNDATION_CONTENT_SECTIONS).some(
                (sections) => entry.sections.join('\n') === sections.join('\n')
            )
        ) {
            sectionErrors.push(`${entry.id}: ${entry.sections.join(' / ') || '(no H2 sections)'}`)
        }

        const bodyReferenceTargetIds = new Set(entry.bodyReferenceTargetIds)
        for (const field of FOUNDATION_RELATION_FIELDS) {
            for (const targetId of entry[field]) {
                if (!bodyReferenceTargetIds.has(createFoundationTargetId(targetId))) {
                    relationWitnessErrors.push(
                        `${entry.id}: ${field} relation “${targetId}” has no body wiki reference`
                    )
                }
            }
        }
    }

    const aliasErrors = [...lookupOwners]
        .filter(([, owners]) => owners.size > 1)
        .map(([lookup, owners]) => `${lookup}: ${[...owners].sort().join(', ')}`)

    return {
        metadataErrors: metadataErrors.sort(),
        aliasErrors: aliasErrors.sort(),
        relationWitnessErrors: relationWitnessErrors.sort(),
        sectionErrors: sectionErrors.sort()
    }
}

export function auditFoundationGraph(collection: FoundationCollection, options: FoundationGraphAuditOptions = {}) {
    const entryById = new Map(collection.entries.map((entry) => [entry.id, entry]))
    const redundantEdgeAllowlist = new Set(options.redundantEdgeAllowlist ?? [])
    const redundantEdges: string[] = []
    const redundantClassificationEdges: string[] = []
    const roleMismatchEdges: string[] = []
    const crossDomainEdges: string[] = []
    const advancedKinds = new Set<FoundationEntryKind>(['theorem', 'algorithm', 'method', 'application'])

    for (const entry of collection.entries) {
        for (const requiredId of entry.requires) {
            const edge = `${entry.id}->${requiredId}`
            const required = entryById.get(requiredId) as FoundationEntry

            if (
                !redundantEdgeAllowlist.has(edge) &&
                entry.requires.some(
                    (otherId) => otherId !== requiredId && reachesFoundation(otherId, requiredId, entryById, 'requires')
                )
            ) {
                redundantEdges.push(edge)
            }
            if ((entry.kind === 'definition' || entry.kind === 'model') && advancedKinds.has(required.kind)) {
                roleMismatchEdges.push(edge)
            }
            if (!entry.domains.some((domain) => required.domains.includes(domain))) {
                crossDomainEdges.push(edge)
            }
        }

        for (const broaderId of entry.special_case_of) {
            const edge = `${entry.id}->${broaderId}`
            if (
                entry.special_case_of.some(
                    (otherId) =>
                        otherId !== broaderId && reachesFoundation(otherId, broaderId, entryById, 'special_case_of')
                )
            ) {
                redundantClassificationEdges.push(edge)
            }
        }
    }

    return { redundantEdges, redundantClassificationEdges, roleMismatchEdges, crossDomainEdges }
}

function reachesFoundation(
    startId: string,
    targetId: string,
    entryById: Map<string, FoundationEntry>,
    field: 'requires' | 'special_case_of'
) {
    const pending = [startId]
    const visited = new Set<string>()

    while (pending.length) {
        const currentId = pending.pop() as string
        if (currentId === targetId) return true
        if (visited.has(currentId)) continue
        visited.add(currentId)
        pending.push(...(entryById.get(currentId)?.[field] ?? []))
    }

    return false
}

function compareFoundationEntries(entryA: FoundationEntry, entryB: FoundationEntry) {
    const kindCompare = FOUNDATION_KINDS.indexOf(entryA.kind) - FOUNDATION_KINDS.indexOf(entryB.kind)
    return kindCompare || entryA.title.localeCompare(entryB.title, 'zh-CN')
}

function findRelationCycle(entries: Map<string, FoundationEntryInput>, field: 'requires' | 'special_case_of') {
    const visited = new Set<string>()
    const active = new Set<string>()
    const path: string[] = []

    function visit(id: string): string[] | null {
        if (active.has(id)) {
            return [...path.slice(path.indexOf(id)), id]
        }
        if (visited.has(id)) return null

        active.add(id)
        path.push(id)

        const targets = entries.get(id)?.[field]
        for (const targetId of Array.isArray(targets) ? targets : []) {
            if (targetId === id) continue
            if (!entries.has(targetId)) continue
            const cycle = visit(targetId)
            if (cycle) return cycle
        }

        path.pop()
        active.delete(id)
        visited.add(id)
        return null
    }

    for (const id of entries.keys()) {
        const cycle = visit(id)
        if (cycle) return cycle
    }

    return null
}
