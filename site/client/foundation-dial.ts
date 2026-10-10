import { t } from './i18n'

interface DialData {
    radius: number
    hub: number
    rings: number[]
    domains: Array<{
        id: string
        title: string
        count: number
        start: number
        end: number
        light: string
        dark: string
    }>
}

interface DialPoint {
    x: number
    y: number
    radius: number
    weight: number
    domain: number
}

const TAU = Math.PI * 2
const REVEAL_MS = 1300
const DOT_RADII = [0.85, 1.15, 1.6, 2.2]

/**
 * The complete map in miniature beside the subject directory. It draws every concept at the position
 * the catalogue rows carry, so it never holds a second copy of the corpus: opening a subject lights
 * its wedge and pointing at a row rings that concept.
 */
export function bindFoundationDial() {
    const root = document.querySelector<HTMLElement>('[data-foundation-dial]')
    const stage = root?.querySelector<HTMLElement>('[data-dial-stage]')
    const source = root?.querySelector<HTMLScriptElement>('[data-dial-data]')
    const catalog = document.querySelector<HTMLElement>('#foundations-catalog')
    if (!root || !stage || !source || !catalog) return

    let data: DialData
    try {
        data = JSON.parse(source.textContent ?? '')
    } catch {
        return
    }
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context || !data.domains.length) return
    canvas.setAttribute('aria-hidden', 'true')
    stage.prepend(canvas)
    stage.hidden = false

    const domainIndex = new Map(data.domains.map((domain, index) => [domain.id, index]))
    const sections = new Map<number, HTMLDetailsElement>()
    for (const section of Array.from(catalog.querySelectorAll<HTMLDetailsElement>('[data-foundation-domain]'))) {
        const index = domainIndex.get(section.dataset.foundationDomain ?? '')
        if (index !== undefined) sections.set(index, section)
    }
    const points: DialPoint[] = []
    const pointByRow = new WeakMap<Element, DialPoint>()
    for (const row of Array.from(catalog.querySelectorAll<HTMLElement>('[data-dial]'))) {
        const [x, y, weight] = (row.dataset.dial ?? '').split(',').map(Number)
        const domain = domainIndex.get(
            row.closest<HTMLElement>('[data-foundation-domain]')?.dataset.foundationDomain ?? ''
        )
        if (domain === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue
        const point = { x, y, radius: Math.hypot(x, y), weight: weight || 0, domain }
        points.push(point)
        pointByRow.set(row, point)
    }

    const caption = root.querySelector<HTMLElement>('[data-dial-caption]')
    const captionTitle = root.querySelector<HTMLElement>('[data-dial-title]')
    const captionNote = root.querySelector<HTMLElement>('[data-dial-note]')
    const restingTitle = captionTitle?.textContent ?? ''
    const restingNote = captionNote?.textContent ?? ''
    const leaders = Array.from(root.querySelectorAll<HTMLElement>('[data-dial-top]'))
    if (caption) caption.hidden = false

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let size = 0
    let scale = 1
    let hovered = -1
    let opened = -1
    let focused: DialPoint | null = null
    let revealStart = 0
    let reveal = reducedMotion.matches ? 1 : 0
    let started = false
    let frame = 0
    let lastTime = 0
    // Each subject eases between resting, lit and receding; drawn values chase their targets.
    const emphasis = data.domains.map(() => 0)
    const presence = data.domains.map(() => 1)

    const active = () => (hovered >= 0 ? hovered : opened)

    const syncCaption = () => {
        const index = active()
        const domain = data.domains[index]
        if (captionTitle) captionTitle.textContent = domain ? domain.title : restingTitle
        if (captionNote)
            captionNote.textContent = domain
                ? `${domain.count.toLocaleString('en')}${t(' 个概念', domain.count === 1 ? ' concept' : ' concepts')}`
                : restingNote
        const subject = domain?.id ?? ''
        // Only swap the list of leaders for a subject the reader has settled on.
        const shown = subject
        leaders.forEach((list) => (list.hidden = list.dataset.dialTop !== shown))
    }

    const resize = () => {
        const next = Math.round(stage.clientWidth)
        if (!next || next === size) return
        size = next
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(size * ratio)
        canvas.height = Math.round(size * ratio)
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        scale = (size / 2 - 9) / data.radius
        request()
    }

    const draw = (time: number) => {
        frame = 0
        if (!started) return
        const elapsed = lastTime ? Math.min(64, time - lastTime) : 16
        lastTime = time
        const dark = document.documentElement.classList.contains('dark')
        const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 90)
        const current = active()
        let moving = false
        if (reveal < 1) {
            if (!revealStart) revealStart = time
            reveal = Math.min(1, (time - revealStart) / REVEAL_MS)
            moving = reveal < 1
        }
        data.domains.forEach((_, index) => {
            const lit = current === index ? 1 : 0
            const present = current < 0 || current === index ? 1 : 0.24
            emphasis[index] += (lit - emphasis[index]) * ease
            presence[index] += (present - presence[index]) * ease
            if (Math.abs(lit - emphasis[index]) > 0.01 || Math.abs(present - presence[index]) > 0.01) moving = true
        })

        const centre = size / 2
        const ink = dark ? '223, 223, 214' : '60, 60, 67'
        // The dial opens from the hub outward, as the complete map does.
        const eased = 1 - (1 - reveal) ** 3
        const horizon = data.hub * 0.4 + (data.radius * 1.04 - data.hub * 0.4) * eased
        context.clearRect(0, 0, size, size)
        context.globalCompositeOperation = 'source-over'

        context.lineWidth = 1
        data.rings.forEach((ring, index) => {
            if (ring > horizon) return
            const edge = index === 0 || index === data.rings.length - 1
            context.strokeStyle = `rgba(${ink}, ${edge ? 0.2 : index % 4 === 0 ? 0.1 : 0.045})`
            context.beginPath()
            context.arc(centre, centre, ring * scale, 0, TAU)
            context.stroke()
        })

        const rim = data.radius * scale + 5
        data.domains.forEach((domain, index) => {
            const sweep = Math.min(1, eased * 1.15)
            context.globalAlpha = (0.5 + 0.5 * emphasis[index]) * presence[index] * eased
            context.strokeStyle = dark ? domain.dark : domain.light
            context.lineWidth = 2 + emphasis[index] * 1.5
            context.beginPath()
            context.arc(
                centre,
                centre,
                rim,
                domain.start - Math.PI / 2,
                domain.start + (domain.end - domain.start) * sweep - Math.PI / 2
            )
            context.stroke()
        })

        // Light adds up where concepts crowd in the dark theme; on paper the dots stay plain ink.
        context.globalCompositeOperation = dark ? 'lighter' : 'source-over'
        const grow = size / 320
        for (const point of points) {
            if (point.radius > horizon) continue
            const domain = data.domains[point.domain]
            const arrival = Math.min(1, (horizon - point.radius) / (data.radius * 0.12))
            const alpha = (dark ? 0.86 : 0.8) * arrival * presence[point.domain]
            if (alpha < 0.01) continue
            const radius = (DOT_RADII[point.weight] ?? DOT_RADII[0]) * grow
            const x = centre + point.x * scale
            const y = centre + point.y * scale
            context.fillStyle = dark ? domain.dark : domain.light
            const halo = point.weight === 3 && dark ? 0.16 : 0
            if (halo > 0.01) {
                context.globalAlpha = alpha * halo
                context.beginPath()
                context.arc(x, y, radius * 3.2, 0, TAU)
                context.fill()
            }
            context.globalAlpha = Math.min(1, alpha)
            context.beginPath()
            context.arc(x, y, radius, 0, TAU)
            context.fill()
        }

        context.globalCompositeOperation = 'source-over'
        context.globalAlpha = 1
        if (focused && reveal >= 1) {
            const domain = data.domains[focused.domain]
            const x = centre + focused.x * scale
            const y = centre + focused.y * scale
            context.fillStyle = dark ? '#ffffff' : '#000000'
            context.beginPath()
            context.arc(x, y, 2.6, 0, TAU)
            context.fill()
            context.strokeStyle = dark ? domain.dark : domain.light
            context.lineWidth = 1.5
            context.beginPath()
            context.arc(x, y, 7, 0, TAU)
            context.stroke()
        }

        // A small lozenge marks the hub, the same sign the entry pages use for a concept's kind.
        context.strokeStyle = `rgba(${ink}, 0.5)`
        context.lineWidth = 1.2
        context.beginPath()
        context.moveTo(centre, centre - 4.5)
        context.lineTo(centre + 4.5, centre)
        context.lineTo(centre, centre + 4.5)
        context.lineTo(centre - 4.5, centre)
        context.closePath()
        context.stroke()

        if (moving) request()
        else lastTime = 0
    }
    const request = () => {
        if (!frame && size) frame = requestAnimationFrame(draw)
    }

    const domainAt = (event: PointerEvent | MouseEvent) => {
        const bounds = canvas.getBoundingClientRect()
        const x = (event.clientX - bounds.left - bounds.width / 2) / scale
        const y = (event.clientY - bounds.top - bounds.height / 2) / scale
        const radius = Math.hypot(x, y)
        if (radius < data.hub * 0.5 || radius > data.radius * 1.08) return -1
        const angle = (Math.atan2(x, -y) + TAU) % TAU
        return data.domains.findIndex((domain) => angle >= domain.start - 0.015 && angle <= domain.end + 0.015)
    }
    const setHovered = (index: number) => {
        if (index === hovered) return
        sections.get(hovered)?.removeAttribute('data-dial-hover')
        hovered = index
        sections.get(hovered)?.setAttribute('data-dial-hover', '')
        canvas.style.cursor = index >= 0 ? 'pointer' : ''
        syncCaption()
        request()
    }
    canvas.addEventListener('pointermove', (event) => setHovered(domainAt(event)))
    canvas.addEventListener('pointerleave', () => setHovered(-1))
    canvas.addEventListener('click', (event) => {
        const section = sections.get(domainAt(event))
        if (!section || section.hidden) return
        section.open = !section.open
        if (section.open)
            section.querySelector('summary')?.scrollIntoView({
                block: 'start',
                behavior: reducedMotion.matches ? 'auto' : 'smooth'
            })
    })

    const rowDomain = (target: EventTarget | null) => {
        const summary = (target as Element | null)?.closest?.('.foundations-domain__header')
        const index = domainIndex.get(
            summary?.closest<HTMLElement>('[data-foundation-domain]')?.dataset.foundationDomain ?? ''
        )
        return index ?? -1
    }
    const setFocused = (target: EventTarget | null) => {
        const row = (target as Element | null)?.closest?.('[data-dial]')
        const next = (row && pointByRow.get(row)) || null
        if (next === focused) return
        focused = next
        request()
    }
    catalog.addEventListener('pointerover', (event) => {
        setFocused(event.target)
        const index = rowDomain(event.target)
        if (index >= 0 || hovered >= 0) setHovered(index)
    })
    catalog.addEventListener('pointerleave', () => {
        setFocused(null)
        setHovered(-1)
    })
    catalog.addEventListener('focusin', (event) => {
        setFocused(event.target)
        setHovered(rowDomain(event.target))
    })
    catalog.addEventListener('focusout', () => {
        setFocused(null)
        setHovered(-1)
    })
    // `toggle` does not bubble, so the catalogue listens for it on the way down.
    catalog.addEventListener(
        'toggle',
        () => {
            opened = [...sections].find(([, section]) => section.open)?.[0] ?? -1
            syncCaption()
            request()
        },
        true
    )

    new MutationObserver(request).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    new ResizeObserver(resize).observe(stage)
    resize()
    opened = [...sections].find(([, section]) => section.open)?.[0] ?? -1
    syncCaption()
    // The opening waits until the dial is on screen, so readers who scroll to it see it unfold.
    const start = () => {
        started = true
        root.dataset.dialReady = ''
        request()
    }
    if ('IntersectionObserver' in window && reveal < 1) {
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return
                observer.disconnect()
                start()
            },
            { threshold: 0.25 }
        )
        observer.observe(stage)
    } else {
        reveal = 1
        start()
    }
}
