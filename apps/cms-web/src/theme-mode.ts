export type CmsThemeMode = 'system' | 'light' | 'dark'
export type CmsEffectiveTheme = 'light' | 'dark'

export const cmsThemeStorageKey = 'tio2-cms-theme-mode'

export function normalizeThemeMode(value: unknown): CmsThemeMode {
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function resolveEffectiveTheme(mode: CmsThemeMode, prefersDark: boolean): CmsEffectiveTheme {
    if (mode === 'system') {
        return prefersDark ? 'dark' : 'light'
    }

    return mode
}
