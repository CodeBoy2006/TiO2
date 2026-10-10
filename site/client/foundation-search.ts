import { t } from './i18n'

export const normalizeFoundationQuery = (value: string) => value.normalize('NFKC').toLowerCase().trim()

/** Names are already normalized; description-only matches follow every name match. */
export function foundationMatchRank(query: string, names: string[], text: string) {
    if (!query || names.includes(query)) return 0
    if (names.some((name) => name.includes(query))) return 1
    return text.includes(query) ? 2 : -1
}

export function bindFoundationSearch() {
    const input = document.querySelector<HTMLInputElement>('#foundation-search')
    const catalog = document.querySelector<HTMLElement>('#foundations-catalog')
    const results = document.querySelector<HTMLElement>('[data-foundation-results]')
    const list = results?.querySelector<HTMLOListElement>('ol')
    const more = results?.querySelector<HTMLButtonElement>('[data-foundation-more]')
    const status = document.querySelector<HTMLElement>('.foundations-result-count')
    const page = document.querySelector<HTMLElement>('.foundations-page')
    const domainFilter = document.querySelector<HTMLSelectElement>('[data-foundation-domain-filter]')
    if (!input || !catalog || !results || !list || !more || !status || !page) return

    const entries = new Map<
        string,
        { row: HTMLElement; names: string[]; text: string; kind: string; subjects: Map<string, string> }
    >()
    for (const row of Array.from(catalog.querySelectorAll<HTMLElement>('[data-foundation-entry]'))) {
        const href = row.querySelector('a')!.getAttribute('href')!
        const domain = row.closest<HTMLElement>('[data-foundation-domain]')!
        const subjectId = domain.dataset.foundationDomain!
        const subject = domain.querySelector('h3')?.textContent ?? ''
        const existing = entries.get(href)
        if (existing) {
            existing.subjects.set(subjectId, subject)
            continue
        }
        const names = [
            row.querySelector('.foundations-entry__title-row strong')?.textContent ?? '',
            row.querySelector('.foundations-entry__title-row small')?.textContent ?? '',
            ...(JSON.parse(row.dataset.searchAliases ?? '[]') as string[]),
            href
                .split('/')
                .pop()
                ?.replace(/\.html$/u, '') ?? ''
        ]
            .map(normalizeFoundationQuery)
            .filter(Boolean)
        entries.set(href, {
            row,
            names,
            kind: row.dataset.kind ?? '',
            subjects: new Map([[subjectId, subject]]),
            text: normalizeFoundationQuery(row.querySelector('.foundations-entry__description')?.textContent ?? '')
        })
    }
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-foundation-kind]'))
    const clearButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-foundation-clear]'))
    const empty = results.querySelector<HTMLElement>('.foundations-empty')!
    const allEntries = [...entries.values()]
    let selectedKind = 'all'
    let matches = allEntries
    let shown = 0

    const appendResults = () => {
        const next = Math.min(shown + 30, matches.length)
        const rows = matches.slice(shown, next).map((entry) => {
            const row = entry.row.cloneNode(true) as HTMLElement
            row.removeAttribute('data-foundation-entry')
            row.removeAttribute('data-dial')
            row.removeAttribute('data-search-aliases')
            row.setAttribute('data-foundation-result', '')
            const subjects = document.createElement('small')
            subjects.className = 'foundations-entry__subjects'
            subjects.textContent = [...entry.subjects.values()].join(' · ')
            row.querySelector('.foundations-entry__body')!.append(subjects)
            return row
        })
        list.append(...rows)
        shown = next
        more.hidden = shown === matches.length
        more.textContent = t(`继续显示（${shown} / ${matches.length}）`, `Show more (${shown} / ${matches.length})`)
    }

    const apply = (writeUrl = false) => {
        const query = normalizeFoundationQuery(input.value)
        const selectedDomain = domainFilter?.value ?? 'all'
        const filtering = Boolean(query) || selectedKind !== 'all' || selectedDomain !== 'all'
        page.dataset.filtering = String(filtering)
        results.hidden = !filtering
        clearButtons.forEach((button) => (button.hidden = !filtering))
        buttons.forEach((button) =>
            button.setAttribute('aria-pressed', String(button.dataset.foundationKind === selectedKind))
        )
        list.replaceChildren()
        shown = 0
        matches = filtering
            ? allEntries
                  .map((entry) => ({ entry, rank: foundationMatchRank(query, entry.names, entry.text) }))
                  .filter(
                      ({ entry, rank }) =>
                          rank >= 0 &&
                          (selectedKind === 'all' || entry.kind === selectedKind) &&
                          (selectedDomain === 'all' || entry.subjects.has(selectedDomain))
                  )
                  .sort((a, b) => a.rank - b.rank)
                  .map(({ entry }) => entry)
            : allEntries
        status.textContent = filtering
            ? t(`找到 ${matches.length} 个概念条目`, `Found: ${matches.length} entries`)
            : t(`共 ${entries.size} 个概念条目`, `Total: ${entries.size} entries`)
        empty.hidden = matches.length > 0
        if (filtering) appendResults()
        if (writeUrl) {
            const url = new URL(location.href)
            if (input.value.trim()) url.searchParams.set('q', input.value.trim())
            else url.searchParams.delete('q')
            if (selectedKind !== 'all') url.searchParams.set('kind', selectedKind)
            else url.searchParams.delete('kind')
            if (selectedDomain !== 'all') url.searchParams.set('domain', selectedDomain)
            else url.searchParams.delete('domain')
            if (filtering) url.hash = ''
            history.replaceState(null, '', url)
        }
    }
    const restore = () => {
        const params = new URLSearchParams(location.search)
        input.value = params.get('q') ?? ''
        const kind = params.get('kind') ?? 'all'
        selectedKind = buttons.some((button) => button.dataset.foundationKind === kind) ? kind : 'all'
        if (domainFilter) {
            const domain = params.get('domain') ?? 'all'
            domainFilter.value = Array.from(domainFilter.options).some((option) => option.value === domain)
                ? domain
                : 'all'
        }
        apply()
    }
    const clear = () => {
        input.value = ''
        selectedKind = 'all'
        if (domainFilter) domainFilter.value = 'all'
        apply(true)
    }
    input.addEventListener('input', (event) => {
        if (!(event as InputEvent).isComposing) apply(true)
    })
    input.addEventListener('compositionend', () => apply(true))
    domainFilter?.addEventListener('change', () => apply(true))
    input.form?.addEventListener('submit', (event) => {
        event.preventDefault()
        if (normalizeFoundationQuery(input.value)) list.querySelector<HTMLAnchorElement>('a')?.click()
    })
    buttons.forEach((button) =>
        button.addEventListener('click', () => {
            selectedKind = button.dataset.foundationKind ?? 'all'
            apply(true)
        })
    )
    clearButtons.forEach((button) =>
        button.addEventListener('click', () => {
            clear()
            input.focus()
        })
    )
    page.querySelectorAll<HTMLAnchorElement>('.foundations-shortcuts a').forEach((link) => {
        if (link.hash !== '#foundation-search') link.addEventListener('click', clear)
    })
    more.addEventListener('click', () => {
        const firstNewIndex = shown
        appendResults()
        list.children[firstNewIndex]?.querySelector<HTMLAnchorElement>('a')?.focus()
    })
    window.addEventListener('popstate', restore)
    restore()
}
