#!/usr/bin/env node
import path from 'node:path'
import { parseArgs } from 'node:util'

const args = process.argv.slice(2)
const command = args.shift()
const help = `TiO₂ — static publishing for personal writing and knowledge sites

Usage: tio2 <build|dev|preview|cms|new> [--root <directory>]
  build    Build and verify .tio2-tmp/site
  dev      Rebuild .tio2-tmp/site-dev on changes (port 5000)
  preview  Serve the production build (port 4173)
  cms      Start the local writing workbench and site preview
  new      Create a post; tio2 new --help lists writing options

dev and preview accept --port <number>. All servers bind to 127.0.0.1.
`

try {
    if (!command || command === '--help' || command === '-h') {
        console.log(help)
    } else {
        if (!['build', 'dev', 'preview', 'cms', 'new'].includes(command)) throw new Error(`Unknown command: ${command}`)
        // The writing command owns its remaining options and positional title.
        const rootIndex = args.indexOf('--root')
        if (rootIndex >= 0) {
            const root = args[rootIndex + 1]
            if (!root || root.startsWith('--')) throw new Error('--root requires a directory')
            process.env.TIO2_PROJECT_ROOT = path.resolve(root)
            args.splice(rootIndex, 2)
        }
        if (command === 'new') {
            process.argv = [process.execPath, process.argv[1], ...args]
            await import('../scripts/create-post.mjs')
        } else {
            const { values } = parseArgs({
                args,
                options: { port: { type: 'string' }, help: { type: 'boolean', short: 'h' } }
            })
            if (values.help) console.log(help)
            else {
                if (values.port) {
                    if (!['dev', 'preview'].includes(command))
                        throw new Error('--port is only supported by dev and preview')
                    process.env[command === 'dev' ? 'SITE_DEV_PORT' : 'TIO2_PREVIEW_PORT'] = values.port
                }
                if (command === 'cms') await import('../scripts/run-cms-dev.mjs')
                else await (await import('../scripts/run-site.mjs'))[command]()
            }
        }
    }
} catch (error) {
    console.error(`[tio2] ${error.message}`)
    process.exitCode = 1
}
