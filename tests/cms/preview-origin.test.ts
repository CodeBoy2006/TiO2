import os from 'node:os'
import { createTiO2Project } from '../../packages/config/src/project.js'
import assert from 'node:assert/strict'
import test from 'node:test'

test('TiO2 CMS preview origin resolver respects explicit overrides', async () => {
    const { resolveCmsPreviewOrigin } = await import('../../apps/cms-server/src/preview-origin.js')

    let probeCount = 0
    const resolution = await resolveCmsPreviewOrigin({
        env: {
            CMS_PREVIEW_ORIGIN: 'https://preview.example.com/'
        } as NodeJS.ProcessEnv,
        probeOrigin: async () => {
            probeCount += 1
            return false
        }
    })

    assert.deepEqual(resolution, {
        origin: 'https://preview.example.com',
        resolved: true
    })
    assert.equal(probeCount, 0)
})

test('TiO2 CMS preview origin resolver scans upward from SITE_DEV_PORT until it finds a preview probe', async () => {
    const { resolveCmsPreviewOrigin } = await import('../../apps/cms-server/src/preview-origin.js')

    const attempts: string[] = []
    const resolution = await resolveCmsPreviewOrigin({
        env: {
            SITE_DEV_PORT: '5000',
            CMS_PREVIEW_PORT_SCAN_WINDOW: '3'
        } as NodeJS.ProcessEnv,
        probeOrigin: async (origin) => {
            attempts.push(origin)
            return origin === 'http://127.0.0.1:5001'
        }
    })

    assert.deepEqual(resolution, {
        origin: 'http://127.0.0.1:5001',
        resolved: true
    })
    assert.deepEqual(attempts, ['http://127.0.0.1:5000', 'http://127.0.0.1:5001'])
})

test('TiO2 CMS server exposes the resolved preview origin through the API', async () => {
    const { createApp } = await import('../../apps/cms-server/src/app.js')

    const project = createTiO2Project(os.tmpdir(), { site: { title: 'Fixture', url: 'https://example.test' } })
    const app = createApp(
        project,
        {
            logger: false
        },
        {
            resolveCmsPreviewOrigin: async () => ({
                origin: 'http://127.0.0.1:5002',
                resolved: true
            })
        }
    )

    try {
        const response = await app.inject({
            method: 'GET',
            url: '/api/preview-origin'
        })

        assert.equal(response.statusCode, 200)
        assert.deepEqual(response.json(), {
            origin: 'http://127.0.0.1:5002',
            resolved: true
        })
    } finally {
        await app.close()
    }
})
