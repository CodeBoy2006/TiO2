import type MarkdownIt from 'markdown-it'
import { FOUNDATION_CONTENT_SECTIONS } from '../../packages/content-core/src/index'
import { escapeHtmlAttribute, escapeHtmlText } from './markdownRendering'

const sections = Object.values(FOUNDATION_CONTENT_SECTIONS)
const formalStatements = new Set(sections.map((titles) => titles[0]))
const referencesHeadings = new Set(sections.map((titles) => titles[4]))
const foundationSectionHeadings = new Set(sections.flat())

export function createFoundationMarkdownPlugin(foundationsDir: string) {
    return (md: MarkdownIt) => {
        md.core.ruler.push('foundation-sections', (state) => {
            const sourcePath =
                typeof state.env.relativePath === 'string' ? state.env.relativePath.replace(/\\/g, '/') : ''
            if (!sourcePath.startsWith(`${foundationsDir}/`)) return

            const output: typeof state.tokens = []
            let sectionOpen = false
            let statementOpen = false
            const html = (content: string) => {
                const token = new state.Token('html_block', '', 0)
                token.content = content
                return token
            }

            for (let index = 0; index < state.tokens.length; index += 1) {
                const heading = state.tokens[index]
                const inline = state.tokens[index + 1]
                const closeHeading = state.tokens[index + 2]
                const isSectionHeading =
                    heading.type === 'heading_open' &&
                    heading.tag === 'h2' &&
                    inline?.type === 'inline' &&
                    closeHeading?.type === 'heading_close'

                if (!isSectionHeading) {
                    output.push(heading)
                    continue
                }

                if (sectionOpen) {
                    output.push(html(statementOpen ? '</section>\n' : '</details>\n'))
                    sectionOpen = false
                    statementOpen = false
                }

                const title = inline.content.trim()
                if (formalStatements.has(title)) {
                    // The statement stays visible; the wrapper lets the page mark it as the canonical passage.
                    output.push(html('<section class="foundation-statement">\n'), heading, inline, closeHeading)
                    sectionOpen = true
                    statementOpen = true
                    index += 2
                    continue
                }
                if (!foundationSectionHeadings.has(title)) {
                    output.push(heading, inline, closeHeading)
                    index += 2
                    continue
                }

                const id = heading.attrGet('id') || title
                const references = referencesHeadings.has(title)
                output.push(
                    html(
                        `<details class="foundation-section${references ? ' foundation-references' : ''}" data-foundation-section="${escapeHtmlAttribute(id)}"${references ? '' : ' open'}><summary id="${escapeHtmlAttribute(id)}"><span class="foundation-section__title" role="heading" aria-level="2">${escapeHtmlText(title)}</span><span class="foundation-section__toggle" aria-hidden="true"></span></summary>\n`
                    )
                )
                sectionOpen = true
                index += 2
            }

            if (sectionOpen) output.push(html(statementOpen ? '</section>\n' : '</details>\n'))
            state.tokens = output
        })
    }
}
