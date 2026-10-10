import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'fs-extra'
import sharp from 'sharp'
import { createApp } from '../../apps/cms-server/src/app'
import { createTiO2Project } from '../../packages/config/src/project.js'
import { generateArticleImages } from '../../packages/content-fs/src/article-images'

test('CMS images browse, preview, upload and become publishable covers without overwriting source assets', async () => {
    const root = await mkdtemp(join(os.tmpdir(), 'tio2-images-'))
    const app = createApp(createTiO2Project(root, { site: { title: 'Test', url: 'https://example.test' } }))
    try {
        const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#2468ac' } })
            .png()
            .toBuffer()
        await fs.outputFile(join(root, 'posts/你好.md'), '---\ntitle: 你好\n---\n# Hello')
        await fs.outputFile(join(root, 'posts/你好/图 (1)#a?.png'), png)
        await fs.outputFile(join(root, 'public/covers/封面.png'), png)
        await fs.outputFile(
            join(root, 'assets/images/diagram.svg'),
            '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="red"/></svg>'
        )
        await fs.outputFile(join(root, 'private/hidden.png'), png)
        await fs.ensureSymlink(join(root, 'private'), join(root, 'public/linked'), 'dir')
        await fs.ensureSymlink(join(root, 'private/hidden.png'), join(root, 'public/secret.png'))

        const listed = await app.inject(`/api/assets?${new URLSearchParams({ sourcePath: 'posts/你好.md' })}`)
        assert.equal(listed.statusCode, 200)
        const assets = listed.json()
        assert.equal(assets.length, 3)
        assert.equal(assets[0].sourcePath, 'posts/你好/图 (1)#a?.png')
        assert.match(assets[0].src, /^\.\//u)
        assert.equal(assets[0].publicSrc, null)
        await fs.appendFile(join(root, 'posts/你好.md'), `\n\n![图](<${assets[0].src}>)\n`)
        const manifest = await generateArticleImages({ repoRoot: root, contentDirectories: ['posts'], quiet: true })
        assert.equal(Object.keys(manifest.entries).length, 1)
        assert.ok(!assets.some((asset: { sourcePath: string }) => /secret|linked|hidden/u.test(asset.sourcePath)))
        const preview = await app.inject(assets[0].previewSrc)
        assert.equal(preview.statusCode, 200)
        assert.equal((await sharp(preview.rawPayload).metadata()).format, 'webp')
        assert.equal(preview.headers['x-content-type-options'], 'nosniff')

        const upload = () =>
            app.inject({
                method: 'POST',
                url: '/api/assets/upload?fileName=test.png',
                headers: { 'content-type': 'application/octet-stream' },
                payload: png
            })
        const uploaded = await upload()
        assert.equal(uploaded.statusCode, 200)
        const image = uploaded.json()
        assert.match(image.publicSrc, /^\/uploads\/test-[a-f0-9]+\.png$/u)
        assert.deepEqual(await fs.readFile(join(root, image.sourcePath)), png)
        assert.equal((await upload()).json().sourcePath, image.sourcePath)
        const cover = await app.inject({
            method: 'POST',
            url: '/api/assets/publish',
            payload: { sourcePath: assets[0].sourcePath }
        })
        assert.equal(cover.statusCode, 200)
        assert.match(cover.json().publicSrc, /^\/uploads\//u)
        assert.deepEqual(await fs.readFile(join(root, assets[0].sourcePath)), png)
        const svgCover = await app.inject({
            method: 'POST',
            url: '/api/assets/publish',
            payload: { sourcePath: 'assets/images/diagram.svg' }
        })
        assert.equal(svgCover.statusCode, 200)
        assert.match(svgCover.json().publicSrc, /\.png$/u)

        for (const sourcePath of [
            '../private/hidden.png',
            'public/../private/hidden.png',
            'public/secret.png',
            'public/linked/hidden.png',
            'private/hidden.png'
        ]) {
            const response = await app.inject(`/api/asset?${new URLSearchParams({ sourcePath })}`)
            assert.equal(response.statusCode, 400, sourcePath)
        }
        for (const fileName of ['../oops.png', 'a/b.png']) {
            const response = await app.inject({
                method: 'POST',
                url: `/api/assets/upload?${new URLSearchParams({ fileName })}`,
                headers: { 'content-type': 'application/octet-stream' },
                payload: png
            })
            assert.equal(response.statusCode, 400)
        }
        const invalid = await app.inject({
            method: 'POST',
            url: '/api/assets/upload?fileName=evil.png',
            headers: { 'content-type': 'application/octet-stream' },
            payload: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
        })
        assert.equal(invalid.statusCode, 400)
        const foreign = await app.inject({
            method: 'POST',
            url: '/api/assets/upload?fileName=test.png',
            headers: { 'content-type': 'application/octet-stream', origin: 'https://foreign.test' },
            payload: png
        })
        assert.equal(foreign.statusCode, 403)
        const oversize = await app.inject({
            method: 'POST',
            url: '/api/assets/upload?fileName=large.png',
            headers: { 'content-type': 'application/octet-stream' },
            payload: Buffer.alloc(20 * 1024 * 1024 + 1)
        })
        assert.equal(oversize.statusCode, 413)
        await fs.remove(join(root, 'public/uploads'))
        await fs.ensureSymlink(join(root, 'private'), join(root, 'public/uploads'), 'dir')
        assert.equal((await upload()).statusCode, 400)
    } finally {
        await app.close()
        await fs.remove(root)
    }
})
