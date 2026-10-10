import assert from 'node:assert/strict'
import test from 'node:test'
import { describeSearchEntry, prepareSearchMarkdown, tokenizeSearchText } from '../../site/search-content.js'

test('TiO2 search renderer parses frontmatter before composing the indexed markdown', () => {
    const prepared = prepareSearchMarkdown(
        '\uFEFF---\ntitle: KMP算法\ndescription: 介绍字符串查找算法\ntags: [字符串, 算法]\n---\n## 前置知识\n\n正文',
        'posts/KMP算法.md'
    )

    assert.ok(prepared)
    assert.equal(prepared.frontmatter.title, 'KMP算法')
    assert.equal(prepared.markdown.startsWith('# KMP算法\n\n'), true)
    assert.equal(prepared.markdown.includes('description:'), false)
    assert.ok(prepared.markdown.indexOf('字符串查找') < prepared.markdown.indexOf('## 前置知识'))
})

test('TiO2 search renderer keeps an existing article title heading singular', () => {
    const prepared = prepareSearchMarkdown('---\ntitle: 数学小问题\n---\n# 数学小问题\n\n正文', 'posts/数学小问题.md')

    assert.ok(prepared)
    assert.equal(prepared.markdown.match(/^# 数学小问题$/gm)?.length, 1)
})

test('TiO2 search renderer excludes pages disabled through frontmatter', () => {
    const prepared = prepareSearchMarkdown('---\ntitle: 文章列表\nsearch: false\n---\n# 文章列表', 'pages/archives.md')

    assert.equal(prepared, null)
})

test('TiO2 search tokenizer segments natural Chinese phrases', () => {
    assert.deepEqual(tokenizeSearchText('为什么长期熬夜会影响注意力？'), [
        '为什么',
        '长期',
        '熬夜',
        '会',
        '影响',
        '注意力'
    ])
})

test('TiO2 search tokenizer separates Latin abbreviations from Chinese words', () => {
    assert.deepEqual(tokenizeSearchText('KMP算法'), ['KMP', '算法'])
    assert.deepEqual(tokenizeSearchText('ＭＡＴＲＩＸ'), ['MATRIX'])
})

test('TiO2 search describes entries by kind and domain, articles by category and date', () => {
    assert.equal(
        describeSearchEntry('foundation', { entryKind: '定理', domains: ['统计学', '分析与概率'] }),
        '定理 · 统计学 · 分析与概率'
    )
    assert.equal(
        describeSearchEntry('post', { category: '开发', publishedAt: '2026-06-10 13:49:10' }),
        '开发 · 2026-06-10'
    )
    assert.equal(describeSearchEntry('page', { publishedAt: '2026-06-10' }), '')
})
