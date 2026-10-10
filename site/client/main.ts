import { t, uiLanguage } from './i18n'
import { inject } from '@vercel/analytics'
import { bindStaticImageLoadFrames, syncThemeImages } from './image-loading'
import { copyMathAsTex } from './math-copy'
import { bindNavigationPrefetch } from './navigation-prefetch'
import { bindFoundationSearch } from './foundation-search'
import { bindFoundationRouteContext } from './foundation-route-context'
declare const __TIO2_ANALYTICS__: boolean
import '@fontsource-variable/noto-serif-sc/wght.css'
import './theme.css'
import '../../packages/ui-theme/src/tokens.css'
import './pages.css'
import './foundation-atlas.css'
import './foundation-library.css'

const appearanceKey = 'vitepress-theme-appearance'
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const openSearch = () => void import('./search').then(({ openSearch }) => openSearch())

bindAppearance()
bindMobileNavigation()
bindDisclosures()
bindTreeDisclosures()
bindFoundationSearch()
bindFoundationRoutes()
bindFoundationAnchors()
bindFoundationRouteContext(document, window, syncFoundationRouteBar)
bindTagFilters()
bindIndexFilter()
bindComments()
bindNavigationPrefetch()
bindStaticImageLoadFrames(document)
document.addEventListener('copy', copyMathAsTex)

if (document.querySelector('[data-article-layout]')) {
    void import('./article-reading').then(({ bindArticleReading }) => bindArticleReading())
}

const foundationGraph = document.querySelector('[data-foundation-graph]')
if (foundationGraph) {
    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return
            observer.disconnect()
            void import('./foundation-graph')
                .then(({ bindFoundationGraph }) => bindFoundationGraph())
                .catch(() => {
                    const status = foundationGraph.querySelector('[data-foundation-graph-status]')
                    if (status)
                        status.textContent = t(
                            '交互图谱载入失败，请使用下方文字版关系。',
                            'The graph failed to load. Use the text relationships below.'
                        )
                })
        },
        { rootMargin: '300px' }
    )
    observer.observe(foundationGraph)
}

if (document.querySelector('[data-foundation-atlas]')) {
    void import('./foundation-atlas').then(({ bindFoundationAtlas }) => bindFoundationAtlas())
}

if (document.querySelector('[data-foundation-dial]')) {
    void import('./foundation-dial').then(({ bindFoundationDial }) => bindFoundationDial())
}

if (document.querySelector('[data-foundation-life]')) {
    void import('./foundation-life').then(({ bindFoundationLife }) => bindFoundationLife())
}

if (document.querySelector('[data-encrypted-content]')) {
    void import('./encryption').then(({ bindEncryptedContent }) => bindEncryptedContent())
}

if (document.querySelector('[data-ledger-verify]')) {
    void import('./ledger').then(({ bindLedger }) => bindLedger())
}

document.addEventListener('click', (event) => {
    const target = event.target as Element | null
    const imageTrigger = target?.closest<HTMLButtonElement>('[data-article-image-viewer]')
    if (imageTrigger) {
        void import('./image-viewer').then(({ openImageViewer }) => openImageViewer(imageTrigger))
        return
    }

    if (target?.closest('.DocSearch-Button')) {
        openSearch()
    }
})

document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openSearch()
    }
})

if (__TIO2_ANALYTICS__) inject()

function bindAppearance() {
    const applyAppearance = () => {
        const preference = localStorage.getItem(appearanceKey) || 'auto'
        const dark = preference === 'dark' || (preference === 'auto' && darkQuery.matches)
        document.documentElement.classList.toggle('dark', dark)
        syncThemeImages(document, dark)
        document.querySelectorAll<HTMLButtonElement>('.VPSwitchAppearance').forEach((button) => {
            button.setAttribute('aria-checked', String(dark))
            button.title = dark ? t('切换浅色主题', 'Switch to light theme') : t('切换深色主题', 'Switch to dark theme')
        })
        document.dispatchEvent(new CustomEvent('tio2:theme'))
    }

    document.querySelectorAll<HTMLButtonElement>('.VPSwitchAppearance').forEach((button) => {
        button.addEventListener('click', () => {
            localStorage.setItem(appearanceKey, document.documentElement.classList.contains('dark') ? 'light' : 'dark')
            applyAppearance()
        })
    })
    darkQuery.addEventListener('change', applyAppearance)
    applyAppearance()
}

function bindMobileNavigation() {
    const button = document.querySelector<HTMLButtonElement>('.VPNavBarHamburger')
    const screen = document.querySelector<HTMLElement>('#VPNavScreen')
    if (!button || !screen) return

    const setOpen = (open: boolean) => {
        button.classList.toggle('active', open)
        button.setAttribute('aria-expanded', String(open))
        screen.hidden = !open
        document.body.style.overflow = open ? 'hidden' : ''
    }

    button.addEventListener('click', () => setOpen(screen.hidden))
    screen.addEventListener('click', (event) => {
        if ((event.target as Element | null)?.closest('a')) setOpen(false)
    })
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !screen.hidden) {
            setOpen(false)
            button.focus()
        }
    })
    window.addEventListener('resize', () => {
        if (!button.getClientRects().length) setOpen(false)
    })
}

function bindDisclosures() {
    document.querySelectorAll<HTMLElement>('.backlinks-panel').forEach((panel) => {
        const button = panel.querySelector<HTMLButtonElement>('.backlinks-panel__header')
        const content = button?.getAttribute('aria-controls')
            ? document.getElementById(button.getAttribute('aria-controls')!)
            : null
        if (!button || !content) return

        button.addEventListener('click', () => {
            const open = button.getAttribute('aria-expanded') !== 'true'
            button.setAttribute('aria-expanded', String(open))
            panel.dataset.open = String(open)
            content.hidden = !open
            content.style.display = open ? '' : 'none'
        })
    })

    document.querySelectorAll<HTMLElement>('.fold-block').forEach((fold) => {
        const button = fold.querySelector<HTMLButtonElement>('.fold-block__toggle')
        const body = fold.querySelector<HTMLElement>('.fold-block__body')
        const inner = fold.querySelector<HTMLElement>('.fold-block__body-inner')
        const fade = fold.querySelector<HTMLElement>('.fold-block__fade')
        if (!button || !body || !inner) return

        const collapsedHeight = fold.dataset.collapsedHeight ?? ''
        const setOpen = (open: boolean) => {
            button.setAttribute('aria-expanded', String(open))
            button.setAttribute(
                'aria-label',
                open
                    ? (fold.dataset.collapseText ?? t('收起', 'Collapse'))
                    : (fold.dataset.expandText ?? t('展开', 'Expand'))
            )
            fold.classList.toggle('is-expanded', open)
            fold.dataset.expanded = String(open)
            body.style.maxHeight = open ? 'none' : collapsedHeight
            if (fade) fade.hidden = open
        }

        requestAnimationFrame(() => {
            if (fold.dataset.mode === 'partial' && inner.scrollHeight <= body.clientHeight + 6) {
                fold.classList.remove('is-collapsible')
                fold.dataset.collapsible = 'false'
                button.hidden = true
                body.style.maxHeight = 'none'
                if (fade) fade.hidden = true
            }
        })
        button.addEventListener('click', () => {
            setOpen(button.getAttribute('aria-expanded') !== 'true')
        })
    })
}

function bindTreeDisclosures() {
    bindTree('.topic-node', '.topic-node__summary', '.topic-node__content', 280)
    bindTree('.ledger-node', '.ledger-node__summary', '.ledger-node__children', 240)
}

function bindTree(rootSelector: string, buttonSelector: string, contentSelector: string, duration: number) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.querySelectorAll<HTMLElement>(rootSelector).forEach((root) => {
        const button = root.querySelector<HTMLButtonElement>(`:scope > ${buttonSelector}`)
        const content = root.querySelector<HTMLElement>(`:scope > ${contentSelector}`)
        if (!button || !content) return

        button.addEventListener('click', () => {
            const open = button.getAttribute('aria-expanded') !== 'true'
            button.setAttribute('aria-expanded', String(open))
            root.dataset.open = String(open)
            content.getAnimations().forEach((animation) => animation.cancel())
            if (open) content.hidden = false
            if (reduceMotion) {
                content.hidden = !open
                return
            }

            const height = content.scrollHeight
            const animation = content.animate(
                open
                    ? [
                          { height: '0px', opacity: 0 },
                          { height: `${height}px`, opacity: 1 }
                      ]
                    : [
                          { height: `${height}px`, opacity: 1 },
                          { height: '0px', opacity: 0 }
                      ],
                { duration, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }
            )
            void animation.finished
                .then(() => {
                    if (!open && button.getAttribute('aria-expanded') === 'false') content.hidden = true
                })
                .catch(() => {})
        })
    })
}

/** The route switch narrows the list by kind; featured routes keep the remaining routes folded away. */
function bindFoundationRoutes() {
    const filters = document.querySelector<HTMLElement>('[data-route-filters]')
    const section = filters?.closest<HTMLElement>('.foundation-routes')
    if (!filters || !section) return

    const routes = Array.from(section.querySelectorAll<HTMLElement>('.foundation-route'))
    const more = section.querySelector<HTMLDetailsElement>('.foundation-routes__more')
    const buttons = Array.from(filters.querySelectorAll<HTMLButtonElement>('[data-route-filter]'))
    if (!buttons.length) return
    const apply = (filter: string) => {
        buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.routeFilter === filter)))
        routes.forEach((route) => {
            route.hidden = filter !== 'featured' && filter !== 'all' && route.dataset.routeType !== filter
        })
        section.dataset.routeFilter = filter
        if (more) more.open = filter !== 'featured'
    }

    const restore = () => {
        const requested = new URLSearchParams(location.search).get('level')
        apply(buttons.some((button) => button.dataset.routeFilter === requested) ? requested! : 'all')
    }
    filters.hidden = false
    buttons.forEach((button) =>
        button.addEventListener('click', () => {
            const filter = button.dataset.routeFilter ?? 'all'
            apply(filter)
            const url = new URL(location.href)
            if (filter === 'all') url.searchParams.delete('level')
            else url.searchParams.set('level', filter)
            url.hash = ''
            history.replaceState(null, '', url)
        })
    )
    window.addEventListener('popstate', restore)
    restore()
}

/** Mirrors the chosen route above the title, so the next stop is at hand before and after reading. */
function syncFoundationRouteBar(panel: HTMLElement | null) {
    const bar = document.querySelector<HTMLElement>('[data-foundation-route-bar]')
    if (!bar) return
    bar.hidden = !panel
    if (!panel) return

    const copy = (target: Element | null, source: Element | null, skip = 0) =>
        target?.replaceChildren(...Array.from(source?.cloneNode(true).childNodes ?? []).slice(skip))
    copy(bar.querySelector('[data-foundation-route-bar-title]'), panel.querySelector('summary strong'))
    copy(
        bar.querySelector('[data-foundation-route-bar-position]'),
        panel.querySelector('.foundation-reading-routes__position')
    )
    bar.style.setProperty(
        '--foundation-route-progress',
        panel.style.getPropertyValue('--foundation-route-progress') || '0'
    )
    for (const step of ['previous', 'next']) {
        const source = panel.querySelector<HTMLAnchorElement>(`[data-foundation-route-step="${step}"]`)
        const target = bar.querySelector<HTMLAnchorElement>(`[data-foundation-route-bar-step="${step}"]`)
        if (!target) continue
        target.hidden = !source
        if (!source) continue
        target.setAttribute('href', source.getAttribute('href') ?? '')
        // The panel link starts with its own "next stop" label; the bar already carries one.
        copy(target.querySelector('strong'), source, 1)
    }
}

/** Native fragments also open their enclosing disclosures, including folded references. */
function bindFoundationAnchors() {
    const root = document.querySelector('.foundation-entry, .foundations-page')
    if (!root) return
    const reveal = (hash: string) => {
        let id = hash.slice(1)
        try {
            id = decodeURIComponent(id)
        } catch {
            /* A malformed fragment may still be a literal ID. */
        }
        const target = document.getElementById(id)
        if (!target || !root.contains(target)) return
        const route = target.closest<HTMLElement>('.foundation-route')
        if (route?.hidden) root.querySelector<HTMLButtonElement>('[data-route-filter="all"]')?.click()
        for (let parent = target.closest('details'); parent; parent = parent.parentElement?.closest('details') ?? null)
            parent.open = true
        target.querySelector<HTMLDetailsElement>(':scope > details')?.setAttribute('open', '')
        return target
    }
    const arrive = () => {
        const target = reveal(location.hash)
        if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }))
    }
    root.addEventListener('click', (event) => {
        const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
        if (link && link.origin === location.origin && link.pathname === location.pathname && link.hash)
            reveal(link.hash)
    })
    window.addEventListener('hashchange', arrive)
    root.querySelectorAll<HTMLDetailsElement>('[data-foundation-domain]').forEach((domain) => {
        domain.addEventListener('toggle', () => {
            if (!domain.open) return
            const summary = domain.querySelector('summary')!
            const nav = document.querySelector<HTMLElement>('.VPNav')
            const top = nav && getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0
            const bounds = summary.getBoundingClientRect()
            if (bounds.top < top || bounds.top > innerHeight * 0.7) summary.scrollIntoView({ block: 'start' })
        })
    })
    arrive()
}

function bindTagFilters() {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tags] [data-tag]'))
    const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-tag-panel]'))
    const heading = document.querySelector<HTMLElement>('[data-tag-heading]')
    if (!buttons.length || !panels.length || !heading) return

    const select = (tag: string, updateUrl: boolean) => {
        if (!buttons.some((button) => button.dataset.tag === tag)) return
        buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tag === tag)))
        panels.forEach((panel) => (panel.hidden = panel.dataset.tagPanel !== tag))
        heading.textContent = tag
        document.dispatchEvent(new CustomEvent('tio2:index-scope'))
        if (updateUrl) {
            const url = new URL(window.location.href)
            url.hash = new URLSearchParams({ tag }).toString()
            history.replaceState({}, '', url)
        }
    }

    const requested = new URLSearchParams(window.location.hash.slice(1)).get('tag')
    select(
        requested && buttons.some((button) => button.dataset.tag === requested) ? requested : buttons[0].dataset.tag!,
        false
    )
    buttons.forEach((button) => button.addEventListener('click', () => select(button.dataset.tag!, true)))
}

/** Index pages: filter rows by title and by the human-written mark; the count follows the visible scope. */
function bindIndexFilter() {
    const page = document.querySelector<HTMLElement>('[data-index-page]')
    const input = page?.querySelector<HTMLInputElement>('[data-index-filter]')
    const human = page?.querySelector<HTMLButtonElement>('[data-index-human]')
    const count = page?.querySelector<HTMLElement>('[data-index-count]')
    const empty = page?.querySelector<HTMLElement>('[data-index-empty]')
    if (!page || !input || !human || !count) return

    const rows = Array.from(page.querySelectorAll<HTMLElement>('[data-index-row]')).map((row) => ({
        row,
        title: (row.querySelector('.index-row__title')?.textContent ?? '').toLocaleLowerCase(uiLanguage()),
        human: row.hasAttribute('data-human')
    }))
    const groups = Array.from(page.querySelectorAll<HTMLElement>('[data-index-group]'))

    const apply = () => {
        const query = input.value.trim().toLocaleLowerCase(uiLanguage())
        const onlyHuman = human.getAttribute('aria-pressed') === 'true'
        let total = 0
        let shown = 0
        for (const entry of rows) {
            const visible = (!query || entry.title.includes(query)) && (!onlyHuman || entry.human)
            entry.row.hidden = !visible
            // Tag panels that are switched away do not count toward the visible scope.
            if (entry.row.closest('[data-tag-panel][hidden]')) continue
            total += 1
            if (visible) shown += 1
        }
        groups.forEach((group) => {
            if (group.hasAttribute('data-tag-panel')) return
            group.hidden = !group.querySelector('[data-index-row]:not([hidden])')
        })
        count.textContent =
            shown === total
                ? `${t('共 ', 'Total: ')}${total}${t(' 篇', total === 1 ? ' post' : ' posts')}`
                : `${t('显示 ', 'Showing ')}${shown} / ${total}${t(' 篇', total === 1 ? ' post' : ' posts')}`
        if (empty) empty.hidden = shown > 0
    }

    input.addEventListener('input', apply)
    human.addEventListener('click', () => {
        human.setAttribute('aria-pressed', String(human.getAttribute('aria-pressed') !== 'true'))
        apply()
    })
    document.addEventListener('tio2:index-scope', apply)
    apply()
}

function bindComments() {
    const root = document.querySelector<HTMLElement>('[data-giscus]')
    if (!root) return

    const theme = () => (document.documentElement.classList.contains('dark') ? 'transparent_dark' : 'light')
    const script = document.createElement('script')
    script.src = 'https://giscus.app/client.js'
    script.async = true
    script.crossOrigin = 'anonymous'
    Object.assign(script.dataset, {
        repo: root.dataset.repo,
        repoId: root.dataset.repoId,
        category: root.dataset.category,
        categoryId: root.dataset.categoryId,
        mapping: 'pathname',
        strict: '0',
        reactionsEnabled: '1',
        emitMetadata: '0',
        inputPosition: 'top',
        theme: theme(),
        lang: uiLanguage(),
        loading: 'eager'
    })
    script.addEventListener('error', () => {
        const status = root.querySelector<HTMLElement>('[data-giscus-status]')
        if (status)
            status.textContent = t(
                '评论加载失败，请稍后刷新页面。',
                'Comments failed to load. Please refresh the page later.'
            )
    })
    root.append(script)
    const syncTheme = () => {
        root
            .querySelector<HTMLIFrameElement>('iframe.giscus-frame')
            ?.contentWindow?.postMessage({ giscus: { setConfig: { theme: theme() } } }, 'https://giscus.app')
    }
    root.addEventListener('load', syncTheme, true)
    document.addEventListener('tio2:theme', () => {
        script.dataset.theme = theme()
        syncTheme()
    })
}
