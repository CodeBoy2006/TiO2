import assert from 'node:assert/strict'
import test from 'node:test'
import {
    attachArticlesToTopics,
    compareTopicNode,
    createTopicNode,
    ensureTopicNode,
    finalizeTopicNode,
    getTopicSegments,
    normalizeMetaDescription
} from '../../packages/content-core/src/index.js'
import type { BlogPost, TopicNode } from '../../packages/content-core/src/index.js'

function createPost(sourcePath: string, title: string, publishedAt: string, topics: string[] = []): BlogPost {
    return {
        sourcePath,
        regularPath: `/${sourcePath.replace(/\.md$/, '')}`,
        kind: 'post',
        collectionKey: 'all',
        excerpt: `${title} excerpt`,
        articleTargetId: `article:${sourcePath}`,
        frontMatter: {
            title,
            description: '',
            date: publishedAt,
            publishedAt,
            lastUpdated: '',
            tags: ['tag'],
            topics,
            order: 0,
            wordCount: 120,
            readingTime: 1
        }
    }
}

test('TiO2 topic tree creates and reuses nested topic nodes', () => {
    const root = createTopicNode('')
    const topicMap = new Map<string, TopicNode>()
    const first = ensureTopicNode(topicMap, root, ['framework', 'core_tools'])
    const second = ensureTopicNode(topicMap, root, ['framework', 'core_tools'])

    assert.equal(root.title, 'Topics')
    assert.equal(first, second)
    assert.equal(first.key, 'framework/core_tools')
    assert.equal(first.title, 'core tools')
    assert.equal(first.anchorId, 'topic-framework-core-tools')
    assert.equal(first.targetId, 'topic:framework/core_tools')
    assert.deepEqual(
        root.children.map((node) => node.key),
        ['framework']
    )
    assert.deepEqual(
        root.children[0].children.map((node) => node.key),
        ['framework/core_tools']
    )
})

test('TiO2 topic tree attaches cloned articles and finalizes navigation and counts', () => {
    const root = createTopicNode('')
    const topicMap = new Map<string, TopicNode>()
    const alpha = createPost('posts/alpha.md', 'Alpha', '2026-03-29', [
        'framework/core',
        ' framework \\ core ',
        'framework/testing'
    ])
    const beta = createPost('posts/beta.md', 'Beta', '2026-03-30', ['framework/core'])
    const gamma = createPost('posts/gamma.md', 'Gamma', '2026-03-28')

    const attachedCount = attachArticlesToTopics(topicMap, root, [alpha, beta, gamma])
    const coreNode = topicMap.get('framework/core')
    const testingNode = topicMap.get('framework/testing')
    const frameworkNode = topicMap.get('framework')

    assert.equal(attachedCount, 3)
    assert.ok(coreNode)
    assert.ok(testingNode)
    assert.ok(frameworkNode)
    assert.equal(coreNode?.articles.length, 2)
    assert.equal(testingNode?.articles.length, 1)
    assert.notEqual(coreNode?.articles[0], alpha)

    coreNode?.articles[0].frontMatter.tags.push('changed')
    assert.deepEqual(alpha.frontMatter.tags, ['tag'])

    if (!coreNode || !testingNode || !frameworkNode) {
        throw new Error('Expected framework topic nodes to exist.')
    }

    coreNode.order = 1
    testingNode.order = 5

    finalizeTopicNode(root, [], 'all')

    assert.equal(root.articleCount, 3)
    assert.equal(root.directArticleCount, 0)
    assert.deepEqual(
        frameworkNode.children.map((node) => node.key),
        ['framework/testing', 'framework/core']
    )
    assert.deepEqual(
        coreNode.articles.map((article) => article.sourcePath),
        ['posts/beta.md', 'posts/alpha.md']
    )
    assert.equal(coreNode.articles[0].topicKey, 'framework/core')
    assert.equal(coreNode.articles[0].collectionKey, 'framework/core')
    assert.deepEqual(coreNode.articles[0].topicTrail, [
        { key: 'framework', title: 'framework' },
        { key: 'framework/core', title: 'core' }
    ])
    assert.equal(coreNode.articles[0].previousSourcePath, undefined)
    assert.equal(coreNode.articles[0].nextSourcePath, 'posts/alpha.md')
    assert.equal(coreNode.articles[1].previousSourcePath, 'posts/beta.md')
    assert.equal(coreNode.articles[1].nextSourcePath, undefined)
})

test('TiO2 topic tree utilities derive segment paths and normalized descriptions', () => {
    const sortedNodes = [createTopicNode('算法'), createTopicNode('工具')]
    sortedNodes[0].title = '算法'
    sortedNodes[1].title = '工具'
    sortedNodes[1].order = 2

    assert.deepEqual(
        sortedNodes.sort(compareTopicNode).map((node) => node.title),
        ['工具', '算法']
    )
    assert.deepEqual(getTopicSegments('topics/framework/core/article.md'), ['framework', 'core'])
    assert.deepEqual(getTopicSegments('topics/_meta.md'), [])

    const normalizedDescription = normalizeMetaDescription(`**TiO2** <b>framework</b> ${'works '.repeat(40)}`)
    assert.match(normalizedDescription, /^TiO2 framework works /)
    assert.ok(normalizedDescription.endsWith('…'))
    assert.ok(normalizedDescription.length <= 180)
})
