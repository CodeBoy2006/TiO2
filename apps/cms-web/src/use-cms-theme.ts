import { t } from './i18n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
    cmsThemeStorageKey,
    normalizeThemeMode,
    resolveEffectiveTheme,
    type CmsEffectiveTheme,
    type CmsThemeMode
} from './theme-mode'

export function useCmsTheme() {
    const themeMode = ref<CmsThemeMode>('system')
    const systemPrefersDark = ref(false)
    const effectiveTheme = computed(() => resolveEffectiveTheme(themeMode.value, systemPrefersDark.value))
    const effectiveThemeLabel = computed(() =>
        effectiveTheme.value === 'dark' ? t('深色模式', 'Dark mode') : t('浅色模式', 'Light mode')
    )

    let mediaQuery: MediaQueryList | null = null
    let removeThemeListener: (() => void) | null = null

    function applyTheme(theme: CmsEffectiveTheme) {
        if (typeof document === 'undefined') return

        document.documentElement.classList.toggle('dark', theme === 'dark')
        document.documentElement.style.colorScheme = theme
    }

    function setupThemeMode() {
        if (typeof window === 'undefined') return

        let storedThemeMode: string | null = null
        try {
            storedThemeMode = window.localStorage.getItem(cmsThemeStorageKey)
        } catch {
            storedThemeMode = null
        }

        themeMode.value = normalizeThemeMode(storedThemeMode)
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        systemPrefersDark.value = mediaQuery.matches

        const handleChange = (event: MediaQueryListEvent) => {
            systemPrefersDark.value = event.matches
        }

        mediaQuery.addEventListener('change', handleChange)
        removeThemeListener = () => mediaQuery?.removeEventListener('change', handleChange)
    }

    watch(themeMode, (value) => {
        if (typeof window === 'undefined') return

        try {
            window.localStorage.setItem(cmsThemeStorageKey, value)
        } catch {
            // Theme selection still applies when storage is unavailable.
        }
    })

    watch(effectiveTheme, applyTheme, { immediate: true })

    onMounted(setupThemeMode)
    onBeforeUnmount(() => {
        removeThemeListener?.()
    })

    return {
        effectiveTheme,
        effectiveThemeLabel,
        themeMode
    }
}
