import assert from 'node:assert/strict'
import test from 'node:test'
import {
    calculateImageViewerFit,
    clampImageViewerZoom,
    IMAGE_VIEWER_MAX_ZOOM,
    IMAGE_VIEWER_MIN_ZOOM
} from '../../site/client/image-viewer.js'

test('TiO2 image viewer fits large media without enlarging small images', () => {
    assert.equal(calculateImageViewerFit(1600, 1200, 1000, 800, 32), 0.585)
    assert.equal(calculateImageViewerFit(320, 200, 1000, 800, 32), 1)
    assert.equal(calculateImageViewerFit(0, 200, 1000, 800, 32), 1)
})

test('TiO2 image viewer clamps zoom to the supported interaction range', () => {
    assert.equal(clampImageViewerZoom(0.25), IMAGE_VIEWER_MIN_ZOOM)
    assert.equal(clampImageViewerZoom(2.5), 2.5)
    assert.equal(clampImageViewerZoom(8), IMAGE_VIEWER_MAX_ZOOM)
})
