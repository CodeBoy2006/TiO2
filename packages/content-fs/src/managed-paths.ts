import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import fs from 'fs-extra'
import type { CmsDocumentKind, CmsLibraryTreeRootKey } from '../../cms-contract/src/index'
import type { TiO2Project } from '../../config/src/types'
import { CmsRepositoryError } from './cms-errors'

export interface ManagedRootDefinition {
    rootKey: CmsLibraryTreeRootKey
    path: string
}

export interface ManagedDocumentPath {
    sourcePath: string
    absolutePath: string
    kind: CmsDocumentKind
    rootPath: string
}

export function getManagedRootDefinitions(project: TiO2Project): ManagedRootDefinition[] {
    const contentConfig = project.config.content
    return [
        { rootKey: 'posts', path: contentConfig.postsDir },
        { rootKey: 'topics', path: contentConfig.topicsDir },
        { rootKey: 'foundations', path: contentConfig.foundationsDir },
        { rootKey: 'pages', path: contentConfig.pagesDir }
    ]
}

export async function resolveManagedDocumentPath(
    project: TiO2Project,
    inputPath: string
): Promise<ManagedDocumentPath> {
    const sourcePath = normalizeManagedPathInput(inputPath)
    const kind = resolveDocumentKind(project, sourcePath)

    if (!kind) {
        throw new CmsRepositoryError('INVALID_INPUT', `Unsupported content path: ${sourcePath}`)
    }

    const rootDefinition = getManagedRootDefinitions(project).find((definition) =>
        sourcePath.startsWith(`${definition.path}/`)
    )
    if (!rootDefinition) {
        throw new CmsRepositoryError('INVALID_INPUT', `Path is outside managed content roots: ${sourcePath}`)
    }

    const absolutePath = resolveRepositoryPath(project, sourcePath)
    const managedRootPath = resolveRepositoryPath(project, rootDefinition.path)
    const relativePathFromManagedRoot = relative(managedRootPath, absolutePath)

    if (
        !relativePathFromManagedRoot ||
        isParentPath(relativePathFromManagedRoot) ||
        isAbsolute(relativePathFromManagedRoot)
    ) {
        throw new CmsRepositoryError(
            'INVALID_INPUT',
            `Path is outside managed content root "${rootDefinition.path}": ${sourcePath}`
        )
    }

    await assertPathHasNoSymbolicLinks(project, sourcePath)

    return {
        sourcePath,
        absolutePath,
        kind,
        rootPath: rootDefinition.path
    }
}

export async function resolveManagedCompanionPath(project: TiO2Project, documentSourcePath: string) {
    const documentPath = await resolveManagedDocumentPath(project, documentSourcePath)
    const sourcePath = stripMarkdownExtension(documentPath.sourcePath)

    await assertPathHasNoSymbolicLinks(project, sourcePath)

    return {
        sourcePath,
        absolutePath: resolveRepositoryPath(project, sourcePath)
    }
}

function normalizeManagedPathInput(inputPath: string) {
    if (typeof inputPath !== 'string') {
        throw new CmsRepositoryError('INVALID_INPUT', 'Content path must be a string.')
    }

    const trimmed = inputPath.trim()
    if (!trimmed) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Content path must not be empty.')
    }
    if (
        [...trimmed].some((character) => {
            const codePoint = character.codePointAt(0) ?? 0
            return codePoint <= 0x1f || codePoint === 0x7f
        })
    ) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Content path must not contain control characters.')
    }

    const slashNormalized = trimmed.replace(/\\/g, '/')
    if (slashNormalized.startsWith('/') || /^[A-Za-z]:\//u.test(slashNormalized)) {
        throw new CmsRepositoryError('INVALID_INPUT', `Content path must be repository-relative: ${inputPath}`)
    }

    const withoutLeadingCurrentDirectory = slashNormalized.replace(/^\.\//u, '')
    const segments = withoutLeadingCurrentDirectory.split('/')

    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new CmsRepositoryError('INVALID_INPUT', `Content path contains an invalid segment: ${inputPath}`)
    }

    return segments.join('/')
}

export function normalizeInternalPath(inputPath: string) {
    return inputPath
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.?\//u, '')
        .replace(/\/+/g, '/')
        .replace(/\/+$/u, '')
}

export function resolveRepositoryPath(project: TiO2Project, relativePath: string) {
    const { rootDir } = project
    const absolutePath = resolve(rootDir, relativePath)
    const relativePathFromRoot = relative(rootDir, absolutePath)

    if (relativePathFromRoot === '' || (!isParentPath(relativePathFromRoot) && !isAbsolute(relativePathFromRoot))) {
        return absolutePath
    }

    throw new CmsRepositoryError('INVALID_INPUT', `Path escapes repository root: ${relativePath}`)
}

function resolveDocumentKind(project: TiO2Project, sourcePath: string): CmsDocumentKind | null {
    const contentConfig = project.config.content
    if (!sourcePath.endsWith('.md')) return null

    if (sourcePath.startsWith(`${contentConfig.postsDir}/`)) {
        return 'post'
    }

    if (sourcePath.startsWith(`${contentConfig.pagesDir}/`)) {
        return 'page'
    }

    if (sourcePath.startsWith(`${contentConfig.foundationsDir}/`)) {
        return 'foundation'
    }

    if (sourcePath.startsWith(`${contentConfig.topicsDir}/`)) {
        return basename(sourcePath) === contentConfig.topicMetaFilename ? 'topicMeta' : 'topic'
    }

    return null
}

function stripMarkdownExtension(sourcePath: string) {
    return sourcePath.replace(/\.md$/u, '')
}

function isParentPath(relativePath: string) {
    return relativePath === '..' || relativePath.startsWith(`..${sep}`)
}

async function assertPathHasNoSymbolicLinks(project: TiO2Project, relativePath: string) {
    const segments = normalizeInternalPath(relativePath).split('/').filter(Boolean)
    let currentPath = project.rootDir

    for (const segment of segments) {
        currentPath = resolve(currentPath, segment)
        if (!(await fs.pathExists(currentPath))) break

        const stat = await fs.lstat(currentPath)
        if (stat.isSymbolicLink()) {
            throw new CmsRepositoryError(
                'INVALID_INPUT',
                `Managed content paths must not traverse symbolic links: ${relativePath}`
            )
        }
    }
}
