import { assignNavigation, compareArticleDate } from './collection-utils'
import { cleanMarkdownText, createTopicAnchorId, createTopicTargetId, truncateText } from './reference-utils'
import type { BlogPost, TopicNode, TopicTrailItem } from './types'

export function normalizeTopicKeys(input: unknown) {
    if (typeof input === 'string') {
        const topicKey = normalizeTopicKey(input)
        return topicKey ? [topicKey] : []
    }

    if (!Array.isArray(input)) return []

    const topicKeys = input
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeTopicKey)
        .filter(Boolean)

    return topicKeys.filter((value, index) => topicKeys.indexOf(value) === index)
}

export function normalizeTopicKey(input: string) {
    return input
        .split(/[\\/]+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join('/')
}

export function createTopicNode(key: string): TopicNode {
    return {
        key,
        title: key ? formatSegmentTitle(key.split('/').at(-1) ?? '') : 'Topics',
        description: '',
        order: 0,
        anchorId: key ? createTopicAnchorId(key) : '',
        targetId: key ? createTopicTargetId(key) : '',
        articleCount: 0,
        directArticleCount: 0,
        articles: [],
        children: []
    }
}

export function ensureTopicNode(topicMap: Map<string, TopicNode>, root: TopicNode, segments: string[]) {
    let current = root
    let currentKey = ''

    for (const segment of segments) {
        currentKey = currentKey ? `${currentKey}/${segment}` : segment
        let node = topicMap.get(currentKey)

        if (!node) {
            node = createTopicNode(currentKey)
            topicMap.set(currentKey, node)
            current.children.push(node)
        }

        current = node
    }

    return current
}

export function finalizeTopicNode(
    node: TopicNode,
    parentTrail: TopicTrailItem[],
    rootCollectionKey: string
): TopicNode {
    const currentTrail = node.key ? [...parentTrail, { key: node.key, title: node.title }] : parentTrail

    node.articles.sort(compareArticleDate)
    node.articles.forEach((article) => {
        article.topicKey = node.key
        article.collectionKey = node.key || rootCollectionKey
        article.topicTrail = currentTrail
    })
    assignNavigation(node.articles)

    node.children = node.children
        .map((child) => finalizeTopicNode(child, currentTrail, rootCollectionKey))
        .sort(compareTopicNode)

    node.directArticleCount = node.articles.length
    node.articleCount = node.directArticleCount + node.children.reduce((count, child) => count + child.articleCount, 0)

    return node
}

export function attachArticlesToTopics(topicMap: Map<string, TopicNode>, root: TopicNode, articles: BlogPost[]) {
    let attachedArticlesCount = 0

    articles.forEach((article) => {
        const seenTopicKeys = new Set<string>()

        article.frontMatter.topics?.forEach((topicKey) => {
            const normalizedTopicKey = normalizeTopicKey(topicKey)
            if (!normalizedTopicKey || seenTopicKeys.has(normalizedTopicKey)) return

            seenTopicKeys.add(normalizedTopicKey)

            const node = ensureTopicNode(topicMap, root, normalizedTopicKey.split('/'))
            if (node.articles.some((item) => item.sourcePath === article.sourcePath)) return

            node.articles.push(cloneArticleForTopic(article))
            attachedArticlesCount += 1
        })
    })

    return attachedArticlesCount
}

export function compareTopicNode(nodeA: TopicNode, nodeB: TopicNode) {
    const orderCompare = nodeB.order - nodeA.order
    if (orderCompare !== 0) return orderCompare

    return nodeA.title.localeCompare(nodeB.title, 'zh-CN')
}

export function getTopicSegments(filePath: string, topicsDir = 'topics') {
    const normalizedPath = filePath.replace(/\\/gu, '/')
    const normalizedTopicsDir = topicsDir.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')
    const prefix = normalizedTopicsDir ? `${normalizedTopicsDir}/` : ''
    const relativePath = prefix && normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath
    const lastSeparatorIndex = relativePath.lastIndexOf('/')

    return lastSeparatorIndex > 0 ? relativePath.slice(0, lastSeparatorIndex).split('/').filter(Boolean) : []
}

export function normalizeMetaDescription(input: string) {
    return truncateText(cleanMarkdownText(input), 180)
}

function cloneArticleForTopic(post: BlogPost): BlogPost {
    return {
        ...post,
        frontMatter: {
            ...post.frontMatter,
            tags: [...post.frontMatter.tags],
            topics: [...(post.frontMatter.topics ?? [])]
        },
        previousSourcePath: undefined,
        nextSourcePath: undefined,
        topicKey: undefined,
        topicTrail: undefined
    }
}

function formatSegmentTitle(segment: string) {
    return segment.replace(/[-_]+/g, ' ').trim() || 'Untitled'
}
