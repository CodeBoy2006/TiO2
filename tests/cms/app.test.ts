import { createTiO2Project } from '../../packages/config/src/project.js'
import type { TiO2Project } from '../../packages/config/src/types'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'fs-extra'

async function createCmsFixture(rootDir: string) {
    await fs.ensureDir(join(rootDir, 'posts/hello'))
    await fs.ensureDir(join(rootDir, 'pages'))

    await Promise.all([
        fs.writeFile(
            join(rootDir, 'posts/hello.md'),
            ['---', 'title: Hello', 'date: 2026-03-30', '---', '# Hello', '', 'Welcome to TiO2 CMS'].join('\n')
        ),
        fs.writeFile(join(rootDir, 'pages/about.md'), ['---', 'title: About', '---', 'About page'].join('\n')),
        fs.writeFile(join(rootDir, 'posts/hello/cover.txt'), 'asset placeholder')
    ])
}

async function withCmsFixture<T>(callback: (rootDir: string, project: TiO2Project) => Promise<T>) {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'tio2-cms-server-'))

    try {
        await createCmsFixture(rootDir)
        const project = createTiO2Project(rootDir, { site: { title: 'Fixture', url: 'https://example.test' } })
        return await callback(rootDir, project)
    } finally {
        await fs.remove(rootDir)
    }
}

test('TiO2 CMS server exposes health, library, and document detail endpoints', async () => {
    const { createApp } = await import('../../apps/cms-server/src/app.js')

    await withCmsFixture(async (_rootDir, project) => {
        const app = createApp(project, {
            logger: false
        })

        try {
            const health = await app.inject({
                method: 'GET',
                url: '/health'
            })
            const library = await app.inject({
                method: 'GET',
                url: '/api/library'
            })
            const document = await app.inject({
                method: 'GET',
                url: '/api/document?sourcePath=posts/hello.md'
            })

            assert.equal(health.statusCode, 200)
            assert.deepEqual(health.json(), { status: 'ok' })

            assert.equal(library.statusCode, 200)
            assert.equal(library.json().stats.post, 1)
            assert.equal(library.json().tree[0].path, 'posts')
            assert.equal(library.json().documents[0].date, '2026-03-30')

            assert.equal(document.statusCode, 200)
            assert.equal(document.json().title, 'Hello')
            assert.equal(document.json().sourcePath, 'posts/hello.md')
            assert.equal(document.json().frontmatter.date, '2026-03-30')
        } finally {
            await app.close()
        }
    })
})

test('TiO2 CMS server persists document updates through the API', async () => {
    const { createApp } = await import('../../apps/cms-server/src/app.js')

    await withCmsFixture(async (rootDir, project) => {
        const app = createApp(project, {
            logger: false
        })

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/document',
                headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' },
                payload: {
                    sourcePath: 'posts/hello.md',
                    frontmatter: {
                        title: 'Hello Updated',
                        date: '2026-03-31',
                        tags: ['cms']
                    },
                    body: '# Hello\n\nUpdated content'
                }
            })

            const persisted = await fs.readFile(join(rootDir, 'posts/hello.md'), 'utf8')

            assert.equal(response.statusCode, 200)
            assert.equal(response.json().title, 'Hello Updated')
            assert.match(persisted, /title: Hello Updated/)
            assert.match(persisted, /Updated content/)
        } finally {
            await app.close()
        }
    })
})

test('CMS guards all writes before parsing and rejects non-loopback hosts', async () => {
    const { createApp } = await import('../../apps/cms-server/src/app.js')
    await withCmsFixture(async (rootDir, project) => {
        const app = createApp(project)
        const before = await fs.readFile(join(rootDir, 'posts/hello.md'), 'utf8')
        try {
            const writes = [
                ['POST', '/api/document'],
                ['PUT', '/api/document'],
                ['PATCH', '/api/document'],
                ['DELETE', '/api/document?sourcePath=posts/hello.md'],
                ['POST', '/api/assets/upload?fileName=test.png'],
                ['POST', '/api/assets/publish']
            ] as const
            for (const [method, url] of writes) {
                for (const origin of ['https://foreign.test', 'null', '', 'http://127.0.0.1:9999']) {
                    const response = await app.inject({
                        method,
                        url,
                        headers: { host: '127.0.0.1:4173', origin }
                    })
                    assert.equal(response.statusCode, 403, `${method} ${url}: ${origin}`)
                }
            }
            for (const host of ['foreign.test:4321', '127.0.0.1.foreign.test', 'localhost@foreign.test']) {
                const response = await app.inject({
                    method: 'GET',
                    url: '/api/library',
                    headers: { host }
                })
                assert.equal(response.statusCode, 403, host)
            }
            const crossSite = await app.inject({
                method: 'DELETE',
                url: '/api/document?sourcePath=posts/hello.md',
                headers: { 'sec-fetch-site': 'cross-site' }
            })
            assert.equal(crossSite.statusCode, 403)
            assert.equal(await fs.readFile(join(rootDir, 'posts/hello.md'), 'utf8'), before)
            const invalid = await app.inject({
                method: 'PUT',
                url: '/api/document',
                payload: { sourcePath: 123 }
            })
            assert.equal(invalid.statusCode, 400)
        } finally {
            await app.close()
        }
    })
})

test('TiO2 CMS server preserves required-field validation order and messages', async () => {
    const project = createTiO2Project(os.tmpdir(), { site: { title: 'Fixture', url: 'https://example.test' } })
    const { createApp } = await import('../../apps/cms-server/src/app.js')
    const app = createApp(project, {
        logger: false
    })
    const cases: Array<{
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
        url: string
        payload?: Record<string, unknown>
        message: string
    }> = [
        {
            method: 'GET',
            url: '/api/document?sourcePath=%20%20',
            message: 'Missing required query parameter: sourcePath'
        },
        {
            method: 'DELETE',
            url: '/api/document',
            message: 'Missing required query parameter: sourcePath'
        },
        {
            method: 'POST',
            url: '/api/document',
            payload: {
                targetPath: '   '
            },
            message: 'Missing required body field: targetPath'
        },
        {
            method: 'POST',
            url: '/api/document',
            payload: {
                targetPath: 'posts/new.md'
            },
            message: 'Missing required body field: body'
        },
        {
            method: 'POST',
            url: '/api/document',
            payload: {
                targetPath: 'posts/new.md',
                body: ''
            },
            message: 'Missing required body field: frontmatter'
        },
        {
            method: 'PUT',
            url: '/api/document',
            payload: {
                sourcePath: '   '
            },
            message: 'Missing required body field: sourcePath'
        },
        {
            method: 'PUT',
            url: '/api/document',
            payload: {
                sourcePath: 'posts/hello.md'
            },
            message: 'Missing required body field: body'
        },
        {
            method: 'PUT',
            url: '/api/document',
            payload: {
                sourcePath: 'posts/hello.md',
                body: ''
            },
            message: 'Missing required body field: frontmatter'
        },
        {
            method: 'PATCH',
            url: '/api/document',
            payload: {
                sourcePath: '   '
            },
            message: 'Missing required body field: sourcePath'
        },
        {
            method: 'PATCH',
            url: '/api/document',
            payload: {
                sourcePath: 'posts/hello.md'
            },
            message: 'Missing required body field: targetPath'
        }
    ]

    try {
        for (const request of cases) {
            const response = await app.inject(request)
            assert.equal(response.statusCode, 400)
            assert.deepEqual(response.json(), {
                message: request.message
            })
        }
    } finally {
        await app.close()
    }
})

test('TiO2 CMS server maps validation, missing, conflict, and unexpected failures distinctly', async () => {
    const { createApp } = await import('../../apps/cms-server/src/app.js')

    await withCmsFixture(async (_rootDir, project) => {
        const app = createApp(project, {
            logger: false
        })

        try {
            const invalidPath = await app.inject({
                method: 'GET',
                url: '/api/document?sourcePath=posts%2F..%2Foutside.md'
            })
            const missingDocument = await app.inject({
                method: 'GET',
                url: '/api/document?sourcePath=posts%2Fmissing.md'
            })
            const conflictingCreate = await app.inject({
                method: 'POST',
                url: '/api/document',
                payload: {
                    targetPath: 'posts/hello.md',
                    frontmatter: {
                        title: 'Duplicate'
                    },
                    body: 'Duplicate'
                }
            })

            assert.equal(invalidPath.statusCode, 400)
            assert.match(invalidPath.json().message, /invalid segment/)
            assert.equal(missingDocument.statusCode, 404)
            assert.equal(conflictingCreate.statusCode, 409)
            assert.match(conflictingCreate.json().message, /already exists/)
        } finally {
            await app.close()
        }
    })

    const project = createTiO2Project(os.tmpdir(), { site: { title: 'Fixture', url: 'https://example.test' } })
    const failingApp = createApp(
        project,
        {
            logger: false
        },
        {
            readCmsDocument: async () => {
                throw new Error('internal fixture detail')
            }
        }
    )

    try {
        const response = await failingApp.inject({
            method: 'GET',
            url: '/api/document?sourcePath=posts%2Fhello.md'
        })

        assert.equal(response.statusCode, 500)
        assert.equal(response.json().message, 'Failed to read document')
        assert.doesNotMatch(response.body, /internal fixture detail/)
    } finally {
        await failingApp.close()
    }
})

test('TiO2 CMS server supports create, move, and delete document APIs', async () => {
    const { createApp } = await import('../../apps/cms-server/src/app.js')

    await withCmsFixture(async (rootDir, project) => {
        const app = createApp(project, {
            logger: false
        })

        try {
            const created = await app.inject({
                method: 'POST',
                url: '/api/document',
                payload: {
                    targetPath: 'posts/new-entry.md',
                    frontmatter: {
                        title: 'New Entry',
                        date: '2026-03-31',
                        tags: ['cms']
                    },
                    body: '# New Entry\n\nCreated content',
                    createAssetDirectory: true
                }
            })

            const moved = await app.inject({
                method: 'PATCH',
                url: '/api/document',
                payload: {
                    sourcePath: 'posts/hello.md',
                    targetPath: 'topics/hello/Guide.md',
                    moveAssetDirectory: true
                }
            })

            const deleted = await app.inject({
                method: 'DELETE',
                url: '/api/document?sourcePath=pages/about.md&removeAssetDirectory=false'
            })

            assert.equal(created.statusCode, 200)
            assert.equal(created.json().sourcePath, 'posts/new-entry.md')
            assert.equal(await fs.pathExists(join(rootDir, 'posts/new-entry.md')), true)
            assert.equal(await fs.pathExists(join(rootDir, 'posts/new-entry')), true)

            assert.equal(moved.statusCode, 200)
            assert.equal(moved.json().sourcePath, 'topics/hello/Guide.md')
            assert.equal(await fs.pathExists(join(rootDir, 'posts/hello.md')), false)
            assert.equal(await fs.pathExists(join(rootDir, 'topics/hello/Guide.md')), true)
            assert.equal(await fs.pathExists(join(rootDir, 'topics/hello/Guide')), true)

            assert.equal(deleted.statusCode, 200)
            assert.equal(deleted.json().sourcePath, 'pages/about.md')
            assert.equal(await fs.pathExists(join(rootDir, 'pages/about.md')), false)
        } finally {
            await app.close()
        }
    })
})
