import { loadTiO2Project } from '../../../packages/config/src/project.js'
import process from 'node:process'
import { createApp } from './app'

const port = Number(process.env.CMS_PORT ?? 4321)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid CMS_PORT: ${process.env.CMS_PORT}`)
}
const host = '127.0.0.1'

const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const app = createApp(project, {
    logger: {
        level: 'info'
    }
})

let closing = false
async function close() {
    if (closing) return
    closing = true
    try {
        await app.close()
    } catch (error) {
        app.log.error(error)
        process.exitCode = 1
    }
}

process.on('SIGINT', close)
process.on('SIGTERM', close)

try {
    await app.listen({ port, host })
} catch (error) {
    app.log.error(error)
    process.exitCode = 1
    await close()
}
