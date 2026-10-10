import assert from 'node:assert/strict'
import test from 'node:test'
import {
    cmsPreviewContentOnlyMode,
    cmsPreviewModeParam,
    isContentOnlyCmsPreview,
    resolveCmsPreviewMode
} from '../../packages/content-core/src/index.js'

test('TiO2 CMS preview helpers resolve the supported content-only mode from search params', () => {
    assert.equal(
        resolveCmsPreviewMode(`?${cmsPreviewModeParam}=${cmsPreviewContentOnlyMode}`),
        cmsPreviewContentOnlyMode
    )
    assert.equal(
        resolveCmsPreviewMode(new URLSearchParams(`${cmsPreviewModeParam}=${cmsPreviewContentOnlyMode}`)),
        cmsPreviewContentOnlyMode
    )
    assert.equal(isContentOnlyCmsPreview(`?${cmsPreviewModeParam}=${cmsPreviewContentOnlyMode}`), true)
})

test('TiO2 CMS preview helpers ignore unknown or missing modes', () => {
    assert.equal(resolveCmsPreviewMode('?foo=bar'), '')
    assert.equal(resolveCmsPreviewMode(`?${cmsPreviewModeParam}=full-site`), '')
    assert.equal(isContentOnlyCmsPreview('?foo=bar'), false)
    assert.equal(isContentOnlyCmsPreview(undefined), false)
})
