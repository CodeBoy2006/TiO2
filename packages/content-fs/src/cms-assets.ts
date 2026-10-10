import { createHash } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import { globby } from 'globby'
import sharp from 'sharp'
import type { TiO2Project } from '../../config/src/types'
import type { CmsImageAsset } from '../../cms-contract/src/index'
import { encodeRoutePathSegments } from '../../content-core/src/route-utils'
import { CmsRepositoryError } from './cms-errors'
import { getManagedRootDefinitions, resolveManagedDocumentPath, resolveRepositoryPath } from './managed-paths'

export const CMS_IMAGE_LIMIT = 20 * 1024 * 1024
const imageExtension = /\.(png|jpe?g|webp|gif|avif|svg)$/iu
const imageFormats = new Set(['png', 'jpeg', 'webp', 'gif', 'avif', 'heif'])

function hasControlCharacters(value: string) {
    return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function imageRoots(project: TiO2Project) {
    return ['public', 'assets/images', ...getManagedRootDefinitions(project).map((root) => root.path)]
}

async function safeImagePath(project: TiO2Project, sourcePath: string) {
    if (
        typeof sourcePath !== 'string' ||
        sourcePath.includes('\\') ||
        hasControlCharacters(sourcePath) ||
        sourcePath.split('/').some((part) => !part || part === '.' || part === '..') ||
        !imageExtension.test(sourcePath) ||
        !imageRoots(project).some((root) => sourcePath.startsWith(`${root}/`))
    ) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Invalid image path.')
    }
    await assertNoSymlinks(project, sourcePath)
    const absolutePath = resolveRepositoryPath(project, sourcePath)
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile() || stat.size > CMS_IMAGE_LIMIT) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Images must be files no larger than 20 MB.')
    }
    return absolutePath
}

async function assertNoSymlinks(project: TiO2Project, sourcePath: string) {
    let current = project.rootDir
    for (const part of sourcePath.split('/')) {
        current = path.join(current, part)
        const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
        })
        if (stat?.isSymbolicLink())
            throw new CmsRepositoryError('INVALID_INPUT', 'Image paths must not traverse symbolic links.')
    }
}

function assetRecord(sourcePath: string, documentPath: string): CmsImageAsset {
    const publicSrc = sourcePath.startsWith('public/') ? `/${encodeRoutePathSegments(sourcePath.slice(7))}` : null
    const relativePath = path.posix.relative(path.posix.dirname(documentPath), sourcePath)
    // Encode individual segments without removing ../ from relative image references.
    const relativeSrc = relativePath.split('/').map(encodeURIComponent).join('/')
    return {
        sourcePath,
        name: path.posix.basename(sourcePath),
        src: publicSrc ?? (relativeSrc.startsWith('.') ? relativeSrc : `./${relativeSrc}`),
        publicSrc,
        previewSrc: `/api/asset?${new URLSearchParams({ sourcePath })}`
    }
}

export async function listCmsImages(project: TiO2Project, documentPath: string): Promise<CmsImageAsset[]> {
    const document = await resolveManagedDocumentPath(project, documentPath)
    await fs.access(document.absolutePath)
    const files = await globby(
        imageRoots(project).map((root) => `${root}/**/*`),
        {
            cwd: project.rootDir,
            onlyFiles: true,
            followSymbolicLinks: false,
            ignore: ['**/.*', '**/node_modules/**', 'public/images/generated/**']
        }
    )
    const images: CmsImageAsset[] = []
    for (const sourcePath of files.filter((file) => imageExtension.test(file)).sort()) {
        try {
            await safeImagePath(project, sourcePath)
            images.push(assetRecord(sourcePath, document.sourcePath))
        } catch (error) {
            if (!(error instanceof CmsRepositoryError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error
        }
    }
    const companion = document.sourcePath.replace(/\.md$/u, '/')
    return images.sort(
        (a, b) => Number(b.sourcePath.startsWith(companion)) - Number(a.sourcePath.startsWith(companion))
    )
}

export async function readCmsImagePreview(project: TiO2Project, sourcePath: string) {
    const absolutePath = await safeImagePath(project, sourcePath)
    // Raster previews keep SVG scripts and external resources out of the CMS origin.
    return sharp(await fs.readFile(absolutePath), { limitInputPixels: 40_000_000 })
        .resize(320, 240, { fit: 'inside', withoutEnlargement: true })
        .webp()
        .toBuffer()
}

export async function uploadCmsImage(project: TiO2Project, fileName: string, data: Buffer): Promise<CmsImageAsset> {
    if (
        typeof fileName !== 'string' ||
        !fileName.trim() ||
        fileName.length > 180 ||
        /[/\\]/u.test(fileName) ||
        hasControlCharacters(fileName) ||
        !Buffer.isBuffer(data) ||
        !data.length ||
        data.length > CMS_IMAGE_LIMIT
    ) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Choose an image no larger than 20 MB with a valid filename.')
    }
    const metadata = await sharp(data, { limitInputPixels: 40_000_000 })
        .metadata()
        .catch(() => null)
    if (
        !metadata?.format ||
        !imageFormats.has(metadata.format) ||
        !metadata.width ||
        !metadata.height ||
        (metadata.format === 'heif' && metadata.compression !== 'av1')
    ) {
        throw new CmsRepositoryError('INVALID_INPUT', 'Upload a PNG, JPEG, WebP, GIF or AVIF image.')
    }
    const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format === 'heif' ? 'avif' : metadata.format
    const stem =
        path
            .parse(fileName)
            .name.replace(/[^\p{L}\p{N}_-]+/gu, '-')
            .replace(/^-+|-+$/gu, '')
            .slice(0, 60) || 'image'
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16)
    const sourcePath = `public/uploads/${stem}-${hash}.${extension}`
    await assertNoSymlinks(project, sourcePath)
    await fs.mkdir(resolveRepositoryPath(project, 'public/uploads'), { recursive: true })
    await fs
        .writeFile(resolveRepositoryPath(project, sourcePath), data, { flag: 'wx' })
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error
        })
    return assetRecord(sourcePath, '')
}

export async function publishCmsImage(project: TiO2Project, sourcePath: string) {
    const absolutePath = await safeImagePath(project, sourcePath)
    if (sourcePath.startsWith('public/')) return assetRecord(sourcePath, '')
    const data = await fs.readFile(absolutePath)
    if (/\.svg$/iu.test(sourcePath)) {
        return uploadCmsImage(
            project,
            `${path.parse(sourcePath).name}.png`,
            await sharp(data, { limitInputPixels: 40_000_000 }).png().toBuffer()
        )
    }
    return uploadCmsImage(project, path.basename(sourcePath), data)
}
