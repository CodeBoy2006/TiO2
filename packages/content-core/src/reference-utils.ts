import type { ReferenceGraph, ReferenceTarget } from './types'

const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g
const rCombining = /[\u0300-\u036F]/g

function stripControlCharacters(value: string) {
    return [...value].filter((character) => (character.codePointAt(0) ?? 0) > 0x1f).join('')
}

export interface ParsedWikiReference {
    target: string
    anchor: string
    label: string
    isTopic: boolean
    isFoundation: boolean
}

export interface ResolvedReference {
    target: ReferenceTarget
    parsed: ParsedWikiReference
}

export interface WikiReferenceMatch {
    raw: string
    embed: boolean
    end: number
}

export interface BlockAnchorParagraph {
    anchor: string
    content: string
}

export function matchWikiReferenceAt(source: string, start: number, max = source.length): WikiReferenceMatch | null {
    let embed = false
    let cursor = start

    if (source.startsWith('![[', start)) {
        embed = true
        cursor += 3
    } else if (source.startsWith('[[', start)) {
        cursor += 2
    } else {
        return null
    }

    const closingIndex = source.indexOf(']]', cursor)
    if (closingIndex < 0 || closingIndex + 2 > max) return null

    const raw = source.slice(cursor, closingIndex).trim()
    if (!raw) return null

    return {
        raw,
        embed,
        end: closingIndex + 2
    }
}

export function parseBlockAnchorParagraph(value: string): BlockAnchorParagraph | null {
    const match = value.match(/(?:^|\n)[ \t]*\^([A-Za-z0-9][A-Za-z0-9_-]*)[ \t]*$/u)
    if (!match || match.index === undefined) return null

    return {
        anchor: match[1],
        content: value.slice(0, match.index).trimEnd()
    }
}

export function slugifyFragment(value: string) {
    return stripControlCharacters(value.normalize('NFKD'))
        .replace(rCombining, '')
        .replace(rSpecial, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^(\d)/, '_$1')
        .toLowerCase()
}

export function normalizeLookup(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

export function truncateText(value: string, maxLength = 120) {
    if (!value) return ''
    if (value.length <= maxLength) return value
    return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function cleanMarkdownText(value: string) {
    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[#>*_~\-|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function parseWikiReference(raw: string): ParsedWikiReference {
    const inner = raw.trim()
    const pipeIndex = inner.indexOf('|')
    const left = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim()
    const label = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : '').trim()
    const isTopic = left.startsWith('topic:')
    const isFoundation = left.startsWith('foundation:')
    const body = isTopic
        ? left.slice('topic:'.length).trim()
        : isFoundation
          ? left.slice('foundation:'.length).trim()
          : left
    const hashIndex = body.indexOf('#')

    return {
        target: (hashIndex >= 0 ? body.slice(0, hashIndex) : body).trim(),
        anchor: (hashIndex >= 0 ? body.slice(hashIndex + 1) : '').trim(),
        label,
        isTopic,
        isFoundation
    }
}

export function createArticleTargetId(sourcePath: string) {
    return `article:${sourcePath}`
}

export function createTopicTargetId(topicKey: string) {
    return `topic:${topicKey}`
}

export function createFoundationTargetId(id: string) {
    return `foundation:${id}`
}

export function createHeadingTargetId(sourcePath: string, anchor: string) {
    return `heading:${sourcePath}#${anchor}`
}

export function createBlockTargetId(sourcePath: string, anchor: string) {
    return `block:${sourcePath}#${anchor}`
}

export function createTopicAnchorId(topicKey: string) {
    const normalized = topicKey.replace(/[\\/]+/g, '-')
    return `topic-${slugifyFragment(normalized) || 'topic'}`
}

export function createReferenceResolver(referenceGraph: ReferenceGraph) {
    const targets = Object.values(referenceGraph.targets ?? {})
    const articleTitleMap = new Map<string, string | null>()
    const topicLookupMap = new Map<string, string | null>()
    const foundationLookupMap = new Map<string, string | null>()
    const articleBySourcePath = new Map<string, string>()
    const headingsBySourcePath = new Map<string, Array<{ targetId: string; anchor: string; normalizedTitle: string }>>()
    const blocksBySourcePath = new Map<string, Map<string, string>>()

    const appendUnique = (map: Map<string, string | null>, key: string, value: string) => {
        if (!key) return
        if (!map.has(key)) {
            map.set(key, value)
            return
        }

        if (map.get(key) !== value) {
            map.set(key, null)
        }
    }

    for (const target of targets) {
        if (target.type === 'article' && target.pageSourcePath) {
            articleBySourcePath.set(target.pageSourcePath, target.id)
            appendUnique(articleTitleMap, normalizeLookup(target.title), target.id)
            continue
        }

        if (target.type === 'topic') {
            appendUnique(topicLookupMap, normalizeLookup(target.title), target.id)
            if (target.topicKey) {
                appendUnique(topicLookupMap, normalizeLookup(target.topicKey), target.id)
            }
            continue
        }

        if (target.type === 'foundation') {
            appendUnique(foundationLookupMap, normalizeLookup(target.title), target.id)
            if (target.foundationId) {
                appendUnique(foundationLookupMap, normalizeLookup(target.foundationId), target.id)
            }
            target.aliases?.forEach((alias) => appendUnique(foundationLookupMap, normalizeLookup(alias), target.id))
            continue
        }

        if (!target.pageSourcePath || !target.anchor) continue

        if (target.type === 'heading') {
            const records = headingsBySourcePath.get(target.pageSourcePath) ?? []
            records.push({
                targetId: target.id,
                anchor: target.anchor,
                normalizedTitle: normalizeLookup(target.title)
            })
            headingsBySourcePath.set(target.pageSourcePath, records)
            continue
        }

        if (target.type === 'block') {
            const records = blocksBySourcePath.get(target.pageSourcePath) ?? new Map<string, string>()
            records.set(target.anchor, target.id)
            blocksBySourcePath.set(target.pageSourcePath, records)
        }
    }

    return (raw: string, currentSourcePath?: string): ResolvedReference | null => {
        const parsed = parseWikiReference(raw)
        const baseLookup = normalizeLookup(parsed.target)
        let pageTargetId: string | null | undefined

        if (parsed.isTopic) {
            pageTargetId = topicLookupMap.get(baseLookup)
        } else if (parsed.isFoundation) {
            pageTargetId = foundationLookupMap.get(baseLookup)
        } else if (parsed.target) {
            pageTargetId = articleTitleMap.get(baseLookup)
            if (!pageTargetId) {
                pageTargetId = topicLookupMap.get(baseLookup)
            }
            if (!pageTargetId) {
                pageTargetId = foundationLookupMap.get(baseLookup)
            }
        } else if (currentSourcePath) {
            pageTargetId = articleBySourcePath.get(currentSourcePath)
        }

        if (!pageTargetId) return null

        const pageTarget = referenceGraph.targets[pageTargetId]
        if (!pageTarget) return null

        if (!parsed.anchor) {
            return {
                target: pageTarget,
                parsed
            }
        }

        if (!pageTarget.pageSourcePath) return null

        const blockTargetId = blocksBySourcePath.get(pageTarget.pageSourcePath)?.get(parsed.anchor)
        if (blockTargetId) {
            return {
                target: referenceGraph.targets[blockTargetId],
                parsed
            }
        }

        const fragmentSlug = slugifyFragment(parsed.anchor)
        const headingTarget =
            headingsBySourcePath
                .get(pageTarget.pageSourcePath)
                ?.find((item) => item.anchor === parsed.anchor || item.anchor === fragmentSlug)?.targetId ??
            headingsBySourcePath
                .get(pageTarget.pageSourcePath)
                ?.find((item) => item.normalizedTitle === normalizeLookup(parsed.anchor))?.targetId

        if (!headingTarget) return null

        return {
            target: referenceGraph.targets[headingTarget],
            parsed
        }
    }
}
