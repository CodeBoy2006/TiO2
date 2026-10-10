import { t } from './i18n'
import { decodeHash } from './url-hash'

const STORAGE_KEY = 'tio2:article-margin'
const NOTE_GAP = 14
const wideLayout = window.matchMedia('(min-width: 1200px)')

interface MarginNote {
    ref: HTMLAnchorElement
    note: HTMLElement
}

/** Mirrors footnotes into the right margin beside their first reference; the column can be folded. */
export function bindMarginNotes(article: HTMLElement) {
    const layout = document.querySelector<HTMLElement>('[data-article-layout]')
    const margin = layout?.querySelector<HTMLElement>('[data-article-margin]')
    const list = margin?.querySelector<HTMLElement>('[data-article-margin-notes]')
    const toggle = margin?.querySelector<HTMLButtonElement>('[data-article-margin-toggle]')
    if (!layout || !margin || !list || !toggle) return

    const notes = buildNotes(article, list)
    if (!notes.length) {
        margin.hidden = true
        return
    }

    const isShowing = () => wideLayout.matches && layout.dataset.margin !== 'collapsed'
    let frame = 0
    const place = () => {
        frame = 0
        if (!isShowing()) return
        // Each note starts level with its reference and yields downward when the previous note runs long.
        const origin = list.getBoundingClientRect().top
        let cursor = 0
        for (const { ref, note } of notes) {
            const top = Math.max(ref.getBoundingClientRect().top - origin - 3, cursor)
            note.style.transform = `translateY(${Math.round(top)}px)`
            cursor = top + note.offsetHeight + NOTE_GAP
        }
        list.style.height = `${Math.ceil(cursor)}px`
    }
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(place)
    }
    const setOpen = (open: boolean, remember: boolean) => {
        layout.dataset.margin = open ? 'open' : 'collapsed'
        toggle.setAttribute('aria-pressed', String(open))
        toggle.textContent = open ? t('收起', 'Collapse') : t('展开', 'Expand')
        if (remember) writePreference(open ? 'open' : 'collapsed')
        schedule()
    }

    setOpen(readPreference() !== 'collapsed', false)
    toggle.addEventListener('click', () => setOpen(layout.dataset.margin === 'collapsed', true))
    new ResizeObserver(schedule).observe(article)
    wideLayout.addEventListener('change', schedule)
    void document.fonts.ready.then(schedule)

    for (const { ref, note } of notes) {
        const link = (active: boolean) => {
            ref.classList.toggle('is-linked', active)
            note.classList.toggle('is-linked', active)
        }
        for (const element of [ref, note]) {
            element.addEventListener('mouseenter', () => link(true))
            element.addEventListener('mouseleave', () => link(false))
        }
        // With the note already beside the text, a click highlights it instead of jumping to the end.
        ref.addEventListener('click', (event) => {
            if (!isShowing()) return
            event.preventDefault()
            note.classList.remove('is-flashing')
            void note.offsetWidth
            note.classList.add('is-flashing')
        })
    }
}

function buildNotes(article: HTMLElement, list: HTMLElement): MarginNote[] {
    const seen = new Set<string>()
    const notes: MarginNote[] = []
    for (const ref of Array.from(article.querySelectorAll<HTMLAnchorElement>('.footnote-ref > a[href^="#fn"]'))) {
        const id = decodeHash(ref.hash)
        const source = document.getElementById(id)
        if (seen.has(id) || !source) continue
        seen.add(id)

        const note = document.createElement('div')
        note.className = 'article-note'
        const label = document.createElement('span')
        label.className = 'article-note__label'
        label.textContent = id.replace(/^fn/u, '')
        const body = document.createElement('div')
        body.className = 'article-note__body'
        body.innerHTML = source.innerHTML
        body.querySelectorAll('.footnote-backref').forEach((backref) => backref.remove())
        body.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
        // Bare URLs read as noise in a narrow column; show their host and keep the full link.
        body.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((link) => {
            if (link.textContent?.trim() === link.href || link.textContent?.startsWith('http'))
                link.textContent = new URL(link.href).hostname.replace(/^www\./u, '')
        })
        note.append(label, body)
        list.append(note)
        notes.push({ ref, note })
    }
    return notes
}

function readPreference() {
    try {
        return localStorage.getItem(STORAGE_KEY)
    } catch {
        return null
    }
}

function writePreference(value: string) {
    try {
        localStorage.setItem(STORAGE_KEY, value)
    } catch {
        // Private browsing may refuse storage; the toggle still works for this page.
    }
}
