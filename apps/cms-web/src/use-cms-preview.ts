import { t } from './i18n'
import { computed, ref, type Ref } from 'vue'
import { fetchPreviewOrigin } from './api'
import { buildEmbeddedPreviewHref, buildPreviewHref, cmsPreviewOrigin } from './preview-link'
import type { CmsDocumentDetail } from './types'

export function useCmsPreview(currentDocument: Ref<CmsDocumentDetail | null>) {
    const previewReloadToken = ref(0)
    const previewOrigin = ref('')
    const previewOriginChecked = ref(false)
    const previewOriginResolved = ref(false)

    const effectivePreviewOrigin = computed(() => previewOrigin.value || cmsPreviewOrigin)
    const currentPreviewHref = computed(() =>
        previewOriginChecked.value
            ? buildPreviewHref(currentDocument.value, effectivePreviewOrigin.value)
            : 'about:blank'
    )
    const currentPreviewFrameHref = computed(() =>
        previewOriginChecked.value
            ? buildEmbeddedPreviewHref(currentDocument.value, previewReloadToken.value, effectivePreviewOrigin.value)
            : 'about:blank'
    )
    const previewStatusText = computed(() => {
        if (!previewOriginChecked.value) {
            return t('探测预览端口中…', 'Checking preview ports…')
        }

        if (!previewOriginResolved.value) {
            return `${t('未发现运行中的预览服务，当前回退到 ', 'No preview service found; using ')}${effectivePreviewOrigin.value}`
        }

        return t('预览服务可用', 'Preview service available')
    })

    async function syncPreviewOrigin() {
        try {
            const nextPreviewOrigin = await fetchPreviewOrigin()
            previewOrigin.value = nextPreviewOrigin.origin
            previewOriginResolved.value = nextPreviewOrigin.resolved
        } catch {
            previewOrigin.value = cmsPreviewOrigin
            previewOriginResolved.value = false
        } finally {
            previewOriginChecked.value = true
        }
    }

    async function refreshPreview() {
        await syncPreviewOrigin()
        previewReloadToken.value += 1
    }

    return {
        effectivePreviewOrigin,
        currentPreviewFrameHref,
        currentPreviewHref,
        previewStatusText,
        refreshPreview,
        syncPreviewOrigin
    }
}
