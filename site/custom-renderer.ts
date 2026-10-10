import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TiO2Project } from '../packages/config/src/index.js'

/** Renderer modules are trusted consumer code, resolved independently of the installation. */
export async function loadCustomRenderer(project: TiO2Project, modulePath: string) {
    const { default: render } = await import(pathToFileURL(path.resolve(project.rootDir, modulePath)).href)
    if (typeof render !== 'function') throw new TypeError(`${modulePath} must export a default renderer function`)
    return render
}
