import { t, language } from './i18n'
import type { CmsDocumentCreateInput, CmsDocumentDetail, CmsDocumentUpdateInput, CmsLibraryItem } from './types'
import { FOUNDATION_RELATION_FIELDS } from '../../../packages/content-core/src/foundations'
import type { FoundationRelationField } from '../../../packages/content-core/src/types'

const foundationKeys = new Set(['aliases', 'kind', 'domains', 'page', ...FOUNDATION_RELATION_FIELDS])

const knownFrontmatterKeys = new Set([
    'title',
    'description',
    'date',
    'lastUpdated',
    'category',
    'cover',
    'order',
    'tags',
    'topics'
])

export type CmsCoverFit = 'cover' | 'contain'

export interface CmsDocumentDraft {
    sourcePath: string
    kind: CmsDocumentDetail['kind']
    title: string
    description: string
    date: string
    lastUpdated: string
    category: string
    order: string
    tagsText: string
    topicsText: string
    coverSrc: string
    coverAlt: string
    coverFit: CmsCoverFit
    coverPosition: string
    foundationKind: string
    aliasesText: string
    domains: string[]
    relations: Record<FoundationRelationField, string[]>
    extraFrontmatterJson: string
    body: string
}

export function createEmptyDraft(
    kind: CmsDocumentDetail['kind'],
    overrides: Partial<CmsDocumentDraft> = {},
    today = new Date()
): CmsDocumentDraft {
    return {
        sourcePath: '',
        kind,
        title: '',
        description: '',
        date: kind === 'page' || kind === 'foundation' || kind === 'topicMeta' ? '' : today.toLocaleDateString('sv-SE'),
        lastUpdated: '',
        category: '',
        order: '',
        tagsText: '',
        topicsText: '',
        coverSrc: '',
        coverAlt: '',
        coverFit: 'cover',
        coverPosition: 'center',
        foundationKind: 'definition',
        aliasesText: '',
        domains: [],
        relations: {
            requires: [],
            uses: [],
            implemented_by: [],
            special_case_of: [],
            equivalent_to: [],
            contrasts_with: []
        },
        extraFrontmatterJson: '',
        body: '',
        ...overrides
    }
}

export function createDraftFromDocument(document: CmsDocumentDetail): CmsDocumentDraft {
    const extraFrontmatter = Object.fromEntries(
        Object.entries(document.frontmatter).filter(
            ([key]) => !knownFrontmatterKeys.has(key) && !(document.kind === 'foundation' && foundationKeys.has(key))
        )
    )
    const cover = readCoverFrontmatter(document.frontmatter.cover)

    const defaults = createEmptyDraft(document.kind)
    return {
        ...defaults,
        sourcePath: document.sourcePath,
        kind: document.kind,
        title: typeof document.frontmatter.title === 'string' ? document.frontmatter.title : '',
        description: typeof document.frontmatter.description === 'string' ? document.frontmatter.description : '',
        date: typeof document.frontmatter.date === 'string' ? document.frontmatter.date : '',
        lastUpdated: typeof document.frontmatter.lastUpdated === 'string' ? document.frontmatter.lastUpdated : '',
        category: typeof document.frontmatter.category === 'string' ? document.frontmatter.category : '',
        order:
            typeof document.frontmatter.order === 'number'
                ? String(document.frontmatter.order)
                : typeof document.frontmatter.order === 'string'
                  ? document.frontmatter.order
                  : '',
        tagsText: Array.isArray(document.frontmatter.tags) ? document.frontmatter.tags.join(', ') : '',
        topicsText: Array.isArray(document.frontmatter.topics) ? document.frontmatter.topics.join(', ') : '',
        coverSrc: cover.src,
        coverAlt: cover.alt,
        coverFit: cover.fit,
        coverPosition: cover.position,
        foundationKind:
            typeof document.frontmatter.kind === 'string' ? document.frontmatter.kind : defaults.foundationKind,
        aliasesText: readStringArray(document.frontmatter.aliases).join('\n'),
        domains: readStringArray(document.frontmatter.domains),
        relations: Object.fromEntries(
            FOUNDATION_RELATION_FIELDS.map((field) => [field, readStringArray(document.frontmatter[field])])
        ) as CmsDocumentDraft['relations'],
        extraFrontmatterJson: JSON.stringify(extraFrontmatter, null, 2),
        body: document.body
    }
}

export function buildUpdateInputFromDraft(draft: CmsDocumentDraft): CmsDocumentUpdateInput {
    return {
        sourcePath: draft.sourcePath,
        body: draft.body,
        frontmatter: buildFrontmatterFromDraft(draft)
    }
}

export function buildCreateInputFromDraft(targetPath: string, draft: CmsDocumentDraft): CmsDocumentCreateInput {
    const frontmatter = buildFrontmatterFromDraft(draft)
    if (draft.kind === 'foundation') {
        frontmatter.id = targetPath.split('/').at(-1)?.replace(/\.md$/u, '') ?? ''
    }

    return {
        targetPath,
        body: draft.body,
        frontmatter
    }
}

function buildFrontmatterFromDraft(draft: CmsDocumentDraft) {
    let extraFrontmatter: Record<string, unknown> = {}

    if (draft.extraFrontmatterJson.trim()) {
        try {
            const parsed = JSON.parse(draft.extraFrontmatterJson)

            if (!isPlainObject(parsed)) {
                throw new Error(t('附加 frontmatter 必须是 JSON 对象。', 'Extra front matter must be a JSON object.'))
            }

            extraFrontmatter = parsed
        } catch (error) {
            throw new Error(
                error instanceof Error
                    ? error.message
                    : t('附加 frontmatter JSON 解析失败。', 'Failed to parse extra front matter JSON.')
            )
        }
    }

    const frontmatter: Record<string, unknown> = {
        ...extraFrontmatter,
        title: draft.title,
        description: draft.description,
        date: draft.date,
        lastUpdated: draft.lastUpdated,
        category: draft.category,
        order: draft.order,
        tags: splitCsvValues(draft.tagsText),
        topics: splitCsvValues(draft.topicsText)
    }

    delete frontmatter.cover
    if (!draft.lastUpdated.trim()) delete frontmatter.lastUpdated

    if (draft.coverSrc.trim()) {
        frontmatter.cover = {
            src: draft.coverSrc.trim(),
            alt: draft.coverAlt.trim(),
            fit: draft.coverFit === 'contain' ? 'contain' : 'cover',
            position: draft.coverPosition.trim() || 'center'
        }
    }

    if (draft.kind === 'foundation') {
        delete frontmatter.date
        delete frontmatter.lastUpdated
        delete frontmatter.category
        delete frontmatter.order
        delete frontmatter.tags
        delete frontmatter.topics
        delete frontmatter.cover
        // Keep relation fields adjacent and ordered, as required by the foundation loader.
        for (const key of foundationKeys) delete frontmatter[key]
        frontmatter.aliases = draft.aliasesText
            .split(/\r?\n/u)
            .map((alias) => alias.trim())
            .filter(Boolean)
        frontmatter.kind = draft.foundationKind
        frontmatter.domains = draft.domains
        for (const field of FOUNDATION_RELATION_FIELDS) frontmatter[field] = draft.relations[field]
        frontmatter.page = true
    }

    return frontmatter
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function suggestDocumentFileName(title: string, kind: CmsDocumentDetail['kind']) {
    const suggestion = title
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
    return kind === 'foundation' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(suggestion) ? '' : suggestion
}

export function getFoundationRelationWarnings(draft: CmsDocumentDraft, documents: CmsLibraryItem[]) {
    const currentId = draft.sourcePath.split('/').at(-1)?.replace(/\.md$/u, '')
    if (!currentId || draft.kind !== 'foundation') return []
    const warnings: string[] = []
    for (const field of ['equivalent_to', 'contrasts_with'] as const) {
        const label = field === 'equivalent_to' ? t('等价于', 'Equivalent to') : t('对比于', 'Contrasts with')
        for (const document of documents) {
            const target = document.foundation
            if (!target || target.id === currentId) continue
            const selected = draft.relations[field].includes(target.id)
            const reciprocal = target[field].includes(currentId)
            if (selected !== reciprocal) {
                warnings.push(
                    t(
                        `「${document.title}」的「${label}」中还需${selected ? '添加' : '移除'}「${draft.title}」（${currentId}）。`,
                        `${document.title}: ${selected ? 'add' : 'remove'} ${draft.title} (${currentId}) in “${label}”.`
                    )
                )
            }
        }
    }
    return warnings
}

export function isDraftDirty(draft: CmsDocumentDraft | null, baseline: CmsDocumentUpdateInput | null) {
    if (!draft || !baseline) return false

    try {
        return JSON.stringify(buildUpdateInputFromDraft(draft)) !== JSON.stringify(baseline)
    } catch {
        return true
    }
}

function splitCsvValues(value: string) {
    return value
        .split(/[，,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
}

export function appendCsvValue(source: string, suggestion: string) {
    const values = splitCsvValues(source)

    if (!values.includes(suggestion)) {
        values.push(suggestion)
    }

    return values.join(', ')
}

export function uniqueDraftValues(values: string[]) {
    return values
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .sort((valueA, valueB) => valueA.localeCompare(valueB, language))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCoverFrontmatter(value: unknown) {
    if (!isPlainObject(value)) {
        return {
            src: '',
            alt: '',
            fit: 'cover' as CmsCoverFit,
            position: 'center'
        }
    }

    return {
        src: typeof value.src === 'string' ? value.src : '',
        alt: typeof value.alt === 'string' ? value.alt : '',
        fit: value.fit === 'contain' ? ('contain' as CmsCoverFit) : ('cover' as CmsCoverFit),
        position: typeof value.position === 'string' && value.position.trim() ? value.position : 'center'
    }
}
