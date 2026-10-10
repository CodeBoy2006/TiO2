import type {
    CmsImageAsset,
    CmsDocumentCreateInput,
    CmsDocumentDeleteResult,
    CmsDocumentDetail,
    CmsDocumentMoveInput,
    CmsPreviewOriginResolution,
    CmsDocumentUpdateInput,
    CmsLibrarySnapshot
} from './types'

async function requestJson<T>(input: string, init?: RequestInit) {
    const response = await fetch(input, init)
    if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message =
            payload && typeof payload === 'object' && 'message' in payload
                ? String(payload.message)
                : response.statusText
        throw new Error(message)
    }

    return (await response.json()) as T
}

export function fetchImages(sourcePath: string) {
    return requestJson<CmsImageAsset[]>(`/api/assets?${new URLSearchParams({ sourcePath })}`)
}

export function uploadImage(file: File) {
    return requestJson<CmsImageAsset>(`/api/assets/upload?${new URLSearchParams({ fileName: file.name })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
    })
}

export function preparePublicImage(sourcePath: string) {
    return requestJson<CmsImageAsset>('/api/assets/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath })
    })
}

export function fetchLibrarySnapshot() {
    return requestJson<CmsLibrarySnapshot>('/api/library')
}

export function fetchPreviewOrigin() {
    return requestJson<CmsPreviewOriginResolution>('/api/preview-origin')
}

export function fetchDocumentDetail(sourcePath: string) {
    const params = new URLSearchParams({
        sourcePath
    })
    return requestJson<CmsDocumentDetail>(`/api/document?${params.toString()}`)
}

export function createDocument(input: CmsDocumentCreateInput) {
    return requestJson<CmsDocumentDetail>('/api/document', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
    })
}

export function saveDocument(input: CmsDocumentUpdateInput) {
    return requestJson<CmsDocumentDetail>('/api/document', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
    })
}

export function moveDocument(input: CmsDocumentMoveInput) {
    return requestJson<CmsDocumentDetail>('/api/document', {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
    })
}

export function deleteDocument(sourcePath: string, removeAssetDirectory = false) {
    const params = new URLSearchParams({
        sourcePath,
        removeAssetDirectory: String(removeAssetDirectory)
    })
    return requestJson<CmsDocumentDeleteResult>(`/api/document?${params.toString()}`, {
        method: 'DELETE'
    })
}
