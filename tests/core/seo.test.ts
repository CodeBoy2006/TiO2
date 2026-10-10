import assert from 'node:assert/strict'
import test from 'node:test'
import { createBlogPostingJsonLd } from '../../site/seo.js'

test('BlogPosting JSON-LD includes article data and cannot close its script tag', () => {
    const serialized = createBlogPostingJsonLd({
        title: '</script><script>alert(1)</script>',
        description: 'Article summary',
        url: 'https://example.test/posts/example.html',
        image: 'https://example.test/covers/example.webp',
        language: 'zh-CN',
        author: 'A writer',
        authorUrl: 'https://example.test/pages/about.html',
        publishedAt: '2026-07-26T00:00:00.000Z',
        section: '开发',
        tags: ['SEO', 'VitePress'],
        wordCount: 1200
    })

    assert.doesNotMatch(serialized, /<\/script>/u)
    assert.deepEqual(JSON.parse(serialized), {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: '</script><script>alert(1)</script>',
        description: 'Article summary',
        url: 'https://example.test/posts/example.html',
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': 'https://example.test/posts/example.html'
        },
        image: 'https://example.test/covers/example.webp',
        inLanguage: 'zh-CN',
        datePublished: '2026-07-26T00:00:00.000Z',
        dateModified: '2026-07-26T00:00:00.000Z',
        articleSection: '开发',
        keywords: 'SEO, VitePress',
        wordCount: 1200,
        author: {
            '@type': 'Person',
            name: 'A writer',
            url: 'https://example.test/pages/about.html'
        },
        publisher: {
            '@type': 'Person',
            name: 'A writer',
            url: 'https://example.test/pages/about.html'
        }
    })
})
