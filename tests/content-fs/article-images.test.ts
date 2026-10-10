import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { createArticleImageKey } from '../../packages/content-core/src/index.js'
import { generateArticleImages } from '../../packages/content-fs/src/index.js'

test('TiO2 article image generation emits responsive variants and a reusable manifest', async (context) => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tio2-article-images-'))
    context.after(() => fs.rm(repoRoot, { recursive: true, force: true }))

    const documentDirectory = path.join(repoRoot, 'posts')
    const imageSourceDirectory = path.join(repoRoot, 'assets', 'images')
    const generatedImageDirectory = path.join(repoRoot, 'public', 'images', 'generated')
    const relativeImageDirectory = path.join(documentDirectory, 'demo')

    await Promise.all([
        fs.mkdir(imageSourceDirectory, { recursive: true }),
        fs.mkdir(relativeImageDirectory, { recursive: true })
    ])
    await Promise.all([
        sharp({
            create: {
                width: 1200,
                height: 400,
                channels: 3,
                background: '#336699'
            }
        })
            .png()
            .toFile(path.join(imageSourceDirectory, 'wide.png')),
        sharp({
            create: {
                width: 320,
                height: 640,
                channels: 3,
                background: '#993366'
            }
        })
            .webp()
            .toFile(path.join(relativeImageDirectory, 'portrait.webp'))
    ])
    await fs.writeFile(
        path.join(imageSourceDirectory, 'diagram.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><path fill="rgb(0%,0%,0%)" d="M0 0h200v100H0z"/><path style="fill:#ffffff;stroke:#000000" d="M0 0h20v20H0z"/><path fill="#eef3fd" d="M20 0h20v20H20z"/><path fill="rgb(89.7995%, 90.59906%, 92.199707%)" d="M40 0h20v20H40z"/><path fill="rgb(100%, 100%, 100%)" d="M60 0h20v20H60z"/><path stroke="#ffffff" d="M0 20h20"/><path stroke="rgb(14.509583%, 38.822937%, 92.156982%)" d="M0 0h20"/><path stroke="rgb(72.549438%, 10.978699%, 10.978699%)" d="M0 10h20"/><path stroke="rgb(8.233643%, 50.193787%, 23.922729%)" d="M0 20h20"/><path stroke="rgb(41.999817%, 44.699097%, 50.19989%)" d="M0 30h20"/><path stroke="#2563eb" d="M0 40h20"/><path stroke="#b91c1c" d="M0 50h20"/><path stroke="#15803d" d="M0 60h20"/><path stroke="#6b7280" d="M0 70h20"/></svg>',
        'utf8'
    )
    await fs.writeFile(
        path.join(documentDirectory, 'demo.md'),
        [
            '![Wide](/images/wide.png)',
            '',
            '![Portrait](./demo/portrait.webp)',
            '',
            '![Diagram](/images/diagram.svg)'
        ].join('\n'),
        'utf8'
    )

    const manifest = await generateArticleImages({
        repoRoot,
        contentDirectories: ['posts'],
        quiet: true
    })
    const wide = manifest.entries[createArticleImageKey('posts/demo.md', '/images/wide.png')]
    const portrait = manifest.entries[createArticleImageKey('posts/demo.md', './demo/portrait.webp')]
    const diagram = manifest.entries[createArticleImageKey('posts/demo.md', '/images/diagram.svg')]

    assert.equal(wide.layout, 'panorama')
    assert.equal(wide.width, 1200)
    assert.deepEqual(
        wide.webp.map((variant) => variant.width),
        [480, 768, 960, 1200]
    )
    assert.equal(portrait.layout, 'portrait')
    assert.equal(portrait.width, 320)
    assert.deepEqual(
        portrait.avif.map((variant) => variant.width),
        [320]
    )
    assert.ok(diagram.darkSrc)

    const generatedFiles = await fs.readdir(generatedImageDirectory)
    assert.equal(generatedFiles.length, 12)
    assert.equal(generatedFiles.filter((fileName) => fileName.endsWith('.svg')).length, 2)
    const darkSvg = await fs.readFile(path.join(generatedImageDirectory, path.basename(diagram.darkSrc!)), 'utf8')
    assert.match(darkSvg, /rgb\(92%,93%,95%\)/)
    assert.match(darkSvg, /#60a5fa/)
    assert.match(darkSvg, /#f87171/)
    assert.match(darkSvg, /#4ade80/)
    assert.match(darkSvg, /#9ca3af/)
    assert.match(darkSvg, /fill:#1b1b1f;stroke:#ebeef2/)
    assert.match(darkSvg, /fill="#1b1b1f"/)
    assert.match(darkSvg, /fill="#202127"/)
    assert.match(darkSvg, /stroke="#ffffff"/)
    assert.doesNotMatch(darkSvg, /rgb\(0%,0%,0%\)/)
    assert.doesNotMatch(darkSvg, /rgb\(89\.7995%, 90\.59906%, 92\.199707%\)/)

    const savedManifest = JSON.parse(
        await fs.readFile(path.join(repoRoot, '.vitepress', 'generated', 'article-images.json'), 'utf8')
    )
    assert.deepEqual(savedManifest.entries, manifest.entries)

    // A rebuild must reuse bytes, repair missing variants, and prune obsolete hashes.
    const options = { repoRoot, contentDirectories: ['posts'], quiet: true }
    const timestamp = new Date('2000-01-01T00:00:00Z')
    for (const file of generatedFiles) {
        await fs.utimes(path.join(generatedImageDirectory, file), timestamp, timestamp)
    }
    const rebuilt = await generateArticleImages(options)
    assert.deepEqual(rebuilt.entries, manifest.entries)
    for (const file of generatedFiles) {
        assert.equal((await fs.stat(path.join(generatedImageDirectory, file))).mtimeMs, timestamp.getTime())
    }

    const missingVariant = path.join(generatedImageDirectory, path.basename(wide.avif[0].src))
    await fs.rm(missingVariant)
    await fs.writeFile(`${missingVariant}.interrupted.tmp`, 'incomplete')
    await generateArticleImages(options)
    assert.equal((await sharp(missingVariant).metadata()).width, 480)
    await assert.rejects(fs.access(`${missingVariant}.interrupted.tmp`), { code: 'ENOENT' })

    await fs.writeFile(
        path.join(imageSourceDirectory, 'diagram.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path fill="black" d="M0 0h300v100H0z"/></svg>'
    )
    const changed = await generateArticleImages(options)
    const changedDiagram = changed.entries[createArticleImageKey('posts/demo.md', '/images/diagram.svg')]
    assert.equal(changedDiagram.width, 300)
    assert.notEqual(changedDiagram.src, diagram.src)
    for (const src of [diagram.src, diagram.darkSrc!]) {
        await assert.rejects(fs.access(path.join(generatedImageDirectory, path.basename(src))), { code: 'ENOENT' })
    }

    await fs.writeFile(path.join(documentDirectory, 'demo.md'), 'No images remain.\n')
    assert.deepEqual((await generateArticleImages(options)).entries, {})
    assert.deepEqual(await fs.readdir(generatedImageDirectory), [])
})

test('TiO2 image cache never publishes a partially written variant', async (context) => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tio2-image-write-'))
    context.after(() => fs.rm(repoRoot, { recursive: true, force: true }))
    await fs.mkdir(path.join(repoRoot, 'posts'))
    await fs.writeFile(path.join(repoRoot, 'posts/demo.md'), '![Diagram](./diagram.svg)')
    await fs.writeFile(
        path.join(repoRoot, 'posts/diagram.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M0 0h20v10H0z"/></svg>'
    )
    context.mock.method(fs, 'rename', async () => {
        throw new Error('simulated write failure')
    })
    await assert.rejects(
        generateArticleImages({ repoRoot, contentDirectories: ['posts'], quiet: true }),
        /simulated write failure/u
    )
    assert.deepEqual(await fs.readdir(path.join(repoRoot, 'public/images/generated')), [])
})
