import assert from 'node:assert/strict'
import test from 'node:test'
import { createMarkdownRoute, encodeRoutePathSegments } from '../../packages/content-core/src/index.js'

test('TiO2 route utilities encode path segments without confusing URL delimiters', () => {
    assert.equal(
        createMarkdownRoute('posts/年度总结 2025.md'),
        '/posts/%E5%B9%B4%E5%BA%A6%E6%80%BB%E7%BB%93%202025.html'
    )
    assert.equal(createMarkdownRoute('posts/what?#100%.md'), '/posts/what%3F%23100%25.html')
    assert.equal(encodeRoutePathSegments('\\topics\\TiO2 Core\\Guide'), 'topics/TiO2%20Core/Guide')
})
