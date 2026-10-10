import assert from 'node:assert/strict'
import test from 'node:test'
import { assignNavigation, compareArticleDate, convertOrder } from '../../packages/content-core/src/index.js'
import type { BlogPost } from '../../packages/content-core/src/index.js'

function createPost(sourcePath: string, order: number, publishedAt: string): BlogPost {
    return {
        sourcePath,
        regularPath: `/${sourcePath.replace(/\.md$/, '')}`,
        kind: 'post',
        collectionKey: 'all',
        excerpt: '',
        articleTargetId: `article:${sourcePath}`,
        frontMatter: {
            title: sourcePath,
            description: '',
            date: publishedAt,
            publishedAt,
            lastUpdated: '',
            tags: [],
            order,
            wordCount: 0,
            readingTime: 1
        }
    }
}

test('TiO2 collection utilities wire navigation links', () => {
    const collection = [
        createPost('posts/a.md', 0, '2026-03-28'),
        createPost('posts/b.md', 0, '2026-03-29'),
        createPost('posts/c.md', 0, '2026-03-30')
    ]

    assignNavigation(collection)

    assert.equal(collection[0].previousSourcePath, undefined)
    assert.equal(collection[0].nextSourcePath, 'posts/b.md')
    assert.equal(collection[1].previousSourcePath, 'posts/a.md')
    assert.equal(collection[1].nextSourcePath, 'posts/c.md')
    assert.equal(collection[2].previousSourcePath, 'posts/b.md')
    assert.equal(collection[2].nextSourcePath, undefined)
})

test('TiO2 collection utilities sort by order first and publication date second', () => {
    const sorted = [
        createPost('posts/older.md', 0, '2026-03-28'),
        createPost('posts/newer.md', 0, '2026-03-29'),
        createPost('posts/pinned.md', 2, '2026-01-01')
    ].sort(compareArticleDate)

    assert.deepEqual(
        sorted.map((article) => article.sourcePath),
        ['posts/pinned.md', 'posts/newer.md', 'posts/older.md']
    )
})

test('TiO2 collection utilities normalize order metadata safely', () => {
    assert.equal(convertOrder(undefined), 0)
    assert.equal(convertOrder(null), 0)
    assert.equal(convertOrder(7), 7)
    assert.equal(convertOrder('42'), 42)
    assert.equal(convertOrder('not-a-number'), 0)
})
