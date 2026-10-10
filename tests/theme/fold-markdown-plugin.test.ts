import assert from 'node:assert/strict'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import { createFoldMarkdownPlugin } from '../../.vitepress/theme/foldMarkdownPlugin.js'

function createMarkdown() {
    const md = new MarkdownIt()
    md.use(createFoldMarkdownPlugin())
    return md
}

test('TiO2 fold markdown plugin renders content fold blocks with normalized options', () => {
    const md = createMarkdown()
    const rendered = md.render(
        [
            '::: fold mode="full" title="更多细节" summary="摘要" expand-text="展开" collapse-text="收起" open',
            '',
            'Hello **TiO2**',
            '',
            ':::'
        ].join('\n')
    )

    assert.match(
        rendered,
        /<FoldBlock kind="content" mode="full" lines="8" title="更多细节" summary="摘要" expand-text="展开" collapse-text="收起" open="true">/
    )
    assert.match(rendered, /<p>Hello <strong>TiO2<\/strong><\/p>/)
    assert.match(rendered, /<\/FoldBlock>/)
})

test('TiO2 fold markdown plugin renders code aliases with sensible defaults', () => {
    const md = createMarkdown()
    const rendered = md.render(['::: code-fold', '', '```ts', 'console.log("TiO2")', '```', '', ':::'].join('\n'))

    assert.match(rendered, /<FoldBlock kind="code" mode="partial" lines="14">/)
    assert.match(rendered, /<pre><code class="language-ts">console\.log\(&quot;TiO2&quot;\)/)
})

test('TiO2 fold markdown containers ignore literal closing markers inside code', () => {
    const md = createMarkdown()
    const rendered = md.render(
        [
            '::: code-fold',
            '```text',
            ':::',
            '```',
            'Content after the fenced marker.',
            ':::',
            '',
            '    ::: fold',
            '    Indented code sample',
            '    :::'
        ].join('\n')
    )

    assert.match(rendered, /<pre><code class="language-text">:::/)
    assert.match(rendered, /Content after the fenced marker\./)
    assert.equal((rendered.match(/<FoldBlock/g) ?? []).length, 1)
    assert.match(rendered, /Indented code sample/)
})

test('TiO2 fold markdown plugin rejects invalid syntax early', () => {
    const md = createMarkdown()

    assert.throws(() => md.render('::: fold mode="weird"\ncontent\n:::'), /mode must be partial or full/)
    assert.throws(() => md.render('::: fold lines="0"\ncontent\n:::'), /lines must be a positive integer/)
    assert.throws(() => md.render('::: fold title="Oops"\ncontent'), /missing closing :::/)
})
