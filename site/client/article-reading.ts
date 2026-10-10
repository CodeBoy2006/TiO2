import { t } from './i18n'
import { bindMarginNotes } from './article-notes'
import { bindQuotePopover } from './quote-popover'
import { decodeHash } from './url-hash'

const ACTIVE_OFFSET = 120
const DOCK_THRESHOLD = 600
// How far the middle of the outline dial bows toward the article, in px.
const ARC_BOW = 26
const ARC_RAIL_X = 4

/** Article reading aids: outline with progress, phone reading bar, desktop dock, margin notes and quoting. */
export function bindArticleReading() {
    const article = document.querySelector<HTMLElement>('.article-column main')
    if (!article) return

    bindOutline(article)
    bindDock()
    bindMarginNotes(article)
    bindQuotePopover(article)
    document.querySelectorAll<HTMLButtonElement>('[data-reading-top]').forEach((button) => {
        button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: scrollBehavior() }))
    })
}

function bindOutline(article: HTMLElement) {
    const toc = document.querySelector<HTMLElement>('[data-article-toc]')
    if (!toc) return

    const lists = Array.from(document.querySelectorAll<HTMLOListElement>('.article-outline'))
    const headings = Array.from(toc.querySelectorAll<HTMLAnchorElement>('a'))
        .map((link) => document.getElementById(decodeHash(link.hash)))
        .filter((heading): heading is HTMLElement => Boolean(heading))
    const minutes = Number(toc.dataset.readingMinutes) || 0
    const percentLabel = toc.querySelector<HTMLElement>('[data-reading-percent]')
    const leftLabel = toc.querySelector<HTMLElement>('[data-reading-left]')
    const bar = document.querySelector<HTMLElement>('[data-reading-bar]')
    const barProgress = bar?.querySelector<HTMLElement>('[data-reading-progress]')
    const barCurrent = bar?.querySelector<HTMLElement>('[data-reading-current]')
    const ring = toc.querySelector<SVGCircleElement>('[data-reading-ring]')
    const dial = bindDial(toc)
    let activeIndex = -1
    let frame = 0

    const update = () => {
        frame = 0
        const start = article.getBoundingClientRect().top + window.scrollY
        const end = start + article.offsetHeight - window.innerHeight
        const progress = end > start ? clamp((window.scrollY - start) / (end - start)) : 1

        let index = 0
        headings.forEach((heading, candidate) => {
            if (heading.getBoundingClientRect().top < ACTIVE_OFFSET) index = candidate
        })
        if (index !== activeIndex) {
            activeIndex = index
            lists.forEach((list) => markActive(list, index))
            dial?.setActive(index)
            if (barCurrent && headings[index]) barCurrent.textContent = readHeadingText(headings[index])
        }

        if (percentLabel) percentLabel.textContent = `${Math.round(progress * 100)}%`
        ring?.style.setProperty('stroke-dasharray', `${progress} 1`)
        if (leftLabel)
            leftLabel.textContent =
                progress >= 1
                    ? t('已读完', 'Finished')
                    : `${t('余约 ', 'Remaining: about ')}${Math.max(1, Math.ceil(minutes * (1 - progress)))}${t(' 分钟', ' min')}`
        barProgress?.style.setProperty('--reading-progress', String(progress))
        if (bar) bar.dataset.visible = String(window.scrollY > start - 80)
    }
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(update)
    }
    // Thread lengths depend on layout: re-measure after resizes and when the hidden phone outline opens.
    const remeasure = () => {
        activeIndex = -1
        schedule()
    }
    const pauseFollow = () => {
        const list = toc.querySelector<HTMLOListElement>('.article-outline')
        if (list) list.scrollTo({ top: list.scrollTop, behavior: 'auto' })
    }

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', remeasure)
    toc.addEventListener('pointerenter', pauseFollow)
    toc.addEventListener('focusin', pauseFollow)
    toc.addEventListener('pointerleave', remeasure)
    toc.addEventListener('focusout', remeasure)
    document.fonts.ready.then(remeasure)
    update()
    if (bar) bindReadingBar(bar, remeasure)
}

function bindReadingBar(bar: HTMLElement, onOpen: () => void) {
    const toggle = bar.querySelector<HTMLButtonElement>('[aria-controls="reading-bar-outline"]')
    const outline = bar.querySelector<HTMLElement>('#reading-bar-outline')
    if (!toggle || !outline) return

    const setOpen = (open: boolean) => {
        toggle.setAttribute('aria-expanded', String(open))
        outline.hidden = !open
        bar.dataset.open = String(open)
        if (!open) return
        onOpen()
        outline.querySelector<HTMLElement>('[aria-current] a')?.scrollIntoView({ block: 'nearest' })
    }

    toggle.addEventListener('click', () => setOpen(outline.hidden))
    outline.addEventListener('click', (event) => {
        if ((event.target as Element | null)?.closest('a')) setOpen(false)
    })
    document.addEventListener('click', (event) => {
        if (!outline.hidden && !bar.contains(event.target as Node)) setOpen(false)
    })
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !outline.hidden) {
            setOpen(false)
            toggle.focus()
        }
    })
}

function bindDock() {
    const dock = document.querySelector<HTMLElement>('[data-reading-dock]')
    if (!dock) return

    const status = dock.querySelector<HTMLElement>('.reading-dock__status')
    let statusTimer = 0
    const announce = (message: string) => {
        if (!status) return
        status.textContent = message
        window.clearTimeout(statusTimer)
        statusTimer = window.setTimeout(() => (status.textContent = ''), 1600)
    }

    const sync = () => (dock.dataset.visible = String(window.scrollY > DOCK_THRESHOLD))
    window.addEventListener('scroll', sync, { passive: true })
    sync()

    dock.querySelector('[data-reading-share]')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(window.location.href.split('#')[0])
            announce(t('已复制链接', 'Link copied'))
        } catch {
            announce(t('复制失败', 'Copy failed'))
        }
    })
}

function markActive(list: HTMLOListElement, index: number) {
    const items = Array.from(list.children) as HTMLElement[]
    items.forEach((item, candidate) => {
        if (candidate === index) item.setAttribute('aria-current', 'location')
        else item.removeAttribute('aria-current')
        item.dataset.read = String(candidate < index)
    })
    const last = items[items.length - 1]
    if (last) list.style.setProperty('--outline-length', `${last.offsetTop + last.offsetHeight}px`)
    const active = items[index]
    if (!active) return
    list.style.setProperty('--outline-thread', String(active.offsetTop + active.offsetHeight / 2))
}

/**
 * Bends the desktop outline into a dial: entries slide along a parabolic rail whose apex sits at the middle of
 * the visible list, so the arc stays put while the list scrolls through it and the marker rides the rail.
 * Like a picker wheel, the list is padded so every entry, the first and last included, can rest at the apex.
 */
function bindDial(toc: HTMLElement) {
    const dial = toc.querySelector<HTMLElement>('.article-toc__dial')
    const list = dial?.querySelector<HTMLOListElement>('.article-outline')
    const track = dial?.querySelector<SVGPathElement>('.article-toc__rail-track')
    const read = dial?.querySelector<SVGPathElement>('.article-toc__rail-read')
    const marker = dial?.querySelector<HTMLElement>('.article-toc__marker')
    const ghost = dial?.querySelector<HTMLElement>('.article-toc__ghost')
    if (!dial || !list || !track || !read || !marker || !ghost) return null

    const items = Array.from(list.children) as HTMLElement[]
    let active = 0
    let hovered: HTMLElement | null = null
    let frame = 0
    let half = 0
    let bow = 0

    const centerOf = (item: HTMLElement) => item.offsetTop + item.offsetHeight / 2 - list.scrollTop
    const railX = (y: number) => {
        const u = half ? clamp(Math.abs(y - half) / half) : 1
        return bow * (1 - u * u)
    }
    const place = (dot: HTMLElement, item: HTMLElement | undefined) => {
        if (!item) return
        const y = centerOf(item)
        dot.style.setProperty('--dot-x', `${ARC_RAIL_X + railX(y)}px`)
        dot.style.setProperty('--dot-y', `${Math.min(half * 2, Math.max(0, y))}px`)
        dot.dataset.outside = String(y < 0 || y > half * 2)
    }
    // Twice the entries' height lets any entry sit at the apex with the whole outline still in view.
    const size = () => {
        const first = items[0]
        const last = items[items.length - 1]
        if (!first || !last) return false
        list.style.setProperty('--dial-content', `${2 * (last.offsetTop + last.offsetHeight - first.offsetTop)}px`)
        const height = list.clientHeight
        // Hidden below the desktop breakpoint: keep the plain list there.
        if (!height) return false
        list.style.paddingTop = `${Math.max(0, (height - first.offsetHeight) / 2)}px`
        list.style.paddingBottom = `${Math.max(0, (height - last.offsetHeight) / 2)}px`
        return true
    }
    const center = (behavior: ScrollBehavior) => {
        const item = items[active]
        // Leave the outline in the reader's control while they browse it.
        if (!item || list.matches(':hover, :has(:focus-visible)')) return
        list.scrollTo({ top: item.offsetTop + item.offsetHeight / 2 - list.clientHeight / 2, behavior })
    }
    const layout = () => {
        frame = 0
        if (!list.clientHeight) return
        half = list.clientHeight / 2
        bow = ARC_BOW * Math.min(1, half / 180)
        toc.dataset.dial = 'true'
        toc.style.setProperty('--arc-bow', `${ARC_BOW}px`)
        track.setAttribute('d', `M${ARC_RAIL_X} 0Q${ARC_RAIL_X + 2 * bow} ${half} ${ARC_RAIL_X} ${half * 2}`)
        read.setAttribute('d', track.getAttribute('d') ?? '')
        items.forEach((item) => {
            const y = centerOf(item)
            const u = clamp(Math.abs(y - half) / half)
            item.style.setProperty('--arc-x', `${railX(y).toFixed(2)}px`)
            item.style.setProperty('--arc-fade', (u * u).toFixed(3))
        })
        // The rail spans only the entries, so the padded ends of the wheel stay empty.
        const at = (item: HTMLElement | undefined) => (item ? clamp(centerOf(item) / (half * 2)) : 0)
        const start = at(items[0])
        track.style.setProperty('stroke-dasharray', `0 ${start} ${at(items[items.length - 1]) - start} 1`)
        read.style.setProperty('stroke-dasharray', `0 ${start} ${Math.max(0, at(items[active]) - start)} 1`)
        place(marker, items[active])
        if (hovered) place(ghost, hovered)
    }
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(layout)
    }
    const point = (target: EventTarget | null) => {
        const item = (target as Element | null)?.closest<HTMLElement>('.article-outline__item')
        hovered = item && item !== items[active] ? item : null
        dial.dataset.pointing = String(Boolean(hovered))
        if (hovered) place(ghost, hovered)
    }

    list.addEventListener('scroll', schedule, { passive: true })
    list.addEventListener('pointerover', (event) => point(event.target))
    list.addEventListener('pointerleave', () => point(null))
    list.addEventListener('focusin', (event) =>
        point((event.target as Element).matches(':focus-visible') ? event.target : null)
    )
    list.addEventListener('focusout', () => point(null))

    return {
        setActive(index: number) {
            const first = !toc.dataset.dial
            active = index
            if (hovered === items[index]) point(null)
            if (!size()) return
            center(first ? 'auto' : scrollBehavior())
            layout()
        }
    }
}

function readHeadingText(heading: HTMLElement) {
    const clone = heading.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.header-anchor').forEach((anchor) => anchor.remove())
    return clone.textContent?.trim() ?? ''
}

function scrollBehavior(): ScrollBehavior {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function clamp(value: number) {
    return Math.min(1, Math.max(0, value))
}
