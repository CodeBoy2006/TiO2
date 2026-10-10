import { createTranslator, resolveLanguage } from '../../packages/config/src/i18n.js'

export function uiLanguage() {
    return resolveLanguage(document.documentElement.dataset.uiLanguage || document.documentElement.lang)
}

export function t(zh: string, en: string) {
    return createTranslator(uiLanguage())(zh, en)
}
