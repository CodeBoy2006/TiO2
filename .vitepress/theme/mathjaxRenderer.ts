import type MarkdownIt from 'markdown-it'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js'
import type { LiteText } from 'mathjax-full/js/adaptors/lite/Text.js'
import type { LiteDocument } from 'mathjax-full/js/adaptors/lite/Document.js'
import { HTMLHandler } from 'mathjax-full/js/handlers/html/HTMLHandler.js'
import { AssistiveMmlHandler } from 'mathjax-full/js/a11y/assistive-mml.js'

export function reuseMathJaxRenderer(
    md: MarkdownIt,
    options: { tex?: Record<string, unknown>; svg?: Record<string, unknown> }
) {
    // Keep markdown-it-mathjax3's tokenization, but own one document per renderer.
    // Its default renderer creates a document and registers a global handler for every formula.
    const adaptor = liteAdaptor()
    const handler = new HTMLHandler<LiteElement, LiteText, LiteDocument>(adaptor)
    AssistiveMmlHandler(handler)
    const output = new SVG<LiteElement, LiteText, LiteDocument>({ fontCache: 'none', ...options.svg })
    const document = handler.create('', {
        InputJax: new TeX({ packages: AllPackages, ...options.tex }),
        OutputJax: output
    })
    const render = (content: string, display: boolean) => adaptor.outerHTML(document.convert(content, { display }))

    md.renderer.rules.math_inline = (tokens, index) => render(tokens[index].content, false)
    // Match VitePress's keyboard-focusable display math.
    md.renderer.rules.math_block = (tokens, index) =>
        render(tokens[index].content, true).replace(/^<mjx-container /u, '<mjx-container tabindex="0" ')

    // SVG styles cover every registered wrapper before any formula is rendered.
    // Share them across pages instead of parsing and inlining them for every formula.
    return adaptor.textContent(output.styleSheet(document))
}
