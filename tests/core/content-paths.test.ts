import { defineTiO2Config } from '../../packages/config/src/index.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getFoundationIgnorePatterns,
    getFoundationSourcePatterns,
    getPageIgnorePatterns,
    getPageSourcePatterns,
    getPostIgnorePatterns,
    getPostSourcePatterns,
    getTopicArticleIgnorePatterns,
    getTopicArticleSourcePatterns,
    getTopicMetaIgnorePatterns,
    getTopicMetaSourcePatterns
} from '../../packages/content-fs/src/content-paths.js'

const contentConfig = defineTiO2Config({
    site: { title: 'Fixture', url: 'https://example.com' },
    content: { productionIgnorePatterns: ['**/draft/**/*.md', '**/trash/**/*.md', '**/private-notes/**/*.md'] }
}).content

test('TiO2 content path helpers use the supplied content config', async (t) => {
    await t.test('exposes post patterns and production ignores under the posts directory', () => {
        assert.deepEqual(getPostSourcePatterns(contentConfig), ['posts/**/*.md'])
        assert.deepEqual(getPostIgnorePatterns(contentConfig), [])
        assert.deepEqual(getPostIgnorePatterns(contentConfig, { production: true }), [
            'posts/**/draft/**/*.md',
            'posts/**/trash/**/*.md',
            'posts/**/private-notes/**/*.md'
        ])
        assert.equal(contentConfig.postsDir, 'posts')
    })

    await t.test('always excludes topic meta files from topic article scans', () => {
        assert.deepEqual(getTopicArticleSourcePatterns(contentConfig), ['topics/**/*.md'])
        assert.deepEqual(getTopicArticleIgnorePatterns(contentConfig), ['topics/**/_meta.md'])
        assert.deepEqual(getTopicArticleIgnorePatterns(contentConfig, { production: true }), [
            'topics/**/draft/**/*.md',
            'topics/**/trash/**/*.md',
            'topics/**/private-notes/**/*.md',
            'topics/**/_meta.md'
        ])
    })

    await t.test('exposes dedicated topic meta scan patterns', () => {
        assert.deepEqual(getTopicMetaSourcePatterns(contentConfig), ['topics/**/_meta.md'])
        assert.deepEqual(getTopicMetaIgnorePatterns(contentConfig), [])
        assert.deepEqual(getTopicMetaIgnorePatterns(contentConfig, { production: true }), [
            'topics/**/draft/**/*.md',
            'topics/**/trash/**/*.md',
            'topics/**/private-notes/**/*.md'
        ])
        assert.equal(contentConfig.topicMetaFilename, '_meta.md')
    })

    await t.test('applies production ignore rules to standalone pages', () => {
        assert.deepEqual(getPageSourcePatterns(contentConfig), ['pages/**/*.md'])
        assert.deepEqual(getPageIgnorePatterns(contentConfig), [])
        assert.deepEqual(getPageIgnorePatterns(contentConfig, { production: true }), [
            'pages/**/draft/**/*.md',
            'pages/**/trash/**/*.md',
            'pages/**/private-notes/**/*.md'
        ])
    })

    await t.test('exposes the independent foundations collection', () => {
        assert.deepEqual(getFoundationSourcePatterns(contentConfig), ['foundations/**/*.md'])
        assert.deepEqual(getFoundationIgnorePatterns(contentConfig), [])
        assert.deepEqual(getFoundationIgnorePatterns(contentConfig, { production: true }), [
            'foundations/**/draft/**/*.md',
            'foundations/**/trash/**/*.md',
            'foundations/**/private-notes/**/*.md'
        ])
        assert.equal(contentConfig.foundationsDir, 'foundations')
    })
})

test('content patterns support independent nested roots and topic metadata filenames', () => {
    const custom = {
        ...contentConfig,
        postsDir: 'writing/posts',
        topicsDir: 'knowledge/topics',
        foundationsDir: 'knowledge/foundations',
        pagesDir: 'site/pages',
        topicMetaFilename: 'index.md'
    }
    assert.deepEqual(getPostSourcePatterns(custom), ['writing/posts/**/*.md'])
    assert.deepEqual(getTopicMetaSourcePatterns(custom), ['knowledge/topics/**/index.md'])
    assert.deepEqual(getTopicArticleIgnorePatterns(custom), ['knowledge/topics/**/index.md'])
    assert.deepEqual(getFoundationSourcePatterns(custom), ['knowledge/foundations/**/*.md'])
    assert.deepEqual(getPageSourcePatterns(custom), ['site/pages/**/*.md'])
    assert.deepEqual(getPostIgnorePatterns(custom, { production: true }), [
        'writing/posts/**/draft/**/*.md',
        'writing/posts/**/trash/**/*.md',
        'writing/posts/**/private-notes/**/*.md'
    ])
    assert.deepEqual(getPostSourcePatterns(contentConfig), ['posts/**/*.md'])
})
