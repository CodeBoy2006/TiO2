import { createTranslator, resolveLanguage } from '../../../packages/config/src/i18n.js'

declare global {
    var __TIO2_LANGUAGE__: string | undefined
}

export const language = resolveLanguage(globalThis.__TIO2_LANGUAGE__ ?? 'en')
export const t = createTranslator(language)
