import type { TiO2Project } from '../../../packages/config/src/types'
import Fastify, { type FastifyReply, type FastifyServerOptions } from 'fastify'
import {
    CmsRepositoryError,
    createCmsDocument,
    deleteCmsDocument,
    loadCmsLibrarySnapshot,
    moveCmsDocument,
    readCmsDocument,
    updateCmsDocument
} from '../../../packages/content-fs/src/index'
import type {
    CmsDocumentCreateInput,
    CmsDocumentMoveInput,
    CmsDocumentUpdateInput
} from '../../../packages/cms-contract/src/index'
import { resolveCmsPreviewOrigin } from './preview-origin'
import {
    CMS_IMAGE_LIMIT,
    listCmsImages,
    publishCmsImage,
    readCmsImagePreview,
    uploadCmsImage
} from '../../../packages/content-fs/src/cms-assets'

interface DocumentQuerystring {
    sourcePath?: string
    removeAssetDirectory?: string
}

function createDependencies(project: TiO2Project) {
    return {
        loadCmsLibrarySnapshot: loadCmsLibrarySnapshot.bind(null, project),
        readCmsDocument: readCmsDocument.bind(null, project),
        createCmsDocument: createCmsDocument.bind(null, project),
        updateCmsDocument: updateCmsDocument.bind(null, project),
        moveCmsDocument: moveCmsDocument.bind(null, project),
        deleteCmsDocument: deleteCmsDocument.bind(null, project),
        resolveCmsPreviewOrigin
    }
}

export type CmsServerDependencies = ReturnType<typeof createDependencies>

const cmsRepositoryStatusCodes = {
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    CONFLICT: 409
} as const

function sendCmsError(reply: FastifyReply, error: unknown, fallbackMessage: string) {
    if (error instanceof CmsRepositoryError) {
        reply.code(cmsRepositoryStatusCodes[error.code])
        return {
            message: error.message
        }
    }

    if (isNodeError(error) && error.code === 'ENOENT') {
        reply.code(404)
        return {
            message: 'Document not found'
        }
    }

    reply.log.error({ err: error }, fallbackMessage)
    reply.code(500)
    return {
        message: fallbackMessage
    }
}

async function runCmsOperation<T>(reply: FastifyReply, fallbackMessage: string, operation: () => Promise<T>) {
    try {
        return await operation()
    } catch (error) {
        return sendCmsError(reply, error, fallbackMessage)
    }
}

function missingRequiredField(reply: FastifyReply, location: 'body field' | 'query parameter', field: string) {
    reply.code(400)
    return {
        message: `Missing required ${location}: ${field}`
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error
}

export function createApp(
    project: TiO2Project,
    options: FastifyServerOptions = {},
    dependencies: Partial<CmsServerDependencies> = {}
) {
    const app = Fastify(options)
    const resolvedDependencies = {
        ...createDependencies(project),
        ...dependencies
    }

    app.addHook('onRequest', async (request, reply) => {
        const { host, origin } = request.headers
        // Binding to loopback does not prevent browser DNS rebinding.
        if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu.test(host)) {
            return reply.code(403).send({ message: 'CMS requires a loopback host.' })
        }
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
        if (
            (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) ||
            request.headers['sec-fetch-site'] === 'cross-site'
        ) {
            return reply.code(403).send({ message: 'Cross-origin CMS writes are not allowed.' })
        }
    })

    app.get('/health', async () => ({
        status: 'ok'
    }))

    app.get('/api/preview-origin', async () => {
        return resolvedDependencies.resolveCmsPreviewOrigin()
    })

    app.get('/api/library', async (_request, reply) => {
        return runCmsOperation(reply, 'Failed to load content library', resolvedDependencies.loadCmsLibrarySnapshot)
    })

    const sourceQuery = {
        type: 'object',
        required: ['sourcePath'],
        properties: { sourcePath: { type: 'string', minLength: 1 } }
    }
    app.get<{ Querystring: { sourcePath: string } }>(
        '/api/assets',
        { schema: { querystring: sourceQuery } },
        async (request, reply) =>
            runCmsOperation(reply, 'Failed to list images', () => listCmsImages(project, request.query.sourcePath))
    )

    app.get<{ Querystring: { sourcePath: string } }>(
        '/api/asset',
        { schema: { querystring: sourceQuery } },
        async (request, reply) =>
            runCmsOperation(reply, 'Failed to preview image', async () => {
                const image = await readCmsImagePreview(project, request.query.sourcePath)
                return reply
                    .type('image/webp')
                    .header('X-Content-Type-Options', 'nosniff')
                    .header('Content-Security-Policy', "default-src 'none'; sandbox")
                    .header('Cache-Control', 'no-store')
                    .send(image)
            })
    )

    // Binary uploads use a non-simple content type and the shared request guard.
    app.addContentTypeParser(
        'application/octet-stream',
        { parseAs: 'buffer', bodyLimit: CMS_IMAGE_LIMIT },
        (_request, body, done) => done(null, body)
    )
    app.post<{ Querystring: { fileName: string }; Body: Buffer }>(
        '/api/assets/upload',
        {
            bodyLimit: CMS_IMAGE_LIMIT,
            schema: {
                querystring: {
                    type: 'object',
                    required: ['fileName'],
                    properties: { fileName: { type: 'string', minLength: 1, maxLength: 180 } }
                }
            }
        },
        async (request, reply) =>
            runCmsOperation(reply, 'Failed to upload image', () =>
                uploadCmsImage(project, request.query.fileName, request.body)
            )
    )

    app.post<{ Body: { sourcePath: string } }>(
        '/api/assets/publish',
        {
            schema: { body: sourceQuery }
        },
        async (request, reply) =>
            runCmsOperation(reply, 'Failed to prepare image', () => publishCmsImage(project, request.body.sourcePath))
    )

    app.get<{ Querystring: DocumentQuerystring }>('/api/document', async (request, reply) => {
        const sourcePath = request.query.sourcePath?.trim()

        if (!sourcePath) {
            return missingRequiredField(reply, 'query parameter', 'sourcePath')
        }

        return runCmsOperation(reply, 'Failed to read document', () => resolvedDependencies.readCmsDocument(sourcePath))
    })

    app.post<{ Body: Partial<CmsDocumentCreateInput> }>('/api/document', async (request, reply) => {
        const targetPath = typeof request.body?.targetPath === 'string' ? request.body.targetPath.trim() : ''

        if (!targetPath) {
            return missingRequiredField(reply, 'body field', 'targetPath')
        }

        if (!request.body || typeof request.body.body !== 'string') {
            return missingRequiredField(reply, 'body field', 'body')
        }

        if (!isRecord(request.body.frontmatter)) {
            return missingRequiredField(reply, 'body field', 'frontmatter')
        }

        const { body, frontmatter } = request.body
        return runCmsOperation(reply, 'Failed to create document', () =>
            resolvedDependencies.createCmsDocument({
                targetPath,
                body,
                frontmatter,
                createAssetDirectory: Boolean(request.body.createAssetDirectory)
            })
        )
    })

    app.put<{ Body: Partial<CmsDocumentUpdateInput> }>('/api/document', async (request, reply) => {
        const sourcePath = typeof request.body?.sourcePath === 'string' ? request.body.sourcePath.trim() : ''

        if (!sourcePath) {
            return missingRequiredField(reply, 'body field', 'sourcePath')
        }

        if (!request.body || typeof request.body.body !== 'string') {
            return missingRequiredField(reply, 'body field', 'body')
        }

        if (!isRecord(request.body.frontmatter)) {
            return missingRequiredField(reply, 'body field', 'frontmatter')
        }

        const { body, frontmatter } = request.body
        return runCmsOperation(reply, 'Failed to update document', () =>
            resolvedDependencies.updateCmsDocument({
                sourcePath,
                body,
                frontmatter
            })
        )
    })

    app.patch<{ Body: Partial<CmsDocumentMoveInput> }>('/api/document', async (request, reply) => {
        const sourcePath = typeof request.body?.sourcePath === 'string' ? request.body.sourcePath.trim() : ''
        const targetPath = typeof request.body?.targetPath === 'string' ? request.body.targetPath.trim() : ''

        if (!sourcePath) {
            return missingRequiredField(reply, 'body field', 'sourcePath')
        }

        if (!targetPath) {
            return missingRequiredField(reply, 'body field', 'targetPath')
        }

        return runCmsOperation(reply, 'Failed to move document', () =>
            resolvedDependencies.moveCmsDocument({
                sourcePath,
                targetPath,
                moveAssetDirectory: Boolean(request.body?.moveAssetDirectory)
            })
        )
    })

    app.delete<{ Querystring: DocumentQuerystring }>('/api/document', async (request, reply) => {
        const sourcePath = request.query.sourcePath?.trim()

        if (!sourcePath) {
            return missingRequiredField(reply, 'query parameter', 'sourcePath')
        }

        return runCmsOperation(reply, 'Failed to delete document', () =>
            resolvedDependencies.deleteCmsDocument({
                sourcePath,
                removeAssetDirectory: request.query.removeAssetDirectory === 'true'
            })
        )
    })

    return app
}
