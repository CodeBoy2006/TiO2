import { loadTiO2Project } from '../packages/config/src/project.js'
import path from 'node:path'
import { loadSiteContent, writePublishingArtifacts } from '../packages/content-fs/src/index'
const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const tio2Config = project.config

const outputDirectory = path.resolve(project.rootDir, process.env.TIO2_OUTPUT_DIR ?? '.tio2-tmp/site')
const content = await loadSiteContent(project, {
    env: process.env.NODE_ENV === 'production' ? 'production' : 'development'
})

await writePublishingArtifacts(content.publishing, outputDirectory, tio2Config.site, tio2Config.integrations)

console.log(`[site-artifacts] ${JSON.stringify({ publishingEntries: content.publishing.entries.length })}`)
