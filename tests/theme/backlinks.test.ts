import assert from 'node:assert/strict'
import test from 'node:test'
import { createMarkdownRenderer } from '../../site/markdown.js'
import { createTranslator } from '../../packages/config/src/i18n.js'
import { groupBacklinks } from '../../site/render-helpers.js'
import { renderBacklinksPanel } from '../../site/site-renderer.js'
import type { BacklinkEntry } from '../../packages/content-core/src/index.js'

function createBacklink(overrides: Partial<BacklinkEntry> = {}): BacklinkEntry {
    return {
        sourceSourcePath: 'posts/source.md',
        sourceTitle: 'Source Article',
        sourceHref: '/posts/source.html',
        sourceKind: 'post',
        sourcePublishedAt: '2026-03-30',
        label: '',
        embed: false,
        context: '',
        ...overrides
    }
}

test('backlink panels exclude auxiliary content from search snippets', async () => {
    const markdown = await createMarkdownRenderer()
    for (const compact of [false, true]) {
        const html = renderBacklinksPanel(
            createTranslator('en'),
            'article:posts/target.md',
            [createBacklink({ context: 'Excerpt from another article.' })],
            markdown,
            'Backlinks',
            compact
        )
        assert.match(html, /^<section class="backlinks-panel[^"]*" data-open="false" data-nosnippet>/)
        assert.match(html, /<p class="backlinks-entry__context">“Excerpt from another article\.”<\/p>/)
        assert.match(html, /<\/section>$/)
    }
})

test('TiO2 backlink grouping merges sources and filters non-context labels', () => {
    const grouped = groupBacklinks([
        createBacklink({
            context: 'Source Article'
        }),
        createBacklink({
            label: 'Named section',
            context: 'Named section'
        }),
        createBacklink({
            context: 'why-links-matter'
        }),
        createBacklink({
            context: '  这里真正提到了来源文章。  '
        }),
        createBacklink({
            embed: true,
            context: '这里真正提到了来源文章。'
        }),
        createBacklink({
            sourceSourcePath: 'topics/other.md',
            sourceTitle: 'Other Article',
            sourceHref: '/topics/other.html',
            sourceKind: 'topic',
            sourcePublishedAt: '2026-03-31',
            context: '另一处中文语境。'
        })
    ])

    assert.deepEqual(grouped, [
        {
            sourceSourcePath: 'posts/source.md',
            sourceTitle: 'Source Article',
            sourceHref: '/posts/source.html',
            sourcePublishedAt: '2026-03-30',
            mentionCount: 5,
            hasEmbed: true,
            contexts: ['这里真正提到了来源文章。']
        },
        {
            sourceSourcePath: 'topics/other.md',
            sourceTitle: 'Other Article',
            sourceHref: '/topics/other.html',
            sourcePublishedAt: '2026-03-31',
            mentionCount: 1,
            hasEmbed: false,
            contexts: ['另一处中文语境。']
        }
    ])
})
