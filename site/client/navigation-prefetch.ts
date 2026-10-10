const prefetched = new Set<string>()

export function bindNavigationPrefetch() {
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } })
        .connection
    if (
        document.documentElement.classList.contains('content-only-preview') ||
        connection?.saveData ||
        /2g/u.test(connection?.effectiveType ?? '')
    ) {
        return
    }

    const probe = document.createElement('link')
    const prefetch = probe.relList.supports?.('prefetch')
        ? (url: string) => {
              const link = document.createElement('link')
              link.rel = 'prefetch'
              link.href = url
              document.head.append(link)
          }
        : (url: string) => {
              const request = new XMLHttpRequest()
              request.open('GET', url)
              request.withCredentials = true
              request.send()
          }

    const prefetchLink = (link: HTMLAnchorElement) => {
        const url = resolveDocumentUrl(link)
        if (!url || prefetched.has(url)) return
        prefetched.add(url)
        prefetch(url)
    }

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue
                observer.unobserve(entry.target)
                prefetchLink(entry.target as HTMLAnchorElement)
            }
        })
        const observeLinks = () => {
            document.querySelectorAll<HTMLAnchorElement>('#VPContent a[href]').forEach((link) => observer.observe(link))
        }
        if (window.requestIdleCallback) {
            window.requestIdleCallback(observeLinks)
        } else {
            window.setTimeout(observeLinks, 1)
        }
    }

    const prefetchFromIntent = (event: Event) => {
        if (!(event.target instanceof Element)) return
        const link = event.target.closest<HTMLAnchorElement>('#app a[href]')
        if (link) prefetchLink(link)
    }
    document.addEventListener('pointerover', prefetchFromIntent, { passive: true })
    document.addEventListener('pointerdown', prefetchFromIntent, { passive: true })
    document.addEventListener('focusin', prefetchFromIntent)
}

function resolveDocumentUrl(link: HTMLAnchorElement) {
    if (link.target || link.hasAttribute('download')) return
    const url = new URL(link.href, link.baseURI)
    const extension = url.pathname.match(/\.[^/]+$/u)?.[0].toLowerCase()
    if (url.origin !== location.origin || url.pathname === location.pathname || (extension && extension !== '.html')) {
        return
    }
    url.hash = ''
    return url.href
}
