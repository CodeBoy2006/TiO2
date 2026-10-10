import { t } from './i18n'
import { bindStaticImageLoadFrames } from './image-loading'

export const IMAGE_VIEWER_MIN_ZOOM = 1
export const IMAGE_VIEWER_MAX_ZOOM = 4
export const IMAGE_VIEWER_ZOOM_STEP = 0.5

export function clampImageViewerZoom(zoom: number) {
    return Math.min(IMAGE_VIEWER_MAX_ZOOM, Math.max(IMAGE_VIEWER_MIN_ZOOM, zoom))
}

export function calculateImageViewerFit(
    naturalWidth: number,
    naturalHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    padding: number
) {
    if (naturalWidth <= 0 || naturalHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return 1
    return Math.min(
        1,
        Math.max(1, viewportWidth - padding * 2) / naturalWidth,
        Math.max(1, viewportHeight - padding * 2) / naturalHeight
    )
}

export function openImageViewer(trigger: HTMLButtonElement) {
    if (document.querySelector('.article-image-viewer[open]')) return

    const sourceImage = trigger.querySelector<HTMLImageElement>('img')
    const dark = document.documentElement.classList.contains('dark')
    const src = dark && trigger.dataset.viewerDarkSrc ? trigger.dataset.viewerDarkSrc : trigger.dataset.viewerSrc
    if (!src) return

    const dialog = document.createElement('dialog')
    const alt = sourceImage?.alt ?? ''
    const surface = trigger.dataset.viewerKind === 'svg' && !dark ? 'light' : 'dark'
    dialog.className = 'article-image-viewer'
    dialog.setAttribute(
        'aria-label',
        alt ? `${t('图片预览：', 'Image preview: ')}${alt}` : t('图片预览', 'Image preview')
    )
    dialog.innerHTML = `<div class="article-image-viewer__shell"><div class="article-image-viewer__toolbar" aria-label="${t('图片缩放控制', 'Image zoom controls')}"><button type="button" class="article-image-viewer__control" data-viewer-action="out" title="${t('缩小', 'Zoom out')}" aria-label="${t('缩小图片', 'Zoom out')}"><span aria-hidden="true">−</span></button><output class="article-image-viewer__zoom" aria-label="${t('当前缩放比例', 'Current zoom')}">100%</output><button type="button" class="article-image-viewer__control" data-viewer-action="in" title="${t('放大', 'Zoom in')}" aria-label="${t('放大图片', 'Zoom in')}"><span aria-hidden="true">+</span></button><button type="button" class="article-image-viewer__control" data-viewer-action="reset" title="${t('适合窗口', 'Fit to window')}" aria-label="${t('重置图片缩放', 'Reset image zoom')}"><span aria-hidden="true">↺</span></button><button type="button" class="article-image-viewer__control article-image-viewer__close" data-viewer-action="close" title="${t('关闭', 'Close')}" aria-label="${t('关闭图片预览', 'Close image preview')}" autofocus><span aria-hidden="true">×</span></button></div><div class="article-image-viewer__viewport"><div class="article-image-viewer__canvas"><div class="article-image-viewer__stage article-image-viewer__stage--${surface}"><span class="image-load-frame image-load-frame--loading image-load-frame--enhanced article-image-viewer__media" data-image-load-frame data-image-state="loading"><picture class="image-load-frame__picture"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" loading="eager" fetchpriority="high" decoding="async" draggable="false" class="image-load-frame__media" data-image-load-media></picture><span class="image-load-frame__placeholder" aria-hidden="true"></span><span class="image-load-frame__error" role="status" hidden>${t('图片加载失败', 'Image failed to load')}</span></span></div></div></div></div>`
    document.body.append(dialog)

    const viewport = dialog.querySelector<HTMLElement>('.article-image-viewer__viewport')!
    const stage = dialog.querySelector<HTMLElement>('.article-image-viewer__stage')!
    const image = dialog.querySelector<HTMLImageElement>('img')!
    const output = dialog.querySelector<HTMLOutputElement>('output')!
    const out = dialog.querySelector<HTMLButtonElement>('[data-viewer-action="out"]')!
    const zoomIn = dialog.querySelector<HTMLButtonElement>('[data-viewer-action="in"]')!
    const reset = dialog.querySelector<HTMLButtonElement>('[data-viewer-action="reset"]')!
    let naturalWidth = Number(sourceImage?.getAttribute('width')) || 0
    let naturalHeight = Number(sourceImage?.getAttribute('height')) || 0
    let fit = 1
    let zoom = 1

    const render = () => {
        const scale = fit * zoom
        if (naturalWidth && naturalHeight) {
            stage.style.width = `${Math.round(naturalWidth * scale)}px`
            stage.style.height = `${Math.round(naturalHeight * scale)}px`
        } else {
            stage.style.width = 'min(80vw, 56rem)'
            stage.style.height = 'min(60vh, 36rem)'
        }
        output.value = `${Math.round(zoom * 100)}%`
        out.disabled = zoom <= IMAGE_VIEWER_MIN_ZOOM
        zoomIn.disabled = zoom >= IMAGE_VIEWER_MAX_ZOOM
        reset.disabled = zoom === IMAGE_VIEWER_MIN_ZOOM
    }

    const updateFit = () => {
        fit = calculateImageViewerFit(
            naturalWidth,
            naturalHeight,
            viewport.clientWidth,
            viewport.clientHeight,
            viewport.clientWidth <= 640 ? 16 : 32
        )
        render()
    }

    const setZoom = (next: number) => {
        const previous = zoom
        const resolved = clampImageViewerZoom(next)
        if (resolved === previous) return
        const centerX = viewport.scrollLeft + viewport.clientWidth / 2
        const centerY = viewport.scrollTop + viewport.clientHeight / 2
        zoom = resolved
        render()
        const ratio = resolved / previous
        viewport.scrollLeft = centerX * ratio - viewport.clientWidth / 2
        viewport.scrollTop = centerY * ratio - viewport.clientHeight / 2
    }

    const close = () => dialog.close()
    const stopImageLoading = bindStaticImageLoadFrames(dialog)
    dialog.addEventListener(
        'close',
        () => {
            stopImageLoading()
            dialog.remove()
        },
        { once: true }
    )
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault()
        close()
    })
    dialog.addEventListener('click', (event) => {
        const action = (event.target as Element | null)?.closest<HTMLElement>('[data-viewer-action]')?.dataset
            .viewerAction
        if (action === 'out') setZoom(zoom - IMAGE_VIEWER_ZOOM_STEP)
        else if (action === 'in') setZoom(zoom + IMAGE_VIEWER_ZOOM_STEP)
        else if (action === 'reset') setZoom(IMAGE_VIEWER_MIN_ZOOM)
        else if (
            action === 'close' ||
            (event.target as Element | null)?.classList.contains('article-image-viewer__canvas')
        )
            close()
    })
    viewport.addEventListener(
        'wheel',
        (event) => {
            if (!event.ctrlKey && !event.metaKey) return
            event.preventDefault()
            setZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25))
        },
        { passive: false }
    )
    image.addEventListener('load', () => {
        naturalWidth = image.naturalWidth
        naturalHeight = image.naturalHeight
        updateFit()
    })
    image.addEventListener('dblclick', () => setZoom(zoom === 1 ? 2 : 1))
    window.addEventListener('resize', updateFit, { signal: closeSignal(dialog) })
    dialog.showModal()
    updateFit()
}

function closeSignal(dialog: HTMLDialogElement) {
    const controller = new AbortController()
    dialog.addEventListener('close', () => controller.abort(), { once: true })
    return controller.signal
}

function escapeAttribute(value: string) {
    return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}
