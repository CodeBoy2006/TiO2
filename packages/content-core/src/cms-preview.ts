export const cmsPreviewModeParam = '__tio2_cms_mode'
export const cmsPreviewContentOnlyMode = 'content-only'
export const cmsPreviewProbePath = '/__tio2/cms-preview-probe'
export const cmsPreviewProbeMarker = 'tio2-cms-preview'

export function resolveCmsPreviewMode(search: string | URLSearchParams | null | undefined) {
    const params = typeof search === 'string' ? new URLSearchParams(search) : search
    const mode = params?.get(cmsPreviewModeParam)?.trim() ?? ''

    return mode === cmsPreviewContentOnlyMode ? cmsPreviewContentOnlyMode : ''
}

export function isContentOnlyCmsPreview(search: string | URLSearchParams | null | undefined) {
    return resolveCmsPreviewMode(search) === cmsPreviewContentOnlyMode
}
