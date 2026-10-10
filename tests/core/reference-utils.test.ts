import assert from 'node:assert/strict'
import test from 'node:test'
import {
    cleanMarkdownText,
    createArticleTargetId,
    createBlockTargetId,
    createFoundationTargetId,
    createHeadingTargetId,
    createReferenceResolver,
    createTopicAnchorId,
    createTopicTargetId,
    normalizeLookup,
    parseWikiReference,
    slugifyFragment,
    truncateText
} from '../../packages/content-core/src/index.js'
import type { ReferenceGraph } from '../../packages/content-core/src/index.js'

function createReferenceGraph(): ReferenceGraph {
    return {
        targets: {
            'article:posts/demo.md': {
                id: 'article:posts/demo.md',
                type: 'article',
                title: 'Demo Article',
                href: '/posts/demo',
                excerpt: 'demo excerpt',
                pageSourcePath: 'posts/demo.md'
            },
            'article:posts/dup-one.md': {
                id: 'article:posts/dup-one.md',
                type: 'article',
                title: 'Duplicate',
                href: '/posts/dup-one',
                excerpt: '',
                pageSourcePath: 'posts/dup-one.md'
            },
            'article:posts/dup-two.md': {
                id: 'article:posts/dup-two.md',
                type: 'article',
                title: 'Duplicate',
                href: '/posts/dup-two',
                excerpt: '',
                pageSourcePath: 'posts/dup-two.md'
            },
            'topic:年度总结': {
                id: 'topic:年度总结',
                type: 'topic',
                title: '年度总结',
                href: '/pages/topics#topic-年度总结',
                excerpt: 'topic excerpt',
                topicKey: '年度总结'
            },
            'foundation:group': {
                id: 'foundation:group',
                type: 'foundation',
                title: '群',
                href: '/foundations/group',
                excerpt: 'group excerpt',
                pageSourcePath: 'foundations/group.md',
                foundationId: 'group',
                aliases: ['Group']
            },
            'heading:posts/demo.md#intro-section': {
                id: 'heading:posts/demo.md#intro-section',
                type: 'heading',
                title: 'Intro Section',
                href: '/posts/demo#intro-section',
                excerpt: '',
                pageSourcePath: 'posts/demo.md',
                pageTitle: 'Demo Article',
                anchor: 'intro-section'
            },
            'heading:posts/demo.md#section-2': {
                id: 'heading:posts/demo.md#section-2',
                type: 'heading',
                title: '第二节',
                href: '/posts/demo#section-2',
                excerpt: '',
                pageSourcePath: 'posts/demo.md',
                pageTitle: 'Demo Article',
                anchor: 'section-2'
            },
            'block:posts/demo.md#proof': {
                id: 'block:posts/demo.md#proof',
                type: 'block',
                title: 'Proof Block',
                href: '/posts/demo#proof',
                excerpt: '',
                pageSourcePath: 'posts/demo.md',
                pageTitle: 'Demo Article',
                anchor: 'proof'
            }
        },
        backlinksByTargetId: {},
        outgoingBySourcePath: {},
        unresolvedBySourcePath: {}
    }
}

test('TiO2 reference utilities normalize fragments and text snippets', () => {
    assert.equal(slugifyFragment(' 1 Résumé / Test '), '_1-resume-test')
    assert.equal(normalizeLookup('  Foo   BAR  '), 'foo bar')
    assert.equal(truncateText('abcdef', 5), 'abcd…')
    assert.equal(cleanMarkdownText('![img](x) [Link](y) <b>bold</b> `code` ## Title'), 'Link bold Title')
})

test('TiO2 reference utilities parse wiki references and build target ids', () => {
    assert.deepEqual(parseWikiReference('topic:年度总结#总览|查看专题'), {
        target: '年度总结',
        anchor: '总览',
        label: '查看专题',
        isTopic: true,
        isFoundation: false
    })

    assert.deepEqual(parseWikiReference('foundation:group|群'), {
        target: 'group',
        anchor: '',
        label: '群',
        isTopic: false,
        isFoundation: true
    })

    assert.equal(createArticleTargetId('posts/demo.md'), 'article:posts/demo.md')
    assert.equal(createTopicTargetId('年度总结'), 'topic:年度总结')
    assert.equal(createFoundationTargetId('group'), 'foundation:group')
    assert.equal(createHeadingTargetId('posts/demo.md', 'intro'), 'heading:posts/demo.md#intro')
    assert.equal(createBlockTargetId('posts/demo.md', 'proof'), 'block:posts/demo.md#proof')
    assert.equal(createTopicAnchorId('算法/图论'), 'topic-算法-图论')
})

test('TiO2 reference resolver resolves articles, headings, blocks, and topics robustly', () => {
    const resolveReference = createReferenceResolver(createReferenceGraph())

    assert.equal(resolveReference(' Demo   Article ')?.target.id, 'article:posts/demo.md')
    assert.equal(resolveReference('Demo Article#Intro Section')?.target.id, 'heading:posts/demo.md#intro-section')
    assert.equal(resolveReference('Demo Article#第二节')?.target.id, 'heading:posts/demo.md#section-2')
    assert.equal(resolveReference('#proof', 'posts/demo.md')?.target.id, 'block:posts/demo.md#proof')
    assert.equal(resolveReference('topic:年度总结')?.target.id, 'topic:年度总结')
    assert.equal(resolveReference('foundation:group')?.target.id, 'foundation:group')
    assert.equal(resolveReference('Group')?.target.id, 'foundation:group')
    assert.equal(resolveReference('Duplicate'), null)
    assert.equal(resolveReference('Missing Article'), null)
})
