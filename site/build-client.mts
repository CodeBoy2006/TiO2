import { build } from 'vite'
import { loadTiO2Project } from '../packages/config/src/project.js'
import { createClientConfig } from './vite.config.js'

const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
await build({ ...createClientConfig(project, mode), configFile: false, mode })
