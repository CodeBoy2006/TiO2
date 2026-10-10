import process from 'node:process'
import { createServer } from 'vite'
import config from '../apps/cms-web/vite.config.js'

const port = Number(process.env.CMS_WEB_PORT ?? 4173)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid CMS_WEB_PORT: ${process.env.CMS_WEB_PORT}`)
}

const server = await createServer({
    ...config,
    configFile: false,
    server: { ...config.server, host: '127.0.0.1', port, strictPort: true }
})

let closing = false
async function close() {
    if (closing) return
    closing = true
    // Keep intentional shutdown successful when Vite's SIGTERM listener also runs.
    process.exitCode ??= 0
    try {
        await server.close()
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    }
}

process.on('SIGINT', close)
process.on('SIGTERM', close)

try {
    await server.listen()
    server.printUrls()
} catch (error) {
    console.error(error)
    process.exitCode = 1
    await close()
}
