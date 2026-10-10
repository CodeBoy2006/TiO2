import type { CmsDocumentDetail } from './types'
import { cmsPreviewContentOnlyMode, cmsPreviewModeParam } from '../../../packages/content-core/src/cms-preview'
import { encodeRoutePathSegments } from '../../../packages/content-core/src/route-utils'

const previewOriginFromRuntime = (globalThis as { __CMS_PREVIEW_ORIGIN__?: string }).__CMS_PREVIEW_ORIGIN__

function resolveDefaultPreviewOrigin() {
    if (previewOriginFromRuntime) {
        return previewOriginFromRuntime
    }

    if (typeof window !== 'undefined') {
        return `${window.location.protocol}//${window.location.hostname}:5000`
    }

    return 'http://127.0.0.1:5000'
}

export const cmsPreviewOrigin = resolveDefaultPreviewOrigin()
export const cmsPreviewRefreshParam = '__tio2_cms_preview'
export { cmsPreviewContentOnlyMode, cmsPreviewModeParam }

type PreviewableDocument = Pick<CmsDocumentDetail, 'kind' | 'sourcePath'> | null | undefined

export function buildPreviewHref(document: PreviewableDocument, origin = cmsPreviewOrigin) {
    const normalizedOrigin = origin.replace(/\/$/, '')

    if (!document || document.kind === 'topicMeta') {
        return normalizedOrigin
    }

    const routePath = document.sourcePath
        .replace(/\\/g, '/')
        .replace(/\.md$/u, '')
    const encodedRoutePath = encodeRoutePathSegments(routePath)

    return encodedRoutePath ? `${normalizedOrigin}/${encodedRoutePath}` : normalizedOrigin
}

export function buildEmbeddedPreviewHref(
    document: PreviewableDocument,
    refreshToken: string | number,
    origin = cmsPreviewOrigin
) {
    const previewHref = buildPreviewHref(document, origin)
    const previewUrl = new URL(previewHref)

    previewUrl.searchParams.set(cmsPreviewRefreshParam, String(refreshToken))
    previewUrl.searchParams.set(cmsPreviewModeParam, cmsPreviewContentOnlyMode)
    return previewUrl.toString()
}
