import assert from 'node:assert/strict'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import { createReferenceMarkdownPlugin } from '../../.vitepress/theme/referenceMarkdownPlugin.js'
import type { ReferenceGraph } from '../../packages/content-core/src/index.js'

function createReferenceGraph(): ReferenceGraph {
    return {
        targets: {
            'article:topics/guide.md': {
                id: 'article:topics/guide.md',
                type: 'article',
                title: 'Guide',
                href: '/topics/guide',
                excerpt: 'Guide excerpt',
                pageSourcePath: 'topics/guide.md'
            },
            'heading:topics/guide.md#deep-dive': {
                id: 'heading:topics/guide.md#deep-dive',
                type: 'heading',
                title: 'Deep Dive',
                href: '/topics/guide#deep-dive',
                excerpt: 'Guide excerpt',
                pageSourcePath: 'topics/guide.md',
                anchor: 'deep-dive'
            },
            'block:posts/current.md#proof': {
                id: 'block:posts/current.md#proof',
                type: 'block',
                title: 'Proof',
                href: '/posts/current#proof',
                excerpt: 'Proof excerpt for TiO2 reference plugin verification',
                pageSourcePath: 'posts/current.md',
                anchor: 'proof'
            },
            'topic:TiO2/Core': {
                id: 'topic:TiO2/Core',
                type: 'topic',
                title: 'TiO2 Core',
                href: '/pages/topics#topic-tio2-core',
                excerpt: 'Core topic',
                topicKey: 'TiO2/Core'
            }
        },
        backlinksByTargetId: {
            'heading:posts/current.md#demo-heading': [
                {
                    sourceSourcePath: 'posts/alpha.md',
                    sourceTitle: 'Alpha',
                    sourceHref: '/posts/alpha',
                    sourceKind: 'post',
                    sourcePublishedAt: '2026-03-30',
                    label: '',
                    embed: false,
                    context: 'Alpha backlink'
                }
            ]
        },
        outgoingBySourcePath: {},
        unresolvedBySourcePath: {}
    }
}

function createMarkdown() {
    const md = new MarkdownIt()
    md.use(createReferenceMarkdownPlugin(createReferenceGraph()))
    return md
}

test('TiO2 reference markdown plugin renders inline wiki references in component mode', () => {
    const md = createMarkdown()
    const rendered = md.renderInline(
        'See [[Guide#Deep Dive|Read Guide]] and ![[topic:TiO2/Core|Core Topic]], but not \\[[Guide]].',
        {
            relativePath: 'posts/current.md'
        }
    )

    assert.match(
        rendered,
        /<InternalRef target-id="heading:topics\/guide\.md#deep-dive" label="Read Guide" raw="Guide#Deep Dive\|Read Guide"><\/InternalRef>/
    )
    assert.match(
        rendered,
        /<ReferenceEmbed target-id="topic:TiO2\/Core" label="Core Topic" raw="topic:TiO2\/Core\|Core Topic"><\/ReferenceEmbed>/
    )
    assert.match(rendered, /but not \[\[Guide\]\]/)
    assert.equal((rendered.match(/<InternalRef/g) ?? []).length, 1)
})

test('TiO2 reference markdown plugin falls back cleanly for static HTML and unresolved references', () => {
    const md = createMarkdown()
    const resolvedHtml = md.renderInline('[[Guide]]', {
        relativePath: 'posts/current.md',
        referenceRenderMode: 'static-html'
    })
    const unresolvedHtml = md.renderInline('[[Missing <ref>]]', {
        relativePath: 'posts/current.md',
        referenceRenderMode: 'static-html'
    })
    const embedHtml = md.renderInline('![[Guide#Deep Dive]]', {
        relativePath: 'posts/current.md',
        referenceRenderMode: 'static-html'
    })

    assert.match(
        resolvedHtml,
        /^<span class="internal-ref"><a class="internal-ref__link" href="\/topics\/guide">Guide<\/a>/
    )
    assert.match(resolvedHtml, /<span class="internal-ref__preview" aria-hidden="true" data-nosnippet>/)
    assert.match(resolvedHtml, /<svg class="reference-glyph" width="14" height="14"/)
    assert.match(resolvedHtml, /<span>Article<\/span>/)
    assert.match(resolvedHtml, /<strong class="internal-ref__preview-title">Guide<\/strong>/)
    assert.match(resolvedHtml, /<span class="internal-ref__preview-excerpt">Guide excerpt<\/span>/)
    assert.equal(unresolvedHtml, 'Missing &lt;ref&gt;')
    assert.match(
        embedHtml,
        /^<span class="reference-embed"><a class="reference-embed__link" href="\/topics\/guide#deep-dive">/
    )
    assert.match(embedHtml, /<strong class="reference-embed__title">Deep Dive<\/strong>/)
    assert.match(embedHtml, /<span class="reference-embed__excerpt">Guide excerpt<\/span>/)
})

test('TiO2 reference markdown plugin renders block anchors and heading backlinks', () => {
    const md = createMarkdown()
    md.core.ruler.before('wiki-heading-backlinks', 'test-heading-id', (state) => {
        for (let index = 0; index < state.tokens.length - 1; index++) {
            const open = state.tokens[index]
            const inline = state.tokens[index + 1]

            if (open.type === 'heading_open' && inline?.type === 'inline' && inline.content === 'Demo Heading') {
                open.attrSet('id', 'demo-heading')
            }
        }
    })

    const rendered = md.render(['## Demo Heading', '', 'Proof paragraph', '^proof'].join('\n'), {
        relativePath: 'posts/current.md'
    })
    const staticRendered = md.render('^proof', {
        relativePath: 'posts/current.md',
        referenceRenderMode: 'static-html'
    })

    assert.match(
        rendered,
        /<BacklinkBadge target-id="heading:posts\/current\.md#demo-heading" mode="heading"><\/BacklinkBadge>/
    )
    assert.match(rendered, /<p>Proof paragraph<\/p>/)
    assert.match(rendered, /<BlockAnchor anchor="proof" target-id="block:posts\/current\.md#proof"><\/BlockAnchor>/)
    assert.match(staticRendered, /<span id="proof"><\/span>/)
})

test('TiO2 wiki references advance during silent link-label lookahead without emitting duplicate tokens', () => {
    for (const referenceRenderMode of ['component', 'static-html']) {
        for (const embedded of [false, true]) {
            const md = createMarkdown()
            const reference = `${embedded ? '!' : ''}[[Guide]]`
            const html = md.renderInline(`Interval [0,4), followed by ${reference}.`, {
                relativePath: 'posts/current.md',
                referenceRenderMode
            })
            assert.match(html, /^Interval \[0,4\), followed by /)
            if (referenceRenderMode === 'static-html') {
                assert.equal((html.match(/href="\/topics\/guide"/g) ?? []).length, 1)
            } else {
                const component = embedded ? 'ReferenceEmbed' : 'InternalRef'
                assert.equal((html.match(new RegExp(`<${component} `, 'g')) ?? []).length, 1)
            }
            assert.ok(html.endsWith('.'))
        }
    }
})

test('TiO2 wiki references inside links render escaped labels rather than nested anchors', () => {
    for (const referenceRenderMode of ['component', 'static-html']) {
        const md = new MarkdownIt({ html: true })
        md.use(createReferenceMarkdownPlugin(createReferenceGraph()))
        const env = { relativePath: 'posts/current.md', referenceRenderMode }
        for (const [source, expected] of [
            ['[![[Guide]]](/outer)', '<a href="/outer">Guide</a>'],
            ['[![[Guide|A & <B>]]](/outer)', '<a href="/outer">A &amp; &lt;B&gt;</a>'],
            ['[![[Missing <ref>]]](/outer)', '<a href="/outer">Missing &lt;ref&gt;</a>'],
            ['[![[Guide]](/image)](/outer)', '<a href="/outer">Guide(/image)</a>'],
            ['[before ![[Guide]] after](/outer)', '<a href="/outer">before Guide after</a>'],
            ['<a href="/outer">[[Guide]]</a>', '<a href="/outer">Guide</a>'],
            ['<a href="/outer">![[Guide]]</a>', '<a href="/outer">Guide</a>']
        ]) {
            assert.equal(md.renderInline(source, env), expected, source)
        }
        const html = md.renderInline('[![[Guide]]](/outer) then ![[Guide]].', env)
        assert.ok(html.startsWith('<a href="/outer">Guide</a> then '))
        const pattern = referenceRenderMode === 'static-html' ? /class="reference-embed__link"/g : /<ReferenceEmbed /g
        assert.equal((html.match(pattern) ?? []).length, 1)
    }
})
