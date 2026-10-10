export type Translator = (zh: string, en: string) => string
export function resolveLanguage(language: string): 'zh-CN' | 'en'
export function createTranslator(language: string): Translator
