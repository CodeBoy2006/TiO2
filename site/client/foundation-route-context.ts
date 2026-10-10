/** The URL owns reading-route state; native links retain normal history and reload behavior. */
export function bindFoundationRouteContext(
    root: ParentNode = document,
    browser: Window = window,
    onChange?: (selected: HTMLDetailsElement | null) => void
) {
    const navigation = root.querySelector<HTMLElement>('[data-foundation-reading-routes]')
    if (!navigation) return
    const panels = Array.from(navigation.querySelectorAll<HTMLDetailsElement>('[data-foundation-route-panel]'))
    const choices = Array.from(navigation.querySelectorAll<HTMLAnchorElement>('[data-foundation-route-choice]'))
    const choiceDisclosure = navigation.querySelector<HTMLDetailsElement>('[data-foundation-route-choices]')
    const prompt = navigation.querySelector<HTMLElement>('[data-foundation-route-prompt]')
    const invalid = navigation.querySelector<HTMLElement>('[data-foundation-route-invalid]')
    const clear = navigation.querySelector<HTMLElement>('[data-foundation-route-clear]')
    const changedLinks = new Map<HTMLAnchorElement, string>()

    const apply = () => {
        const routeId = new URL(browser.location.href).searchParams.get('route')
        const selected = panels.find((panel) => panel.dataset.foundationRoutePanel === routeId)
        navigation.dataset.routeContext = selected ? 'selected' : routeId !== null ? 'invalid' : 'unselected'
        panels.forEach((panel) => {
            panel.hidden = Boolean(selected && panel !== selected)
            if (selected) panel.open = panel === selected
        })
        choices.forEach((choice) => {
            if (selected && choice.dataset.foundationRouteChoice === routeId)
                choice.setAttribute('aria-current', 'true')
            else choice.removeAttribute('aria-current')
        })
        if (choiceDisclosure) choiceDisclosure.hidden = !selected || choices.length < 2
        if (prompt) prompt.hidden = Boolean(selected) || routeId !== null
        if (invalid) invalid.hidden = routeId === null || Boolean(selected)
        if (clear) clear.hidden = !selected
        onChange?.(selected ?? null)

        // Only preserve a route on links to its own stations, never on unrelated detours.
        changedLinks.forEach((href, link) => link.setAttribute('href', href))
        changedLinks.clear()
        if (!selected || !routeId) return
        const paths = new Set<string>(JSON.parse(selected.dataset.foundationRoutePaths ?? '[]'))
        root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
            const href = link.getAttribute('href') ?? ''
            if (!href || href.startsWith('#') || navigation.contains(link)) return
            const target = foundationRouteHref(href, browser.location.href, routeId, paths)
            if (target === href) return
            changedLinks.set(link, href)
            link.setAttribute('href', target)
        })
    }
    apply()
    browser.addEventListener('pageshow', apply)
    browser.addEventListener('popstate', apply)
}

/** Canvas and text links keep the same explicit route, only within its own stations. */
export function foundationRouteHref(href: string, currentHref: string, routeId: string, paths: Set<string>) {
    if (!href || href.startsWith('#') || !routeId) return href
    const current = new URL(currentHref)
    const target = new URL(href, current)
    if (target.origin !== current.origin || !paths.has(target.pathname) || target.searchParams.has('route')) return href
    target.searchParams.set('route', routeId)
    return `${target.pathname}${target.search}${target.hash}`
}
