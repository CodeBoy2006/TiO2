import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import { attrs } from '@mdit/plugin-attrs'
import { container, type MarkdownItContainerOptions } from '@mdit/plugin-container'
import cjkFriendly from 'markdown-it-cjk-friendly'
import footnote from 'markdown-it-footnote'
import mathjax from 'markdown-it-mathjax3'
import { bundledLanguages, createHighlighter } from 'shiki'
import {
    transformerMetaHighlight,
    transformerNotationDiff,
    transformerNotationFocus,
    transformerNotationHighlight,
    transformerNotationErrorLevel
} from '@shikijs/transformers'
import { slugifyFragment } from '../packages/content-core/src/reference-utils.js'
import { markdownMathOptions } from './math-config.js'

// Load grammars once so nested folds/encrypted blocks can render synchronously.
const highlighter = createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: Object.keys(bundledLanguages)
})

export async function createMarkdownRenderer() {
    const shiki = await highlighter
    const md = new MarkdownIt({ html: true, linkify: true })
    md.linkify.set({ fuzzyLink: false })
    md.use(attrs, { rule: ['inline', 'table', 'list', 'heading', 'hr', 'softbreak', 'blockInfo', 'blockEnd'] })
        .use(cjkFriendly)
        .use(footnote)
        .use(mathjax, markdownMathOptions)
        .use(anchor, {
            slugify: slugifyFragment,
            getTokensText: (tokens) =>
                tokens
                    .filter((token) => !['html_inline', 'emoji'].includes(token.type))
                    .map((token) => token.content)
                    .join(''),
            permalink(slug, _options, state, index) {
                const children = state.tokens[index + 1].children!
                const title = children
                    .filter((token) => ['text', 'code_inline'].includes(token.type))
                    .map((token) => token.content)
                    .join('')
                    .trim()
                children.push(
                    Object.assign(new state.Token('text', '', 0), { content: ' ' }),
                    Object.assign(new state.Token('link_open', 'a', 1), {
                        attrs: [
                            ['class', 'header-anchor'],
                            ['href', `#${slug}`],
                            ['aria-label', `Permalink to “${title}”`]
                        ]
                    }),
                    Object.assign(new state.Token('html_inline', '', 0), { content: '&#8203;' }),
                    new state.Token('link_close', 'a', -1)
                )
            }
        } satisfies anchor.AnchorOptions)

    for (const name of ['tip', 'info', 'warning', 'danger', 'details', 'note', 'important', 'caution']) {
        md.use(container, {
            name,
            openRender(tokens, index) {
                const token = tokens[index]
                const label = token.info.trim().slice(name.length).trim()
                const title = md.renderInline(label || (name === 'details' ? 'Details' : name.toUpperCase()))
                token.attrJoin('class', `${name} custom-block`)
                const attributes = md.renderer.renderAttrs(token)
                return name === 'details'
                    ? `<details${attributes}><summary>${title}</summary>\n`
                    : `<div${attributes}><p class="custom-block-title${label ? '' : ' custom-block-title-default'}">${title}</p>\n`
            },
            closeRender: () => (name === 'details' ? '</details>\n' : '</div>\n')
        } satisfies MarkdownItContainerOptions)
    }

    md.renderer.rules.table_open = (tokens, index, options, _env, renderer) => {
        if (tokens[index].attrIndex('tabindex') < 0) tokens[index].attrSet('tabindex', '0')
        return renderer.renderToken(tokens, index, options)
    }
    md.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
        const token = tokens[index]
        const href = token.attrGet('href')
        if (href && token.attrGet('class') !== 'header-anchor') {
            if (/^(?:[a-z][\w+.-]*:|\/\/)/iu.test(href)) {
                if (token.attrIndex('target') < 0) token.attrSet('target', '_blank')
                if (token.attrIndex('rel') < 0) token.attrSet('rel', 'noreferrer')
            } else if (
                token.attrIndex('download') < 0 &&
                token.attrIndex('target') < 0 &&
                !href.startsWith('?')
            ) {
                const [url, fragment] = href.split('#', 2)
                const normalized = url.replace(/(^|\/)index\.md(?=\?|$)/iu, '$1').replace(/\.md(?=\?|$)/u, '.html')
                token.attrSet(
                    'href',
                    normalized + (fragment === undefined ? '' : `#${slugifyFragment(decodeURI(fragment))}`)
                )
            }
        }
        return renderer.renderToken(tokens, index, options)
    }

    md.renderer.rules.fence = (tokens, index) => {
        const { content, info } = tokens[index]
        const label = /^[\w-]+/u.exec(info)?.[0] ?? ''
        const language = label.toLowerCase()
        const code = content.trimEnd()
        const highlighted = shiki.codeToHtml(code, {
            lang: Object.hasOwn(bundledLanguages, language) ? language : 'text',
            themes: { light: 'github-light', dark: 'github-dark' },
            defaultColor: false,
            // Retain the theme's contrast-adjusted syntax colors.
            colorReplacements: {
                'github-light': {
                    '#959da5': '#6c676f',
                    '#28a745': '#0e790b',
                    '#b08800': '#846312',
                    '#e36209': '#c13617',
                    '#3192aa': '#05728b',
                    '#d73a49': '#c62739',
                    '#22863a': '#11782a',
                    '#6a737d': '#62687b',
                    '#1b7c83': '#06747a',
                    '#0366d6': '#0663d0',
                    '#cb2431': '#c82430'
                },
                'github-dark': {
                    '#586069': '#5b93a3',
                    '#6a737d': '#818e99',
                    '#ea4a5a': '#ef5564',
                    '#2188ff': '#268bf9'
                }
            },
            meta: { __raw: info.slice(label.length) },
            transformers: [
                transformerMetaHighlight(),
                transformerNotationDiff(),
                transformerNotationFocus({ classActiveLine: 'has-focus', classActivePre: 'has-focused-lines' }),
                transformerNotationHighlight(),
                transformerNotationErrorLevel(),
                {
                    name: 'tio2:code-markup',
                    pre(node) {
                        this.addClassToHast(node, 'vp-code')
                        node.properties.dir = 'ltr'
                    },
                    code(node) {
                        for (const line of node.children) {
                            if (line.type === 'element' && !line.children.length) {
                                line.children.push({ type: 'element', tagName: 'wbr', properties: {}, children: [] })
                            }
                        }
                    }
                }
            ]
        })
        const numbered = !/:no-line-numbers\b/u.test(info)
        const start = Number(info.match(/:line-numbers=(\d+)/u)?.[1] ?? 1)
        const numbers = numbered
            ? `<div class="line-numbers-wrapper" aria-hidden="true">${code
                  .split('\n')
                  .map((_, line) => `<span class="line-number">${start + line}</span><br>`)
                  .join('')}</div>`
            : ''
        return `<div class="language-${label}${numbered ? ' line-numbers-mode' : ''}"><button title="Copy code" data-copied="Copied" class="copy"></button><span class="lang">${label.replaceAll('_', ' ')}</span>${highlighted}\n${numbers}</div>`
    }
    return md
}
