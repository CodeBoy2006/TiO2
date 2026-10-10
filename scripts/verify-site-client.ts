import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { loadTiO2Project } from '../packages/config/src/project.js'

const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const buildDirectory = path.join(project.rootDir, '.tio2-tmp/site-client')
const manifestPath = path.join(buildDirectory, '.vite/manifest.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const entries = Object.entries<any>(manifest).filter(([, chunk]) => chunk.isEntry)
if (entries.length !== 1 || entries[0][0] !== 'site/client/main.ts') {
    throw new Error(`Expected one site/client/main.ts entry, found ${entries.map(([key]) => key).join(', ')}`)
}

const initialChunks = new Set<string>()
const visit = (key: string) => {
    if (initialChunks.has(key)) return
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Missing manifest chunk: ${key}`)
    initialChunks.add(key)
    for (const imported of chunk.imports ?? []) visit(imported)
}
visit(entries[0][0])

let initialGzipBytes = 0
for (const key of initialChunks) {
    const source = await fs.readFile(resolveAsset(manifest[key].file))
    initialGzipBytes += gzipSync(source).byteLength
}
if (initialGzipBytes >= 100 * 1024) {
    throw new Error(`Initial JavaScript is ${(initialGzipBytes / 1024).toFixed(1)} KiB gzip (limit: <100 KiB)`)
}

for (const [key, chunk] of Object.entries<any>(manifest)) {
    await fs.access(resolveAsset(chunk.file))
    for (const file of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) await fs.access(resolveAsset(file))
    for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
        if (!manifest[dependency]) throw new Error(`${key}: missing dependency ${dependency}`)
    }
}

const dynamicSources = new Set(
    Object.values<any>(manifest)
        .filter((chunk) => chunk.isDynamicEntry)
        .map((chunk) => chunk.src)
)
for (const expected of [
    'site/client/foundation-graph.ts',
    'site/client/foundation-life.ts',
    'site/client/image-viewer.ts',
    'site/client/search.ts'
]) {
    if (!dynamicSources.has(expected)) throw new Error(`Missing dynamic client entry: ${expected}`)
}

console.log(
    `[site-client:verify] ${JSON.stringify({
        manifestEntries: Object.keys(manifest).length,
        initialChunks: initialChunks.size,
        initialGzipKiB: Number((initialGzipBytes / 1024).toFixed(1)),
        dynamicEntries: dynamicSources.size
    })}`
)

function resolveAsset(file: unknown) {
    if (typeof file !== 'string' || !file.startsWith('assets/client/') || file.includes('..')) {
        throw new Error(`Unsafe manifest asset: ${String(file)}`)
    }
    return path.join(buildDirectory, file)
}
