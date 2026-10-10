import assert from 'node:assert/strict'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import {
    ARTICLE_IMAGE_MANIFEST_VERSION,
    createArticleImageKey,
    type ArticleImageManifest
} from '../../packages/content-core/src/index.js'
import { createArticleImageMarkdownPlugin } from '../../.vitepress/theme/articleImageMarkdownPlugin.js'

function createManifest(): ArticleImageManifest {
    return {
        version: ARTICLE_IMAGE_MANIFEST_VERSION,
        generatedAt: '2026-07-17T00:00:00.000Z',
        entries: {
            [createArticleImageKey('posts/demo.md', '/images/demo.png')]: {
                authoredSrc: '/images/demo.png',
                documentPath: 'posts/demo.md',
                width: 1200,
                height: 600,
                kind: 'raster',
                layout: 'standard',
                src: '/images/generated/demo-1200.webp',
                viewerSrc: '/images/generated/demo-1200.webp',
                avif: [
                    { src: '/images/generated/demo-480.avif', width: 480 },
                    { src: '/images/generated/demo-1200.avif', width: 1200 }
                ],
                webp: [
                    { src: '/images/generated/demo-480.webp', width: 480 },
                    { src: '/images/generated/demo-1200.webp', width: 1200 }
                ]
            },
            [createArticleImageKey('posts/demo.md', '/images/diagram.svg')]: {
                authoredSrc: '/images/diagram.svg',
                documentPath: 'posts/demo.md',
                width: 800,
                height: 400,
                kind: 'svg',
                layout: 'standard',
                src: '/images/generated/diagram.svg',
                darkSrc: '/images/generated/diagram-dark.svg',
                viewerSrc: '/images/generated/diagram.svg',
                avif: [],
                webp: []
            }
        }
    }
}

function createMarkdown() {
    const md = new MarkdownIt()
    md.use(createArticleImageMarkdownPlugin(createManifest()))
    return md
}

test('TiO2 article image plugin renders responsive image blocks with intrinsic dimensions', () => {
    const rendered = createMarkdown().render('![Demo image](/images/demo.png "Demo caption")', {
        relativePath: 'posts/demo.md'
    })

    assert.match(rendered, /<div class="article-image-group">/)
    assert.match(rendered, /<ArticleImage /)
    assert.match(rendered, /src="\/images\/generated\/demo-1200\.webp"/)
    assert.match(rendered, /width="1200" height="600"/)
    assert.match(rendered, /avif-srcset="\/images\/generated\/demo-480\.avif 480w/)
    assert.match(rendered, /loading="eager" fetchpriority="high"/)
    assert.match(rendered, /caption="Demo caption"/)
})

test('TiO2 article image plugin groups consecutive images and lazily loads later media', () => {
    const rendered = createMarkdown().render(
        ['![First](/images/demo.png)', '![Remote](https://example.com/remote.png)'].join('\n'),
        {
            relativePath: 'posts/demo.md'
        }
    )

    assert.equal((rendered.match(/<ArticleImage/g) ?? []).length, 2)
    assert.equal((rendered.match(/loading="eager"/g) ?? []).length, 1)
    assert.equal((rendered.match(/loading="lazy"/g) ?? []).length, 1)
    assert.match(rendered, /src="https:\/\/example\.com\/remote\.png"/)
})

test('TiO2 article image plugin splits trailing image blocks from preceding prose', () => {
    const rendered = createMarkdown().render(
        ['Paragraph before the image.  ', '![Demo](/images/demo.png)'].join('\n'),
        {
            relativePath: 'posts/demo.md'
        }
    )

    assert.match(rendered, /<p>Paragraph before the image\.<\/p>/)
    assert.match(rendered, /<div class="article-image-group"><ArticleImage /)
    assert.doesNotMatch(rendered, /article-inline-image/)
})

test('TiO2 article image plugin keeps a late first image lazy', () => {
    const rendered = createMarkdown().render(`${'\n'.repeat(24)}![Demo](/images/demo.png)`, {
        relativePath: 'posts/demo.md'
    })

    assert.match(rendered, /loading="lazy"/)
    assert.doesNotMatch(rendered, /fetchpriority="high"/)
})

test('TiO2 article image plugin keeps a text-heavy first image lazy', () => {
    const rendered = createMarkdown().render(`${'Long introduction. '.repeat(40)}  \n![Demo](/images/demo.png)`, {
        relativePath: 'posts/demo.md'
    })

    assert.match(rendered, /loading="lazy"/)
    assert.doesNotMatch(rendered, /fetchpriority="high"/)
})

test('TiO2 article image plugin keeps mixed paragraphs inline with progressive loading markup', () => {
    const rendered = createMarkdown().render('Before ![Demo](/images/demo.png) after.', {
        relativePath: 'posts/demo.md'
    })

    assert.doesNotMatch(rendered, /<ArticleImage/)
    assert.match(rendered, /<ImageLoadFrame /)
    assert.match(rendered, /src="\/images\/generated\/demo-1200\.webp"/)
    assert.match(rendered, /width="1200" height="600"/)
    assert.match(rendered, /avif-srcset="\/images\/generated\/demo-480\.avif 480w/)
    assert.match(rendered, /loading="eager"/)
    assert.match(rendered, /class="article-inline-image" intrinsic/)
})

test('TiO2 article image plugin emits static picture markup for decrypted content', () => {
    const rendered = createMarkdown().render('![Demo](/images/demo.png)', {
        relativePath: 'posts/demo.md',
        referenceRenderMode: 'static-html'
    })

    assert.doesNotMatch(rendered, /<ArticleImage/)
    assert.match(rendered, /class="article-image article-image--standard article-image--raster"/)
    assert.match(rendered, /<button type="button" class="article-image__trigger"/)
    assert.match(rendered, /aria-label="Enlarge: Demo" aria-haspopup="dialog"/)
    assert.match(rendered, /data-article-image-viewer data-viewer-src="\/images\/generated\/demo-1200\.webp"/)
    assert.match(rendered, /data-image-load-frame/)
    assert.match(rendered, /image-load-frame--loaded image-load-frame--known image-load-frame--enhanced/)
    assert.match(rendered, /image-load-frame--enhanced/)
    assert.match(rendered, /<picture class="image-load-frame__picture"><source type="image\/avif"/)
    assert.match(rendered, /<img src="\/images\/generated\/demo-1200\.webp"/)
    assert.match(rendered, /data-image-load-media="true"/)
})

test('TiO2 article image plugin emits bindable loaded frames for inline static images', () => {
    const rendered = createMarkdown().render('Before ![Demo](/images/demo.png) after.', {
        relativePath: 'posts/demo.md',
        referenceRenderMode: 'static-html'
    })

    assert.doesNotMatch(rendered, /<ImageLoadFrame/)
    assert.match(rendered, /image-load-frame--intrinsic article-inline-image/)
    assert.match(rendered, /data-image-state="loaded"/)
    assert.doesNotMatch(rendered, /aria-busy=/)
    assert.match(rendered, /<span class="image-load-frame__error" role="status" hidden>Image failed to load<\/span>/)
})

test('TiO2 article image plugin passes theme SVG variants to the image component', () => {
    const rendered = createMarkdown().render('![Diagram](/images/diagram.svg)', {
        relativePath: 'posts/demo.md'
    })

    assert.match(rendered, /dark-src="\/images\/generated\/diagram-dark\.svg"/)
})

test('TiO2 article image plugin exposes light and dark SVG sources for explicit theme switching', () => {
    const rendered = createMarkdown().render('![Diagram](/images/diagram.svg)', {
        relativePath: 'posts/demo.md',
        referenceRenderMode: 'static-html'
    })

    assert.match(rendered, /data-viewer-dark-src="\/images\/generated\/diagram-dark\.svg"/)
    assert.match(
        rendered,
        /<img src="\/images\/generated\/diagram\.svg" data-light-src="\/images\/generated\/diagram\.svg" data-dark-src="\/images\/generated\/diagram-dark\.svg"/
    )
    assert.doesNotMatch(rendered, /prefers-color-scheme/)
})
