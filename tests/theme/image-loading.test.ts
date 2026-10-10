import assert from 'node:assert/strict'
import test from 'node:test'
import {
    bindImageLoadState,
    getCompletedImageLoadState,
    syncThemeImage,
    syncThemeImages,
    type ImageLoadState,
    type ImageLoadStateRuntime
} from '../../site/client/image-loading.js'

test('TiO2 themed images follow the explicit site theme independently of OS preference', () => {
    const image = {
        dataset: { lightSrc: '/light.svg', darkSrc: '/dark.svg' },
        getAttribute: () => '/light.svg',
        src: '/light.svg'
    }

    syncThemeImage(image, true)
    assert.equal(image.src, '/dark.svg')
    image.getAttribute = () => '/dark.svg'
    syncThemeImage(image, false)
    assert.equal(image.src, '/light.svg')

    const root = { querySelectorAll: () => [image] }
    image.getAttribute = () => '/light.svg'
    syncThemeImages(root as unknown as ParentNode, true)
    assert.equal(image.src, '/dark.svg')
})

class FakeImage {
    complete = false
    loading: 'eager' | 'lazy' = 'lazy'
    naturalWidth = 0
    private readonly listeners = new Map<string, Set<() => void>>()

    addEventListener(type: string, listener: () => void) {
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
    }

    removeEventListener(type: string, listener: () => void) {
        this.listeners.get(type)?.delete(listener)
    }

    dispatch(type: string) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener()
        }
    }
}

function createImageLoadRuntime() {
    let visibilityCallback: ((visible: boolean) => void) | null = null
    let nextFrame = 1
    let requestedLoadCount = 0
    const frames = new Map<number, () => void>()

    const runtime: ImageLoadStateRuntime = {
        cancelFrame(frame) {
            frames.delete(frame)
        },
        observeVisibility(_image, onVisibilityChange) {
            visibilityCallback = onVisibilityChange
            return () => {
                visibilityCallback = null
            }
        },
        requestLoad(image) {
            requestedLoadCount += 1
            image.loading = 'eager'
        },
        requestFrame(callback) {
            const frame = nextFrame
            nextFrame += 1
            frames.set(frame, callback)
            return frame
        }
    }

    return {
        runtime,
        flushFrame() {
            const pendingFrames = Array.from(frames.values())
            frames.clear()
            for (const callback of pendingFrames) callback()
        },
        setVisible(visible: boolean) {
            visibilityCallback?.(visible)
        },
        scheduledFrameCount() {
            return frames.size
        },
        requestedLoadCount() {
            return requestedLoadCount
        }
    }
}

test('TiO2 image loading state waits for incomplete media', () => {
    assert.equal(
        getCompletedImageLoadState({
            complete: false,
            naturalWidth: 0
        }),
        null
    )
})

test('TiO2 image loading state distinguishes cached success from failure', () => {
    assert.equal(
        getCompletedImageLoadState({
            complete: true,
            naturalWidth: 1200
        }),
        'loaded'
    )
    assert.equal(
        getCompletedImageLoadState({
            complete: true,
            naturalWidth: 0
        }),
        'error'
    )
})

test('TiO2 image loading state reconciles a completed visible image when the native load event is missed', () => {
    const image = new FakeImage()
    const runtime = createImageLoadRuntime()
    const states: ImageLoadState[] = []
    const unbind = bindImageLoadState(
        image as unknown as HTMLImageElement,
        (state) => states.push(state),
        runtime.runtime
    )

    assert.deepEqual(states, ['loading'])

    runtime.setVisible(true)
    assert.equal(runtime.scheduledFrameCount(), 1)

    image.complete = true
    image.naturalWidth = 1200
    runtime.flushFrame()

    assert.deepEqual(states, ['loading', 'loaded'])
    assert.equal(runtime.scheduledFrameCount(), 0)

    unbind()
    image.dispatch('error')
    assert.deepEqual(states, ['loading', 'loaded'])
})

test('TiO2 image loading state still settles immediately from native events', () => {
    const image = new FakeImage()
    const runtime = createImageLoadRuntime()
    const states: ImageLoadState[] = []
    const unbind = bindImageLoadState(
        image as unknown as HTMLImageElement,
        (state) => states.push(state),
        runtime.runtime
    )

    image.dispatch('load')

    assert.deepEqual(states, ['loading', 'loaded'])
    assert.equal(runtime.scheduledFrameCount(), 0)
    unbind()
})

test('TiO2 image loading state only reconciles continuously near the viewport', () => {
    const image = new FakeImage()
    const runtime = createImageLoadRuntime()
    const unbind = bindImageLoadState(image as unknown as HTMLImageElement, () => {}, runtime.runtime)

    runtime.setVisible(false)
    assert.equal(runtime.scheduledFrameCount(), 0)
    assert.equal(runtime.requestedLoadCount(), 0)
    assert.equal(image.loading, 'lazy')

    runtime.setVisible(true)
    assert.equal(runtime.scheduledFrameCount(), 1)
    assert.equal(runtime.requestedLoadCount(), 1)
    assert.equal(image.loading, 'eager')

    runtime.setVisible(false)
    assert.equal(runtime.scheduledFrameCount(), 0)
    unbind()
})
