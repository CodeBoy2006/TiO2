import type {
    CmsDocumentDetail,
    CmsDocumentKind,
    CmsLibraryItem,
    CmsLibraryTreeDirectoryNode,
    CmsLibraryTreeDocumentNode,
    CmsLibraryTreeNode,
    CmsLibraryTreeRoot
} from '../../cms-contract/src/index'
import type { ManagedRootDefinition } from './managed-paths'

export function createCmsLibraryItem(document: CmsDocumentDetail): CmsLibraryItem {
    const item: CmsLibraryItem = {
        kind: document.kind,
        sourcePath: document.sourcePath,
        title: document.title,
        description:
            typeof document.frontmatter.description === 'string' ? document.frontmatter.description : document.excerpt,
        date: typeof document.frontmatter.date === 'string' ? document.frontmatter.date : '',
        category: typeof document.frontmatter.category === 'string' ? document.frontmatter.category : '',
        tags: Array.isArray(document.frontmatter.tags)
            ? document.frontmatter.tags.filter((tag): tag is string => typeof tag === 'string')
            : [],
        topics: Array.isArray(document.frontmatter.topics)
            ? document.frontmatter.topics.filter((topic): topic is string => typeof topic === 'string')
            : []
    }
    if (document.kind === 'foundation') {
        const data = document.frontmatter
        item.foundation = {
            id: typeof data.id === 'string' ? data.id : '',
            kind: typeof data.kind === 'string' ? data.kind : '',
            equivalent_to: readStrings(data.equivalent_to),
            contrasts_with: readStrings(data.contrasts_with)
        }
        item.aliases = readStrings(data.aliases)
    }
    return item
}

function readStrings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function buildCmsLibraryTree(
    items: CmsLibraryItem[],
    managedRootDefinitions: ManagedRootDefinition[]
): CmsLibraryTreeRoot[] {
    const roots = managedRootDefinitions.map<CmsLibraryTreeRoot>(({ rootKey, path }) => ({
        type: 'root',
        rootKey,
        path,
        documentCount: 0,
        children: []
    }))

    for (const item of items) {
        const root = roots.find(
            (entry) => item.sourcePath === entry.path || item.sourcePath.startsWith(`${entry.path}/`)
        )
        if (!root) continue

        const relativePath = item.sourcePath.slice(root.path.length).replace(/^\//u, '')
        if (!relativePath) continue

        root.documentCount += 1
        insertTreeDocument(root.children, root.path, relativePath.split('/'), item)
    }

    roots.forEach((root) => sortTreeNodes(root.children))
    return roots
}

export function compareCmsLibraryItems(
    itemA: Pick<CmsLibraryItem, 'kind' | 'date' | 'sourcePath'>,
    itemB: Pick<CmsLibraryItem, 'kind' | 'date' | 'sourcePath'>
) {
    const kindOrder = getKindOrder(itemA.kind) - getKindOrder(itemB.kind)
    if (kindOrder !== 0) return kindOrder

    if (itemA.date && itemB.date && itemA.date !== itemB.date) {
        return itemA.date < itemB.date ? 1 : -1
    }

    return itemA.sourcePath.localeCompare(itemB.sourcePath, 'zh-CN')
}

function insertTreeDocument(
    nodes: CmsLibraryTreeNode[],
    currentPath: string,
    remainingSegments: string[],
    item: CmsLibraryItem
) {
    if (remainingSegments.length === 1) {
        const fileName = remainingSegments[0]
        nodes.push({
            type: 'document',
            name: fileName,
            path: item.sourcePath,
            sourcePath: item.sourcePath,
            kind: item.kind,
            title: item.title,
            description: item.description,
            date: item.date
        })
        return
    }

    const [directoryName, ...nextSegments] = remainingSegments
    const directoryPath = `${currentPath}/${directoryName}`
    let directoryNode = nodes.find(
        (node): node is CmsLibraryTreeDirectoryNode => node.type === 'directory' && node.path === directoryPath
    )

    if (!directoryNode) {
        directoryNode = {
            type: 'directory',
            name: directoryName,
            path: directoryPath,
            documentCount: 0,
            children: []
        }
        nodes.push(directoryNode)
    }

    directoryNode.documentCount += 1
    insertTreeDocument(directoryNode.children, directoryPath, nextSegments, item)
}

function sortTreeNodes(nodes: CmsLibraryTreeNode[]) {
    nodes.sort((nodeA, nodeB) => {
        if (nodeA.type !== nodeB.type) {
            return nodeA.type === 'directory' ? -1 : 1
        }

        if (nodeA.type === 'directory' && nodeB.type === 'directory') {
            return nodeA.path.localeCompare(nodeB.path, 'zh-CN')
        }

        return compareCmsLibraryItems(nodeA as CmsLibraryTreeDocumentNode, nodeB as CmsLibraryTreeDocumentNode)
    })

    for (const node of nodes) {
        if (node.type === 'directory') {
            sortTreeNodes(node.children)
        }
    }
}

function getKindOrder(kind: CmsDocumentKind) {
    switch (kind) {
        case 'post':
            return 0
        case 'topic':
            return 1
        case 'foundation':
            return 2
        case 'page':
            return 3
        case 'topicMeta':
            return 4
    }
}
