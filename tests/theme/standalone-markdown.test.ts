import assert from 'node:assert/strict'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import test, { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMarkdownRenderer } from '../../site/markdown.js'
import { createFoldMarkdownPlugin } from '../../.vitepress/theme/foldMarkdownPlugin.js'
import { createEncryptedMarkdownPlugin } from '../../.vitepress/theme/encryptedMarkdownPlugin.js'

const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'tio2-markdown-fixture-'))
after(() => rmSync(projectRoot, { recursive: true, force: true }))

test('standalone Markdown preserves anchors, downloads, external links, CJK, tables and footnotes', async () => {
    const md = await createMarkdownRenderer()
    const html = md.render(
        [
            '## 123 中文 `code`',
            '',
            '## 123 中文 `code`',
            '',
            '## Explicit {#custom-id}',
            '',
            '[page](./demo.md#Hello%20World) [index](./index.md) [download](/file.md){download}',
            '',
            '[external](https://example.com) [mail](mailto:reader@example.com)',
            '',
            '这是**「中文」**强调[^note]。',
            '',
            '| A | B |',
            '| - | - |',
            '| 1 | 2 |',
            '',
            '[^note]: Footnote body.'
        ].join('\n')
    )
    assert.match(html, /id="_123-中文-code" tabindex="-1"/u)
    assert.match(html, /id="_123-中文-code-1"/u)
    assert.match(html, /href="#_123-中文-code" aria-label="Permalink to “123 中文 code”"/u)
    assert.match(html, /id="custom-id"/u)
    assert.match(html, /href="\.\/demo\.html#hello-world"/u)
    assert.match(html, /href="\.\/"/u)
    assert.match(html, /href="\/file\.md" download=""/u)
    assert.match(html, /href="https:\/\/example\.com" target="_blank" rel="noreferrer"/u)
    assert.match(html, /href="mailto:reader@example\.com"/u)
    assert.match(html, /<strong>「中文」<\/strong>/u)
    assert.match(html, /<table tabindex="0">/u)
    assert.match(html, /href="#fn1" id="fnref1"/u)
    assert.match(html, /href="#fnref1" class="footnote-backref"/u)
    assert.equal((html.match(/<section class="footnotes">/gu) ?? []).length, 1)
    assert.equal(md.renderInline(':|'), ':|')
    assert.match(md.render('## 123 中文 `code`'), /id="_123-中文-code"/u)
})

test('standalone Markdown emits synchronous highlighted code in ordinary and nested blocks', async () => {
    const md = await createMarkdownRenderer()
    md.use(createFoldMarkdownPlugin()).use(createEncryptedMarkdownPlugin(projectRoot))
    const source = '```cpp\nint x = 1;\n\nreturn x;\n```'
    const assertHighlighted = (html: string) => {
        assert.match(html, /class="language-cpp line-numbers-mode"/u)
        assert.match(html, /class="shiki shiki-themes github-light github-dark vp-code"/u)
        assert.match(html, /--shiki-light:#c62739/u)
        assert.match(html, /class="line"><wbr><\/span>/u)
        assert.equal((html.match(/class="line-number"/gu) ?? []).length, 3)
        assert.doesNotMatch(html, /markdown-it-async|v-pre/u)
    }
    assertHighlighted(md.render(source))
    assertHighlighted(md.render(`::: code-fold\n${source}\n:::`, { referenceRenderMode: 'static-html' }))
    assertHighlighted(md.render(`::: tip\n${source}\n:::`))
    const encrypted = md.render(`::: encrypt password="test-only"\n${source}\n:::`, {
        referenceRenderMode: 'static-html'
    })
    const payload = JSON.parse(Buffer.from(encrypted.match(/data-payload="([^"]+)"/u)![1], 'base64url').toString())
    const key = pbkdf2Sync('test-only', Buffer.from(payload.salt, 'base64url'), payload.iterations, 32, 'sha256')
    const ciphertext = Buffer.from(payload.ciphertext, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64url'))
    decipher.setAuthTag(ciphertext.subarray(-16))
    assertHighlighted(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString())
    const unknown = md.render('```unknown-language\n<script>alert(1)</script>\n```')
    assert.match(unknown, /(?:&lt;|&#x3C;)script/u)
    assert.doesNotMatch(unknown, /<script>/u)
    assert.doesNotMatch(md.render('```text:no-line-numbers\nx\n```'), /line-numbers-wrapper/u)
    assert.match(md.render('```ts {2}\nlet x = 1\nx++\n```'), /class="line highlighted"/u)
})
