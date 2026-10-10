export type ArticleKind = 'post' | 'topic'
export type ReferenceTargetType = 'article' | 'topic' | 'foundation' | 'heading' | 'block'
export type AigcModelKey = 'openai' | 'claude' | 'gemini'
export type ArticleCoverFit = 'cover' | 'contain'

export type FoundationGroup = string
export type FoundationEntryKind =
    | 'axiom'
    | 'principle'
    | 'definition'
    | 'model'
    | 'method'
    | 'algorithm'
    | 'theorem'
    | 'application'
    | 'navigation'
export type FoundationRelationField =
    | 'requires'
    | 'uses'
    | 'implemented_by'
    | 'special_case_of'
    | 'equivalent_to'
    | 'contrasts_with'
export type FoundationDomain = string

export interface FoundationDomainDefinition {
    id: FoundationDomain
    group: FoundationGroup
    title: string
    description: string
}

export interface FoundationGroupDefinition {
    id: FoundationGroup
    title: string
    englishTitle: string
    description: string
    domains: FoundationDomainDefinition[]
}

export interface FoundationEntry {
    title: string
    id: string
    aliases: string[]
    kind: FoundationEntryKind
    domains: FoundationDomain[]
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

export interface FoundationRoute {
    id: string
    title: string
    audience: string
    promise: string
    entries: string[]
    type: 'core' | 'advanced'
    featured?: boolean
    capstoneHref?: string
}

export interface FoundationCollection {
    entries: FoundationEntry[]
    groups: FoundationGroupDefinition[]
    routes: FoundationRoute[]
    entryCount: number
}

export type FoundationDependencyDepth = -3 | -2 | -1 | 0 | 1 | 2 | 3

export interface FoundationRelationGraph {
    currentId: string
    nodes: Array<{
        id: string
        title: string
        kind: FoundationEntryKind
        href: string
        dependencyDepth: FoundationDependencyDepth | null
    }>
    edges: Array<{
        id: string
        source: string
        target: string
        relation: FoundationRelationField
    }>
}

export interface FoundationReadingRoute {
    id: string
    title: string
    position: number
    total: number
    previous: FoundationEntry | null
    next: FoundationEntry | null
    capstoneHref?: string
    entryPaths: string[]
}

export interface FoundationPageRuntimeData {
    current: FoundationEntry
    prerequisites: FoundationEntry[]
    dependents: FoundationEntry[]
    relationGraph: FoundationRelationGraph
    classification: {
        broader: FoundationEntry[]
        narrower: FoundationEntry[]
    }
    typedRelations: {
        uses: FoundationEntry[]
        usedBy: FoundationEntry[]
        implementedBy: FoundationEntry[]
        implements: FoundationEntry[]
        equivalentTo: FoundationEntry[]
        contrastsWith: FoundationEntry[]
    }
    readingRoutes: FoundationReadingRoute[]
    /** Available only when the entry belongs to one unambiguous reading route. */
    recommendedNext: {
        entry: FoundationEntry
        routeTitle: string
    } | null
}

export interface ArticleCover {
    src: string
    alt: string
    fit: ArticleCoverFit
    position: string
}

export interface PostFrontMatter {
    title: string
    description: string
    date: string
    publishedAt: string
    lastUpdated: string
    aigcRate?: number
    aigcModels?: AigcModelKey[]
    humanWritten?: true
    tags: string[]
    topics?: string[]
    category?: string
    cover?: ArticleCover
    order: number
    wordCount: number
    readingTime: number
}

export interface TopicTrailItem {
    key: string
    title: string
}

export interface BlogPost {
    frontMatter: PostFrontMatter
    regularPath: string
    sourcePath: string
    kind: ArticleKind
    collectionKey: string
    excerpt: string
    articleTargetId: string
    topicKey?: string
    topicTrail?: TopicTrailItem[]
    previousSourcePath?: string
    nextSourcePath?: string
}

export interface TopicNode {
    key: string
    title: string
    description: string
    order: number
    anchorId: string
    targetId: string
    articleCount: number
    directArticleCount: number
    articles: BlogPost[]
    children: TopicNode[]
}

export interface TopicCollection {
    roots: TopicNode[]
    topicCount: number
    articleCount: number
}

export type ProofLedgerNode = ProofLedgerGroupNode | ProofLedgerProofNode

export interface ProofLedgerGroupNode {
    kind: 'group'
    name: string
    title: string
    path: string
    proofCount: number
    children: ProofLedgerNode[]
}

export interface ProofLedgerProofNode {
    kind: 'proof'
    name: string
    title: string
    path: string
    timestamp: string
    status: string
    sha256: string
    proofUrl: string
    proofFileName: string
    sourceOtsPath?: string
}

export interface ProofLedgerCollection {
    roots: ProofLedgerGroupNode[]
    proofCount: number
    generatedAt: string
}

export interface ReferenceTarget {
    id: string
    type: ReferenceTargetType
    title: string
    href: string
    excerpt: string
    pageSourcePath?: string
    pageTitle?: string
    anchor?: string
    topicKey?: string
    topicTitle?: string
    foundationId?: string
    aliases?: string[]
    date?: string
    readingTime?: number
    articleCount?: number
}

export interface ReferenceRecord {
    targetId: string
    label: string
    embed: boolean
    context: string
}

export interface BacklinkEntry {
    sourceSourcePath: string
    sourceTitle: string
    sourceHref: string
    sourceKind: ArticleKind | 'foundation'
    sourcePublishedAt: string
    label: string
    embed: boolean
    context: string
}

export interface ReferenceGraph {
    targets: Record<string, ReferenceTarget>
    backlinksByTargetId: Record<string, BacklinkEntry[]>
    outgoingBySourcePath: Record<string, ReferenceRecord[]>
    unresolvedBySourcePath: Record<string, string[]>
}

export interface ArticlePageRuntimeData {
    current: BlogPost
    previous: BlogPost | null
    next: BlogPost | null
}

export interface TiO2PageRuntimeData {
    posts?: BlogPost[]
    topics?: TopicCollection
    foundations?: FoundationCollection
    foundation?: FoundationPageRuntimeData
    proofLedger?: ProofLedgerCollection
    article?: ArticlePageRuntimeData
    references?: ReferenceGraph
}
