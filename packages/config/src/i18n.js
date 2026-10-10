/** Framework UI supports Chinese and English; other content languages use English UI. */
export function resolveLanguage(language) {
    return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en'
}

export function createTranslator(language) {
    const chinese = resolveLanguage(language) === 'zh-CN'
    return (zh, en) => (chinese ? zh : en)
}
