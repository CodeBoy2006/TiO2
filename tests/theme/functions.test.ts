import assert from 'node:assert/strict'
import test from 'node:test'
import { initCategory, initTags, useYearSort } from '../../site/render-helpers.js'
import type { BlogPost } from '../../packages/content-core/src/index.js'

function createPost(
    title: string,
    {
        date,
        category,
        tags
    }: {
        date: string
        category: string
        tags: string[]
    }
): BlogPost {
    return {
        frontMatter: {
            date,
            publishedAt: date,
            lastUpdated: '',
            title,
            category,
            tags,
            description: `${title} description`,
            order: 0,
            wordCount: 1,
            readingTime: 1
        },
        regularPath: `/${title.toLowerCase()}`,
        sourcePath: `posts/${title.toLowerCase()}.md`,
        kind: 'post',
        collectionKey: 'all',
        excerpt: '',
        articleTargetId: `article:posts/${title.toLowerCase()}.md`
    }
}

test('TiO2 theme helpers group tags by frequency and keep post associations intact', () => {
    const alpha = createPost('Alpha', { date: '2026-03-30', category: 'Framework', tags: ['TiO2', 'Testing'] })
    const beta = createPost('Beta', { date: '2026-03-29', category: 'Framework', tags: ['TiO2'] })
    const gamma = createPost('Gamma', { date: '2025-05-10', category: '', tags: ['Notes'] })

    const grouped = initTags([alpha, beta, gamma])

    assert.deepEqual(Object.keys(grouped), ['TiO2', 'Testing', 'Notes'])
    assert.deepEqual(
        grouped.TiO2.map((post) => post.frontMatter.title),
        ['Alpha', 'Beta']
    )
    assert.deepEqual(
        grouped.Testing.map((post) => post.frontMatter.title),
        ['Alpha']
    )
})

test('TiO2 theme helpers group categories and ignore empty category values', () => {
    const posts = [
        createPost('Alpha', { date: '2026-03-30', category: 'Framework', tags: [] }),
        createPost('Beta', { date: '2026-03-29', category: 'Framework', tags: [] }),
        createPost('Gamma', { date: '2025-05-10', category: '', tags: [] }),
        createPost('Delta', { date: '2024-01-01', category: 'Notes', tags: [] })
    ]

    const grouped = initCategory(posts)

    assert.deepEqual(Object.keys(grouped), ['Framework', 'Notes'])
    assert.deepEqual(
        grouped.Framework.map((post) => post.frontMatter.title),
        ['Alpha', 'Beta']
    )
    assert.deepEqual(
        grouped.Notes.map((post) => post.frontMatter.title),
        ['Delta']
    )
})

test('TiO2 theme helpers split posts into ordered year buckets', () => {
    const grouped = useYearSort([
        createPost('Alpha', { date: '2026-03-30', category: 'Framework', tags: [] }),
        createPost('Beta', { date: '2026-01-01', category: 'Framework', tags: [] }),
        createPost('Gamma', { date: '', category: 'Notes', tags: [] }),
        createPost('Delta', { date: '2025-05-10', category: 'Notes', tags: [] }),
        createPost('Epsilon', { date: '2024-02-20', category: 'Notes', tags: [] })
    ])

    assert.deepEqual(
        grouped.map((posts) => posts.map((post) => post.frontMatter.title)),
        [['Alpha', 'Beta'], ['Delta'], ['Epsilon']]
    )
})
