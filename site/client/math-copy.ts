export function copyMathAsTex(event: ClipboardEvent) {
    const selection = document.getSelection()
    if (!event.clipboardData || !selection || selection.isCollapsed || selection.rangeCount === 0) return

    const fragment = selection.getRangeAt(0).cloneContents()
    const formulas = fragment.querySelectorAll<HTMLElement>('mjx-container[data-tex]')
    if (!formulas.length) return

    formulas.forEach((formula) => formula.replaceWith(document.createTextNode(formula.dataset.tex ?? '')))
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:fixed;left:-9999px;white-space:pre-wrap'
    wrapper.append(fragment)
    document.body.append(wrapper)
    event.clipboardData.setData('text/plain', wrapper.innerText)
    event.clipboardData.setData('text/html', wrapper.innerHTML)
    wrapper.remove()
    event.preventDefault()
}
