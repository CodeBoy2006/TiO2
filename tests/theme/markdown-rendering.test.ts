import assert from 'node:assert/strict'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import juice from 'juice'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import mathjaxPlugin from 'markdown-it-mathjax3'
import { createMarkdownRenderer } from '../../site/markdown.js'
import { createLatexMathMarkdownPlugin } from '../../.vitepress/theme/latexMathMarkdownPlugin.js'
import {
    annotateMathSource,
    createMarkdownLocation,
    escapeHtmlText,
    renderInlineMath,
    renderComponentTag
} from '../../.vitepress/theme/markdownRendering.js'
import { markdownMathOptions } from '../../site/math-config.js'
import { reuseMathJaxRenderer } from '../../.vitepress/theme/mathjaxRenderer.js'

async function createMathMarkdownRenderer() {
    const markdown = await createMarkdownRenderer()
    const styles = reuseMathJaxRenderer(markdown, markdownMathOptions)
    markdown.use(createLatexMathMarkdownPlugin())
    annotateMathSource(markdown)
    return { markdown, styles }
}

test('TiO2 markdown rendering escapes component attributes and text consistently', () => {
    assert.equal(
        renderComponentTag('Demo', {
            label: 'A & "B" <C>',
            enabled: true,
            hidden: false,
            empty: '',
            count: 3
        }),
        '<Demo label="A &amp; &quot;B&quot; &lt;C&gt;" enabled count="3"></Demo>'
    )
    assert.equal(escapeHtmlText('A & <B> "C"'), 'A &amp; &lt;B&gt; "C"')
    assert.equal(createMarkdownLocation('posts/demo.md', 4), 'posts/demo.md:5')
    assert.equal(createMarkdownLocation(undefined, 0), 'unknown.md:1')
})

test('TiO2 markdown rendering preserves TeX for copying and text extraction', () => {
    const md = new MarkdownIt()
    let inlineRenderCount = 0
    md.renderer.rules.math_inline = () => {
        inlineRenderCount += 1
        return '<mjx-container display="false"></mjx-container>'
    }
    md.renderer.rules.math_block = () => '<mjx-container display="true"></mjx-container>'
    annotateMathSource(md)

    assert.equal(
        md.renderer.rules.math_inline!([{ content: 'x_1 < y' } as any], 0, md.options, {}, md.renderer),
        '<mjx-container data-tex="$x_1 &lt; y$" display="false"></mjx-container>'
    )
    assert.equal(
        md.renderer.rules.math_inline!([{ content: 'x_1 < y' } as any], 0, md.options, {}, md.renderer),
        '<mjx-container data-tex="$x_1 &lt; y$" display="false"></mjx-container>'
    )
    assert.equal(inlineRenderCount, 1)
    md.renderer.rules.math_inline!([{ content: '\\newcommand{\\demo}{x}' } as any], 0, md.options, {}, md.renderer)
    md.renderer.rules.math_inline!([{ content: 'x_1 < y' } as any], 0, md.options, {}, md.renderer)
    assert.equal(inlineRenderCount, 3)
    md.renderer.rules.math_block!([{ content: '\\def\\demo{y}' } as any], 0, md.options, {}, md.renderer)
    md.renderer.rules.math_inline!([{ content: 'x_1 < y' } as any], 0, md.options, {}, md.renderer)
    assert.equal(inlineRenderCount, 4)
    for (let i = 0; i < 2; i += 1) {
        md.renderer.rules.math_inline!([{ content: '\\eqref{demo}' } as any], 0, md.options, {}, md.renderer)
    }
    assert.equal(inlineRenderCount, 6, 'Equation references must resolve against current labels')
    assert.equal(
        md.renderer.rules.math_block!(
            [{ content: '\\frac{1}{2}' } as any],
            0,
            md.options,
            { indexMathSource: true },
            md.renderer
        ),
        '$$\n\\frac{1}{2}\n$$<mjx-container data-tex="$$&#10;\\frac{1}{2}&#10;$$" display="true"></mjx-container>'
    )
})

test('TiO2 markdown rendering supports inline math in titles and summaries', async () => {
    const { markdown: md } = await createMathMarkdownRenderer()

    assert.equal(renderInlineMath(md, 'Plain <title> with `code`'), 'Plain &lt;title&gt; with `code`')
    assert.equal(renderInlineMath(md, 'Price $5 <title>'), 'Price $5 &lt;title&gt;')

    const rendered = renderInlineMath(md, '复杂度为 $O(n\\log n)$，参见 `FFT`。', 'posts/fft.md')
    assert.match(rendered, /<mjx-container data-tex="\$O\(n\\log n\)\$"/u)
    assert.match(rendered, /<code>FFT<\/code>/u)
    assert.doesNotMatch(rendered, / v-pre=""/u)

    const latexDelimited = renderInlineMath(md, '映射 \\(T:V\\to W\\)', 'foundations/linear-map.md')
    assert.match(latexDelimited, /<mjx-container data-tex="\$T:V\\to W\$"/u)
})

test('TiO2 inline math cache reuses a cross-page working set and evicts old formulas', () => {
    const md = new MarkdownIt()
    let renders = 0
    md.renderer.rules.math_inline = () => {
        renders += 1
        return '<mjx-container></mjx-container>'
    }
    md.renderer.rules.math_block = () => '<mjx-container></mjx-container>'
    annotateMathSource(md)
    const render = (content: string) =>
        md.renderer.rules.math_inline!([{ content } as any], 0, md.options, {}, md.renderer)

    for (let i = 0; i < 1000; i += 1) render(`x_${i}`)
    for (let i = 0; i < 1000; i += 1) render(`x_${i}`)
    assert.equal(renders, 1000, 'Repeated formulas across pages should stay cached')

    for (let i = 1000; i < 5000; i += 1) {
        render(`x_${i}`)
        render('x_999')
    }
    const before = renders
    render('x_999')
    assert.equal(renders, before, 'Frequently reused formulas stay in the working set')
    render('x_0')
    assert.equal(renders, before + 1, 'The cache must evict old formulas rather than grow forever')
})

test('TiO2 reuses MathJax without changing SVG, assistive MathML, styles or equation state', async () => {
    const original = new MarkdownIt().use(mathjaxPlugin, markdownMathOptions).use(createLatexMathMarkdownPlugin())
    const originalBlock = original.renderer.rules.math_block!
    original.renderer.rules.math_block = (...args) => originalBlock(...args)
        .replace(/^<mjx-container /u, '<mjx-container tabindex="0" ')
    annotateMathSource(original)
    const { markdown: optimized, styles } = await createMathMarkdownRenderer()
    const sources = [
        '$x < y$ and $\\frac{1}{2}$ and $\\bm{v}\\in\\R^n$.',
        '$$\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n$$',
        '$$\n\\begin{array}{|c:c|}\\hline a&b\\\\\\hdashline c&d\\\\\\hline\\end{array}\n$$',
        '$$\n\\begin{equation}E=mc^2\\label{energy}\\end{equation}\n$$\n\n$\\eqref{energy}$',
        '$$\n\\begin{equation}a^2+b^2=c^2\\end{equation}\n$$',
        '$\\newcommand{\\buildtest}{x}\\buildtest$ then $\\buildtest$.',
        '$\\renewcommand{\\buildtest}{y}\\buildtest$ then $\\buildtest$.',
        '$\\color{red}{x}$ and $\\href{https://example.com}{y}$ and $\\bbox[2px,border:1px solid blue]{z}$.',
        '$\\enclose{circle}{x}$ and $\\cancel{x}$ and $\\ce{H2O}$.',
        '$\\notARealCommand$'
    ]
    for (const source of sources) {
        const handlers = [...mathjax.handlers].length
        const rendered = optimized.render(source, {})
        assert.equal([...mathjax.handlers].length, handlers, 'Rendering must not accumulate global handlers')
        assert.equal(
            juice.inlineContent(rendered, styles, {
                applyWidthAttributes: true,
                applyHeightAttributes: true,
                applyAttributesTableElements: true
            }),
            original.render(source, {}),
            source
        )
    }
    const { markdown: independent } = await createMathMarkdownRenderer()
    assert.match(independent.render('$\\buildtest$', {}), /data-mjx-error=/u)
    for (const renderer of [original, optimized]) {
        assert.throws(() => renderer.render('$\\toggle{x}{y}\\endtoggle$', {}), /addEventListener/u)
    }
})

test('TiO2 markdown rendering supports LaTeX math delimiters without touching code or escaped text', async () => {
    const { markdown: md } = await createMathMarkdownRenderer()
    const rendered = md.render(
        [
            '设 \\(T:V\\to W\\) 为映射，且 $x$ 已定义。',
            '',
            '   \\[',
            '   \\begin{aligned}',
            '   a&=b\\\\[2pt]',
            '   c&=d',
            '   \\end{aligned}',
            '   \\]',
            '',
            '保留 \\\\(literal) 与 `\\(not math\\)`。'
        ].join('\n'),
        { relativePath: 'foundations/example.md' }
    )

    assert.equal(rendered.match(/<mjx-container\b/gu)?.length, 3)
    assert.match(rendered, /data-tex="\$T:V\\to W\$"/u)
    assert.match(rendered, /data-tex="\$\$[^"]*"[^>]*display="true"/u)
    assert.ok(rendered.includes('\\\\[2pt]'))
    assert.ok(rendered.includes('\\(literal)'))
    assert.ok(rendered.includes('<code>\\(not math\\)</code>'))
})
