import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import { createTranslator, type Translator } from '../../packages/config/src/i18n.js'
import type MarkdownIt from 'markdown-it'
import { findContainerCloseLine } from '../../packages/content-core/src/markdown-containers'
import {
    createMarkdownLocation,
    escapeHtmlAttribute,
    escapeHtmlText,
    renderComponentOpenTag
} from './markdownRendering'

const FOLD_MARKER_CODE = 0x3a
const DEFAULT_CODE_LINES = 14
const DEFAULT_CONTENT_LINES = 8

const CONTAINER_KIND_MAP = new Map<string, FoldBlockKind>([
    ['fold', 'content'],
    ['collapse', 'content'],
    ['fold-content', 'content'],
    ['content-fold', 'content'],
    ['collapse-content', 'content'],
    ['content-collapse', 'content'],
    ['code-fold', 'code'],
    ['fold-code', 'code'],
    ['code-collapse', 'code'],
    ['collapse-code', 'code']
])

const OPTION_KEY_MAP = new Map<string, keyof Omit<FoldBlockOptions, 'kind'>>([
    ['mode', 'mode'],
    ['lines', 'lines'],
    ['height', 'height'],
    ['preview-height', 'height'],
    ['previewheight', 'height'],
    ['title', 'title'],
    ['summary', 'summary'],
    ['description', 'summary'],
    ['expand-text', 'expandText'],
    ['expand', 'expandText'],
    ['expand-label', 'expandText'],
    ['collapse-text', 'collapseText'],
    ['collapse', 'collapseText'],
    ['collapse-label', 'collapseText'],
    ['open', 'open'],
    ['default-open', 'open'],
    ['expanded', 'open']
])

interface FoldBlockOptions {
    kind: FoldBlockKind
    mode?: FoldBlockMode
    lines?: number
    height?: string
    title?: string
    summary?: string
    expandText?: string
    collapseText?: string
    open?: boolean
}

interface FoldBlockTokenMeta {
    content: string
    location: string
    options: FoldBlockOptions
}

type FoldBlockKind = 'content' | 'code'
type FoldBlockMode = 'partial' | 'full'

function normalizeOptionKey(key: string) {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .trim()
        .toLowerCase()
}

function parseBooleanValue(value: string | boolean, location: string, keyName: string) {
    if (typeof value === 'boolean') return value

    const normalized = value.trim().toLowerCase()

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false

    throw new Error(`[fold-block] ${location}: ${keyName} must be true/false.`)
}

function normalizeMode(value: string, location: string) {
    const normalized = value.trim().toLowerCase()

    if (['partial', 'preview', 'peek'].includes(normalized)) return 'partial' satisfies FoldBlockMode
    if (['full', 'all', 'hidden'].includes(normalized)) return 'full' satisfies FoldBlockMode

    throw new Error(`[fold-block] ${location}: mode must be partial or full.`)
}

function normalizeLines(value: string, location: string) {
    const parsed = Number.parseInt(value, 10)

    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`[fold-block] ${location}: lines must be a positive integer.`)
    }

    return parsed
}

function normalizeContainerKind(rawType: string, location: string) {
    const containerType = CONTAINER_KIND_MAP.get(rawType.trim().toLowerCase())

    if (!containerType) {
        throw new Error(`[fold-block] ${location}: unsupported fold type: ${rawType}.`)
    }

    return containerType
}

function parseFoldOptions(rawType: string, rawOptions: string, location: string): FoldBlockOptions {
    const kind = normalizeContainerKind(rawType, location)
    const options: FoldBlockOptions = { kind }
    const remainder = rawOptions.trim()

    if (!remainder) {
        options.mode = 'partial'

        if (kind === 'code') {
            options.lines = DEFAULT_CODE_LINES
        } else {
            options.lines = DEFAULT_CONTENT_LINES
        }

        return options
    }

    const pattern = /([A-Za-z][A-Za-z0-9_-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(remainder))) {
        if (remainder.slice(lastIndex, match.index).trim()) {
            throw new Error(`[fold-block] ${location}: invalid options; use key="value" or standalone boolean flags.`)
        }

        const [, rawKey, doubleQuoted, singleQuoted, bareValue] = match
        const normalizedKey = normalizeOptionKey(rawKey)
        const targetKey = OPTION_KEY_MAP.get(normalizedKey)

        if (!targetKey) {
            throw new Error(`[fold-block] ${location}: unsupported option: ${rawKey}.`)
        }

        const resolvedValue = doubleQuoted ?? singleQuoted ?? bareValue ?? true

        switch (targetKey) {
            case 'mode':
                options.mode = normalizeMode(String(resolvedValue), location)
                break
            case 'lines':
                options.lines = normalizeLines(String(resolvedValue), location)
                break
            case 'height':
                options.height = String(resolvedValue).trim()
                if (!options.height) {
                    throw new Error(`[fold-block] ${location}: height cannot be empty.`)
                }
                break
            case 'title':
                options.title = String(resolvedValue).trim() || undefined
                break
            case 'summary':
                options.summary = String(resolvedValue).trim() || undefined
                break
            case 'expandText':
                options.expandText = String(resolvedValue).trim() || undefined
                break
            case 'collapseText':
                options.collapseText = String(resolvedValue).trim() || undefined
                break
            case 'open':
                options.open = parseBooleanValue(resolvedValue, location, rawKey)
                break
            default:
                break
        }

        lastIndex = pattern.lastIndex
    }

    if (remainder.slice(lastIndex).trim()) {
        throw new Error(`[fold-block] ${location}: invalid options; use key="value" or standalone boolean flags.`)
    }

    if (!options.mode) {
        options.mode = 'partial'
    }

    if (!options.lines) {
        options.lines = kind === 'code' ? DEFAULT_CODE_LINES : DEFAULT_CONTENT_LINES
    }

    return options
}

function createFoldBlockRule() {
    return (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
        const start = state.bMarks[startLine] + state.tShift[startLine]
        const max = state.eMarks[startLine]

        if (state.sCount[startLine] - state.blkIndent >= 4) return false
        if (start + 3 > max) return false
        if (state.src.charCodeAt(start) !== FOLD_MARKER_CODE) return false

        let markerEnd = start
        while (markerEnd < max && state.src.charCodeAt(markerEnd) === FOLD_MARKER_CODE) {
            markerEnd += 1
        }

        const markerCount = markerEnd - start
        if (markerCount < 3) return false

        const markerParams = state.src.slice(markerEnd, max).trim()
        if (!markerParams) return false

        const [rawType, ...rest] = markerParams.split(/\s+/)
        if (!CONTAINER_KIND_MAP.has(rawType.toLowerCase())) return false
        if (silent) return true

        const location = createMarkdownLocation(state.env?.relativePath, startLine)
        const nextLine = findContainerCloseLine(state, startLine, endLine, markerCount)

        if (nextLine < 0) {
            throw new Error(`[fold-block] ${location}: missing closing :::.`)
        }

        const token = state.push('fold_block', 'FoldBlock', 0)
        token.block = true
        token.map = [startLine, nextLine + 1]
        token.markup = state.src.slice(start, markerEnd)
        token.info = markerParams
        token.meta = {
            content: state.getLines(startLine + 1, nextLine, 0, true),
            location,
            options: parseFoldOptions(rawType, rest.join(' '), location)
        } satisfies FoldBlockTokenMeta

        state.line = nextLine + 1
        return true
    }
}

export function createFoldMarkdownPlugin(language = 'en') {
    const t = createTranslator(language)
    return (md: MarkdownIt) => {
        md.block.ruler.before('fence', 'fold_block', createFoldBlockRule(), {
            alt: ['paragraph', 'reference', 'blockquote', 'list']
        })

        md.renderer.rules.fold_block = (tokens, index, _options, env) => {
            const meta = tokens[index].meta as FoldBlockTokenMeta
            const renderedHtml = md.render(meta.content, env)

            if (env?.referenceRenderMode === 'static-html') {
                return renderStaticFoldBlock(t, meta.options, renderedHtml)
            }

            const openTag = renderComponentOpenTag('FoldBlock', {
                kind: meta.options.kind,
                mode: meta.options.mode,
                lines: meta.options.lines,
                height: meta.options.height,
                title: meta.options.title,
                summary: meta.options.summary,
                'expand-text': meta.options.expandText,
                'collapse-text': meta.options.collapseText,
                open: meta.options.open === true ? 'true' : meta.options.open === false ? 'false' : undefined
            })

            return `${openTag}${renderedHtml}</FoldBlock>`
        }
    }
}

function renderStaticFoldBlock(t: Translator, options: FoldBlockOptions, renderedHtml: string) {
    const mode = options.mode ?? 'partial'
    const lines = options.lines ?? (options.kind === 'code' ? DEFAULT_CODE_LINES : DEFAULT_CONTENT_LINES)
    const expanded = options.open === true
    const collapsedHeight =
        mode === 'full'
            ? '0px'
            : options.height ||
              (options.kind === 'code' ? `calc(${lines} * 1.65em + 3.5rem)` : `calc(${lines} * 1.85em)`)
    const expandText = options.expandText || t('展开', 'Expand')
    const collapseText = options.collapseText || t('收起', 'Collapse')
    const meta = [
        options.title ? `<strong class="fold-block__title">${escapeHtmlText(options.title)}</strong>` : '',
        options.summary ? `<span class="fold-block__summary">${escapeHtmlText(options.summary)}</span>` : ''
    ].join('')
    const metaHtml = meta ? `<div class="fold-block__meta">${meta}</div>` : ''
    const classes = [
        'fold-block',
        `fold-block--${options.kind}`,
        `fold-block--${mode}`,
        expanded ? 'is-expanded' : '',
        'is-collapsible',
        meta ? 'has-meta' : ''
    ]
        .filter(Boolean)
        .join(' ')
    const fade = mode === 'partial' && !expanded ? '<div class="fold-block__fade" aria-hidden="true"></div>' : ''

    return `<section class="${classes}" data-kind="${options.kind}" data-mode="${mode}" data-expanded="${expanded}" data-collapsible="true" data-collapsed-height="${escapeHtmlAttribute(collapsedHeight)}" data-expand-text="${escapeHtmlAttribute(expandText)}" data-collapse-text="${escapeHtmlAttribute(collapseText)}"><div class="fold-block__header"><button type="button" class="fold-block__toggle" aria-expanded="${expanded}" aria-label="${escapeHtmlAttribute(expanded ? collapseText : expandText)}"><svg class="fold-block__toggle-icon" viewBox="0 3 16 10" aria-hidden="true"><path d="M4 4.75 8 8.25l4-3.5"></path><path d="M4 8.25 8 11.75l4-3.5"></path></svg></button>${metaHtml}</div><div class="fold-block__body" style="max-height:${escapeHtmlAttribute(expanded ? 'none' : collapsedHeight)}"><div class="fold-block__body-inner">${renderedHtml}</div>${fade}</div></section>`
}
