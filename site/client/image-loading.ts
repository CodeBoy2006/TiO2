export type ImageLoadState = 'loading' | 'loaded' | 'error'

interface CompleteImageState {
    complete: boolean
    naturalWidth: number
}

export interface ImageLoadStateRuntime {
    cancelFrame(frame: number): void
    observeVisibility(image: HTMLImageElement, onVisibilityChange: (visible: boolean) => void): () => void
    requestLoad(image: HTMLImageElement): void
    requestFrame(callback: () => void): number
}

interface ThemeImage {
    dataset: DOMStringMap
    getAttribute(name: string): string | null
    src: string
}

export function syncThemeImage(image: ThemeImage, dark: boolean) {
    const src = dark ? image.dataset.darkSrc : image.dataset.lightSrc
    if (src && image.getAttribute('src') !== src) image.src = src
}

export function syncThemeImages(root: ParentNode, dark: boolean) {
    root.querySelectorAll<HTMLImageElement>('img[data-light-src][data-dark-src]').forEach((image) => {
        syncThemeImage(image, dark)
    })
}

const browserImageLoadStateRuntime: ImageLoadStateRuntime = {
    cancelFrame(frame) {
        window.cancelAnimationFrame(frame)
    },
    observeVisibility(image, onVisibilityChange) {
        if (typeof IntersectionObserver === 'undefined') {
            onVisibilityChange(true)
            return () => {}
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries.find((candidate) => candidate.target === image)
                if (entry) {
                    onVisibilityChange(entry.isIntersecting || entry.intersectionRatio > 0)
                }
            },
            {
                rootMargin: '256px 0px'
            }
        )

        observer.observe(image)
        return () => observer.disconnect()
    },
    requestLoad(image) {
        image.loading = 'eager'
    },
    requestFrame(callback) {
        return window.requestAnimationFrame(callback)
    }
}

export function getCompletedImageLoadState(image: CompleteImageState): Exclude<ImageLoadState, 'loading'> | null {
    if (!image.complete) return null
    return image.naturalWidth > 0 ? 'loaded' : 'error'
}

export function bindImageLoadState(
    image: HTMLImageElement,
    onStateChange: (state: ImageLoadState) => void,
    runtime: ImageLoadStateRuntime = browserImageLoadStateRuntime
) {
    let active = true
    let currentState: ImageLoadState | null = null
    let frame: number | null = null
    let visible = false
    let stopObservingVisibility = () => {}

    const cancelReconciliation = () => {
        if (frame === null) return
        runtime.cancelFrame(frame)
        frame = null
    }

    const stopVisibilityTracking = () => {
        stopObservingVisibility()
        stopObservingVisibility = () => {}
    }

    const setState = (state: ImageLoadState) => {
        if (!active || currentState === state) return

        currentState = state
        onStateChange(state)

        if (state !== 'loading') {
            cancelReconciliation()
            stopVisibilityTracking()
        }
    }

    const reconcile = () => {
        const completedState = getCompletedImageLoadState(image)
        if (completedState) {
            setState(completedState)
        }
    }

    // Native lazy loading can stall after large scroll jumps. Promote only near-viewport media, then reconcile missed events.
    const scheduleReconciliation = () => {
        if (!active || !visible || currentState !== 'loading' || frame !== null) return

        frame = runtime.requestFrame(() => {
            frame = null
            reconcile()
            scheduleReconciliation()
        })
    }

    const handleLoad = () => setState('loaded')
    const handleError = () => setState('error')

    image.addEventListener('load', handleLoad)
    image.addEventListener('error', handleError)
    setState(getCompletedImageLoadState(image) ?? 'loading')

    if (currentState === 'loading') {
        stopObservingVisibility = runtime.observeVisibility(image, (isVisible) => {
            visible = isVisible
            cancelReconciliation()
            if (isVisible) {
                runtime.requestLoad(image)
            }
            reconcile()
            scheduleReconciliation()
        })

        if (currentState !== 'loading') {
            stopVisibilityTracking()
        }
    }

    return () => {
        active = false
        cancelReconciliation()
        stopVisibilityTracking()
        image.removeEventListener('load', handleLoad)
        image.removeEventListener('error', handleError)
    }
}

export function bindStaticImageLoadFrames(root: ParentNode) {
    const cleanups: Array<() => void> = []
    const frames = Array.from(root.querySelectorAll('[data-image-load-frame]')) as HTMLElement[]

    for (const frame of frames) {
        const image = frame.querySelector('[data-image-load-media]') as HTMLImageElement | null
        if (!image) continue

        const setState = (state: ImageLoadState) => {
            frame.classList.remove('image-load-frame--loading', 'image-load-frame--loaded', 'image-load-frame--error')
            frame.classList.add(`image-load-frame--${state}`)
            frame.dataset.imageState = state

            if (state === 'loading') {
                frame.setAttribute('aria-busy', 'true')
            } else {
                frame.removeAttribute('aria-busy')
            }

            const error = frame.querySelector('.image-load-frame__error') as HTMLElement | null
            if (error) {
                error.hidden = state !== 'error'
            }
        }

        cleanups.push(bindImageLoadState(image, setState))
    }

    return () => {
        for (const cleanup of cleanups) cleanup()
    }
}
