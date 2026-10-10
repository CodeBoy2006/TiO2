import type { TiO2Project } from '../../config/src/types'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import fs from 'fs-extra'
import { globby } from 'globby'
import matter from 'gray-matter'
import {
    extractExcerpt,
    extractHeadings,
    extractReferences,
    extractRawFrontmatterValue,
    inferTitleFromPath,
    maskMarkdownContainers
} from '../../content-core/src/index'
import type {
    CmsDocumentCreateInput,
    CmsDocumentDeleteInput,
    CmsDocumentDeleteResult,
    CmsDocumentDetail,
    CmsDocumentKind,
    CmsDocumentMoveInput,
    CmsDocumentUpdateInput,
    CmsLibrarySnapshot
} from '../../cms-contract/src/index'
import { createSiblingTemporaryPath, writeTextFileAtomically } from './atomic-file'
import { loadArticleDocument } from './article-document'
import { CmsRepositoryError } from './cms-errors'
import { buildCmsLibraryTree, compareCmsLibraryItems, createCmsLibraryItem } from './cms-library'
import {
    getFoundationIgnorePatterns,
    getFoundationSourcePatterns,
    getPageIgnorePatterns,
    getPageSourcePatterns,
    getPostIgnorePatterns,
    getPostSourcePatterns,
    getTopicArticleIgnorePatterns,
    getTopicArticleSourcePatterns,
    getTopicMetaIgnorePatterns,
    getTopicMetaSourcePatterns
} from './content-paths'
import {
    getManagedRootDefinitions,
    normalizeInternalPath,
    resolveManagedCompanionPath,
    resolveManagedDocumentPath,
    resolveRepositoryPath
} from './managed-paths'
import { rewriteRelativeAssetReferences } from './markdown-assets'
import { readMarkdownSource } from './markdown-source'

export type {
    CmsDocumentCreateInput,
    CmsDocumentDeleteInput,
    CmsDocumentDeleteResult,
    CmsDocumentDetail,
    CmsDocumentKind,
    CmsDocumentMoveInput,
    CmsDocumentUpdateInput,
    CmsLibraryItem,
    CmsLibrarySnapshot
} from '../../cms-contract/src/index'

interface ResolveContentPathsOptions {
    env?: string
}

export async function loadCmsLibrarySnapshot(
    project: TiO2Project,
    options: ResolveContentPathsOptions = {}
): Promise<CmsLibrarySnapshot> {
    const documents = await Promise.all(
        (await getManagedMarkdownPaths(project, options)).map((sourcePath) => readCmsDocument(project, sourcePath))
    )
    const items = documents.map(createCmsLibraryItem).sort(compareCmsLibraryItems)

    return {
        documents: items,
        stats: items.reduce<Record<CmsDocumentKind, number>>(
            (counts, item) => {
                counts[item.kind] += 1
                return counts
            },
            {
                post: 0,
                topic: 0,
                foundation: 0,
                page: 0,
                topicMeta: 0
            }
        ),
        tree: buildCmsLibraryTree(items, getManagedRootDefinitions(project)),
        content: {
            topicMetaFilename: project.config.content.topicMetaFilename,
            foundationDomains: project.config.foundations.groups.flatMap((group) =>
                group.domains.map(({ id, title }) => ({ id, title: `${group.title} / ${title}` }))
            )
        }
    }
}

export async function readCmsDocument(project: TiO2Project, sourcePath: string): Promise<CmsDocumentDetail> {
    const resolvedPath = await resolveManagedDocumentPath(project, sourcePath)
    const { sourcePath: normalizedSourcePath, kind } = resolvedPath
    const source = await readMarkdownSource(resolvedPath.absolutePath)
    const frontmatter = normalizeParsedFrontmatterRecord(source.data)
    const rawDate = extractRawFrontmatterValue(source.rawContent, 'date')
    const rawLastUpdated = extractRawFrontmatterValue(source.rawContent, 'lastUpdated')
    const body = normalizeBody(source.content)

    if (rawDate) frontmatter.date = rawDate
    if (rawLastUpdated) frontmatter.lastUpdated = rawLastUpdated

    if (kind === 'post' || kind === 'topic') {
        const collectionKey = kind === 'post' ? 'posts' : dirname(normalizedSourcePath)
        const document = await loadArticleDocument(normalizedSourcePath, kind, collectionKey, {
            source,
            language: project.config.site.language
        })
        return {
            kind,
            sourcePath: normalizedSourcePath,
            title: document.post.frontMatter.title,
            body,
            excerpt: document.post.excerpt,
            frontmatter,
            headings: document.headings,
            references: document.references,
            assetDirectoryPath: await resolveAssetDirectoryPath(project, normalizedSourcePath)
        }
    }

    const publicMarkdown = maskMarkdownContainers(body, ['encrypt'], normalizedSourcePath)
    return {
        kind,
        sourcePath: normalizedSourcePath,
        title:
            typeof frontmatter.title === 'string' && frontmatter.title.trim()
                ? frontmatter.title.trim()
                : inferTitleFromPath(normalizedSourcePath),
        body,
        excerpt: extractExcerpt(publicMarkdown),
        frontmatter,
        headings: extractHeadings(publicMarkdown),
        references: extractReferences(publicMarkdown),
        assetDirectoryPath: shouldCreateAssetDirectory(kind)
            ? await resolveAssetDirectoryPath(project, normalizedSourcePath)
            : null
    }
}

export async function createCmsDocument(
    project: TiO2Project,
    input: CmsDocumentCreateInput
): Promise<CmsDocumentDetail> {
    const resolvedTargetPath = await resolveManagedDocumentPath(project, input.targetPath)
    const { sourcePath: targetPath, absolutePath: targetAbsolutePath, kind } = resolvedTargetPath
    const normalizedBody = normalizeBody(input.body)

    if (await fs.pathExists(targetAbsolutePath)) {
        throw new CmsRepositoryError('CONFLICT', `Document already exists: ${targetPath}`)
    }

    await writeTextFileAtomically(targetAbsolutePath, serializeCmsDocument(normalizedBody, input.frontmatter))

    if (input.createAssetDirectory && shouldCreateAssetDirectory(kind)) {
        const assetDirectory = await resolveManagedCompanionPath(project, targetPath)

        try {
            await fs.ensureDir(assetDirectory.absolutePath)
        } catch (error) {
            await fs.remove(targetAbsolutePath)
            throw error
        }
    }

    return readCmsDocument(project, targetPath)
}

export async function updateCmsDocument(
    project: TiO2Project,
    input: CmsDocumentUpdateInput
): Promise<CmsDocumentDetail> {
    const resolvedSourcePath = await resolveManagedDocumentPath(project, input.sourcePath)
    const { sourcePath, absolutePath: sourceAbsolutePath } = resolvedSourcePath
    const normalizedBody = normalizeBody(input.body)
    if (!(await fs.pathExists(sourceAbsolutePath))) {
        throw new CmsRepositoryError('NOT_FOUND', `Document not found: ${sourcePath}`)
    }

    await writeTextFileAtomically(sourceAbsolutePath, serializeCmsDocument(normalizedBody, input.frontmatter))
    return readCmsDocument(project, sourcePath)
}

export async function moveCmsDocument(project: TiO2Project, input: CmsDocumentMoveInput): Promise<CmsDocumentDetail> {
    const [resolvedSourcePath, resolvedTargetPath] = await Promise.all([
        resolveManagedDocumentPath(project, input.sourcePath),
        resolveManagedDocumentPath(project, input.targetPath)
    ])
    const { sourcePath, absolutePath: sourceAbsolutePath, kind: sourceKind } = resolvedSourcePath
    const { sourcePath: targetPath, absolutePath: targetAbsolutePath, kind: targetKind } = resolvedTargetPath

    if (sourcePath === targetPath) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Target path must be different from the source path.')
    }

    if (!(await fs.pathExists(sourceAbsolutePath))) {
        throw new CmsRepositoryError('NOT_FOUND', `Document not found: ${sourcePath}`)
    }

    if (await fs.pathExists(targetAbsolutePath)) {
        throw new CmsRepositoryError('CONFLICT', `Target document already exists: ${targetPath}`)
    }

    const sourceAssetDirectoryPath = shouldCreateAssetDirectory(sourceKind)
        ? await resolveAssetDirectoryPath(project, sourcePath)
        : null
    const moveAssetDirectory = Boolean(input.moveAssetDirectory && sourceAssetDirectoryPath)
    if (moveAssetDirectory && !shouldCreateAssetDirectory(targetKind)) {
        throw new CmsRepositoryError(
            'INVALID_INPUT',
            `Document kind "${targetKind}" does not support companion asset directories.`
        )
    }

    const targetAssetDirectory = await resolveManagedCompanionPath(project, targetPath)
    const targetAssetDirectoryPath = targetAssetDirectory.sourcePath

    if (
        moveAssetDirectory &&
        sourceAssetDirectoryPath &&
        sourceAssetDirectoryPath !== targetAssetDirectoryPath &&
        (await fs.pathExists(targetAssetDirectory.absolutePath))
    ) {
        throw new CmsRepositoryError('CONFLICT', `Target asset directory already exists: ${targetAssetDirectoryPath}`)
    }

    const sourceContent = await fs.readFile(sourceAbsolutePath, 'utf8')
    const finalAssetDirectoryPath =
        moveAssetDirectory && sourceAssetDirectoryPath ? targetAssetDirectoryPath : sourceAssetDirectoryPath
    const rewrittenContent =
        sourceAssetDirectoryPath && finalAssetDirectoryPath
            ? rewriteRelativeAssetReferences(sourceContent, {
                  sourceDocumentPath: sourcePath,
                  targetDocumentPath: targetPath,
                  sourceAssetDirectoryPath,
                  targetAssetDirectoryPath: finalAssetDirectoryPath
              })
            : sourceContent

    await executeMoveTransaction({
        sourceAbsolutePath,
        targetAbsolutePath,
        content: rewrittenContent,
        sourceAssetAbsolutePath: sourceAssetDirectoryPath
            ? resolveRepositoryPath(project, sourceAssetDirectoryPath)
            : null,
        targetAssetAbsolutePath:
            moveAssetDirectory && sourceAssetDirectoryPath ? targetAssetDirectory.absolutePath : null
    })

    await cleanupEmptyManagedAncestors(project, dirname(sourcePath)).catch(() => undefined)

    if (moveAssetDirectory && sourceAssetDirectoryPath) {
        await cleanupEmptyManagedAncestors(project, dirname(sourceAssetDirectoryPath)).catch(() => undefined)
    }

    return readCmsDocument(project, targetPath)
}

export async function deleteCmsDocument(
    project: TiO2Project,
    input: CmsDocumentDeleteInput
): Promise<CmsDocumentDeleteResult> {
    const resolvedSourcePath = await resolveManagedDocumentPath(project, input.sourcePath)
    const { sourcePath, absolutePath: sourceAbsolutePath, kind } = resolvedSourcePath
    if (!(await fs.pathExists(sourceAbsolutePath))) {
        throw new CmsRepositoryError('NOT_FOUND', `Document not found: ${sourcePath}`)
    }

    const assetDirectoryPath = shouldCreateAssetDirectory(kind)
        ? await resolveAssetDirectoryPath(project, sourcePath)
        : null
    const removeAssetDirectory = Boolean(input.removeAssetDirectory && assetDirectoryPath)

    await executeDeleteTransaction(
        project,
        sourceAbsolutePath,
        removeAssetDirectory && assetDirectoryPath ? resolveRepositoryPath(project, assetDirectoryPath) : null
    )

    await cleanupEmptyManagedAncestors(project, dirname(sourcePath)).catch(() => undefined)

    if (removeAssetDirectory && assetDirectoryPath) {
        await cleanupEmptyManagedAncestors(project, dirname(assetDirectoryPath)).catch(() => undefined)
    }

    return {
        sourcePath,
        removedAssetDirectory: removeAssetDirectory
    }
}

async function getManagedMarkdownPaths(project: TiO2Project, options: ResolveContentPathsOptions = {}) {
    const { env = process.env.NODE_ENV } = options
    const isProd = env === 'production'
    const [postPaths, topicArticlePaths, topicMetaPaths, foundationPaths, pagePaths] = await Promise.all([
        globby(getPostSourcePatterns(project.config.content), {
            cwd: project.rootDir,
            ignore: getPostIgnorePatterns(project.config.content, { production: isProd })
        }),
        globby(getTopicArticleSourcePatterns(project.config.content), {
            cwd: project.rootDir,
            ignore: getTopicArticleIgnorePatterns(project.config.content, { production: isProd })
        }),
        globby(getTopicMetaSourcePatterns(project.config.content), {
            cwd: project.rootDir,
            ignore: getTopicMetaIgnorePatterns(project.config.content, { production: isProd })
        }),
        globby(getFoundationSourcePatterns(project.config.content), {
            cwd: project.rootDir,
            ignore: getFoundationIgnorePatterns(project.config.content, { production: isProd })
        }),
        globby(getPageSourcePatterns(project.config.content), {
            cwd: project.rootDir,
            ignore: getPageIgnorePatterns(project.config.content, { production: isProd })
        })
    ])

    return [...postPaths, ...topicArticlePaths, ...topicMetaPaths, ...foundationPaths, ...pagePaths]
}

async function resolveAssetDirectoryPath(project: TiO2Project, sourcePath: string) {
    const directoryPath = await resolveManagedCompanionPath(project, sourcePath)
    if (!(await fs.pathExists(directoryPath.absolutePath))) return null

    const stat = await fs.stat(directoryPath.absolutePath)
    return stat.isDirectory() ? directoryPath.sourcePath : null
}

function normalizeFrontmatterRecord(frontmatter: Record<string, unknown>) {
    if (!isPlainObject(frontmatter)) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Document frontmatter must be a plain object.')
    }

    return Object.fromEntries(
        Object.entries(frontmatter)
            .filter(([, value]) => value !== undefined)
            .flatMap(([key, value]) => {
                const normalizedValue = normalizeFrontmatterValue(key, value)
                return normalizedValue === undefined ? [] : ([[key, normalizedValue]] as const)
            })
    )
}

function normalizeFrontmatterValue(key: string, value: unknown): unknown {
    if (key === 'tags' || key === 'topics') {
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
            throw new CmsRepositoryError('INVALID_INPUT', `Frontmatter field "${key}" must be an array of strings.`)
        }

        return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
    }

    if (key === 'order') {
        if (value === '' || value === null) return undefined
        if (typeof value === 'number' && Number.isFinite(value)) return value
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) return parsed
        }

        throw new CmsRepositoryError('INVALID_INPUT', 'Frontmatter field "order" must be a number.')
    }

    return sanitizeStructuredValue(value)
}

function sanitizeStructuredValue(value: unknown): unknown {
    if (value === null) return null

    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return value

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeStructuredValue(entry))
    }

    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, nestedValue]) => nestedValue !== undefined)
                .map(([nestedKey, nestedValue]) => [nestedKey, sanitizeStructuredValue(nestedValue)])
        )
    }

    throw new CmsRepositoryError('INVALID_INPUT', 'Frontmatter only supports JSON-like values.')
}

function normalizeBody(value: unknown) {
    if (typeof value !== 'string') {
        throw new CmsRepositoryError('INVALID_INPUT', 'Document body must be a string.')
    }

    return value.replace(/\r\n/g, '\n')
}

function serializeCmsDocument(body: string, frontmatter: Record<string, unknown>) {
    const serialized = matter.stringify(body, normalizeFrontmatterRecord(frontmatter))
    return ensureTrailingNewline(serialized)
}

function ensureTrailingNewline(value: string) {
    return value.endsWith('\n') ? value : `${value}\n`
}

function normalizeParsedFrontmatterRecord(value: unknown) {
    if (!isPlainObject(value)) return {}

    return Object.fromEntries(
        Object.entries(value)
            .filter(([, nestedValue]) => nestedValue !== undefined)
            .map(([key, nestedValue]) => [key, normalizeParsedFrontmatterValue(nestedValue)])
    )
}

function normalizeParsedFrontmatterValue(value: unknown): unknown {
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? '' : value.toISOString()
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeParsedFrontmatterValue(entry))
    }

    if (isPlainObject(value)) {
        return normalizeParsedFrontmatterRecord(value)
    }

    return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function shouldCreateAssetDirectory(kind: CmsDocumentKind) {
    return kind === 'post' || kind === 'topic'
}

function isManagedRootDirectory(project: TiO2Project, directoryPath: string) {
    return getManagedRootDefinitions(project).some((definition) => definition.path === directoryPath)
}

function isManagedDirectory(project: TiO2Project, directoryPath: string) {
    return getManagedRootDefinitions(project).some(
        (definition) => directoryPath === definition.path || directoryPath.startsWith(`${definition.path}/`)
    )
}

async function cleanupEmptyManagedAncestors(project: TiO2Project, initialDirectoryPath: string) {
    let currentDirectoryPath = normalizeInternalPath(initialDirectoryPath)

    while (
        currentDirectoryPath &&
        isManagedDirectory(project, currentDirectoryPath) &&
        !isManagedRootDirectory(project, currentDirectoryPath)
    ) {
        const absolutePath = resolveRepositoryPath(project, currentDirectoryPath)

        if (!(await fs.pathExists(absolutePath))) {
            currentDirectoryPath = normalizeInternalPath(dirname(currentDirectoryPath))
            continue
        }

        const entries = await fs.readdir(absolutePath)
        if (entries.length > 0) {
            break
        }

        await fs.remove(absolutePath)
        currentDirectoryPath = normalizeInternalPath(dirname(currentDirectoryPath))
    }
}

interface MoveTransactionInput {
    sourceAbsolutePath: string
    targetAbsolutePath: string
    content: string
    sourceAssetAbsolutePath: string | null
    targetAssetAbsolutePath: string | null
}

async function executeMoveTransaction(input: MoveTransactionInput) {
    const temporaryTargetPath = createSiblingTemporaryPath(input.targetAbsolutePath, 'move')
    const sourceBackupPath = createSiblingTemporaryPath(input.sourceAbsolutePath, 'backup')
    const shouldMoveAsset =
        Boolean(input.sourceAssetAbsolutePath && input.targetAssetAbsolutePath) &&
        input.sourceAssetAbsolutePath !== input.targetAssetAbsolutePath
    let assetMoved = false
    let sourceBackedUp = false
    let targetCreated = false

    await fs.ensureDir(dirname(input.targetAbsolutePath))

    try {
        await fs.writeFile(temporaryTargetPath, input.content, 'utf8')

        if (shouldMoveAsset && input.sourceAssetAbsolutePath && input.targetAssetAbsolutePath) {
            await fs.ensureDir(dirname(input.targetAssetAbsolutePath))
            await fs.move(input.sourceAssetAbsolutePath, input.targetAssetAbsolutePath)
            assetMoved = true
        }

        await fs.move(input.sourceAbsolutePath, sourceBackupPath)
        sourceBackedUp = true
        await fs.move(temporaryTargetPath, input.targetAbsolutePath)
        targetCreated = true
        await fs.remove(sourceBackupPath)
        sourceBackedUp = false
    } catch (error) {
        const rollbackErrors: string[] = []

        if (targetCreated && (await fs.pathExists(input.targetAbsolutePath))) {
            await fs.remove(input.targetAbsolutePath).catch((rollbackError) => {
                rollbackErrors.push(describeError(rollbackError))
            })
        }

        if (sourceBackedUp && (await fs.pathExists(sourceBackupPath))) {
            await fs.move(sourceBackupPath, input.sourceAbsolutePath).catch((rollbackError) => {
                rollbackErrors.push(describeError(rollbackError))
            })
        }

        if (
            assetMoved &&
            input.sourceAssetAbsolutePath &&
            input.targetAssetAbsolutePath &&
            (await fs.pathExists(input.targetAssetAbsolutePath))
        ) {
            await fs.move(input.targetAssetAbsolutePath, input.sourceAssetAbsolutePath).catch((rollbackError) => {
                rollbackErrors.push(describeError(rollbackError))
            })
        }

        const rollbackSuffix = rollbackErrors.length ? ` Rollback errors: ${rollbackErrors.join('; ')}` : ''
        throw new Error(`${describeError(error)}${rollbackSuffix}`)
    } finally {
        await fs.remove(temporaryTargetPath).catch(() => undefined)
    }
}

async function executeDeleteTransaction(
    project: TiO2Project,
    sourceAbsolutePath: string,
    assetAbsolutePath: string | null
) {
    const transactionRootPath = resolve(project.rootDir, '.tio2-tmp')
    const transactionPath = resolve(transactionRootPath, `delete-${process.pid}-${randomUUID()}`)
    const stagedSourcePath = resolve(transactionPath, 'document.md')
    const stagedAssetPath = resolve(transactionPath, 'assets')
    let sourceStaged = false
    let assetStaged = false

    await fs.ensureDir(transactionPath)

    try {
        await fs.move(sourceAbsolutePath, stagedSourcePath)
        sourceStaged = true

        if (assetAbsolutePath) {
            await fs.move(assetAbsolutePath, stagedAssetPath)
            assetStaged = true
        }
    } catch (error) {
        const rollbackErrors: string[] = []

        if (assetStaged && assetAbsolutePath && (await fs.pathExists(stagedAssetPath))) {
            await fs.move(stagedAssetPath, assetAbsolutePath).catch((rollbackError) => {
                rollbackErrors.push(describeError(rollbackError))
            })
        }

        if (sourceStaged && (await fs.pathExists(stagedSourcePath))) {
            await fs.move(stagedSourcePath, sourceAbsolutePath).catch((rollbackError) => {
                rollbackErrors.push(describeError(rollbackError))
            })
        }

        await fs.remove(transactionPath).catch((rollbackError) => {
            rollbackErrors.push(describeError(rollbackError))
        })
        await removeDirectoryIfEmpty(transactionRootPath).catch((rollbackError) => {
            rollbackErrors.push(describeError(rollbackError))
        })
        const rollbackSuffix = rollbackErrors.length ? ` Rollback errors: ${rollbackErrors.join('; ')}` : ''
        throw new Error(`${describeError(error)}${rollbackSuffix}`)
    }

    await fs.remove(transactionPath).catch(() => undefined)
    await removeDirectoryIfEmpty(transactionRootPath).catch(() => undefined)
}

function describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

async function removeDirectoryIfEmpty(directoryPath: string) {
    if (!(await fs.pathExists(directoryPath))) return
    if ((await fs.readdir(directoryPath)).length > 0) return
    await fs.remove(directoryPath)
}
