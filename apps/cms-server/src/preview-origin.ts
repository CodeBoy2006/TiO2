import { cmsPreviewProbeMarker, cmsPreviewProbePath } from '../../../packages/content-core/src/index'
import type { CmsPreviewOriginResolution } from '../../../packages/cms-contract/src/index'

const defaultPreviewPort = 5000
const defaultPreviewHost = '127.0.0.1'
const defaultProbeWindow = 10
const previewProbeTimeoutMs = 500

interface ResolveCmsPreviewOriginOptions {
    env?: NodeJS.ProcessEnv
    probeOrigin?: (origin: string) => Promise<boolean>
}

export async function resolveCmsPreviewOrigin(
    options: ResolveCmsPreviewOriginOptions = {}
): Promise<CmsPreviewOriginResolution> {
    const env = options.env ?? process.env
    const explicitOrigin = normalizeOrigin(env.CMS_PREVIEW_ORIGIN)

    if (explicitOrigin) {
        return {
            origin: explicitOrigin,
            resolved: true
        }
    }

    const preferredPort = parsePort(env.SITE_DEV_PORT, defaultPreviewPort)
    const probeOrigin = options.probeOrigin ?? isReachableCmsPreviewOrigin

    for (const origin of collectCandidateOrigins(preferredPort, env.CMS_PREVIEW_PORT_SCAN_WINDOW)) {
        if (await probeOrigin(origin)) {
            return {
                origin,
                resolved: true
            }
        }
    }

    return {
        origin: buildPreviewOrigin(preferredPort),
        resolved: false
    }
}

function collectCandidateOrigins(preferredPort: number, probeWindowRaw: string | undefined) {
    const probeWindow = parsePort(probeWindowRaw, defaultProbeWindow)
    return Array.from({ length: probeWindow + 1 }, (_, offset) => buildPreviewOrigin(preferredPort + offset))
}

function buildPreviewOrigin(port: number) {
    return `http://${defaultPreviewHost}:${port}`
}

function normalizeOrigin(origin: string | undefined) {
    const value = origin?.trim()
    return value ? value.replace(/\/$/, '') : ''
}

function parsePort(raw: string | undefined, fallback: number) {
    const parsed = Number(raw)
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback
}

async function isReachableCmsPreviewOrigin(origin: string) {
    try {
        const response = await fetch(`${origin}${cmsPreviewProbePath}`, {
            headers: {
                Accept: 'application/json'
            },
            signal: AbortSignal.timeout(previewProbeTimeoutMs)
        })

        if (!response.ok) {
            return false
        }

        const payload = (await response.json().catch(() => null)) as { marker?: string } | null
        return payload?.marker === cmsPreviewProbeMarker
    } catch {
        return false
    }
}
