import { t } from './i18n'
import type { CmsDocumentKind, CmsLibrarySnapshot, CmsLibraryItem, CmsLibraryTreeRoot } from './types'

type ManagedRoots = readonly Pick<CmsLibraryTreeRoot, 'rootKey' | 'path'>[]

export function searchLibraryDocuments(documents: CmsLibraryItem[], query: string) {
    const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
    if (!terms.length) return []

    return documents.filter((document) => {
        const text = [document.title, document.sourcePath, document.description, ...document.tags, ...document.topics]
            .join(' ')
            .toLowerCase()
        return terms.every((term) => text.includes(term))
    })
}

export function getDocumentAncestorPaths(sourcePath: string) {
    const normalizedPath = normalizePathInput(sourcePath)
    const segments = normalizedPath.split('/').filter(Boolean)

    if (segments.length < 2) return []

    const ancestors: string[] = []
    let currentPath = segments[0]
    ancestors.push(currentPath)

    for (let index = 1; index < segments.length - 1; index += 1) {
        currentPath = `${currentPath}/${segments[index]}`
        ancestors.push(currentPath)
    }

    return ancestors
}

export function getDocumentDirectoryPath(sourcePath: string) {
    const normalizedPath = normalizePathInput(sourcePath)
    const segments = normalizedPath.split('/').filter(Boolean)

    if (segments.length <= 1) return normalizedPath
    return segments.slice(0, -1).join('/')
}

export function getDocumentFileStem(sourcePath: string) {
    const normalizedPath = normalizePathInput(sourcePath)
    const fileName = normalizedPath.split('/').pop() ?? ''
    return fileName.replace(/\.md$/u, '')
}

export function buildDocumentTargetPath(
    directoryPath: string,
    fileStem: string,
    kind: CmsDocumentKind,
    library: { tree: ManagedRoots; content: Pick<CmsLibrarySnapshot['content'], 'topicMetaFilename'> }
) {
    const normalizedDirectory = normalizePathInput(directoryPath)
    assertManagedDirectory(normalizedDirectory, kind, library.tree)

    if (kind === 'topicMeta') {
        return `${normalizedDirectory}/${library.content.topicMetaFilename}`
    }

    const normalizedStem = normalizeFileStem(fileStem)
    if (!normalizedStem) {
        throw new Error(t('文件名不能为空。', 'Filename cannot be empty.'))
    }
    if (kind === 'topic' && `${normalizedStem}.md` === library.content.topicMetaFilename) {
        throw new Error(
            `${t('专题文章不能使用保留文件名 ', 'Topic articles cannot use the reserved filename ')}${library.content.topicMetaFilename}${t('。', '.')}`
        )
    }

    return `${normalizedDirectory}/${normalizedStem}.md`
}

export function getDefaultDirectoryForKind(kind: CmsDocumentKind, roots: ManagedRoots) {
    const rootKey = kind === 'topicMeta' ? 'topics' : `${kind}s`
    const root = roots.find((root) => root.rootKey === rootKey)
    if (!root) {
        throw new Error(t('文档类型没有配置内容目录。', 'No content directory is configured for this document type.'))
    }

    return root.path
}

export function inferDefaultKindForDirectory(directoryPath: string, roots: ManagedRoots): CmsDocumentKind {
    const normalizedDirectory = normalizePathInput(directoryPath)
    const root = roots.find(
        (root) => normalizedDirectory === root.path || normalizedDirectory.startsWith(`${root.path}/`)
    )
    switch (root?.rootKey) {
        case 'posts':
            return 'post'
        case 'pages':
            return 'page'
        case 'foundations':
            return 'foundation'
        case 'topics':
            return 'topic'
    }

    throw new Error(t('目录必须位于配置的内容目录下。', 'The directory must be within a configured content root.'))
}

export function inferTopicsFromTargetPath(targetPath: string, roots: ManagedRoots) {
    const normalizedPath = normalizePathInput(targetPath)
    const topicsDirectory = getDefaultDirectoryForKind('topic', roots)

    if (!normalizedPath.startsWith(`${topicsDirectory}/`)) {
        return []
    }

    const relativePath = normalizedPath.slice(topicsDirectory.length + 1)
    const segments = relativePath.split('/').filter(Boolean)
    if (segments.length <= 1) {
        return []
    }

    const directorySegments = segments.slice(0, -1)
    return directorySegments.length ? [directorySegments.join('/')] : []
}

export function normalizePathInput(value: string) {
    return value
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/\/+/g, '/')
        .replace(/\/+$/g, '')
}

function normalizeFileStem(value: string) {
    const normalized = value.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('-').replace(/\.md$/u, '')

    if (containsControlCharacters(normalized) || normalized === '.' || normalized === '..') {
        throw new Error(t('文件名包含非法字符。', 'Filename contains invalid characters.'))
    }

    return normalized
}

function assertManagedDirectory(directoryPath: string, kind: CmsDocumentKind, roots: ManagedRoots) {
    if (!directoryPath || containsControlCharacters(directoryPath)) {
        throw new Error(t('目录不能为空或包含非法字符。', 'Directory cannot be empty or contain invalid characters.'))
    }

    const segments = directoryPath.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(t('目录包含非法路径片段。', 'Directory contains invalid path segments.'))
    }

    const expectedRoot = getDefaultDirectoryForKind(kind, roots)
    if (directoryPath !== expectedRoot && !directoryPath.startsWith(`${expectedRoot}/`)) {
        throw new Error(
            `${t('该文档类型必须位于 ', 'This document type must be within ')}${expectedRoot}${t(' 目录下。', '.')}`
        )
    }
}

function containsControlCharacters(value: string) {
    return [...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint <= 0x1f || codePoint === 0x7f
    })
}
