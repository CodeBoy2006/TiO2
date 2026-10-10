import assert from 'node:assert/strict'
import test from 'node:test'
import {
    buildReferenceGraph,
    createFoundationCollection,
    createReferenceResolver,
    createReferenceGraphSubset,
    createTopicNode
} from '../../packages/content-core/src/index.js'
import type { BlogPost, TopicCollection } from '../../packages/content-core/src/index.js'

const groups = [
    {
        id: 'knowledge',
        title: 'Knowledge',
        englishTitle: 'Knowledge',
        description: 'Test knowledge domains.',
        domains: ['basics', 'structure', 'methods'].map((id) => ({
            id: `knowledge/${id}`,
            group: 'knowledge',
            title: id,
            description: id
        }))
    }
]

function createPost(
    sourcePath: string,
    title: string,
    publishedAt: string,
    {
        topicKey,
        topicTitle
    }: {
        topicKey?: string
        topicTitle?: string
    } = {}
): BlogPost {
    return {
        sourcePath,
        regularPath: `/${sourcePath.replace(/\.md$/, '')}`,
        kind: 'post',
        collectionKey: topicKey ?? 'all',
        excerpt: `${title} excerpt`,
        articleTargetId: `article:${sourcePath}`,
        topicKey,
        topicTrail: topicKey && topicTitle ? [{ key: topicKey, title: topicTitle }] : undefined,
        frontMatter: {
            title,
            description: '',
            date: publishedAt,
            publishedAt,
            lastUpdated: '',
            tags: [],
            order: 0,
            wordCount: 120,
            readingTime: 2
        }
    }
}

function createTopics(): TopicCollection {
    const topic = createTopicNode('TiO2')
    topic.title = 'TiO2'
    topic.description = 'TiO2 framework topic'
    topic.articleCount = 2

    return {
        roots: [topic],
        topicCount: 1,
        articleCount: 2
    }
}

test('TiO2 reference graph indexes targets, outgoing references, backlinks, and unresolved links', () => {
    const alphaPost = createPost('posts/alpha.md', 'Alpha Post', '2026-03-28', {
        topicKey: 'TiO2',
        topicTitle: 'TiO2'
    })
    const betaPost = createPost('posts/beta.md', 'Beta Post', '2026-03-29', {
        topicKey: 'TiO2',
        topicTitle: 'TiO2'
    })
    const gammaPost = createPost('posts/gamma.md', 'Gamma Post', '2026-03-30')

    const graph = buildReferenceGraph(
        [
            {
                post: alphaPost,
                headings: [{ level: 2, title: 'Intro', slug: 'intro' }],
                blocks: [],
                references: []
            },
            {
                post: betaPost,
                headings: [],
                blocks: [{ anchor: 'proof', excerpt: 'Proof block snippet' }],
                references: [
                    { raw: 'Alpha Post', label: '', embed: false, context: 'See Alpha article.' },
                    { raw: 'Alpha Post#Intro', label: '开头', embed: false, context: 'See Alpha heading.' },
                    { raw: '#proof', label: '', embed: true, context: 'Embed local proof.' },
                    { raw: 'topic:TiO2', label: '', embed: false, context: 'Read the topic.' },
                    { raw: 'Missing', label: '', embed: false, context: 'Unknown reference.' }
                ]
            },
            {
                post: gammaPost,
                headings: [],
                blocks: [],
                references: [{ raw: 'Alpha Post', label: 'Alpha', embed: false, context: 'Another backlink.' }]
            }
        ],
        createTopics(),
        {
            topicIndexRoute: '/pages/topics.html',
            foundations: createFoundationCollection(
                [
                    {
                        title: '群',
                        id: 'group',
                        aliases: ['Group'],
                        kind: 'definition',
                        domains: ['knowledge/structure'],
                        requires: [],
                        uses: [],
                        implemented_by: [],
                        special_case_of: [],
                        equivalent_to: [],
                        contrasts_with: [],
                        description: '带有封闭结合运算、单位元与逆元的集合。',
                        sourcePath: 'foundations/knowledge/structure/group.md',
                        regularPath: '/foundations/knowledge/structure/group.html'
                    },
                    {
                        title: '独立同分布样本',
                        id: 'iid-sample',
                        aliases: ['IID sample'],
                        kind: 'definition',
                        domains: ['knowledge/methods'],
                        requires: [],
                        uses: [],
                        implemented_by: [],
                        special_case_of: [],
                        equivalent_to: [],
                        contrasts_with: [],
                        description: '从同一分布独立抽取的随机变量族。',
                        sourcePath: 'foundations/knowledge/methods/iid-sample.md',
                        regularPath: '/foundations/knowledge/methods/iid-sample.html'
                    },
                    {
                        title: 'IID 样本与经验测度（导航）',
                        id: 'iid-sample-and-empirical-measure',
                        aliases: ['IID sample'],
                        kind: 'navigation',
                        domains: ['knowledge/methods'],
                        requires: [],
                        uses: [],
                        implemented_by: [],
                        special_case_of: [],
                        equivalent_to: [],
                        contrasts_with: [],
                        description: '在两个正式概念之间分流的导航页。',
                        sourcePath: 'foundations/knowledge/methods/iid-sample-and-empirical-measure.md',
                        regularPath: '/foundations/knowledge/methods/iid-sample-and-empirical-measure.html'
                    }
                ],
                { groups }
            )
        }
    )

    assert.equal(graph.targets['article:posts/alpha.md']?.type, 'article')
    assert.equal(graph.targets['article:posts/alpha.md']?.topicKey, 'TiO2')
    assert.equal(graph.targets['heading:posts/alpha.md#intro']?.href, '/posts/alpha#intro')
    assert.equal(graph.targets['block:posts/beta.md#proof']?.title, 'Proof block snippet')
    assert.equal(graph.targets['topic:TiO2']?.href, '/pages/topics.html#topic-tio2')
    assert.equal(graph.targets['foundation:group']?.type, 'foundation')
    assert.equal(graph.targets['foundation:iid-sample-and-empirical-measure']?.aliases, undefined)

    const resolveReference = createReferenceResolver(graph)
    assert.equal(resolveReference('IID sample')?.target.id, 'foundation:iid-sample')
    assert.equal(
        resolveReference('foundation:iid-sample-and-empirical-measure')?.target.id,
        'foundation:iid-sample-and-empirical-measure'
    )

    assert.deepEqual(
        graph.outgoingBySourcePath['posts/beta.md']?.map((reference) => reference.targetId),
        ['article:posts/alpha.md', 'heading:posts/alpha.md#intro', 'block:posts/beta.md#proof', 'topic:TiO2']
    )
    assert.deepEqual(graph.unresolvedBySourcePath['posts/beta.md'], ['Missing'])
    assert.equal(graph.outgoingBySourcePath['posts/gamma.md']?.[0]?.label, 'Alpha')
    assert.equal(graph.outgoingBySourcePath['posts/beta.md']?.[2]?.embed, true)

    assert.deepEqual(
        graph.backlinksByTargetId['article:posts/alpha.md']?.map((entry) => entry.sourceSourcePath),
        ['posts/gamma.md', 'posts/beta.md']
    )
    assert.equal(graph.backlinksByTargetId['article:posts/alpha.md']?.[0]?.label, 'Alpha')
    assert.equal(graph.backlinksByTargetId['heading:posts/alpha.md#intro']?.[0]?.label, '开头')
    assert.equal(graph.backlinksByTargetId['block:posts/beta.md#proof']?.[0]?.embed, true)
    assert.equal(graph.backlinksByTargetId['topic:TiO2']?.[0]?.sourceSourcePath, 'posts/beta.md')

    const articleSubset = createReferenceGraphSubset(graph, {
        sourcePath: 'posts/beta.md'
    })
    assert.deepEqual(Object.keys(articleSubset.targets).sort(), [
        'article:posts/alpha.md',
        'block:posts/beta.md#proof',
        'heading:posts/alpha.md#intro',
        'topic:TiO2'
    ])
    assert.deepEqual(Object.keys(articleSubset.backlinksByTargetId), ['block:posts/beta.md#proof'])
    assert.deepEqual(articleSubset.unresolvedBySourcePath['posts/beta.md'], ['Missing'])
    assert.equal(articleSubset.outgoingBySourcePath['posts/gamma.md'], undefined)

    const topicSubset = createReferenceGraphSubset(graph, {
        backlinkTargetIds: ['topic:TiO2'],
        targetIds: ['foundation:group']
    })
    assert.equal(topicSubset.targets['foundation:group']?.type, 'foundation')
    assert.equal(topicSubset.backlinksByTargetId['topic:TiO2']?.[0]?.sourceSourcePath, 'posts/beta.md')
})
