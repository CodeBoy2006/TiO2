import path from 'node:path'

interface RewriteAssetReferenceOptions {
    sourceDocumentPath: string
    targetDocumentPath: string
    sourceAssetDirectoryPath: string
    targetAssetDirectoryPath: string
}

interface FenceState {
    marker: '`' | '~'
    length: number
}

export function rewriteRelativeAssetReferences(markdown: string, options: RewriteAssetReferenceOptions) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n')
    let fence: FenceState | null = null

    return lines
        .map((line) => {
            const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/u)

            if (fence) {
                if (
                    fenceMatch &&
                    fenceMatch[1][0] === fence.marker &&
                    fenceMatch[1].length >= fence.length
                ) {
                    fence = null
                }
                return line
            }

            if (fenceMatch) {
                fence = {
                    marker: fenceMatch[1][0] as FenceState['marker'],
                    length: fenceMatch[1].length
                }
                return line
            }

            if (/^ {4}/u.test(line)) return line

            return rewriteMarkdownLine(line, (destination) => rewriteDestination(destination, options))
        })
        .join('\n')
}

function rewriteMarkdownLine(line: string, rewrite: (destination: string) => string) {
    const definitionMatch = line.match(/^(\s{0,3}\[[^\]]+\]:\s*)(<([^>]+)>|(\S+))/u)
    let rewrittenLine = line

    if (definitionMatch) {
        const originalToken = definitionMatch[2]
        const originalDestination = definitionMatch[3] ?? definitionMatch[4]
        const nextDestination = rewrite(originalDestination)
        const nextToken =
            originalToken.startsWith('<') || /\s/u.test(nextDestination) ? `<${nextDestination}>` : nextDestination
        rewrittenLine = `${definitionMatch[1]}${nextToken}${line.slice(definitionMatch[0].length)}`
    }

    let output = ''
    let cursor = 0

    while (cursor < rewrittenLine.length) {
        if (rewrittenLine[cursor] === '`') {
            const markerLength = countRun(rewrittenLine, cursor, '`')
            const marker = '`'.repeat(markerLength)
            const closingIndex = rewrittenLine.indexOf(marker, cursor + markerLength)

            if (closingIndex >= 0) {
                const endIndex = closingIndex + markerLength
                output += rewrittenLine.slice(cursor, endIndex)
                cursor = endIndex
                continue
            }
        }

        if (
            rewrittenLine[cursor] === ']' &&
            rewrittenLine[cursor + 1] === '(' &&
            !isEscaped(rewrittenLine, cursor) &&
            rewrittenLine.lastIndexOf('[', cursor) >= 0
        ) {
            output += ']('
            cursor += 2

            while (cursor < rewrittenLine.length && /\s/u.test(rewrittenLine[cursor])) {
                output += rewrittenLine[cursor]
                cursor += 1
            }

            if (rewrittenLine[cursor] === '<') {
                const closingIndex = findUnescapedCharacter(rewrittenLine, '>', cursor + 1)
                if (closingIndex >= 0) {
                    const destination = rewrittenLine.slice(cursor + 1, closingIndex)
                    output += `<${rewrite(destination)}>`
                    cursor = closingIndex + 1
                    continue
                }
            }

            const destinationEnd = findBareDestinationEnd(rewrittenLine, cursor)
            const destination = rewrittenLine.slice(cursor, destinationEnd)
            if (destination) {
                const nextDestination = rewrite(destination)
                output += /\s/u.test(nextDestination) ? `<${nextDestination}>` : nextDestination
                cursor = destinationEnd
                continue
            }
        }

        output += rewrittenLine[cursor]
        cursor += 1
    }

    return output
}

function rewriteDestination(destination: string, options: RewriteAssetReferenceOptions) {
    if (
        !destination ||
        destination.startsWith('/') ||
        destination.startsWith('#') ||
        destination.startsWith('?') ||
        destination.startsWith('//') ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(destination)
    ) {
        return destination
    }

    const suffixIndex = findSuffixIndex(destination)
    const rawPath = suffixIndex >= 0 ? destination.slice(0, suffixIndex) : destination
    const suffix = suffixIndex >= 0 ? destination.slice(suffixIndex) : ''
    const decodedPath = safeDecodeUri(unescapeMarkdownDestination(rawPath))
    const sourceDocumentDirectory = path.posix.dirname(options.sourceDocumentPath)
    const targetDocumentDirectory = path.posix.dirname(options.targetDocumentPath)
    const resolvedSourcePath = path.posix.normalize(path.posix.join(sourceDocumentDirectory, decodedPath))
    const relativeAssetPath = path.posix.relative(options.sourceAssetDirectoryPath, resolvedSourcePath)

    if (
        isParentPath(relativeAssetPath) ||
        path.posix.isAbsolute(relativeAssetPath)
    ) {
        return destination
    }

    const resolvedTargetPath = path.posix.join(options.targetAssetDirectoryPath, relativeAssetPath)
    let nextPath = path.posix.relative(targetDocumentDirectory, resolvedTargetPath)

    if (!nextPath.startsWith('.')) {
        nextPath = `./${nextPath}`
    }

    return `${nextPath}${suffix}`
}

function findBareDestinationEnd(line: string, startIndex: number) {
    let depth = 0

    for (let index = startIndex; index < line.length; index += 1) {
        if (line[index] === '\\') {
            index += 1
            continue
        }

        if (line[index] === '(') {
            depth += 1
            continue
        }

        if (line[index] === ')') {
            if (depth === 0) return index
            depth -= 1
            continue
        }

        if (depth === 0 && /\s/u.test(line[index])) {
            return index
        }
    }

    return line.length
}

function findSuffixIndex(destination: string) {
    const queryIndex = destination.indexOf('?')
    const hashIndex = destination.indexOf('#')
    const indices = [queryIndex, hashIndex].filter((index) => index >= 0)
    return indices.length ? Math.min(...indices) : -1
}

function findUnescapedCharacter(value: string, character: string, startIndex: number) {
    for (let index = startIndex; index < value.length; index += 1) {
        if (value[index] === character && !isEscaped(value, index)) {
            return index
        }
    }

    return -1
}

function countRun(value: string, startIndex: number, character: string) {
    let length = 0
    while (value[startIndex + length] === character) {
        length += 1
    }
    return length
}

function isEscaped(value: string, index: number) {
    let slashCount = 0
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
        slashCount += 1
    }
    return slashCount % 2 === 1
}

function safeDecodeUri(value: string) {
    try {
        return decodeURI(value)
    } catch {
        return value
    }
}

function unescapeMarkdownDestination(value: string) {
    return value.replace(/\\([\\ !"#$%&'()*+,./:;<=>?@[\]^_`{|}~-])/gu, '$1')
}

function isParentPath(relativePath: string) {
    return relativePath === '..' || relativePath.startsWith('../')
}
