import assert from 'node:assert/strict'
import test from 'node:test'
import { rewriteRelativeAssetReferences } from '../../packages/content-fs/src/index.js'

test('TiO2 asset rewriting preserves Markdown syntax while relocating companion references', () => {
    const markdown = [
        '![Cover](./alpha/cover.png?raw=1#preview "Cover title")',
        '[Space](./alpha/read\\ me.txt)',
        '[Near dot file](./alpha/..draft.png)',
        '[Outside](../shared.png)',
        '[cover-ref]: ./alpha/cover.png "Reference title"',
        '',
        '`![Inline](./alpha/inline.png)`',
        '',
        '````md',
        '![Fenced](./alpha/fenced.png)',
        '```',
        '![Still fenced](./alpha/still-fenced.png)',
        '````'
    ].join('\n')

    const rewritten = rewriteRelativeAssetReferences(markdown, {
        sourceDocumentPath: 'posts/alpha.md',
        targetDocumentPath: 'topics/TiO2/Core/Alpha Updated.md',
        sourceAssetDirectoryPath: 'posts/alpha',
        targetAssetDirectoryPath: 'topics/TiO2/Core/Alpha Updated'
    })

    assert.match(rewritten, /!\[Cover\]\(<\.\/Alpha Updated\/cover\.png\?raw=1#preview> "Cover title"\)/)
    assert.match(rewritten, /\[Space\]\(<\.\/Alpha Updated\/read me\.txt>\)/)
    assert.match(rewritten, /\[Near dot file\]\(<\.\/Alpha Updated\/\.\.draft\.png>\)/)
    assert.match(rewritten, /\[Outside\]\(\.\.\/shared\.png\)/)
    assert.match(rewritten, /\[cover-ref\]: <\.\/Alpha Updated\/cover\.png> "Reference title"/)
    assert.match(rewritten, /`!\[Inline\]\(\.\/alpha\/inline\.png\)`/)
    assert.match(rewritten, /!\[Still fenced\]\(\.\/alpha\/still-fenced\.png\)/)
})
