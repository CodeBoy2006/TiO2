import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import MarkdownIt from 'markdown-it'

interface FenceState {
    markerCode: number
    markerCount: number
}

const parserCache = new Map<string, MarkdownIt>()

export function findContainerCloseLine(
    state: StateBlock,
    startLine: number,
    endLine: number,
    outerMarkerCount: number
) {
    const nestedMarkerCounts: number[] = []
    let fence: FenceState | null = null

    for (let nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
        const start = state.bMarks[nextLine] + state.tShift[nextLine]
        const max = state.eMarks[nextLine]

        if (start >= max) continue

        const indentation = state.sCount[nextLine] - state.blkIndent
        if (fence) {
            if (indentation < 4 && isFenceClose(state, start, max, fence)) {
                fence = null
            }
            continue
        }

        if (indentation >= 4) continue

        const openedFence = readFenceOpen(state, start, max)
        if (openedFence) {
            fence = openedFence
            continue
        }

        if (state.src.charCodeAt(start) !== 0x3a) continue

        const markerEnd = state.skipChars(start, 0x3a)
        const markerCount = markerEnd - start
        if (markerCount < outerMarkerCount) continue

        const params = state.src.slice(markerEnd, max).trim()
        if (params) {
            nestedMarkerCounts.push(markerCount)
            continue
        }

        const nestedMarkerCount = nestedMarkerCounts.at(-1)
        if (nestedMarkerCount !== undefined) {
            if (markerCount >= nestedMarkerCount) {
                nestedMarkerCounts.pop()
            }
            continue
        }

        return nextLine
    }

    return -1
}

export function maskMarkdownContainers(markdown: string, containerNames: string[], relativePath = 'content.md') {
    const names = [...new Set(containerNames.map((name) => name.trim()).filter(Boolean))].sort()
    if (!names.length) return markdown

    const normalized = markdown.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    const parser = getContainerMaskingParser(names)
    const ranges = parser
        .parse(normalized, { relativePath })
        .filter((token) => token.type === 'masked_container' && token.map)
        .map((token) => token.map as [number, number])

    ranges.forEach(([startLine, endLine]) => {
        for (let line = startLine; line < endLine; line += 1) {
            lines[line] = ''
        }
    })

    return lines.join('\n')
}

function getContainerMaskingParser(containerNames: string[]) {
    const cacheKey = containerNames.join('\u0000')
    const cached = parserCache.get(cacheKey)
    if (cached) return cached

    const parser = new MarkdownIt()

    containerNames.forEach((containerName) => {
        parser.block.ruler.before('fence', `mask_${containerName}`, createContainerMaskRule(containerName), {
            alt: ['paragraph', 'reference', 'blockquote', 'list']
        })
    })

    parserCache.set(cacheKey, parser)
    return parser
}

function createContainerMaskRule(containerName: string) {
    return (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
        const start = state.bMarks[startLine] + state.tShift[startLine]
        const max = state.eMarks[startLine]

        if (state.sCount[startLine] - state.blkIndent >= 4) return false
        if (start + 3 > max || state.src.charCodeAt(start) !== 0x3a) return false

        const markerEnd = state.skipChars(start, 0x3a)
        const markerCount = markerEnd - start
        if (markerCount < 3) return false

        const params = state.src.slice(markerEnd, max).trim()
        if (params !== containerName && !params.startsWith(`${containerName} `)) return false
        if (silent) return true

        const closeLine = findContainerCloseLine(state, startLine, endLine, markerCount)
        if (closeLine < 0) {
            const source =
                typeof state.env?.relativePath === 'string' && state.env.relativePath
                    ? state.env.relativePath
                    : 'content.md'
            throw new Error(`[markdown-container] ${source}:${startLine + 1}: missing closing :::.`)
        }

        const token = state.push('masked_container', '', 0)
        token.block = true
        token.map = [startLine, closeLine + 1]
        state.line = closeLine + 1
        return true
    }
}

function readFenceOpen(state: StateBlock, start: number, max: number): FenceState | null {
    const markerCode = state.src.charCodeAt(start)
    if (markerCode !== 0x60 && markerCode !== 0x7e) return null

    const markerEnd = state.skipChars(start, markerCode)
    const markerCount = markerEnd - start
    if (markerCount < 3) return null

    if (markerCode === 0x60 && state.src.slice(markerEnd, max).includes('`')) {
        return null
    }

    return {
        markerCode,
        markerCount
    }
}

function isFenceClose(state: StateBlock, start: number, max: number, fence: FenceState) {
    if (state.src.charCodeAt(start) !== fence.markerCode) return false

    const markerEnd = state.skipChars(start, fence.markerCode)
    if (markerEnd - start < fence.markerCount) return false

    return state.skipSpaces(markerEnd) >= max
}
