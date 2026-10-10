import {
    createFoundationAtlasCurves,
    foundationAtlasAngle,
    foundationAtlasColor,
    foundationAtlasPoint,
    type FoundationAtlas,
    type FoundationAtlasDirection,
    type FoundationAtlasNeighborhood
} from '../../packages/content-core/src/foundation-atlas'
import { FOUNDATION_RELATION_FIELDS } from '../../packages/content-core/src/foundations'
import type { FoundationRelationField } from '../../packages/content-core/src/types'

export interface AtlasSceneView {
    nodeIds: Set<string>
    edges: FoundationAtlas['edges']
    focusId?: string
    /** Present while the scene is re-centred on the focus. */
    neighborhood?: FoundationAtlasNeighborhood
}

export interface AtlasSceneOptions {
    stage: HTMLElement
    tooltip: HTMLElement
    /** Controls floating over the stage; concept names keep clear of them. */
    reserved: HTMLElement[]
    data: FoundationAtlas
    intro: boolean
    sectorLabel(relation: FoundationRelationField, direction: FoundationAtlasDirection): string
    depthLabel: string
    /** Fill the tooltip for a concept or subject; the scene positions it. */
    onHover(target: { node?: string; domain?: string } | undefined): void
    onSelect(id: string): void
    onOpen(id: string): void
    onDomain(id: string): void
    onBackground(): void
    onZoom(zoom: number): void
    /** Called when camera and layout come to rest, and when they start moving again. */
    onSettle(settled: boolean): void
}

type Camera = { x: number; y: number; k: number }
type Label = {
    dx: number
    dy: number
    align: CanvasTextAlign
    text: string
    strong: boolean
    turn?: number
    quiet?: boolean
    size: number
    alpha: number
    goal: number
}

const TAU = Math.PI * 2
const GHOST = 0.1
/** The relation layer is painted a little beyond the stage so a pan does not expose its edge at once. */
const OVERSCAN = 0.12
const DASHES: Record<FoundationRelationField, number[]> = {
    requires: [],
    implemented_by: [],
    special_case_of: [7, 4],
    equivalent_to: [7, 4],
    uses: [1.5, 4],
    contrasts_with: [1.5, 4]
}
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const smooth = (from: number, to: number, value: number) => {
    const t = clamp((value - from) / (to - from), 0, 1)
    return t * t * (3 - 2 * t)
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * The dial is drawn by hand on three layers. Relations are the costly part, so they are painted once
 * and merely moved by the compositor while the camera travels; concepts and rim are redrawn every
 * frame; a light layer on top carries whatever is lit, labelled or moving. Frames are only requested
 * while something changes.
 */
export function createAtlasScene(options: AtlasSceneOptions) {
    const { stage, tooltip, data } = options
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const layer = (name: string) => {
        const canvas = document.createElement('canvas')
        canvas.className = `atlas-layer atlas-layer--${name}`
        canvas.setAttribute('aria-hidden', 'true')
        stage.append(canvas)
        return canvas
    }
    const fibre = layer('edges')
    const base = layer('base')
    const overlay = layer('overlay')
    const weave = fibre.getContext('2d')!
    const still = base.getContext('2d')!
    const light = overlay.getContext('2d')!

    const total = data.nodes.length
    const indexOf = new Map(data.nodes.map((node, index) => [node.id, index]))
    const domainIndex = new Map(data.domains.map((domain, index) => [domain.id, index]))
    const nodeDomain = data.nodes.map((node) => domainIndex.get(node.domains[0])!)
    const depth = Math.max(1, data.rings.length - 2)
    const size = data.nodes.map((node) => Math.min(13, 3 + 1.5 * Math.sqrt(node.degree)))
    const posX = Float32Array.from(data.nodes, (node) => node.x)
    const posY = Float32Array.from(data.nodes, (node) => node.y)
    const fromX = posX.slice()
    const fromY = posY.slice()
    const toX = posX.slice()
    const toY = posY.slice()
    const shown = new Float32Array(total).fill(1)
    const shownFrom = shown.slice()
    const shownTo = shown.slice()
    const edgeSource = data.edges.map((edge) => indexOf.get(edge.source)!)
    const edgeTarget = data.edges.map((edge) => indexOf.get(edge.target)!)
    const edgeRelation = data.edges.map((edge) => FOUNDATION_RELATION_FIELDS.indexOf(edge.relation))
    const edgeIndex = new Map(data.edges.map((edge, index) => [edge.id, index]))
    const directed = FOUNDATION_RELATION_FIELDS.map((field) => field !== 'equivalent_to' && field !== 'contrasts_with')
    // Several relations may join the same pair; each later one bows a little further out.
    const lanes = new Map<number, number>()
    const lane = data.edges.map((_, edge) => {
        const key = Math.min(edgeSource[edge], edgeTarget[edge]) * total + Math.max(edgeSource[edge], edgeTarget[edge])
        const taken = lanes.get(key) ?? 0
        lanes.set(key, taken + 1)
        return taken ? (taken % 2 ? 1 : -1) * Math.ceil(taken / 2) : 0
    })
    const bow = (curve: number[], amount: number) => {
        if (!amount || curve.length !== 8) return curve
        const reach = Math.hypot(curve[6] - curve[0], curve[7] - curve[1]) || 1
        const shiftX = (-(curve[7] - curve[1]) / reach) * amount
        const shiftY = ((curve[6] - curve[0]) / reach) * amount
        return [
            curve[0],
            curve[1],
            curve[2] + shiftX,
            curve[3] + shiftY,
            curve[4] + shiftX,
            curve[5] + shiftY,
            curve[6],
            curve[7]
        ]
    }
    const curveOf = createFoundationAtlasCurves(data)
    const dialCurves = data.edges.map((edge, index) => bow(curveOf(edge), lane[index] * 14))
    // Close up, only relations whose hull meets the stage are worth handing to the rasterizer.
    const dialHull = new Float32Array(data.edges.length * 4)
    dialCurves.forEach((curve, edge) => {
        let left = Infinity
        let right = -Infinity
        let top = Infinity
        let bottom = -Infinity
        for (let at = 0; at < curve.length; at += 2) {
            left = Math.min(left, curve[at])
            right = Math.max(right, curve[at])
            top = Math.min(top, curve[at + 1])
            bottom = Math.max(bottom, curve[at + 1])
        }
        dialHull.set([left, top, right, bottom], edge * 4)
    })
    const incident: number[][] = data.nodes.map(() => [])
    data.edges.forEach((_, edge) => {
        incident[edgeSource[edge]].push(edge)
        incident[edgeTarget[edge]].push(edge)
    })
    // Label priority alternates between subjects so every wing names its best-connected concepts first.
    const priority: number[] = []
    const ranked = data.domains.map((_, domain) =>
        data.nodes
            .map((_, index) => index)
            .filter((index) => nodeDomain[index] === domain)
            .sort((a, b) => data.nodes[b].degree - data.nodes[a].degree)
    )
    for (let turn = 0; priority.length < total; turn++)
        priority.push(
            ...ranked
                .flatMap((list) => (list[turn] === undefined ? [] : [list[turn]]))
                .sort((a, b) => data.nodes[b].degree - data.nodes[a].degree)
        )

    let width = 1
    let height = 1
    let ratio = 1
    let dark = false
    let family = 'sans-serif'
    let serif = 'serif'
    let palette = { background: '#fff', text: '#000', muted: '#666', brand: '#00f' }
    let domainColor: string[] = []
    let domainBright: string[] = []
    let relationColor: string[] = []
    let halo: HTMLCanvasElement[] = []

    const camera: Camera = { x: 0, y: 0, k: 0.2 }
    let fitted = true
    let tween: { from: Camera; to: Camera; start: number; duration: number } | undefined
    let wheel: { k: number; sx: number; sy: number; wx: number; wy: number } | undefined
    let glide: { vx: number; vy: number } | undefined

    let view: AtlasSceneView = { nodeIds: new Set(data.nodes.map((node) => node.id)), edges: data.edges }
    let orbit: FoundationAtlasNeighborhood | undefined
    let focus = -1
    let hover = -1
    let hoverDomain = -1
    let matches: Set<number> | undefined
    let edgeOn = new Uint8Array(data.edges.length).fill(1)
    let orbitCurves = new Map<number, { curve: number[]; tier: number }>()
    type Strokes = { intra: Path2D[]; cross: Path2D[]; relation: Path2D[]; tiers: Path2D[][]; arrows: Path2D[] }
    let strokes: Strokes | undefined
    let edgePaths = new Map<number, Path2D>()
    let transition: { start: number; duration: number; moving: boolean; swapped: boolean } | undefined
    let woven: Camera = { ...camera }
    let wovenRatio = 0
    let wovenAt = 0
    let wovenNear = false
    let weaveCap = 1.5
    let weavePace = 140
    let weaveProbe = false
    let weaveTurn = -1e4
    let weaveStale = true
    let weaveFade = 1
    let dim = 1
    let dimGoal = 1
    let progress = 1
    let mix = 0
    let mixFrom = 0
    let mixTo = 0
    let intro: number | undefined = options.intro && !motion.matches ? -1 : undefined
    let introAt = intro === undefined ? 1 : 0
    let pulse: { node: number; start: number } | undefined
    const labels = new Map<number, Label>()
    let grid = new Map<number, number[]>()
    let gridStale = true
    let labelsStale = true
    let dirtyStill = true
    let dirtyLight = true
    let frame = 0
    let clock = 0
    let awake = true
    let onScreen = true
    let settled = false

    const request = () => {
        if (!frame && awake) frame = requestAnimationFrame(tick)
    }
    const invalidate = (stillLayer = true) => {
        if (stillLayer) dirtyStill = true
        dirtyLight = true
        labelsStale = true
        request()
    }
    const screenX = (x: number) => (x - camera.x) * camera.k + width / 2
    const screenY = (y: number) => (y - camera.y) * camera.k + height / 2
    const worldX = (x: number) => (x - width / 2) / camera.k + camera.x
    const worldY = (y: number) => (y - height / 2) / camera.k + camera.y
    const drawn = (node: number) =>
        Math.max(1.2 / camera.k, size[node] * (orbit ? 1 : 1 + 0.45 * (1 - smooth(0.3, 0.9, camera.k))))

    function readTheme() {
        const css = getComputedStyle(stage)
        const value = (name: string) => css.getPropertyValue(name).trim()
        dark = document.documentElement.classList.contains('dark')
        family = css.fontFamily
        serif = value('--article-title-font-family') || 'serif'
        palette = {
            background: value('--vp-c-bg'),
            text: value('--vp-c-text-1'),
            muted: value('--vp-c-text-2'),
            brand: value('--vp-c-brand')
        }
        const theme = dark ? 'dark' : 'light'
        domainColor = data.domains.map((domain) => foundationAtlasColor(domain.hue, theme))
        domainBright = data.domains.map((domain) => foundationAtlasColor(domain.hue, theme, 0.8))
        relationColor = FOUNDATION_RELATION_FIELDS.map((field) => value(`--atlas-${field}`))
        halo = domainColor.map((color) => {
            const sprite = document.createElement('canvas')
            sprite.width = sprite.height = 64
            const context = sprite.getContext('2d')!
            const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
            gradient.addColorStop(0, `${color}88`)
            gradient.addColorStop(0.35, `${color}2e`)
            gradient.addColorStop(1, `${color}00`)
            context.fillStyle = gradient
            context.fillRect(0, 0, 64, 64)
            return sprite
        })
        widths.clear()
        weaveStale = true
        invalidate()
    }

    function resize() {
        const nextWidth = stage.clientWidth
        const nextHeight = stage.clientHeight
        if (!nextWidth || !nextHeight) return
        const wasFitted = fitted
        width = nextWidth
        height = nextHeight
        ratio = Math.min(2, window.devicePixelRatio || 1)
        for (const canvas of [base, overlay]) {
            canvas.width = Math.round(width * ratio)
            canvas.height = Math.round(height * ratio)
        }
        wovenRatio = 0
        weaveStale = true
        const frameBox = stage.getBoundingClientRect()
        reserved = options.reserved.flatMap((control) => {
            const box = control.getBoundingClientRect()
            return box.width
                ? [
                      box.left - frameBox.left - 6,
                      box.top - frameBox.top - 6,
                      box.right - frameBox.left + 6,
                      box.bottom - frameBox.top + 6
                  ]
                : []
        })
        if (wasFitted) Object.assign(camera, fitCamera())
        invalidate()
    }

    /** Zoom at which the whole dial, rim lettering included, sits inside the stage. */
    const dialZoom = () => (Math.min(width, height) - (Math.min(width, height) < 520 ? 108 : 132)) / (2 * data.radius)

    function fitCamera(): Camera {
        if (orbit) {
            const upright = orbit.rings.length === 1 && orbit.positions.size <= 13
            const room = Math.min(upright ? 110 : 170, Math.min(width, height) * 0.24)
            const reach = Math.max(orbit.radius, 150)
            return { x: 0, y: 0, k: clamp((Math.min(width, height) / 2 - room) / reach, 0.05, 1.5) }
        }
        if (view.nodeIds.size === total || !view.nodeIds.size) return { x: 0, y: 0, k: dialZoom() }
        // A filtered subject also shows its few members filed under other subjects; frame the subject itself.
        const census = data.domains.map(() => 0)
        for (let node = 0; node < total; node++) if (shownTo[node] >= 0.5) census[nodeDomain[node]]++
        const main = census.indexOf(Math.max(...census))
        const single = census[main] >= view.nodeIds.size * 0.8
        let left = Infinity
        let right = -Infinity
        let top = Infinity
        let bottom = -Infinity
        for (let node = 0; node < total; node++) {
            if (shownTo[node] < 0.5 || (single && nodeDomain[node] !== main)) continue
            left = Math.min(left, toX[node])
            right = Math.max(right, toX[node])
            top = Math.min(top, toY[node])
            bottom = Math.max(bottom, toY[node])
        }
        const margin = Math.min(width, height) < 520 ? 44 : 96
        return {
            x: (left + right) / 2,
            y: (top + bottom) / 2,
            k: clamp(
                Math.min((width - 2 * margin) / (right - left + 1), (height - 2 * margin) / (bottom - top + 1)),
                dialZoom(),
                1.6
            )
        }
    }

    function flyTo(to: Camera, duration = 720) {
        wheel = glide = undefined
        if (motion.matches || !duration) {
            Object.assign(camera, to)
            tween = undefined
        } else tween = { from: { ...camera }, to, start: performance.now(), duration }
        invalidate()
    }

    function pathOf(curve: number[]) {
        const path = new Path2D()
        appendCurve(path, curve)
        return path
    }
    function appendCurve(path: Path2D, curve: number[]) {
        path.moveTo(curve[0], curve[1])
        for (let at = 2; at < curve.length; at += 6)
            path.bezierCurveTo(curve[at], curve[at + 1], curve[at + 2], curve[at + 3], curve[at + 4], curve[at + 5])
    }
    function appendArrow(path: Path2D, curve: number[], inset: number, length: number) {
        const endX = curve.at(-2)!
        const endY = curve.at(-1)!
        let at = curve.length - 4
        while (at > 0 && Math.hypot(endX - curve[at], endY - curve[at + 1]) < 0.5) at -= 2
        const reach = Math.hypot(endX - curve[at], endY - curve[at + 1]) || 1
        const ux = (endX - curve[at]) / reach
        const uy = (endY - curve[at + 1]) / reach
        const tipX = endX - ux * inset
        const tipY = endY - uy * inset
        path.moveTo(tipX, tipY)
        path.lineTo(tipX - ux * length - uy * length * 0.42, tipY - uy * length + ux * length * 0.42)
        path.lineTo(tipX - ux * length + uy * length * 0.42, tipY - uy * length - ux * length * 0.42)
        path.closePath()
    }

    function orbitCurve(edge: number) {
        const source = orbit!.positions.get(data.edges[edge].source)!
        const target = orbit!.positions.get(data.edges[edge].target)!
        const line = (pull: number, lift = pull) => [
            source.x,
            source.y,
            source.x * pull,
            source.y * pull,
            target.x * lift,
            target.y * lift,
            target.x,
            target.y
        ]
        if (!source.ring || !target.ring)
            return {
                tier: 0,
                curve: bow(
                    [
                        source.x,
                        source.y,
                        source.x + (target.x - source.x) / 3,
                        source.y + (target.y - source.y) / 3,
                        source.x + ((target.x - source.x) * 2) / 3,
                        source.y + ((target.y - source.y) * 2) / 3,
                        target.x,
                        target.y
                    ],
                    lane[edge] * 22
                )
            }
        if (source.parent === data.edges[edge].target || target.parent === data.edges[edge].source) {
            const middle = (orbit!.rings[0] + orbit!.rings[1]) / 2
            return {
                tier: 1,
                curve: line(middle / orbit!.rings[source.ring - 1], middle / orbit!.rings[target.ring - 1])
            }
        }
        const apart = Math.abs(((source.angle - target.angle + Math.PI * 3) % TAU) - Math.PI)
        return { tier: 2, curve: line(1 - 0.5 * (apart / Math.PI) ** 0.6) }
    }

    function buildStrokes(within?: { left: number; top: number; right: number; bottom: number }): Strokes {
        const relations = () => FOUNDATION_RELATION_FIELDS.map(() => new Path2D())
        const result: Strokes = {
            intra: data.domains.map(() => new Path2D()),
            cross: data.domains.map(() => new Path2D()),
            relation: relations(),
            tiers: [relations(), relations(), relations()],
            arrows: relations()
        }
        for (let edge = 0; edge < data.edges.length; edge++) {
            if (!edgeOn[edge]) continue
            if (
                within &&
                (dialHull[edge * 4] > within.right ||
                    dialHull[edge * 4 + 2] < within.left ||
                    dialHull[edge * 4 + 1] > within.bottom ||
                    dialHull[edge * 4 + 3] < within.top)
            )
                continue
            const source = edgeSource[edge]
            const relation = edgeRelation[edge]
            if (orbit) {
                const shape = orbitCurves.get(edge)!
                appendCurve(result.tiers[shape.tier][relation], shape.curve)
                if (directed[relation] && shape.tier < 2)
                    appendArrow(result.arrows[relation], shape.curve, size[edgeTarget[edge]] + 7, 8)
            } else {
                const curve = dialCurves[edge]
                appendCurve(
                    (nodeDomain[source] === nodeDomain[edgeTarget[edge]] ? result.intra : result.cross)[
                        nodeDomain[source]
                    ],
                    curve
                )
                appendCurve(result.relation[relation], curve)
                if (directed[relation]) appendArrow(result.arrows[relation], curve, size[edgeTarget[edge]] + 2, 5)
            }
        }
        return result
    }
    const edgePath = (edge: number) => {
        let path = edgePaths.get(edge)
        if (!path) {
            path = pathOf(orbit ? orbitCurves.get(edge)!.curve : dialCurves[edge])
            edgePaths.set(edge, path)
        }
        return path
    }

    function setView(next: AtlasSceneView, mode: { animate?: boolean; frame?: 'fit' | 'keep' } = {}) {
        const animate = mode.animate !== false && !motion.matches
        const wasOrbit = Boolean(orbit)
        const oldFocus = focus
        const origin = oldFocus >= 0 ? { x: posX[oldFocus], y: posY[oldFocus] } : undefined
        view = next
        orbit = next.neighborhood
        focus = next.focusId ? (indexOf.get(next.focusId) ?? -1) : -1
        let moving = false
        for (let node = 0; node < total; node++) {
            const id = data.nodes[node].id
            const place = orbit?.positions.get(id)
            const inside = next.nodeIds.has(id)
            shownFrom[node] = shown[node]
            shownTo[node] = orbit ? (place ? 1 : 0) : inside ? 1 : GHOST
            toX[node] = place ? place.x : data.nodes[node].x
            toY[node] = place ? place.y : data.nodes[node].y
            // Concepts joining a re-centred neighborhood unfold from the concept that was chosen.
            if (orbit && wasOrbit && origin && shown[node] < 0.05 && place) {
                posX[node] = origin.x
                posY[node] = origin.y
            }
            fromX[node] = posX[node]
            fromY[node] = posY[node]
            if (Math.abs(toX[node] - posX[node]) > 0.5 || Math.abs(toY[node] - posY[node]) > 0.5) moving = true
        }
        edgeOn = new Uint8Array(data.edges.length)
        edgePaths = new Map()
        orbitCurves = new Map()
        for (const edge of next.edges) {
            const index = edgeIndex.get(edge.id)!
            edgeOn[index] = 1
            if (orbit) orbitCurves.set(index, orbitCurve(index))
        }
        strokes = buildStrokes()
        mixFrom = mix
        mixTo = orbit ? 1 : 0
        if (animate) {
            transition = { start: performance.now(), duration: moving ? 900 : 320, moving, swapped: false }
            progress = 0
        } else {
            transition = undefined
            progress = 1
            mix = mixTo
            posX.set(toX)
            posY.set(toY)
            shown.set(shownTo)
            weaveStale = true
            wovenAt = 0
        }
        if (focus >= 0 && focus !== oldFocus && animate) pulse = { node: focus, start: performance.now() }
        gridStale = true
        hover = hoverDomain = -1
        tooltip.hidden = true
        if (mode.frame !== 'keep') {
            fitted = true
            flyTo(fitCamera(), animate ? (moving ? 900 : 620) : 0)
        }
        syncDim()
        invalidate()
    }

    function syncDim() {
        const lit = hover >= 0 || hoverDomain >= 0 || Boolean(matches)
        dimGoal = focus >= 0 && !orbit ? 0.24 : lit ? 0.5 : 1
        stage.style.cursor = hover >= 0 || hoverDomain >= 0 ? 'pointer' : ''
        request()
    }

    function rebuildGrid() {
        gridStale = false
        grid = new Map()
        for (let node = 0; node < total; node++) {
            if (shownTo[node] < 0.5) continue
            const key = Math.floor(posX[node] / 64) * 4096 + Math.floor(posY[node] / 64)
            const cell = grid.get(key)
            if (cell) cell.push(node)
            else grid.set(key, [node])
        }
    }
    function nodeAt(x: number, y: number) {
        if (transition?.moving) return -1
        if (gridStale) rebuildGrid()
        const wx = worldX(x)
        const wy = worldY(y)
        const reach = Math.max(14, 11 / camera.k)
        let best = -1
        let nearest = Infinity
        for (let cx = Math.floor((wx - reach) / 64); cx <= Math.floor((wx + reach) / 64); cx++) {
            for (let cy = Math.floor((wy - reach) / 64); cy <= Math.floor((wy + reach) / 64); cy++) {
                for (const node of grid.get(cx * 4096 + cy) ?? []) {
                    const distance = Math.hypot(posX[node] - wx, posY[node] - wy)
                    if (distance < Math.max(drawn(node) + 3 / camera.k, 9 / camera.k) && distance < nearest) {
                        nearest = distance
                        best = node
                    }
                }
            }
        }
        return best
    }
    const rim = () => {
        const letter = clamp(58 * camera.k, Math.min(width, height) < 520 ? 10 : 11, 15)
        return { letter, radius: data.radius + 12 + (10 + letter / 2) / camera.k }
    }
    /**
     * Subject names are lettered along the rim. A long name in a narrow wedge may borrow room from its
     * neighbours as long as the whole wing still fits; only then are names clipped to their own wedge.
     */
    let lettering: Array<{ title: string; count: boolean; centre: number; span: number }> = []
    function letterRim(context: CanvasRenderingContext2D) {
        const { letter, radius } = rim()
        const em = letter / camera.k / radius
        lettering = data.domains.map((domain) => {
            const room = (domain.end - domain.start) / em - 0.6
            const own = measure(context, domain.title, 600)
            const count = own + measure(context, ` ${domain.count}`, 500) * 0.82 <= room
            return {
                title: domain.title,
                count,
                centre: (domain.start + domain.end) / 2,
                span: (count ? own + measure(context, ` ${domain.count}`, 500) * 0.82 : own) * em
            }
        })
        for (const group of data.groups) {
            const wing = data.domains.flatMap((domain, index) => (domain.group === group.id ? [index] : []))
            const space = 0.9 * em
            const needed = wing.reduce((sum, index) => sum + lettering[index].span + space, -space)
            const room = group.end - group.start + 0.1
            if (needed > room) {
                // Too little rim for every full name: all names give up the same share.
                for (const index of wing) {
                    const domain = data.domains[index]
                    const own = (domain.end - domain.start) / em - 0.6
                    const full = measure(context, domain.title, 600)
                    if (full <= own) continue
                    lettering[index].count = false
                    lettering[index].title = clip(
                        context,
                        domain.title,
                        600,
                        Math.max(own, (full * room) / needed - 0.5)
                    )
                    lettering[index].span = measure(context, lettering[index].title, 600) * em
                }
            }
            const step = (at: number) => (lettering[wing[at - 1]].span + lettering[wing[at]].span) / 2 + space
            const forward = wing.map((index) => lettering[index].centre)
            const backward = [...forward]
            for (let at = 1; at < wing.length; at++) forward[at] = Math.max(forward[at], forward[at - 1] + step(at))
            for (let at = wing.length - 2; at >= 0; at--)
                backward[at] = Math.min(backward[at], backward[at + 1] - step(at + 1))
            wing.forEach((index, at) => {
                lettering[index].centre = (forward[at] + backward[at]) / 2
            })
        }
    }
    function domainAt(x: number, y: number) {
        if (orbit || transition) return -1
        const wx = worldX(x)
        const wy = worldY(y)
        const { letter, radius } = rim()
        const distance = Math.hypot(wx, wy)
        const angle = foundationAtlasAngle(wx, wy)
        if (Math.abs(distance - radius) <= (letter / 2 + 7) / camera.k) {
            const named = lettering.findIndex((label) => Math.abs(angle - label.centre) <= label.span / 2 + 0.01)
            if (named >= 0) return named
        }
        if (distance < data.radius + 4 || distance > radius + (letter / 2 + 7) / camera.k) return -1
        return data.domains.findIndex((domain) => angle >= domain.start && angle <= domain.end)
    }

    // Glyph advances are measured once at a reference size and scaled.
    const widths = new Map<string, number>()
    function measure(context: CanvasRenderingContext2D, text: string, weight: number, face = family) {
        const key = `${weight}${face === family ? '' : 's'}${text}`
        let known = widths.get(key)
        if (known === undefined) {
            context.font = `${weight} 100px ${face}`
            known = context.measureText(text).width / 100
            widths.set(key, known)
        }
        return known
    }
    function clip(context: CanvasRenderingContext2D, text: string, weight: number, room: number) {
        if (measure(context, text, weight) <= room) return text
        const glyphs = Array.from(text)
        while (glyphs.length > 1 && measure(context, `${glyphs.join('')}…`, weight) > room) glyphs.pop()
        return `${glyphs.join('').trimEnd()}…`
    }

    /** Letter a string along an arc; below the horizon it turns over so it never reads upside down. */
    function arcText(
        context: CanvasRenderingContext2D,
        parts: Array<{ text: string; color: string; weight: number; scale?: number; tracking?: number }>,
        radius: number,
        angle: number,
        letter: number,
        face = family
    ) {
        const turned = angle > Math.PI / 2 && angle < (Math.PI * 3) / 2
        const glyphs = parts.flatMap((part) =>
            Array.from(part.text, (glyph) => ({
                glyph,
                part,
                advance:
                    (measure(context, glyph, part.weight, face) * (part.scale ?? 1) + (part.tracking ?? 0)) * letter
            }))
        )
        let at = -glyphs.reduce((sum, item) => sum + item.advance, 0) / 2
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        for (const item of glyphs) {
            const along = angle + ((turned ? -1 : 1) * (at + item.advance / 2)) / radius
            const point = foundationAtlasPoint(radius, along)
            context.save()
            context.translate(point.x, point.y)
            context.rotate(along + (turned ? Math.PI : 0))
            context.font = `${item.part.weight} ${letter * (item.part.scale ?? 1)}px ${face}`
            context.fillStyle = item.part.color
            context.fillText(item.glyph, 0, 0)
            context.restore()
            at += item.advance
        }
    }
    const arc = (context: CanvasRenderingContext2D | Path2D, radius: number, start: number, end: number) => {
        context.moveTo(radius * Math.sin(start), -radius * Math.cos(start))
        context.arc(0, 0, radius, start - Math.PI / 2, end - Math.PI / 2)
    }

    function drawDial(context: CanvasRenderingContext2D, pixel: number, amount: number) {
        context.lineWidth = pixel
        context.strokeStyle = palette.text
        for (const major of [false, true]) {
            context.beginPath()
            data.rings.forEach((radius, rank) => {
                if ((rank % 5 === 0 || rank === data.rings.length - 1) !== major) return
                for (const group of data.groups) arc(context, radius, group.start - 0.03, group.end + 0.03)
            })
            context.globalAlpha = amount * (major ? 0.16 : 0.07) * (dark ? 1 : 1.15)
            context.stroke()
        }
        context.beginPath()
        arc(context, data.gate, 0, TAU)
        context.globalAlpha = amount * 0.12
        context.stroke()

        const { letter, radius } = rim()
        const type = letter * pixel
        letterRim(context)
        data.domains.forEach((domain, index) => {
            const lit = hoverDomain === index
            context.beginPath()
            arc(context, data.radius + 12, domain.start, domain.end)
            context.strokeStyle = domainColor[index]
            context.lineWidth = Math.max(2.5 * pixel, 5)
            context.globalAlpha = amount * (hoverDomain < 0 || lit ? 1 : 0.4)
            context.stroke()
            arcText(
                context,
                [
                    { text: lettering[index].title, color: lit ? domainBright[index] : palette.text, weight: 600 },
                    ...(lettering[index].count
                        ? [{ text: ` ${domain.count}`, color: palette.muted, weight: 500, scale: 0.82 }]
                        : [])
                ],
                radius,
                lettering[index].centre,
                type
            )
        })
        const wing = clamp(74 * camera.k, 13, 19) * pixel
        context.globalAlpha = amount
        for (const group of data.groups)
            arcText(
                context,
                [
                    { text: group.title, color: palette.text, weight: 700, tracking: 0.2 },
                    { text: `  ${group.count.toLocaleString('en')}`, color: palette.muted, weight: 500, scale: 0.72 }
                ],
                radius + type / 2 + 12 * pixel + wing / 2,
                (group.start + group.end) / 2,
                wing,
                serif
            )

        // The gap at twelve o'clock carries the depth scale, like the rule on an astrolabe.
        const scale = clamp(46 * camera.k, 9, 11) * pixel
        // Measuring sets its own reference font, so it has to happen before this one is chosen.
        const captioned =
            data.groups.length > 0 &&
            measure(context, options.depthLabel, 500) * scale < data.groups[0].start * 2 * data.radius
        context.font = `500 ${scale}px ${family}`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillStyle = palette.muted
        context.globalAlpha = amount * 0.9
        for (let rank = 0; rank + 1 < data.rings.length; rank += 5)
            context.fillText(String(rank), 0, -(data.rings[rank] + data.rings[rank + 1]) / 2)
        if (captioned) context.fillText(options.depthLabel, 0, -(data.radius + 12 + 16 * pixel))
    }

    function drawOrbit(context: CanvasRenderingContext2D, pixel: number, amount: number) {
        if (!orbit) return
        context.lineWidth = pixel
        context.strokeStyle = palette.text
        context.setLineDash([2 * pixel, 5 * pixel])
        context.beginPath()
        for (const radius of orbit.rings) arc(context, radius, 0, TAU)
        context.globalAlpha = amount * 0.2
        context.stroke()
        context.setLineDash([])
        const band = orbit.rings[0] * 0.56
        const letter = clamp(13 * camera.k, 10.5, 13) * pixel
        for (const sector of orbit.sectors) {
            const color = relationColor[FOUNDATION_RELATION_FIELDS.indexOf(sector.relation)]
            const whole = sector.end - sector.start > TAU - 0.2
            context.beginPath()
            arc(context, band, sector.start + (whole ? 0 : 0.02), sector.end - (whole ? 0 : 0.02))
            context.strokeStyle = color
            context.lineWidth = Math.max(1.5 * pixel, 2)
            context.globalAlpha = amount * 0.6
            context.stroke()
            const text = `${options.sectorLabel(sector.relation, sector.direction)} · ${sector.count}`
            if (band * camera.k < 46) continue
            if (measure(context, text, 600) * letter > (sector.end - sector.start) * band * 1.6 + 40 * pixel) continue
            context.globalAlpha = amount
            arcText(
                context,
                [{ text, color: dark ? color : palette.text, weight: 600 }],
                band + letter * 0.95,
                // A relation that surrounds the focus is named above it, clear of the focus label.
                whole ? 0 : (sector.start + sector.end) / 2,
                letter
            )
        }
    }

    function strokeEdges(context: CanvasRenderingContext2D, pixel: number, set: Strokes, near: boolean) {
        if (orbit) {
            const few = view.edges.length < 260
            ;[few ? 0.9 : 0.8, few ? 0.58 : 0.42, few ? 0.2 : 0.12].forEach((alpha, tier) => {
                context.lineWidth = (tier ? 1 : 1.5) * Math.max(pixel, 1)
                FOUNDATION_RELATION_FIELDS.forEach((field, relation) => {
                    context.setLineDash(DASHES[field].map((dash) => dash * Math.max(pixel, 1)))
                    context.strokeStyle = relationColor[relation]
                    context.globalAlpha = alpha
                    context.stroke(set.tiers[tier][relation])
                })
            })
            context.setLineDash([])
            FOUNDATION_RELATION_FIELDS.forEach((_, relation) => {
                context.fillStyle = relationColor[relation]
                context.globalAlpha = 0.9
                context.fill(set.arrows[relation])
            })
            return
        }
        // From afar relations take their subject's colour; close up they take their own type.
        if (!near) {
            context.globalCompositeOperation = dark ? 'lighter' : 'source-over'
            context.lineWidth = clamp(0.85 * pixel, 0.7, 3.4)
            data.domains.forEach((_, domain) => {
                context.strokeStyle = domainColor[domain]
                context.globalAlpha = dark ? 0.19 : 0.3
                context.stroke(set.intra[domain])
                context.globalAlpha = dark ? 0.085 : 0.15
                context.stroke(set.cross[domain])
            })
            context.globalCompositeOperation = 'source-over'
            return
        }
        // Thousands of dashed curves would stall the rasterizer; line patterns are kept for lit relations.
        context.lineWidth = pixel
        FOUNDATION_RELATION_FIELDS.forEach((_, relation) => {
            context.strokeStyle = context.fillStyle = relationColor[relation]
            context.globalAlpha = 0.5
            context.stroke(set.relation[relation])
            context.globalAlpha = 0.75
            context.fill(set.arrows[relation])
        })
    }

    /** Paint every visible relation at the current camera and let the compositor carry it from there. */
    function drawWeave(now: number) {
        const started = performance.now()
        const wanted = Math.min(ratio, weaveCap)
        const near = camera.k > 0.86 || (wovenNear && camera.k > 0.74)
        if (near !== wovenNear && !orbit) weaveTurn = now
        wovenNear = near
        const spanX = width * (1 + 2 * OVERSCAN)
        const spanY = height * (1 + 2 * OVERSCAN)
        if (wanted !== wovenRatio) {
            wovenRatio = wanted
            fibre.width = Math.round(spanX * wanted)
            fibre.height = Math.round(spanY * wanted)
        }
        weave.setTransform(1, 0, 0, 1, 0, 0)
        weave.clearRect(0, 0, fibre.width, fibre.height)
        weave.setTransform(
            wanted * camera.k,
            0,
            0,
            wanted * camera.k,
            wanted * (spanX / 2 - camera.x * camera.k),
            wanted * (spanY / 2 - camera.y * camera.k)
        )
        const cropped = !orbit && camera.k > dialZoom() * 1.5
        const visible = cropped
            ? buildStrokes({
                  left: camera.x - spanX / 2 / camera.k,
                  right: camera.x + spanX / 2 / camera.k,
                  top: camera.y - spanY / 2 / camera.k,
                  bottom: camera.y + spanY / 2 / camera.k
              })
            : strokes
        if (visible) strokeEdges(weave, 1 / camera.k, visible, near)
        weave.globalAlpha = 1
        woven = { ...camera }
        fibre.style.transform = ''
        weaveStale = false
        wovenAt = now
        weaveProbe = true
        // A rasterizer that needs this long is not accelerated; give it fewer pixels from now on.
        if (performance.now() - started > 70) weaveCap = 1
    }

    function drawStill() {
        dirtyStill = false
        const pixel = 1 / camera.k
        still.setTransform(ratio, 0, 0, ratio, 0, 0)
        still.clearRect(0, 0, width, height)
        still.setTransform(
            ratio * camera.k,
            0,
            0,
            ratio * camera.k,
            ratio * (width / 2 - camera.x * camera.k),
            ratio * (height / 2 - camera.y * camera.k)
        )
        const settle = transition?.moving ? smooth(0.55, 1, progress) : 1
        if (mix < 0.99) drawDial(still, pixel, (1 - mix) * smooth(0, 0.4, introAt))
        if (mix > 0.01) drawOrbit(still, pixel, mix * settle)

        const left = worldX(-20)
        const right = worldX(width + 20)
        const top = worldY(-20)
        const bottom = worldY(height + 20)
        const revealed = (node: number) =>
            introAt >= 1 ? 1 : clamp((introAt * 1.2 - data.nodes[node].rank / (depth + 1)) / 0.14, 0, 1)
        if (dark) {
            still.globalCompositeOperation = 'lighter'
            for (let node = 0; node < total; node++) {
                const alpha = shown[node] * revealed(node)
                if (data.nodes[node].degree < 9 || alpha < 0.5) continue
                const x = posX[node]
                const y = posY[node]
                const reach = drawn(node) * 3.4
                if (x < left - reach || x > right + reach || y < top - reach || y > bottom + reach) continue
                still.globalAlpha = alpha * 0.7
                still.drawImage(halo[nodeDomain[node]], x - reach, y - reach, reach * 2, reach * 2)
            }
            still.globalCompositeOperation = 'source-over'
        }
        const partial: number[] = []
        data.domains.forEach((_, domain) => {
            still.fillStyle = domainColor[domain]
            still.globalAlpha = 1
            still.beginPath()
            for (const node of ranked[domain]) {
                const x = posX[node]
                const y = posY[node]
                if (x < left || x > right || y < top || y > bottom) continue
                const alpha = shown[node] * revealed(node)
                if (alpha < 0.012) continue
                if (alpha < 0.99) {
                    partial.push(node, alpha)
                    continue
                }
                const radius = drawn(node)
                still.moveTo(x + radius, y)
                still.arc(x, y, radius, 0, TAU)
            }
            still.fill()
        })
        for (let at = 0; at < partial.length; at += 2) {
            const node = partial[at]
            still.fillStyle = domainColor[nodeDomain[node]]
            still.globalAlpha = partial[at + 1]
            still.beginPath()
            still.arc(posX[node], posY[node], drawn(node), 0, TAU)
            still.fill()
        }
        still.globalAlpha = 1
    }

    function planLabels() {
        labelsStale = false
        const plan = new Map<number, Omit<Label, 'alpha' | 'goal'>>()
        const boxes: number[] = [...reserved]
        const blocked = (x0: number, y0: number, x1: number, y1: number) => {
            if (x0 < 2 || x1 > width - 2) return true
            for (let at = 0; at < boxes.length; at += 4)
                if (x0 < boxes[at + 2] && x1 > boxes[at] && y0 < boxes[at + 3] && y1 > boxes[at + 1]) return true
            return false
        }
        const moving = Boolean(transition?.moving) && progress < 0.72
        const place = (node: number, strong: boolean, required = false) => {
            if (plan.has(node) || shownTo[node] < 0.5) return
            const x = screenX(posX[node])
            const y = screenY(posY[node])
            if (x < -60 || x > width + 60 || y < -20 || y > height + 20) return
            const letter = strong ? 13 : 12
            const text = clip(light, data.nodes[node].title, strong ? 650 : 500, 15)
            const span = measure(light, text, strong ? 650 : 500) * letter
            const reach = drawn(node) * camera.k + 5
            const sides = posX[node] < 0 ? [-1, 1] : [1, -1]
            for (const side of sides) {
                const x0 = side > 0 ? x + reach : x - reach - span
                if (blocked(x0 - 9, y - 10, x0 + span + 9, y + 10)) continue
                boxes.push(x0 - 9, y - 10, x0 + span + 9, y + 10)
                plan.set(node, {
                    dx: side * reach,
                    dy: 0,
                    align: side > 0 ? 'left' : 'right',
                    text,
                    strong,
                    size: letter
                })
                return
            }
            if (!required && !strong) return
            const y0 = y + reach + 3
            if (!required && blocked(x - span / 2 - 4, y0, x + span / 2 + 4, y0 + 18)) return
            boxes.push(x - span / 2 - 4, y0, x + span / 2 + 4, y0 + 18)
            plan.set(node, { dx: 0, dy: reach + 12, align: 'center', text, strong, size: letter })
        }
        if (orbit && !moving) {
            if (focus >= 0) {
                const reach = drawn(focus) * camera.k + 16
                const text = clip(light, data.nodes[focus].title, 700, 18)
                plan.set(focus, { dx: 0, dy: reach, align: 'center', text, strong: true, size: 15 })
            }
            const letter = clamp(13 * camera.k, 11, 14)
            orbit.rings.forEach((radius, ring) => {
                const taken: number[] = []
                const next = orbit!.rings[ring + 1]
                const room = (next ? (next - radius) * camera.k - 26 : 190) / letter
                const members = priority.filter((node) => orbit!.positions.get(data.nodes[node].id)?.ring === ring + 1)
                const need = (letter + 2.5) / (radius * camera.k)
                // A handful of first-hop concepts can afford upright names.
                if (!ring && members.length <= 12) {
                    for (const node of members) {
                        const { angle } = orbit!.positions.get(data.nodes[node].id)!
                        const reach = drawn(node) * camera.k + 9
                        const side = Math.sin(angle)
                        const flat = Math.abs(side) > 0.38
                        plan.set(node, {
                            dx: flat ? side * reach : 0,
                            dy: -Math.cos(angle) * (reach + (flat ? 0 : 7)),
                            align: flat ? (side > 0 ? 'left' : 'right') : 'center',
                            text: clip(light, data.nodes[node].title, 650, 16),
                            strong: true,
                            size: clamp(14 * camera.k, 12, 14)
                        })
                    }
                    return
                }
                for (const node of hover >= 0 ? [hover, ...members] : members) {
                    const position = orbit!.positions.get(data.nodes[node].id)
                    if (position?.ring !== ring + 1 || plan.has(node)) continue
                    if (
                        taken.some((angle) => Math.abs(((angle - position.angle + Math.PI * 3) % TAU) - Math.PI) < need)
                    )
                        continue
                    taken.push(position.angle)
                    const outward = position.angle < Math.PI
                    plan.set(node, {
                        dx: (outward ? 1 : -1) * (drawn(node) * camera.k + 6),
                        dy: 0,
                        align: outward ? 'left' : 'right',
                        text: clip(light, data.nodes[node].title, node === hover ? 650 : 500, Math.max(4, room)),
                        strong: node === hover,
                        quiet: ring > 0 && node !== hover,
                        turn: position.angle + (outward ? -1 : 1) * (Math.PI / 2),
                        size: letter
                    })
                }
            })
        } else if (!orbit && !moving) {
            const around = (node: number, limit: number) =>
                incident[node]
                    .filter((edge) => edgeOn[edge])
                    .map((edge) => (edgeSource[edge] === node ? edgeTarget[edge] : edgeSource[edge]))
                    .sort((a, b) => data.nodes[b].degree - data.nodes[a].degree)
                    .slice(0, limit)
            if (focus >= 0) place(focus, true, true)
            if (hover >= 0) place(hover, true, true)
            if (focus >= 0) for (const node of around(focus, 60)) place(node, false)
            if (hover >= 0 && hover !== focus) for (const node of around(hover, 18)) place(node, false)
            if (matches) {
                let named = 0
                for (const node of priority) {
                    if (!matches.has(node)) continue
                    place(node, false)
                    if (++named >= 40) break
                }
            } else if (focus < 0 && hoverDomain < 0) {
                // A phone-sized dial names a handful of landmarks; a large one names one or two per subject.
                const scale = (camera.k / dialZoom()) * clamp(Math.min(width, height) / 760, 0.5, 1)
                const budget = camera.k >= 1.4 ? total : Math.round(data.domains.length * 1.25 * scale ** 2.4)
                let named = 0
                for (const node of priority) {
                    if (shownTo[node] < 0.5) continue
                    if (++named > budget) break
                    place(node, false)
                }
            } else if (hoverDomain >= 0) {
                for (const node of ranked[hoverDomain].slice(0, 9)) place(node, false)
            }
        }
        for (const [node, label] of labels) if (!plan.has(node)) label.goal = 0
        for (const [node, spec] of plan) {
            const label = labels.get(node)
            labels.set(node, { ...spec, alpha: label?.alpha ?? (motion.matches ? 1 : 0), goal: 1 })
        }
    }

    function drawLight(now: number) {
        dirtyLight = false
        if (labelsStale) planLabels()
        const pixel = 1 / camera.k
        light.setTransform(ratio, 0, 0, ratio, 0, 0)
        light.clearRect(0, 0, width, height)
        light.setTransform(
            ratio * camera.k,
            0,
            0,
            ratio * camera.k,
            ratio * (width / 2 - camera.x * camera.k),
            ratio * (height / 2 - camera.y * camera.k)
        )
        const settled = !transition?.moving || progress > 0.8
        const lit = new Set<number>()
        const lightEdges = (node: number, strength: number, flow: number) => {
            lit.add(node)
            for (const edge of incident[node]) {
                if (!edgeOn[edge]) continue
                const relation = edgeRelation[edge]
                const path = edgePath(edge)
                lit.add(edgeSource[edge] === node ? edgeTarget[edge] : edgeSource[edge])
                if (strength) {
                    light.setLineDash(
                        DASHES[FOUNDATION_RELATION_FIELDS[relation]].map((dash) => dash * Math.max(pixel, 0.5))
                    )
                    light.strokeStyle = relationColor[relation]
                    light.lineWidth = 1.5 * pixel
                    light.globalAlpha = strength
                    light.stroke(path)
                }
                if (!directed[relation]) continue
                if (strength && (!orbit || orbitCurves.get(edge)!.tier === 2)) {
                    const arrow = new Path2D()
                    appendArrow(
                        arrow,
                        orbit ? orbitCurves.get(edge)!.curve : dialCurves[edge],
                        drawn(edgeTarget[edge]) + 2 * pixel,
                        Math.max(7 * pixel, 6)
                    )
                    light.fillStyle = relationColor[relation]
                    light.fill(arrow)
                }
                if (!flow || motion.matches) continue
                // A short pulse travels every directed relation from its source to its target.
                light.setLineDash([9 * pixel, 87 * pixel])
                light.lineDashOffset = -((now * 0.055 + edge * 37) % 96) * pixel
                light.lineCap = 'round'
                light.lineWidth = 2.6 * pixel
                light.strokeStyle = dark ? '#fff' : relationColor[relation]
                light.globalAlpha = flow
                light.stroke(path)
                light.lineCap = 'butt'
                light.lineDashOffset = 0
            }
            light.setLineDash([])
        }
        if (settled) {
            if (focus >= 0) lightEdges(focus, orbit ? 0 : 0.95, dark ? 0.85 : 1)
            if (hover >= 0 && hover !== focus) lightEdges(hover, 0.95, 0)
        }
        if (hoverDomain >= 0 && strokes && !orbit) {
            light.globalCompositeOperation = dark ? 'lighter' : 'source-over'
            light.strokeStyle = domainColor[hoverDomain]
            light.lineWidth = clamp(pixel, 0.7, 3.4)
            light.globalAlpha = dark ? 0.34 : 0.4
            light.stroke(strokes.intra[hoverDomain])
            light.globalAlpha = dark ? 0.3 : 0.34
            light.stroke(strokes.cross[hoverDomain])
            light.globalCompositeOperation = 'source-over'
            for (const node of ranked[hoverDomain]) if (shownTo[node] > 0.5) lit.add(node)
        }
        if (matches) for (const node of matches) if (shownTo[node] > 0.5) lit.add(node)
        light.globalAlpha = 1
        for (const node of lit) {
            if (node === focus || node === hover) continue
            const radius = drawn(node) + (matches?.has(node) ? 1.2 * pixel : 0)
            light.fillStyle = dark ? domainBright[nodeDomain[node]] : domainColor[nodeDomain[node]]
            light.beginPath()
            light.arc(posX[node], posY[node], radius, 0, TAU)
            light.fill()
        }
        for (const node of [focus, hover]) {
            if (node < 0 || shown[node] < 0.5) continue
            const radius = drawn(node) + 2 * pixel
            light.fillStyle = palette.background
            light.beginPath()
            light.arc(posX[node], posY[node], radius + 3.5 * pixel, 0, TAU)
            light.fill()
            light.fillStyle = dark ? domainBright[nodeDomain[node]] : domainColor[nodeDomain[node]]
            light.beginPath()
            light.arc(posX[node], posY[node], radius, 0, TAU)
            light.fill()
            light.strokeStyle = node === focus ? palette.brand : domainColor[nodeDomain[node]]
            light.lineWidth = 1.6 * pixel
            light.beginPath()
            light.arc(posX[node], posY[node], radius + 3.5 * pixel, 0, TAU)
            light.stroke()
        }
        if (pulse) {
            const age = (now - pulse.start) / 700
            if (age >= 1) pulse = undefined
            else {
                light.strokeStyle = palette.brand
                light.lineWidth = 1.5 * pixel
                light.globalAlpha = (1 - age) * 0.8
                light.beginPath()
                light.arc(posX[pulse.node], posY[pulse.node], drawn(pulse.node) + (6 + 34 * ease(age)) * pixel, 0, TAU)
                light.stroke()
                light.globalAlpha = 1
            }
        }

        light.setTransform(ratio, 0, 0, ratio, 0, 0)
        light.textBaseline = 'middle'
        light.lineJoin = 'round'
        for (const [node, label] of labels) {
            if (label.alpha < 0.02) continue
            const weight = label.strong ? 650 : 500
            light.save()
            light.translate(screenX(posX[node]), screenY(posY[node]))
            if (label.turn !== undefined) light.rotate(label.turn)
            light.font = `${weight} ${label.size}px ${family}`
            light.textAlign = label.align
            light.globalAlpha = label.alpha * shown[node] * (lit.has(node) || node === focus ? 1 : 0.3 + 0.7 * dim)
            light.strokeStyle = palette.background
            light.lineWidth = 3.5
            light.strokeText(label.text, label.dx, label.dy)
            light.fillStyle = label.quiet && !lit.has(node) ? palette.muted : palette.text
            light.fillText(label.text, label.dx, label.dy)
            light.restore()
        }
        positionTooltip()
    }

    function positionTooltip() {
        if (tooltip.hidden) return
        let x: number
        let y: number
        let above = false
        if (hover >= 0) {
            x = screenX(posX[hover])
            y = screenY(posY[hover])
            // Open on the side with fewer lit neighbours, so the card does not cover what it explains.
            let below = 0
            for (const edge of incident[hover]) {
                if (!edgeOn[edge]) continue
                const other = edgeSource[edge] === hover ? edgeTarget[edge] : edgeSource[edge]
                below += Math.sign(posY[other] - posY[hover])
            }
            above = below > 0
            y += (above ? -1 : 1) * (drawn(hover) * camera.k + 16)
        } else if (hoverDomain >= 0) {
            const domain = data.domains[hoverDomain]
            const point = foundationAtlasPoint(data.radius - 40, (domain.start + domain.end) / 2)
            x = screenX(point.x)
            y = screenY(point.y)
        } else return
        const boxWidth = tooltip.offsetWidth
        const boxHeight = tooltip.offsetHeight
        const left = clamp(x - boxWidth / 2, 8, Math.max(8, width - boxWidth - 8))
        const flip = above ? y - boxHeight < 8 : y + boxHeight + 8 > height
        const reach = hover >= 0 ? 2 * (drawn(hover) * camera.k + 16) : 40
        const top = above !== flip ? y - boxHeight - (flip ? reach : 0) : y + (flip ? reach : 0)
        tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(clamp(top, 8, height - boxHeight - 8))}px)`
    }

    function tick(now: number) {
        frame = 0
        const elapsed = Math.min(64, clock ? now - clock : 16)
        // The frame after a repaint shows what it really cost; repaint less often when it hurt.
        if (weaveProbe && clock) {
            weaveProbe = false
            weavePace = now - clock > 34 ? Math.min(900, weavePace * 1.7) : Math.max(120, weavePace * 0.9)
        }
        clock = now
        let active = false
        if (intro !== undefined) {
            if (intro < 0) intro = now
            introAt = clamp((now - intro) / 1500, 0, 1)
            dirtyStill = dirtyLight = true
            if (introAt >= 1) intro = undefined
            else active = true
        }
        if (transition) {
            progress = clamp((now - transition.start) / transition.duration, 0, 1)
            const eased = ease(progress)
            mix = mixFrom + (mixTo - mixFrom) * eased
            for (let node = 0; node < total; node++) {
                shown[node] = shownFrom[node] + (shownTo[node] - shownFrom[node]) * eased
                if (!transition.moving) continue
                // Outer rings leave a beat later, so the neighborhood opens like a fan.
                const late = orbit?.positions.get(data.nodes[node].id)?.ring === 2 ? 0.12 : 0
                const local = ease(clamp((progress - late) / (1 - late), 0, 1))
                posX[node] = fromX[node] + (toX[node] - fromX[node]) * local
                posY[node] = fromY[node] + (toY[node] - fromY[node]) * local
            }
            dirtyStill = dirtyLight = labelsStale = true
            // The old relations fade where they are; the new ones are painted once and fade in.
            const swap = transition.moving ? 0.6 : 0.3
            if (!transition.swapped && progress >= swap) {
                transition.swapped = true
                drawWeave(now)
            }
            weaveFade = transition.swapped ? smooth(swap, 1, progress) : 1 - smooth(0, swap, progress)
            if (progress >= 1) {
                transition = undefined
                gridStale = true
            } else active = true
        }
        if (tween) {
            const t = clamp((now - tween.start) / tween.duration, 0, 1)
            const eased = ease(t)
            camera.x = tween.from.x + (tween.to.x - tween.from.x) * eased
            camera.y = tween.from.y + (tween.to.y - tween.from.y) * eased
            camera.k = tween.from.k * (tween.to.k / tween.from.k) ** eased
            dirtyStill = dirtyLight = labelsStale = true
            if (t >= 1) tween = undefined
            else active = true
        }
        if (wheel) {
            const step = 1 - Math.exp(-elapsed / 70)
            camera.k *= (wheel.k / camera.k) ** step
            if (Math.abs(Math.log(wheel.k / camera.k)) < 0.002) camera.k = wheel.k
            camera.x = wheel.wx - (wheel.sx - width / 2) / camera.k
            camera.y = wheel.wy - (wheel.sy - height / 2) / camera.k
            dirtyStill = dirtyLight = labelsStale = true
            if (camera.k === wheel.k) wheel = undefined
            else active = true
        }
        if (glide) {
            camera.x -= (glide.vx * elapsed) / camera.k
            camera.y -= (glide.vy * elapsed) / camera.k
            const friction = Math.exp(-elapsed / 260)
            glide.vx *= friction
            glide.vy *= friction
            dirtyStill = dirtyLight = labelsStale = true
            if (Math.hypot(glide.vx, glide.vy) < 0.012) glide = undefined
            else active = true
        }
        if (labelsStale) planLabels()
        for (const [node, label] of labels) {
            if (label.alpha === label.goal) continue
            const step = motion.matches ? 1 : elapsed / 170
            label.alpha = label.goal > label.alpha ? Math.min(1, label.alpha + step) : Math.max(0, label.alpha - step)
            if (!label.alpha && !label.goal) labels.delete(node)
            dirtyLight = true
            active = true
        }
        if (pulse) dirtyLight = active = true
        // Pulses keep travelling only while the atlas is actually in view.
        if (focus >= 0 && !motion.matches && onScreen) dirtyLight = active = true
        if (dim !== dimGoal) {
            // Fall quickly, recover slowly: sweeping across concepts must not make the dial flicker.
            dim += (dimGoal - dim) * (motion.matches ? 1 : 1 - Math.exp(-elapsed / (dimGoal < dim ? 70 : 240)))
            if (Math.abs(dim - dimGoal) < 0.004) dim = dimGoal
            else active = true
            dirtyLight = true
        }
        if (dirtyStill && (camera.x !== woven.x || camera.y !== woven.y || camera.k !== woven.k)) weaveStale = true
        if (weaveStale && (!transition || transition.swapped)) {
            const scale = camera.k / woven.k
            const travelling = Boolean(tween || wheel || glide || press?.moved || pointers.size > 1)
            const waited = now - wovenAt
            if (!travelling || waited >= weavePace || ((scale > 1.8 || scale < 0.55) && waited >= weavePace / 2))
                drawWeave(now)
        }
        if (weaveStale)
            fibre.style.transform = `translate(${(woven.x - camera.x) * camera.k}px, ${(woven.y - camera.y) * camera.k}px) scale(${camera.k / woven.k})`
        base.style.opacity = String(dim)
        // Changing from subject colours to relation colours arrives as a short dip, not a jump.
        const turn = motion.matches ? 1 : 0.35 + 0.65 * smooth(0, 280, now - weaveTurn)
        if (turn < 1) active = true
        fibre.style.opacity = String(dim ** 1.5 * weaveFade * turn * smooth(0.45, 1, introAt))
        if (dirtyStill) {
            drawStill()
            options.onZoom(camera.k)
        }
        if (dirtyLight) drawLight(now)
        const resting = !transition && !tween && !wheel && !glide && intro === undefined
        if (resting !== settled) options.onSettle((settled = resting))
        if (active) request()
        else clock = 0
    }

    function zoomAt(factor: number, sx = width / 2, sy = height / 2, immediate = false) {
        const target = clamp((wheel?.k ?? camera.k) * factor, Math.min(dialZoom(), fitCamera().k) * 0.6, 5)
        tween = glide = undefined
        fitted = false
        if (motion.matches || immediate) {
            const wx = worldX(sx)
            const wy = worldY(sy)
            camera.k = target
            camera.x = wx - (sx - width / 2) / target
            camera.y = wy - (sy - height / 2) / target
            wheel = undefined
        } else wheel = { k: target, sx, sy, wx: worldX(sx), wy: worldY(sy) }
        invalidate()
    }

    function setHover(node: number, domain = -1, show = true) {
        if (node === hover && domain === hoverDomain) return
        const domainChanged = domain !== hoverDomain
        hover = node
        hoverDomain = domain
        if ((node >= 0 || domain >= 0) && show) {
            options.onHover(node >= 0 ? { node: data.nodes[node].id } : { domain: data.domains[domain].id })
            tooltip.hidden = false
        } else {
            tooltip.hidden = true
            options.onHover(undefined)
        }
        syncDim()
        invalidate(domainChanged)
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let press: { x: number; y: number; moved: boolean; time: number } | undefined
    let pinch = 0
    let lastTap = 0
    let reserved: number[] = []
    const trail: Array<{ x: number; y: number; time: number }> = []
    const local = (event: PointerEvent | WheelEvent | MouseEvent) => {
        const box = stage.getBoundingClientRect()
        return { x: event.clientX - box.left, y: event.clientY - box.top }
    }
    function onPointerDown(event: PointerEvent) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const point = local(event)
        pointers.set(event.pointerId, point)
        try {
            stage.setPointerCapture(event.pointerId)
        } catch {
            // A pointer that has already gone cannot be captured; the gesture still completes.
        }
        tween = wheel = glide = undefined
        trail.length = 0
        if (pointers.size === 1) press = { ...point, moved: false, time: event.timeStamp }
        else {
            const [a, b] = [...pointers.values()]
            pinch = Math.hypot(a.x - b.x, a.y - b.y)
            if (press) press.moved = true
        }
    }
    function onPointerMove(event: PointerEvent) {
        const point = local(event)
        const known = pointers.get(event.pointerId)
        if (!known) {
            if (event.pointerType !== 'mouse') return
            const node = nodeAt(point.x, point.y)
            setHover(node, node < 0 ? domainAt(point.x, point.y) : -1)
            return
        }
        if (pointers.size === 2) {
            pointers.set(event.pointerId, point)
            const [a, b] = [...pointers.values()]
            const spread = Math.hypot(a.x - b.x, a.y - b.y)
            const centreX = (a.x + b.x) / 2
            const centreY = (a.y + b.y) / 2
            camera.x -= (point.x - known.x) / 2 / camera.k
            camera.y -= (point.y - known.y) / 2 / camera.k
            if (pinch) zoomAt(spread / pinch, centreX, centreY, true)
            pinch = spread
            fitted = false
            invalidate()
            return
        }
        if (!press) return
        if (!press.moved && Math.hypot(point.x - press.x, point.y - press.y) < 5) return
        if (!press.moved) {
            press.moved = true
            stage.dataset.atlasDragging = ''
            setHover(-1)
        }
        camera.x -= (point.x - known.x) / camera.k
        camera.y -= (point.y - known.y) / camera.k
        pointers.set(event.pointerId, point)
        trail.push({ ...point, time: event.timeStamp })
        if (trail.length > 6) trail.shift()
        fitted = false
        invalidate()
    }
    function onPointerUp(event: PointerEvent) {
        if (!pointers.delete(event.pointerId)) return
        pinch = 0
        if (pointers.size) return
        delete stage.dataset.atlasDragging
        const point = local(event)
        const pressed = press
        press = undefined
        if (!pressed) return
        request()
        if (pressed.moved) {
            const first = trail[0]
            const last = trail.at(-1)
            if (!motion.matches && first && last && last.time - first.time > 8 && event.timeStamp - last.time < 60) {
                glide = {
                    vx: (last.x - first.x) / (last.time - first.time),
                    vy: (last.y - first.y) / (last.time - first.time)
                }
                request()
            }
            return
        }
        if (event.type === 'pointercancel') return
        const node = nodeAt(point.x, point.y)
        const again = event.timeStamp - lastTap < 320
        lastTap = event.timeStamp
        if (node >= 0) {
            if (again) options.onOpen(data.nodes[node].id)
            else options.onSelect(data.nodes[node].id)
            return
        }
        const domain = domainAt(point.x, point.y)
        if (domain >= 0) options.onDomain(data.domains[domain].id)
        else if (again) zoomAt(1.9, point.x, point.y)
        else options.onBackground()
    }
    function onWheel(event: WheelEvent) {
        event.preventDefault()
        const point = local(event)
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1)
        zoomAt(Math.exp(-delta * (event.ctrlKey ? 0.011 : 0.0019)), point.x, point.y)
    }
    function onKey(event: KeyboardEvent) {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const pans: Record<string, number[] | undefined> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1]
        }
        const pan = pans[event.key]
        if (pan) {
            fitted = false
            flyTo(
                { x: camera.x + (pan[0] * 110) / camera.k, y: camera.y + (pan[1] * 110) / camera.k, k: camera.k },
                220
            )
        } else if (event.key === '+' || event.key === '=') zoomAt(1.5)
        else if (event.key === '-' || event.key === '_') zoomAt(1 / 1.5)
        else if (event.key === '0') fit()
        else if (event.key === 'Escape') options.onBackground()
        else return
        event.preventDefault()
    }
    const onLeave = () => {
        if (!pointers.size) setHover(-1)
    }
    function fit() {
        fitted = true
        flyTo(fitCamera())
    }

    stage.addEventListener('pointerdown', onPointerDown)
    stage.addEventListener('pointermove', onPointerMove)
    stage.addEventListener('pointerup', onPointerUp)
    stage.addEventListener('pointercancel', onPointerUp)
    stage.addEventListener('pointerleave', onLeave)
    stage.addEventListener('wheel', onWheel, { passive: false })
    stage.addEventListener('keydown', onKey)
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(stage)
    const visibility = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting
        if (onScreen) request()
    })
    visibility.observe(stage)
    const onVisibility = () => {
        awake = !document.hidden
        if (awake) request()
    }
    document.addEventListener('visibilitychange', onVisibility)
    readTheme()
    resize()
    strokes = buildStrokes()

    return {
        setView,
        fit,
        theme: readTheme,
        zoomBy: (factor: number) => zoomAt(factor),
        /** Light a concept from outside the stage, for instance from a list. */
        hover(id: string | undefined) {
            setHover(id ? (indexOf.get(id) ?? -1) : -1, -1, false)
        },
        mark(ids: Iterable<string> | undefined) {
            matches = ids ? new Set(Array.from(ids, (id) => indexOf.get(id)!)) : undefined
            syncDim()
            invalidate(false)
        },
        /** Bring a concept to the centre at a scale where its surroundings can be read. */
        reveal(id: string) {
            const node = indexOf.get(id)
            if (node === undefined || orbit) return
            let left = toX[node]
            let right = left
            let top = toY[node]
            let bottom = top
            for (const edge of incident[node]) {
                if (!edgeOn[edge]) continue
                const other = edgeSource[edge] === node ? edgeTarget[edge] : edgeSource[edge]
                left = Math.min(left, toX[other])
                right = Math.max(right, toX[other])
                top = Math.min(top, toY[other])
                bottom = Math.max(bottom, toY[other])
            }
            const margin = Math.min(width, height) < 520 ? 64 : 150
            const k = Math.min(
                (width - 2 * margin) / (right - left + 1),
                (height - 2 * margin) / (bottom - top + 1),
                1.2
            )
            // Relations that reach across the dial are best read on the whole dial.
            fitted = k <= dialZoom() * 1.2
            flyTo(fitted ? { x: 0, y: 0, k: dialZoom() } : { x: (left + right) / 2, y: (top + bottom) / 2, k })
        },
        resume() {
            awake = !document.hidden
            request()
        },
        destroy() {
            awake = false
            cancelAnimationFrame(frame)
            resizeObserver.disconnect()
            visibility.disconnect()
            document.removeEventListener('visibilitychange', onVisibility)
            stage.removeEventListener('pointerdown', onPointerDown)
            stage.removeEventListener('pointermove', onPointerMove)
            stage.removeEventListener('pointerup', onPointerUp)
            stage.removeEventListener('pointercancel', onPointerUp)
            stage.removeEventListener('pointerleave', onLeave)
            stage.removeEventListener('wheel', onWheel)
            stage.removeEventListener('keydown', onKey)
            fibre.remove()
            base.remove()
            overlay.remove()
        }
    }
}
