import assert from 'node:assert/strict'
import test from 'node:test'
import { defineTiO2Config } from '../../packages/config/src/index.js'
import { createTranslator, resolveLanguage } from '../../packages/config/src/i18n.js'
import { calculateReadingStats } from '../../packages/content-core/src/article-parsing.js'
import { loadArticleDocument } from '../../packages/content-fs/src/article-document.js'

test('framework locales resolve regional tags, preserve Chinese, and default other languages to English', () => {
    for (const language of ['en', 'en-GB', 'EN-us', 'fr', '']) {
        assert.equal(resolveLanguage(language), 'en')
        assert.equal(createTranslator(language)('搜索', 'Search'), 'Search')
    }
    for (const language of ['zh', 'zh-CN', 'ZH-Hans']) {
        assert.equal(createTranslator(language)('搜索', 'Search'), '搜索')
    }
    const site = { title: 'Example', url: 'https://example.test' }
    assert.equal(defineTiO2Config({ site }).theme.outlineLabel, 'Contents')
    assert.equal(defineTiO2Config({ site: { ...site, language: 'zh-CN' } }).theme.outlineLabel, '目录')
    assert.equal(
        defineTiO2Config({ site, theme: { outlineLabel: 'Custom outline' } }).theme.outlineLabel,
        'Custom outline'
    )
})

test('English reading estimates count words rather than characters while Chinese estimates stay unchanged', () => {
    assert.deepEqual(calculateReadingStats('Hello **world**, again!', 'en-GB'), { wordCount: 3, readingTime: 1 })
    assert.deepEqual(calculateReadingStats('word '.repeat(201), 'en'), { wordCount: 201, readingTime: 2 })
    assert.deepEqual(calculateReadingStats('中文'.repeat(226), 'zh-CN'), { wordCount: 452, readingTime: 2 })
    assert.deepEqual(calculateReadingStats('', 'en'), { wordCount: 0, readingTime: 1 })
})

test('article reading statistics honor content language before the site default', async () => {
    const source = { rawContent: '', data: { lang: 'zh-CN' }, content: '你好世界' }
    const chinese = await loadArticleDocument('posts/example.md', 'post', 'posts', { source, language: 'en' })
    assert.equal(chinese.post.frontMatter.wordCount, 4)
    const english = await loadArticleDocument('posts/example.md', 'post', 'posts', {
        source: { ...source, data: { lang: 'en' }, content: 'Hello world' },
        language: 'zh-CN'
    })
    assert.equal(english.post.frontMatter.wordCount, 2)
})
