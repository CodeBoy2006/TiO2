import type MarkdownIt from 'markdown-it'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'

const INLINE_OPEN = '\\('
const INLINE_CLOSE = '\\)'
const DISPLAY_OPEN = '\\['
const DISPLAY_CLOSE = '\\]'

function findInlineClose(source: string, start: number) {
    let close = source.indexOf(INLINE_CLOSE, start)

    while (close >= 0) {
        let slashCount = 1
        for (let index = close - 1; index >= 0 && source[index] === '\\'; index -= 1) slashCount += 1

        if (slashCount % 2 === 1) return close
        close = source.indexOf(INLINE_CLOSE, close + INLINE_CLOSE.length)
    }

    return -1
}

function latexInlineMath(state: StateInline, silent: boolean) {
    if (!state.src.startsWith(INLINE_OPEN, state.pos)) return false

    const contentStart = state.pos + INLINE_OPEN.length
    const close = findInlineClose(state.src, contentStart)
    if (close < 0 || close === contentStart) return false

    if (!silent) {
        const token = state.push('math_inline', 'math', 0)
        token.markup = INLINE_OPEN
        token.content = state.src.slice(contentStart, close)
    }

    state.pos = close + INLINE_CLOSE.length
    return true
}

function isDelimiterLine(state: StateBlock, line: number, delimiter: string) {
    const start = state.bMarks[line] + state.tShift[line]
    return state.src.slice(start, state.eMarks[line]).trim() === delimiter
}

function latexDisplayMath(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false
    if (!isDelimiterLine(state, startLine, DISPLAY_OPEN)) return false
    if (silent) return true

    let closeLine = startLine + 1
    while (closeLine < endLine) {
        const start = state.bMarks[closeLine] + state.tShift[closeLine]
        const end = state.eMarks[closeLine]

        if (start < end && state.tShift[closeLine] < state.blkIndent) return false
        if (isDelimiterLine(state, closeLine, DISPLAY_CLOSE)) break
        closeLine += 1
    }
    if (closeLine >= endLine) return false

    const token = state.push('math_block', 'math', 0)
    token.block = true
    token.content = state.getLines(startLine + 1, closeLine, state.tShift[startLine], true)
    token.map = [startLine, closeLine + 1]
    token.markup = DISPLAY_OPEN
    state.line = closeLine + 1
    return true
}

export function createLatexMathMarkdownPlugin() {
    return (md: MarkdownIt) => {
        // Markdown escapes backslash delimiters unless math claims them first.
        md.inline.ruler.before('escape', 'latex_math_inline', latexInlineMath)
        md.block.ruler.before('blockquote', 'latex_math_block', latexDisplayMath, {
            alt: ['paragraph', 'reference', 'blockquote', 'list']
        })
    }
}
