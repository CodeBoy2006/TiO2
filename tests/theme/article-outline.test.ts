import { createTiO2Project } from '../../packages/config/src/project.js'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMarkdownRenderer } from '../../site/markdown.js'
import type { BlogPost } from '../../packages/content-core/src/index.js'
import { renderArticlePage } from '../../site/page-renderer.js'

test('article outlines decode entities once without unescaping code or creating HTML', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tio2-outline-'))
    const sourcePath = path.join(directory, 'outline.md')
    const headings = [
        ['A & B', 'A &amp; B'],
        ['&quot;Q&quot; &#39;S&#39; &copy; &#x1F600;', '"Q" \'S\' © 😀'],
        ['&amp;lt;', '&amp;lt;'],
        ['Code `\\*`', 'Code \\*'],
        ['&readerUnknown;', '&amp;readerUnknown;'],
        ['&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', '&lt;img src=x onerror="alert(1)"&gt;'],
        ['&lt;script&gt;alert(1)&lt;/script&gt;', '&lt;script&gt;alert(1)&lt;/script&gt;']
    ]
    try {
        await writeFile(
            sourcePath,
            `---\ncomment: false\nlang: zh-CN\n---\n${headings.map(([source]) => `## ${source}`).join('\n\n')}`
        )
        const project = createTiO2Project(directory, { site: { title: 'Outline', url: 'https://outline.test' } })
        const article: BlogPost = {
            sourcePath: 'outline.md',
            regularPath: '/posts/outline.html',
            kind: 'post',
            collectionKey: 'posts',
            excerpt: '',
            articleTargetId: 'article:outline',
            frontMatter: {
                title: 'Outline regression',
                description: '',
                date: '2026-10-01',
                publishedAt: '2026-10-01',
                lastUpdated: '',
                tags: [],
                order: 0,
                wordCount: 10,
                readingTime: 1
            }
        }
        const content = {
            articles: [article],
            references: { backlinksByTargetId: {} },
            publishing: { entries: [{ sourcePath: 'outline.md', publishedAt: '2026-10-01', updatedAt: '' }] }
        } as Parameters<typeof renderArticlePage>[1]
        const markdown = await createMarkdownRenderer()
        const html = await renderArticlePage(project, content, article, markdown, {
            stylesheets: [],
            modulePreloads: [],
            script: ''
        })
        const outline = html.match(/<nav class="article-toc"[\s\S]*?<\/nav>/u)?.[0]
        assert.match(html, /data-ui-language="en" lang="zh-CN"/)
        assert.match(html, /10 characters · About 1 min/)
        assert.match(html, /Search articles and concepts/)
        assert.ok(outline)
        const labels = [...outline.matchAll(/<a href="#[^"]*">([\s\S]*?)<\/a>/gu)].map((match) => match[1])
        assert.deepEqual(
            labels,
            headings.map(([, expected]) => expected)
        )
        assert.doesNotMatch(outline, /<(?:img|script)\b/iu)
        assert.equal(labels.length, 7, 'Encoded markup cannot add outline elements')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
