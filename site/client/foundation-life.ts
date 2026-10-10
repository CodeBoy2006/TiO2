export const LIFE_COLUMNS = 72
export const LIFE_ROWS = 8

export type LifeCell = readonly [x: number, y: number]

export interface LifePattern {
    name: string
    cells: readonly LifeCell[]
}

function pattern(name: string, rows: readonly string[]): LifePattern {
    const cells: LifeCell[] = []
    rows.forEach((row, y) => {
        Array.from(row).forEach((cell, x) => {
            if (cell === 'O') cells.push([x, y])
        })
    })
    return { name, cells }
}

export const LIFE_PATTERNS = [
    pattern('十五周期振子', ['..O....O..', 'OO.OOOO.OO', '..O....O..']),
    pattern('不倒翁', ['.OO.OO.', '.OO.OO.', '..O.O..', 'O.O.O.O', 'O.O.O.O', 'OO...OO']),
    pattern('橡实', ['.O.....', '...O...', 'OO..OOO']),
    pattern('R 五连体', ['.OO', 'OO.', '.O.']),
    pattern('顽强者', ['......O.', 'OO......', '.O...OOO']),
    pattern('蟾蜍', ['.OOO', 'OOO.']),
    pattern('信号灯', ['OO..', 'OO..', '..OO', '..OO']),
    pattern('滑翔机', ['.O.', '..O', 'OOO'])
] as const satisfies readonly LifePattern[]

export function seedLife(patternToPlace: LifePattern, columns = LIFE_COLUMNS, rows = LIFE_ROWS) {
    const cells = new Uint8Array(columns * rows)
    const width = Math.max(...patternToPlace.cells.map(([x]) => x)) + 1
    const height = Math.max(...patternToPlace.cells.map(([, y]) => y)) + 1
    const offsetX = Math.floor((columns - width) / 2)
    const offsetY = Math.floor((rows - height) / 2)
    patternToPlace.cells.forEach(([x, y]) => {
        cells[(y + offsetY) * columns + x + offsetX] = 1
    })
    return cells
}

export function nextLifeGeneration(cells: Uint8Array, columns = LIFE_COLUMNS, rows = LIFE_ROWS) {
    const next = new Uint8Array(cells.length)
    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
            let neighbours = 0
            for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    if (!dx && !dy) continue
                    neighbours += cells[((y + dy + rows) % rows) * columns + ((x + dx + columns) % columns)]
                }
            }
            const index = y * columns + x
            next[index] = neighbours === 3 || (cells[index] === 1 && neighbours === 2) ? 1 : 0
        }
    }
    return next
}

const stepInterval = 190

export function bindFoundationLife() {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-foundation-life] canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const pattern = LIFE_PATTERNS[Math.floor(Math.random() * LIFE_PATTERNS.length)] ?? LIFE_PATTERNS[0]
    let cells = seedLife(pattern)
    let strength = Float32Array.from(cells)
    let width = 0
    let height = 0
    let ink = 'rgba(0, 0, 0, 0.16)'
    let frame = 0
    let lastFrame = 0
    let lastStep = 0
    let visible = true
    let focused = false
    let cursorX = Math.floor(LIFE_COLUMNS / 2)
    let cursorY = Math.floor(LIFE_ROWS / 2)
    let lastHovered = -1
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const draw = (time = 0) => {
        if (!width || !height) return
        const cellWidth = width / LIFE_COLUMNS
        const cellHeight = height / LIFE_ROWS
        const baseRadius = Math.max(0.65, Math.min(cellWidth, cellHeight) * 0.24)
        context.clearRect(0, 0, width, height)
        context.fillStyle = ink

        strength.forEach((value, index) => {
            if (value < 0.015) return
            const phase = Math.sin(time * 0.0012 + index * 0.47)
            const x = index % LIFE_COLUMNS
            const y = Math.floor(index / LIFE_COLUMNS)
            context.beginPath()
            context.arc(
                (x + 0.5) * cellWidth,
                (y + 0.5) * cellHeight,
                baseRadius * (0.94 + phase * 0.06),
                0,
                Math.PI * 2
            )
            context.globalAlpha = value * (0.72 + phase * 0.08)
            context.fill()
        })
        context.globalAlpha = 1

        if (focused) {
            context.save()
            context.strokeStyle = ink
            context.globalAlpha = 0.62
            context.beginPath()
            context.arc((cursorX + 0.5) * cellWidth, (cursorY + 0.5) * cellHeight, baseRadius * 1.8, 0, Math.PI * 2)
            context.stroke()
            context.restore()
        }
    }

    const canAnimate = () => visible && !document.hidden && !motion.matches
    const animate = (time: number) => {
        if (!canAnimate()) {
            frame = 0
            return
        }
        const elapsed = lastFrame ? Math.min(64, time - lastFrame) : 16
        lastFrame = time
        if (!lastStep) lastStep = time
        if (time - lastStep >= stepInterval) {
            cells = nextLifeGeneration(cells)
            lastStep = time
        }
        const rise = 1 - Math.exp(-elapsed / 150)
        const fade = 1 - Math.exp(-elapsed / 520)
        strength.forEach((value, index) => {
            strength[index] = value + (cells[index] - value) * (cells[index] ? rise : fade)
        })
        draw(time)
        frame = requestAnimationFrame(animate)
    }

    const syncAnimation = () => {
        cancelAnimationFrame(frame)
        frame = 0
        lastFrame = 0
        lastStep = 0
        if (canAnimate()) frame = requestAnimationFrame(animate)
        else draw()
    }

    const resize = () => {
        const bounds = canvas.getBoundingClientRect()
        if (!bounds.width || !bounds.height) return
        const dpr = Math.min(devicePixelRatio || 1, 2)
        width = bounds.width
        height = bounds.height
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        ink = getComputedStyle(canvas).color || ink
        draw()
    }

    const cellFromPointer = (event: MouseEvent | PointerEvent) => {
        const bounds = canvas.getBoundingClientRect()
        const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * LIFE_COLUMNS)
        const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * LIFE_ROWS)
        return x >= 0 && x < LIFE_COLUMNS && y >= 0 && y < LIFE_ROWS ? ([x, y] as const) : null
    }

    const toggle = (x: number, y: number) => {
        cursorX = x
        cursorY = y
        const index = y * LIFE_COLUMNS + x
        cells[index] = cells[index] ? 0 : 1
        strength[index] = motion.matches ? cells[index] : Math.max(strength[index], cells[index] ? 0.72 : 0)
        draw(performance.now())
    }

    canvas.addEventListener('mousemove', (event) => {
        const cell = cellFromPointer(event)
        if (!cell) return
        const index = cell[1] * LIFE_COLUMNS + cell[0]
        if (index === lastHovered) return
        lastHovered = index
        toggle(cell[0], cell[1])
    })
    canvas.addEventListener('mouseleave', () => (lastHovered = -1))
    canvas.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') return
        const cell = cellFromPointer(event)
        if (cell) toggle(cell[0], cell[1])
    })
    canvas.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') cursorX = Math.max(0, cursorX - 1)
        else if (event.key === 'ArrowRight') cursorX = Math.min(LIFE_COLUMNS - 1, cursorX + 1)
        else if (event.key === 'ArrowUp') cursorY = Math.max(0, cursorY - 1)
        else if (event.key === 'ArrowDown') cursorY = Math.min(LIFE_ROWS - 1, cursorY + 1)
        else if (event.key === ' ' || event.key === 'Enter') toggle(cursorX, cursorY)
        else return
        event.preventDefault()
        draw(performance.now())
    })
    canvas.addEventListener('focus', () => {
        focused = true
        draw(performance.now())
    })
    canvas.addEventListener('blur', () => {
        focused = false
        draw(performance.now())
    })

    new ResizeObserver(resize).observe(canvas)
    new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting)
        syncAnimation()
    }).observe(canvas)
    motion.addEventListener('change', () => {
        if (motion.matches) strength = Float32Array.from(cells)
        syncAnimation()
    })
    document.addEventListener('visibilitychange', syncAnimation)
    document.addEventListener('tio2:theme', resize)
    resize()
    syncAnimation()
}
