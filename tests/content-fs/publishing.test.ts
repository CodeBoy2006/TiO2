import assert from 'node:assert/strict'
import test from 'node:test'
import { createAbsoluteUrl } from '../../packages/content-fs/src/publishing.js'

test('publishing URLs preserve absolute URLs, including queries and fragments', () => {
    const siteUrl = 'https://example.test'
    for (const url of [
        `${siteUrl}/pages/about.html`,
        'http://author.example/about.html',
        'https://author.example/%E4%BD%9C%E8%80%85?next=%2Fposts%2F&view=full#bio',
        'https://cdn.example/cover%20image.webp?width=1200&format=webp'
    ]) {
        assert.equal(createAbsoluteUrl(url, siteUrl), url)
    }
    assert.equal(createAbsoluteUrl('HTTPS://AUTHOR.EXAMPLE/about', siteUrl), 'https://author.example/about')
})

test('publishing URLs still encode local paths without double encoding', () => {
    const siteUrl = 'https://example.test/blog/'
    for (const [route, expected] of [
        ['/', 'https://example.test/'],
        ['/pages/about.html', 'https://example.test/pages/about.html'],
        ['pages/about.html', 'https://example.test/blog/pages/about.html'],
        ['/posts/中文 空格.html', 'https://example.test/posts/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC.html'],
        ['/posts/what%3F%23100%25.html', 'https://example.test/posts/what%3F%23100%25.html'],
        ['/posts/what?#100%.html', 'https://example.test/posts/what%3F%23100%25.html']
    ]) {
        assert.equal(createAbsoluteUrl(route, siteUrl), expected)
    }
})
