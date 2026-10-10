import { t, uiLanguage } from './i18n'
import MiniSearch, { type SearchResult } from 'minisearch'
import type { TiO2SearchConfig } from '../../packages/config/src/index.js'
import { foundationMatchRank, normalizeFoundationQuery } from './foundation-search'

declare const __TIO2_SEARCH__: TiO2SearchConfig['miniSearch']
/** The site's own name for its knowledge library. */
declare const __TIO2_LIBRARY__: string

interface SearchDocument {
    id: string
    title: string
    aliases: string[]
    description: string
    kind: string
    meta: string
    text: string
}

type SearchMatch = SearchResult & SearchDocument
type Scope = 'all' | 'post' | 'foundation' | 'topic'

const miniSearchOptions = {
    fields: ['title', 'text'],
    storeFields: ['title', 'aliases', 'description', 'kind', 'meta'],
    tokenize: tokenizeSearchText,
    searchOptions: {
        ...__TIO2_SEARCH__,
        combineWith: 'AND' as const
    }
}

const SCOPES: { key: Scope; label: string }[] = [
    { key: 'all', label: t('全部', 'All') },
    { key: 'post', label: t('文章', 'Posts') },
    { key: 'foundation', label: __TIO2_LIBRARY__ },
    { key: 'topic', label: t('专题', 'Topics') }
]
const GROUPS: Record<string, string> = {
    post: t('文章', 'Posts'),
    foundation: __TIO2_LIBRARY__,
    topic: t('专题', 'Topics'),
    page: t('页面', 'Pages')
}
const ENTRY_GLYPHS: Record<string, string> = {
    公理: '公',
    原则: '原',
    定义: '定',
    模型: '模',
    方法: '法',
    算法: '算',
    定理: '理',
    应用: '用',
    导航: '导'
}
const RESULT_LIMIT = 40
const QUERY_KEY = 'vitepress:local-search-filter'
const SCOPE_KEY = 'tio2:search-scope'

let searchIndex: Promise<MiniSearch<SearchDocument>> | undefined
let activeSearch: HTMLElement | undefined

export function openSearch() {
    if (activeSearch) {
        activeSearch.querySelector<HTMLInputElement>('#localsearch-input')?.focus()
        return
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.createElement('div')
    root.className = 'VPLocalSearchBox'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-labelledby', 'localsearch-label')
    root.innerHTML = `<button type="button" class="backdrop" aria-label="${t('关闭搜索', 'Close search')}"></button><div class="shell"><form class="search-bar"><label title="${t('搜索', 'Search')}" id="localsearch-label" for="localsearch-input"><span aria-hidden="true" class="vpi-search search-icon local-search-icon"></span><span class="visually-hidden">${t('搜索', 'Search')}</span></label><div class="search-actions before"><button type="button" class="back-button" title="${t('关闭搜索', 'Close search')}"><span class="vpi-arrow-left local-search-icon" aria-hidden="true"></span></button></div><input aria-autocomplete="list" aria-controls="localsearch-list" autocapitalize="off" autocomplete="off" autocorrect="off" class="search-input" id="localsearch-input" enterkeyhint="go" maxlength="64" placeholder="${t('搜索文章、概念条目与专题', 'Search articles, foundations and topics')}" spellcheck="false" type="search"><div class="search-actions"><button class="clear-button" type="reset" disabled title="${t('清空搜索', 'Clear search')}"><span class="vpi-delete local-search-icon" aria-hidden="true"></span></button></div></form><div class="search-scopes" role="group" aria-label="${t('搜索范围', 'Search scope')}">${SCOPES.map((scope) => `<button type="button" data-scope="${scope.key}" aria-pressed="false">${scope.label}<small></small></button>`).join('')}</div><div class="search-body"><ul class="results" id="localsearch-list" role="listbox" aria-live="polite"><li class="search-loading">${t('正在加载搜索索引…', 'Loading search index…')}</li></ul><aside class="search-preview" aria-hidden="true"></aside></div><div class="search-keyboard-shortcuts"><span><kbd aria-label="${t('向上', 'Up')}"><span class="vpi-arrow-up navigate-icon"></span></kbd><kbd aria-label="${t('向下', 'Down')}"><span class="vpi-arrow-down navigate-icon"></span></kbd>${t('选择', 'Select')}</span><span><kbd aria-label="${t('回车', 'Enter')}"><span class="vpi-corner-down-left navigate-icon"></span></kbd>${t('打开', 'Open')}</span><span><kbd aria-label="${t('退出', 'Escape')}">esc</kbd>${t('关闭', 'Close')}</span></div></div>`
    document.body.append(root)
    document.body.style.overflow = 'hidden'
    activeSearch = root

    const input = root.querySelector<HTMLInputElement>('#localsearch-input')!
    const results = root.querySelector<HTMLUListElement>('.results')!
    const preview = root.querySelector<HTMLElement>('.search-preview')!
    const clear = root.querySelector<HTMLButtonElement>('.clear-button')!
    const scopeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-scope]'))
    let scope = readScope()
    let visible: SearchMatch[] = []
    let selected = -1
    let debounce = 0
    let searchRun = 0

    const close = () => {
        window.clearTimeout(debounce)
        root.remove()
        document.body.style.overflow = ''
        activeSearch = undefined
        previousFocus?.focus()
    }

    const select = (index: number) => {
        const links = Array.from(results.querySelectorAll<HTMLAnchorElement>('a.result'))
        selected = links.length ? (index + links.length) % links.length : -1
        links.forEach((link, candidate) => {
            const active = candidate === selected
            link.classList.toggle('selected', active)
            link.parentElement?.setAttribute('aria-selected', String(active))
        })
        links[selected]?.scrollIntoView({ block: 'nearest' })
        input.setAttribute('aria-activedescendant', selected >= 0 ? `localsearch-item-${selected}` : '')
        renderPreview(preview, visible[selected])
    }

    const syncScopes = (counts?: Map<string, number>) => {
        scopeButtons.forEach((button) => {
            const key = button.dataset.scope as Scope
            button.setAttribute('aria-pressed', String(key === scope))
            const count = counts
                ? key === 'all'
                    ? [...counts.values()].reduce((sum, n) => sum + n, 0)
                    : (counts.get(key) ?? 0)
                : null
            button.querySelector('small')!.textContent = count === null ? '' : String(count)
        })
    }

    const renderResults = async () => {
        const run = ++searchRun
        const query = input.value.trim()
        sessionStorage.setItem(QUERY_KEY, input.value)
        clear.disabled = !query
        results.replaceChildren()
        visible = []
        if (!query) {
            syncScopes()
            results.append(
                message(
                    t(
                        '输入关键词，搜索文章、概念条目与专题。',
                        'Enter keywords to search articles, concept entries and topics.'
                    )
                )
            )
            select(-1)
            return
        }

        try {
            const index = await loadSearchIndex()
            if (run !== searchRun || input.value.trim() !== query || !root.isConnected) return
            const matches = index.search(query) as SearchMatch[]
            const normalized = normalizeFoundationQuery(query)
            const nameRank = (match: SearchMatch) => {
                const rank = foundationMatchRank(
                    normalized,
                    [match.title, ...match.aliases].map(normalizeFoundationQuery),
                    ''
                )
                return rank < 0 ? 2 : rank
            }
            matches.sort((a, b) => nameRank(a) - nameRank(b))
            const counts = new Map<string, number>()
            for (const match of matches) counts.set(match.kind, (counts.get(match.kind) ?? 0) + 1)
            syncScopes(counts)

            visible = matches.filter((match) => scope === 'all' || match.kind === scope).slice(0, RESULT_LIMIT)
            if (!visible.length) {
                results.append(message(`${t('没有找到“', 'No results for “')}${query}${t('”。', '”.')}`))
                select(-1)
                return
            }

            visible.forEach((match, index) => {
                results.append(renderResult(match, index, query, select, close))
            })
            select(0)
        } catch (error) {
            if (run !== searchRun || input.value.trim() !== query || !root.isConnected) return
            console.error(error)
            results.append(
                message(t('搜索索引加载失败，请刷新后重试。', 'Search failed to load. Refresh the page to try again.'))
            )
        }
    }

    input.value = sessionStorage.getItem(QUERY_KEY) ?? ''
    input.addEventListener('input', () => {
        window.clearTimeout(debounce)
        debounce = window.setTimeout(renderResults, 120)
    })
    scopeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            scope = button.dataset.scope as Scope
            sessionStorage.setItem(SCOPE_KEY, scope)
            void renderResults()
            input.focus()
        })
    })
    root.querySelector('form')?.addEventListener('submit', (event) => event.preventDefault())
    root.querySelector('.backdrop')?.addEventListener('click', close)
    root.querySelector('.back-button')?.addEventListener('click', close)
    clear.addEventListener('click', (event) => {
        event.preventDefault()
        input.value = ''
        void renderResults()
        input.focus()
    })
    root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close()
        else if (event.key === 'ArrowUp') {
            event.preventDefault()
            select(selected - 1)
        } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            select(selected + 1)
        } else if (event.key === 'Enter' && document.activeElement === input) {
            const link = results.querySelectorAll<HTMLAnchorElement>('a.result')[selected]
            if (link && !event.isComposing) location.href = link.href
        } else if (event.key === 'Tab') trapFocus(event, root)
    })

    syncScopes()
    input.focus()
    void renderResults()
}

function renderResult(
    match: SearchMatch,
    index: number,
    query: string,
    select: (index: number) => void,
    close: () => void
) {
    const item = document.createElement('li')
    item.id = `localsearch-item-${index}`
    item.setAttribute('role', 'option')
    const link = document.createElement('a')
    link.href = String(match.id)
    link.className = 'result'
    const glyph = document.createElement('span')
    glyph.className = 'result-glyph'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = glyphFor(match)
    const titles = document.createElement('span')
    titles.className = 'titles'
    const title = document.createElement('span')
    title.className = 'title'
    title.append(...highlight(match.title, query))
    titles.append(title)
    const meta = document.createElement('span')
    meta.className = 'result-meta'
    meta.textContent = [GROUPS[match.kind], match.meta].filter(Boolean).join(' · ')
    titles.append(meta)
    link.append(glyph, titles)
    link.addEventListener('mouseenter', () => select(index))
    link.addEventListener('focus', () => select(index))
    link.addEventListener('click', close)
    item.append(link)
    return item
}

function renderPreview(preview: HTMLElement, match: SearchMatch | undefined) {
    preview.replaceChildren()
    if (!match) return
    const kind = document.createElement('p')
    kind.className = 'search-preview__kind'
    kind.textContent = GROUPS[match.kind] ?? t('页面', 'Pages')
    const title = document.createElement('p')
    title.className = 'search-preview__title'
    title.textContent = match.title
    preview.append(kind, title)
    for (const [className, text] of [
        ['search-preview__description', match.description],
        ['search-preview__meta', match.meta]
    ]) {
        if (!text) continue
        const paragraph = document.createElement('p')
        paragraph.className = className
        paragraph.textContent = text
        preview.append(paragraph)
    }
}

function glyphFor(match: SearchMatch) {
    if (uiLanguage() === 'en')
        return match.kind === 'foundation' ? match.meta[0] || 'F' : ({ post: 'P', topic: 'T' }[match.kind] ?? 'P')
    if (match.kind === 'foundation') return ENTRY_GLYPHS[match.meta.split(' · ')[0]] ?? '条'
    return { post: '文', topic: '题' }[match.kind] ?? '页'
}

/** Wraps the first case-insensitive occurrence of the query in <mark>; built as nodes, never as HTML. */
function highlight(text: string, query: string) {
    const start = text.toLocaleLowerCase(uiLanguage()).indexOf(query.toLocaleLowerCase(uiLanguage()))
    if (start < 0 || !query) return [document.createTextNode(text)]
    const mark = document.createElement('mark')
    mark.textContent = text.slice(start, start + query.length)
    return [
        document.createTextNode(text.slice(0, start)),
        mark,
        document.createTextNode(text.slice(start + query.length))
    ]
}

function readScope(): Scope {
    const stored = sessionStorage.getItem(SCOPE_KEY)
    return SCOPES.some((scope) => scope.key === stored) ? (stored as Scope) : 'all'
}

function loadSearchIndex() {
    searchIndex ??= fetch('/assets/search-index.json').then(async (response) => {
        if (!response.ok) throw new Error(`Search index returned HTTP ${response.status}`)
        return MiniSearch.loadJSONAsync<SearchDocument>(await response.text(), miniSearchOptions)
    })
    return searchIndex
}

function tokenizeSearchText(text: string) {
    return [...new Intl.Segmenter(uiLanguage(), { granularity: 'word' }).segment(text.normalize('NFKC'))]
        .filter((segment) => segment.isWordLike)
        .map((segment) => segment.segment)
}

function message(text: string) {
    const item = document.createElement('li')
    item.className = 'no-results'
    item.textContent = text
    return item
}

function trapFocus(event: KeyboardEvent, root: HTMLElement) {
    const focusable = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]'))
    if (!focusable.length) return
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey ? current - 1 : current + 1
    if (next >= 0 && next < focusable.length) return
    event.preventDefault()
    focusable[event.shiftKey ? focusable.length - 1 : 0].focus()
}
