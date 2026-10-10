import type { AigcModelKey } from './types'

export interface AigcModelMeta {
    key: AigcModelKey
    label: string
    vendor: string
    icon: string
    /** The mark has no brand colour of its own and is drawn in the theme's title ink. */
    monochrome: boolean
}

export const AIGC_MODELS: Record<AigcModelKey, AigcModelMeta> = {
    openai: { key: 'openai', label: 'OpenAI', vendor: 'OpenAI', icon: '/ai-icons/openai.svg', monochrome: true },
    claude: {
        key: 'claude',
        label: 'Claude',
        vendor: 'Anthropic',
        icon: '/ai-icons/claude-color.svg',
        monochrome: false
    },
    gemini: { key: 'gemini', label: 'Gemini', vendor: 'Google', icon: '/ai-icons/gemini-color.svg', monochrome: false }
}
