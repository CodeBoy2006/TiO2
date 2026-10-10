import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineTiO2Config } from './index.js'

function resolveRoot(rootDir) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) {
        throw new TypeError('TiO2 project rootDir must be a nonempty path')
    }
    return path.resolve(rootDir)
}

export function createTiO2Project(rootDir, config) {
    return { rootDir: resolveRoot(rootDir), config: defineTiO2Config(config) }
}

export async function loadTiO2Project(rootDir) {
    const root = resolveRoot(rootDir)
    for (const filename of ['tio2.config.js', 'tio2.config.mjs']) {
        const configPath = path.join(root, filename)
        try {
            const info = await stat(configPath)
            if (!info.isFile()) throw new Error('configuration path must be a file')
        } catch (error) {
            if (error.code === 'ENOENT') continue
            throw new Error(`Cannot load TiO2 configuration at ${configPath}: ${error.message}`, { cause: error })
        }
        try {
            const module = await import(pathToFileURL(configPath).href)
            return createTiO2Project(root, module.default)
        } catch (error) {
            throw new Error(`Invalid TiO2 configuration at ${configPath}: ${error.message}`, { cause: error })
        }
    }
    throw new Error(`Missing TiO2 configuration in ${root}: expected tio2.config.js or tio2.config.mjs`)
}
