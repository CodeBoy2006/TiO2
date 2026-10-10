import {
    createBlockTargetId,
    createFoundationTargetId,
    createHeadingTargetId,
    createReferenceResolver,
    truncateText
} from './reference-utils'
import type { ParsedBlock, ParsedHeading, ParsedRawReference } from './article-parsing'
import type {
    BacklinkEntry,
    BlogPost,
    FoundationCollection,
    ReferenceGraph,
    ReferenceRecord,
    TopicCollection,
    TopicNode
} from './types'

export interface ReferenceSourceDocument {
    post: BlogPost
    headings: ParsedHeading[]
    blocks: ParsedBlock[]
    references: ParsedRawReference[]
}

export interface AdditionalReferenceSource {
    sourcePath: string
    sourceTitle: string
    sourceHref: string
    sourceKind: BacklinkEntry['sourceKind']
    sourcePublishedAt: string
    references: ParsedRawReference[]
}

export interface BuildReferenceGraphOptions {
    /** Omit when no topic index is published. */
    topicIndexRoute?: string
    foundations?: FoundationCollection
    additionalReferenceSources?: AdditionalReferenceSource[]
}

export interface CreateReferenceGraphSubsetOptions {
    sourcePath?: string
    backlinkTargetIds?: Iterable<string>
    targetIds?: Iterable<string>
}

export function buildReferenceGraph(
    documents: ReferenceSourceDocument[],
    topics: TopicCollection,
    options: BuildReferenceGraphOptions = {}
): ReferenceGraph {
    const targets: ReferenceGraph['targets'] = {}
    const backlinksByTargetId: ReferenceGraph['backlinksByTargetId'] = {}
    const outgoingBySourcePath: ReferenceGraph['outgoingBySourcePath'] = {}
    const unresolvedBySourcePath: ReferenceGraph['unresolvedBySourcePath'] = {}

    for (const document of documents) {
        const { post, headings, blocks } = document
        const topicTitle = post.topicTrail?.at(-1)?.title
        const articleExcerpt = post.frontMatter.description || post.excerpt
        const sharedTargetFields = {
            pageSourcePath: post.sourcePath,
            pageTitle: post.frontMatter.title,
            topicKey: post.topicKey,
            topicTitle,
            date: post.frontMatter.date,
            readingTime: post.frontMatter.readingTime
        }

        targets[post.articleTargetId] = {
            id: post.articleTargetId,
            type: 'article',
            title: post.frontMatter.title,
            href: post.regularPath,
            excerpt: articleExcerpt,
            ...sharedTargetFields
        }

        headings.forEach((heading) => {
            const targetId = createHeadingTargetId(post.sourcePath, heading.slug)
            targets[targetId] = {
                id: targetId,
                type: 'heading',
                title: heading.title,
                href: `${post.regularPath}#${heading.slug}`,
                excerpt: articleExcerpt,
                anchor: heading.slug,
                ...sharedTargetFields
            }
        })

        blocks.forEach((block) => {
            const targetId = createBlockTargetId(post.sourcePath, block.anchor)
            targets[targetId] = {
                id: targetId,
                type: 'block',
                title: truncateText(block.excerpt || '文段', 26),
                href: `${post.regularPath}#${block.anchor}`,
                excerpt: block.excerpt || articleExcerpt,
                anchor: block.anchor,
                ...sharedTargetFields
            }
        })
    }

    if (options.topicIndexRoute) appendTopicTargets(targets, topics.roots, options.topicIndexRoute)
    appendFoundationTargets(targets, options.foundations)

    const referenceGraph: ReferenceGraph = {
        targets,
        backlinksByTargetId,
        outgoingBySourcePath,
        unresolvedBySourcePath
    }

    const resolveReference = createReferenceResolver(referenceGraph)

    const referenceSources: AdditionalReferenceSource[] = [
        ...documents.map((document) => ({
            sourcePath: document.post.sourcePath,
            sourceTitle: document.post.frontMatter.title,
            sourceHref: document.post.regularPath,
            sourceKind: document.post.kind,
            sourcePublishedAt: document.post.frontMatter.publishedAt,
            references: document.references
        })),
        ...(options.additionalReferenceSources ?? [])
    ]

    for (const source of referenceSources) {
        const outgoing: ReferenceRecord[] = []
        const unresolved: string[] = []

        source.references.forEach((reference) => {
            const resolved = resolveReference(reference.raw, source.sourcePath)

            if (!resolved) {
                unresolved.push(reference.raw)
                return
            }

            const referenceFields = {
                label: reference.label || resolved.parsed.label,
                embed: reference.embed,
                context: reference.context
            }
            outgoing.push({
                targetId: resolved.target.id,
                ...referenceFields
            })

            const backlinks = backlinksByTargetId[resolved.target.id] ?? []
            backlinks.push({
                sourceSourcePath: source.sourcePath,
                sourceTitle: source.sourceTitle,
                sourceHref: source.sourceHref,
                sourceKind: source.sourceKind,
                sourcePublishedAt: source.sourcePublishedAt,
                ...referenceFields
            })
            backlinksByTargetId[resolved.target.id] = backlinks
        })

        if (outgoing.length) {
            outgoingBySourcePath[source.sourcePath] = outgoing
        }

        if (unresolved.length) {
            unresolvedBySourcePath[source.sourcePath] = unresolved
        }
    }

    Object.values(backlinksByTargetId).forEach((backlinks) => {
        backlinks.sort((entryA, entryB) => (entryA.sourcePublishedAt < entryB.sourcePublishedAt ? 1 : -1))
    })

    return referenceGraph
}

export function createReferenceGraphSubset(
    referenceGraph: ReferenceGraph,
    options: CreateReferenceGraphSubsetOptions = {}
): ReferenceGraph {
    const { sourcePath = '' } = options
    const outgoing = sourcePath ? (referenceGraph.outgoingBySourcePath[sourcePath] ?? []) : []
    const unresolved = sourcePath ? (referenceGraph.unresolvedBySourcePath[sourcePath] ?? []) : []
    const targetIds = new Set(options.targetIds ?? [])
    outgoing.forEach((reference) => targetIds.add(reference.targetId))
    const backlinkTargetIds = new Set(options.backlinkTargetIds ?? [])

    if (sourcePath) {
        Object.entries(referenceGraph.targets).forEach(([targetId, target]) => {
            if (target.pageSourcePath === sourcePath) {
                backlinkTargetIds.add(targetId)
            }
        })
    }

    return {
        targets: Object.fromEntries(
            [...targetIds]
                .map((targetId) => [targetId, referenceGraph.targets[targetId]] as const)
                .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
        ),
        backlinksByTargetId: Object.fromEntries(
            [...backlinkTargetIds]
                .map((targetId) => [targetId, referenceGraph.backlinksByTargetId[targetId]] as const)
                .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]?.length))
        ),
        outgoingBySourcePath: sourcePath && outgoing.length ? { [sourcePath]: outgoing } : {},
        unresolvedBySourcePath: sourcePath && unresolved.length ? { [sourcePath]: unresolved } : {}
    }
}

function appendTopicTargets(targets: ReferenceGraph['targets'], nodes: TopicNode[], indexRoute: string) {
    nodes.forEach((node) => {
        targets[node.targetId] = {
            id: node.targetId,
            type: 'topic',
            title: node.title,
            href: `${indexRoute}#${node.anchorId}`,
            excerpt: node.description || node.articles[0]?.excerpt || '',
            topicKey: node.key,
            topicTitle: node.title,
            articleCount: node.articleCount
        }

        appendTopicTargets(targets, node.children, indexRoute)
    })
}

function appendFoundationTargets(targets: ReferenceGraph['targets'], foundations?: FoundationCollection) {
    foundations?.entries.forEach((entry) => {
        const targetId = createFoundationTargetId(entry.id)
        targets[targetId] = {
            id: targetId,
            type: 'foundation',
            title: entry.title,
            href: entry.regularPath,
            excerpt: entry.description,
            pageSourcePath: entry.sourcePath,
            pageTitle: entry.title,
            foundationId: entry.id,
            ...(entry.kind === 'navigation' ? {} : { aliases: entry.aliases })
        }
    })
}
