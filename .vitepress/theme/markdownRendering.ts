import type MarkdownIt from 'markdown-it'

type ComponentProp = string | number | boolean | undefined

export function escapeHtmlAttribute(value: string) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeHtmlText(value: string) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderInlineMath(md: MarkdownIt, value: string, relativePath?: string) {
    if (!value.includes('$') && !value.includes('\\(')) return escapeHtmlText(value)
    const rendered = md.renderInline(value, { relativePath, referenceRenderMode: 'static-html' })
    return rendered.includes('<mjx-container') ? rendered : escapeHtmlText(value)
}

export function renderComponentOpenTag(componentName: string, props: Record<string, ComponentProp>) {
    const attributes = Object.entries(props)
        .filter(([, value]) => value !== undefined && value !== false && value !== '')
        .map(([key, value]) => (value === true ? key : `${key}="${escapeHtmlAttribute(String(value))}"`))
        .join(' ')

    return attributes ? `<${componentName} ${attributes}>` : `<${componentName}>`
}

export function renderComponentTag(componentName: string, props: Record<string, ComponentProp>) {
    return `${renderComponentOpenTag(componentName, props)}</${componentName}>`
}

export function createMarkdownLocation(relativePath: unknown, startLine: number) {
    const source = typeof relativePath === 'string' && relativePath.trim() ? relativePath : 'unknown.md'
    return `${source}:${startLine + 1}`
}

interface MathRenderEnv {
    indexMathSource?: boolean
}

const INLINE_MATH_CACHE_SIZE = 4096
const STATEFUL_TEX_PATTERN =
    /\\(?:DeclareMathOperator|def|gdef|edef|xdef|let|newcommand|providecommand|renewcommand|newenvironment|renewenvironment|definecolor|colorlet|require|label|tag|ref|eqref)\b/u

function renderMath(content: string, rendered: string, display: boolean, env: MathRenderEnv) {
    const delimiter = display ? '$$' : '$'
    const source = `${delimiter}${display ? '\n' : ''}${content}${display ? '\n' : ''}${delimiter}`
    const annotated = rendered.replace(
        '<mjx-container',
        () => `<mjx-container data-tex="${escapeHtmlAttribute(source).replace(/\n/g, '&#10;')}"`
    )
    return env.indexMathSource ? `${escapeHtmlText(source)}${annotated}` : annotated
}

export function annotateMathSource(md: MarkdownIt) {
    const renderInline = md.renderer.rules.math_inline
    const renderBlock = md.renderer.rules.math_block
    if (!renderInline || !renderBlock)
        throw new Error('Math renderer rules must be registered before annotating TeX source')

    // ponytail: Bound the inline working set instead of retaining the full formula corpus.
    const inlineCache = new Map<string, string>()

    md.renderer.rules.math_inline = (tokens, idx, options, env, self) => {
        const content = tokens[idx].content
        if (STATEFUL_TEX_PATTERN.test(content)) {
            inlineCache.clear()
            return renderMath(content, renderInline(tokens, idx, options, env, self), false, env)
        }

        let rendered = inlineCache.get(content)
        if (rendered === undefined) {
            rendered = renderInline(tokens, idx, options, env, self)
            inlineCache.set(content, rendered)
            if (inlineCache.size > INLINE_MATH_CACHE_SIZE) {
                const oldestKey = inlineCache.keys().next().value
                if (oldestKey !== undefined) inlineCache.delete(oldestKey)
            }
        } else {
            inlineCache.delete(content)
            inlineCache.set(content, rendered)
        }

        return renderMath(content, rendered, false, env)
    }
    md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
        const content = tokens[idx].content
        if (STATEFUL_TEX_PATTERN.test(content)) inlineCache.clear()
        return renderMath(content, renderBlock(tokens, idx, options, env, self), true, env)
    }
}
