export type CmsDocumentKind = 'post' | 'topic' | 'foundation' | 'page' | 'topicMeta'
export type CmsLibraryTreeRootKey = 'posts' | 'topics' | 'foundations' | 'pages'

export interface CmsHeading {
    level: number
    title: string
    slug: string
}

export interface CmsReference {
    raw: string
    label: string
    embed: boolean
    context: string
}

export interface CmsLibraryItem {
    kind: CmsDocumentKind
    sourcePath: string
    title: string
    description: string
    date: string
    category: string
    tags: string[]
    topics: string[]
    aliases?: string[]
    foundation?: {
        id: string
        kind: string
        equivalent_to: string[]
        contrasts_with: string[]
    }
}

export interface CmsImageAsset {
    sourcePath: string
    name: string
    src: string
    publicSrc: string | null
    previewSrc: string
}

export interface CmsLibraryTreeRoot {
    type: 'root'
    rootKey: CmsLibraryTreeRootKey
    path: string
    documentCount: number
    children: CmsLibraryTreeNode[]
}

export interface CmsLibraryTreeDirectoryNode {
    type: 'directory'
    name: string
    path: string
    documentCount: number
    children: CmsLibraryTreeNode[]
}

export interface CmsLibraryTreeDocumentNode {
    type: 'document'
    name: string
    path: string
    sourcePath: string
    kind: CmsDocumentKind
    title: string
    description: string
    date: string
}

export type CmsLibraryTreeNode = CmsLibraryTreeDirectoryNode | CmsLibraryTreeDocumentNode

export interface CmsLibrarySnapshot {
    documents: CmsLibraryItem[]
    stats: Record<CmsDocumentKind, number>
    tree: CmsLibraryTreeRoot[]
    content: {
        topicMetaFilename: string
        foundationDomains: Array<{ id: string; title: string }>
    }
}

export interface CmsPreviewOriginResolution {
    origin: string
    resolved: boolean
}

export interface CmsDocumentDetail {
    kind: CmsDocumentKind
    sourcePath: string
    title: string
    body: string
    excerpt: string
    frontmatter: Record<string, unknown>
    headings: CmsHeading[]
    references: CmsReference[]
    assetDirectoryPath: string | null
}

export interface CmsDocumentUpdateInput {
    sourcePath: string
    frontmatter: Record<string, unknown>
    body: string
}

export interface CmsDocumentCreateInput {
    targetPath: string
    frontmatter: Record<string, unknown>
    body: string
    createAssetDirectory?: boolean
}

export interface CmsDocumentMoveInput {
    sourcePath: string
    targetPath: string
    moveAssetDirectory?: boolean
}

export interface CmsDocumentDeleteInput {
    sourcePath: string
    removeAssetDirectory?: boolean
}

export interface CmsDocumentDeleteResult {
    sourcePath: string
    removedAssetDirectory: boolean
}
