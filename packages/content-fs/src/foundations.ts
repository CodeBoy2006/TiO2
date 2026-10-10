import path from 'node:path'
import {
    createMarkdownRoute,
    FOUNDATION_RELATION_FIELDS,
    type FoundationEntryInput
} from '../../content-core/src/index'
import { readMarkdownSource, type MarkdownSource } from './markdown-source'

interface LoadFoundationDocumentOptions {
    source?: MarkdownSource
}

export async function loadFoundationDocument(
    sourcePath: string,
    options: LoadFoundationDocumentOptions = {}
): Promise<FoundationEntryInput> {
    const { data } = options.source ?? (await readMarkdownSource(sourcePath))
    const errors: string[] = []
    const title = readString(data, 'title', errors)
    const id = readString(data, 'id', errors)
    const description = readString(data, 'description', errors)
    const kind = readString(data, 'kind', errors)
    const aliases = readStringArray(data, 'aliases', errors)
    const domains = readStringArray(data, 'domains', errors)
    const requires = readStringArray(data, 'requires', errors)
    const uses = readStringArray(data, 'uses', errors)
    const implementedBy = readStringArray(data, 'implemented_by', errors)
    const specialCaseOf = readStringArray(data, 'special_case_of', errors)
    const equivalentTo = readStringArray(data, 'equivalent_to', errors)
    const contrastsWith = readStringArray(data, 'contrasts_with', errors)

    validateRelationFieldOrder(data, errors)

    if (data.page !== true) {
        errors.push('page must be true')
    }
    if (id && path.basename(sourcePath, '.md') !== id) {
        errors.push(`filename must match id “${id}”`)
    }
    if (errors.length) {
        throw new Error(`Invalid foundation frontmatter in ${sourcePath}:\n- ${errors.join('\n- ')}`)
    }

    return {
        title,
        id,
        description,
        kind,
        aliases: uniqueStrings(aliases),
        domains: uniqueStrings(domains),
        requires,
        uses,
        implemented_by: implementedBy,
        special_case_of: specialCaseOf,
        equivalent_to: equivalentTo,
        contrasts_with: contrastsWith,
        sourcePath,
        regularPath: createMarkdownRoute(sourcePath)
    }
}

function readString(data: Record<string, unknown>, key: string, errors: string[]) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()

    errors.push(`${key} must be a non-empty string`)
    return ''
}

function readStringArray(data: Record<string, unknown>, key: string, errors: string[]) {
    const value = data[key]
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        const values = value.map((item) => item.trim())
        if (values.some((item) => !item)) {
            errors.push(`${key} must not contain empty values`)
        }
        return values.filter(Boolean)
    }

    errors.push(`${key} must be an array of strings`)
    return []
}

function validateRelationFieldOrder(data: Record<string, unknown>, errors: string[]) {
    const keys = Object.keys(data)
    const start = keys.indexOf(FOUNDATION_RELATION_FIELDS[0])
    const actual = start >= 0 ? keys.slice(start, start + FOUNDATION_RELATION_FIELDS.length) : []

    if (actual.join('\n') !== FOUNDATION_RELATION_FIELDS.join('\n')) {
        errors.push(`relation fields must be adjacent and ordered: ${FOUNDATION_RELATION_FIELDS.join(', ')}`)
    }
}

function uniqueStrings(values: string[]) {
    return values.filter((value, index) => values.indexOf(value) === index)
}
