import { t } from './i18n'
const MIN_QUOTE_LENGTH = 4
const FRAGMENT_EDGE = 24

/** A small toolbar above selected article text: copy it as a citation, or copy a link that scrolls to it. */
export function bindQuotePopover(article: HTMLElement) {
    // Touch devices already offer their own selection menu.
    if (!window.matchMedia('(pointer: fine)').matches) return

    const popover = document.createElement('div')
    popover.className = 'quote-popover'
    popover.setAttribute('role', 'toolbar')
    popover.setAttribute('aria-label', t('引用选中文字', 'Quote selected text'))
    popover.hidden = true
    popover.innerHTML = `<button type="button" data-quote-action="copy">${t('复制引文', 'Copy quote')}</button><button type="button" data-quote-action="link">${t('复制链接', 'Copy link')}</button>`
    document.body.append(popover)

    let timer = 0
    const place = () => {
        const selection = window.getSelection()
        const text = selection?.toString().trim() ?? ''
        const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null
        if (!range || text.length < MIN_QUOTE_LENGTH || !article.contains(range.commonAncestorContainer)) {
            popover.hidden = true
            return
        }
        const rect = range.getBoundingClientRect()
        popover.hidden = false
        const width = popover.offsetWidth
        const left = Math.min(
            Math.max(rect.left + rect.width / 2 - width / 2, 12),
            document.documentElement.clientWidth - width - 12
        )
        popover.style.left = `${left + window.scrollX}px`
        popover.style.top = `${rect.top + window.scrollY - popover.offsetHeight - 10}px`
    }

    document.addEventListener('selectionchange', () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(place, 160)
    })
    // Keep the selection alive while the toolbar is pressed.
    popover.addEventListener('pointerdown', (event) => event.preventDefault())
    popover.addEventListener('click', async (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button')
        const text = window.getSelection()?.toString().trim()
        if (!button || !text) return
        const url = window.location.href.split('#')[0]
        const title = document.querySelector('.article-header-title')?.textContent?.trim() ?? document.title
        const value =
            button.dataset.quoteAction === 'copy'
                ? t(`“${text}”\n——《${title}》${url}`, `“${text}”\n— ${title}\n${url}`)
                : `${url}#:~:text=${textFragment(text)}`
        const label = button.textContent
        try {
            await navigator.clipboard.writeText(value)
            button.textContent = t('已复制', 'Copied')
        } catch {
            button.textContent = t('复制失败', 'Copy failed')
        }
        window.setTimeout(() => (button.textContent = label), 1200)
    })
}

function textFragment(text: string) {
    const compact = text.replace(/\s+/gu, ' ')
    if (compact.length <= FRAGMENT_EDGE * 2) return encodeURIComponent(compact)
    return `${encodeURIComponent(compact.slice(0, FRAGMENT_EDGE))},${encodeURIComponent(compact.slice(-FRAGMENT_EDGE))}`
}
