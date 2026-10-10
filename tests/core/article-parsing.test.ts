import assert from 'node:assert/strict'
import test from 'node:test'
import {
    calculateReadingStats,
    extractBlocks,
    extractExcerpt,
    extractHeadings,
    extractRawFrontmatterValue,
    extractReferences,
    inferTitleFromPath,
    normalizeAigcModels,
    normalizeHumanWritten,
    normalizeArticleCover,
    normalizePercentage,
    normalizeTopicKey,
    normalizeTopicKeys
} from '../../packages/content-core/src/index.js'

test('TiO2 article parsing extracts raw frontmatter values', () => {
    const content = [
        '---',
        'title: "TiO2 Demo"',
        "author: 'CodeBoy'",
        'date: 2026-03-30 # local calendar date',
        '---',
        'date: 2099-01-01'
    ].join('\n')

    assert.equal(extractRawFrontmatterValue(content, 'title'), 'TiO2 Demo')
    assert.equal(extractRawFrontmatterValue(content, 'author'), 'CodeBoy')
    assert.equal(extractRawFrontmatterValue(content, 'date'), '2026-03-30')
    assert.equal(extractRawFrontmatterValue(content, 'missing'), '')
    assert.equal(extractRawFrontmatterValue('date: 2099-01-01', 'date'), '')
})

test('TiO2 article parsing calculates reading stats and excerpts from cleaned markdown', () => {
    const stats = calculateReadingStats('Hello [[World|Reader]]\n\n^block-id')
    const excerpt = extractExcerpt(`Intro [[Target|Label]] ${'word '.repeat(50)}`)

    assert.deepEqual(stats, {
        wordCount: 2,
        readingTime: 1
    })
    assert.match(excerpt, /^Intro Label word /)
    assert.ok(excerpt.endsWith('…'))
    assert.ok(excerpt.length <= 180)
    assert.ok(!excerpt.includes('[['))
})

test('TiO2 article parsing extracts headings while ignoring fenced code blocks', () => {
    const markdown = [
        '# First Heading',
        '```md',
        '## Hidden Heading',
        '```',
        '## 2026 计划',
        '~~~ts',
        '### Also Hidden',
        '~~~',
        '### Final Section'
    ].join('\n')

    assert.deepEqual(extractHeadings(markdown), [
        { level: 1, title: 'First Heading', slug: 'first-heading' },
        { level: 2, title: '2026 计划', slug: '_2026-计划' },
        { level: 3, title: 'Final Section', slug: 'final-section' }
    ])
})

test('TiO2 article parsing matches VitePress heading text and duplicate slug behavior', () => {
    const markdown = [
        '# Repeated `Heading`',
        '',
        'Repeated Heading',
        '----------------',
        '',
        '## Repeated `Heading`',
        '',
        '## Repeated Heading-1',
        '',
        '## Repeated Heading'
    ].join('\n')

    assert.deepEqual(extractHeadings(markdown), [
        { level: 1, title: 'Repeated Heading', slug: 'repeated-heading' },
        { level: 2, title: 'Repeated Heading', slug: 'repeated-heading-1' },
        { level: 2, title: 'Repeated Heading', slug: 'repeated-heading-2' },
        { level: 2, title: 'Repeated Heading-1', slug: 'repeated-heading-1-1' },
        { level: 2, title: 'Repeated Heading', slug: 'repeated-heading-3' }
    ])
})

test('TiO2 article parsing ignores setext-like operators inside display math', () => {
    const markdown = [
        '## Before math',
        '',
        '\\[',
        '|A_2\\cup A_3|',
        '=',
        '\\left\\lfloor\\frac N2\\right\\rfloor',
        '-',
        '\\left\\lfloor\\frac N6\\right\\rfloor',
        '\\]',
        '',
        '$$',
        'x',
        '-',
        'y',
        '$$',
        '',
        '## After math'
    ].join('\n')

    assert.deepEqual(extractHeadings(markdown), [
        { level: 2, title: 'Before math', slug: 'before-math' },
        { level: 2, title: 'After math', slug: 'after-math' }
    ])
})

test('TiO2 article parsing extracts block anchors with nearby snippets', () => {
    const markdown = [
        'Intro paragraph',
        'continues here',
        '',
        '^block-one',
        '',
        '```md',
        '^ignored',
        '```',
        '',
        'Paragraph for second block',
        '^block-two',
        '',
        '> Quoted block',
        '> ^block-three',
        '',
        '````md',
        '^hidden-long-fence',
        '```',
        '^still-hidden',
        '````'
    ].join('\n')

    assert.deepEqual(extractBlocks(markdown), [
        {
            anchor: 'block-one',
            excerpt: 'Intro paragraph continues here'
        },
        {
            anchor: 'block-two',
            excerpt: 'Paragraph for second block'
        },
        {
            anchor: 'block-three',
            excerpt: 'Quoted block'
        }
    ])
})

test('TiO2 article parsing extracts wiki references outside code and preserves context', () => {
    const markdown = [
        'Paragraph with [[Article#Section|nice label]] and ![[topic:年度总结|年度总结专题]].',
        '',
        '`[[IgnoredInline]]`',
        '',
        '``[[IgnoredDoubleBacktick]]``',
        '',
        '\\[[EscapedReference]]',
        '',
        '    [[IgnoredIndentedCode]]',
        '',
        '```md',
        '![[IgnoredFence]]',
        '```'
    ].join('\n')

    assert.deepEqual(extractReferences(markdown), [
        {
            raw: 'Article#Section|nice label',
            label: 'nice label',
            embed: false,
            context: 'Paragraph with nice label and 年度总结专题.'
        },
        {
            raw: 'topic:年度总结|年度总结专题',
            label: '年度总结专题',
            embed: true,
            context: 'Paragraph with nice label and 年度总结专题.'
        }
    ])
})

test('TiO2 article parsing normalizes percentage, model, and topic metadata', () => {
    assert.equal(normalizePercentage('76.66%'), 76.7)
    assert.equal(normalizePercentage(105), 100)
    assert.equal(normalizePercentage(-3), 0)
    assert.equal(normalizePercentage('bad-value'), null)

    assert.deepEqual(normalizeAigcModels('GPT-4, Claude / google-gemini, gpt4'), ['openai', 'claude', 'gemini'])
    assert.equal(normalizeHumanWritten(true), true)
    assert.equal(normalizeHumanWritten(false), false)
    assert.equal(normalizeHumanWritten(undefined), false)
    assert.throws(() => normalizeHumanWritten('true'), /humanWritten must be true or false/)
    assert.deepEqual(normalizeTopicKeys('  算法 \\ 图论 / 最短路  '), ['算法/图论/最短路'])
    assert.deepEqual(normalizeTopicKeys(['算法/图论', ' 算法\\图论 ', '年度总结']), ['算法/图论', '年度总结'])
    assert.equal(normalizeTopicKey('  算法 \\ 图论 / 最短路  '), '算法/图论/最短路')
    assert.equal(inferTitleFromPath('/tmp/posts/TiO2 入门.md'), 'TiO2 入门')
})

test('TiO2 article parsing only accepts explicit cover metadata', () => {
    assert.deepEqual(
        normalizeArticleCover({
            src: ' /covers/demo.svg ',
            alt: ' Demo cover ',
            fit: 'contain',
            position: ' 60% 40% '
        }),
        {
            src: '/covers/demo.svg',
            alt: 'Demo cover',
            fit: 'contain',
            position: '60% 40%'
        }
    )
    assert.deepEqual(normalizeArticleCover({ src: '/covers/demo.svg', fit: 'unexpected' }), {
        src: '/covers/demo.svg',
        alt: '',
        fit: 'cover',
        position: 'center'
    })
    assert.equal(normalizeArticleCover({ alt: 'Missing source' }), undefined)
    assert.equal(normalizeArticleCover('/covers/demo.svg'), undefined)
})
