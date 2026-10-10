import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { loadTiO2Project } from '../packages/config/src/project.js'
// @ts-expect-error -- the Eleventy configuration is a native JavaScript module.
import { configureSite } from './eleventy.config.mjs'

// Eleventy 3.1.6 publishes JavaScript without a TypeScript declaration file.
// @ts-expect-error -- the default export is verified by the installed package and the programmatic probe.
import Eleventy from '@11ty/eleventy'

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const outputDirectory = path.resolve(project.rootDir, process.env.TIO2_OUTPUT_DIR ?? '.tio2-tmp/site')
const workDirectory = path.join(project.rootDir, '.tio2-tmp', 'site-work')
const generatedImageDirectory = path.join(workDirectory, 'images', 'generated')
const outputImageDirectory = path.join(outputDirectory, 'images', 'generated')
const peakMemory = { rss: 0, heapUsed: 0, heapTotal: 0 }
const startedAt = performance.now()
let succeeded = false

function sampleMemory() {
    const memory = process.memoryUsage()
    peakMemory.rss = Math.max(peakMemory.rss, memory.rss)
    peakMemory.heapUsed = Math.max(peakMemory.heapUsed, memory.heapUsed)
    peakMemory.heapTotal = Math.max(peakMemory.heapTotal, memory.heapTotal)
}

function bytesToMiB(bytes: number) {
    return Number((bytes / 1024 / 1024).toFixed(1))
}

sampleMemory()
const memorySampler = setInterval(sampleMemory, 50)
memorySampler.unref()

try {
    // Image names include the source hash; generation removes unreferenced variants.
    await fs.rm(outputDirectory, { recursive: true, force: true })

    const eleventy = new Eleventy(path.join(frameworkRoot, 'site'), outputDirectory, {
        configPath: false,
        config: (config: unknown) => configureSite(config, project)
    })
    eleventy.setIsVerbose(false)
    await eleventy.write()
    await fs.mkdir(outputImageDirectory, { recursive: true })
    await fs.cp(generatedImageDirectory, outputImageDirectory, { recursive: true, force: true })
    succeeded = true
} finally {
    clearInterval(memorySampler)
    sampleMemory()
    const resourceUsage = process.resourceUsage()
    console.log(
        `[eleventy-site] ${JSON.stringify({
            succeeded,
            wallSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(2)),
            peakRssMiB: bytesToMiB(peakMemory.rss),
            peakHeapUsedMiB: bytesToMiB(peakMemory.heapUsed),
            peakHeapTotalMiB: bytesToMiB(peakMemory.heapTotal),
            maxRssMiB: Number((resourceUsage.maxRSS / 1024).toFixed(1))
        })}`
    )
}
