import { loadTiO2Project } from '../packages/config/src/project.js'
import type { TiO2Project } from '../packages/config/src/index.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import { libraryIdentity } from './render-helpers'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(repoRoot, 'site/client/main.ts')
const vueRuntimePattern = /[/\\]node_modules[/\\](?:\.pnpm[/\\]vue@[^/\\]+[/\\]node_modules[/\\])?vue[/\\]/u

function clientBoundary(project: TiO2Project): Plugin {
    const contentRoots = (['postsDir', 'topicsDir', 'foundationsDir', 'pagesDir'] as const).map((key) =>
        path.resolve(project.rootDir, project.config.content[key])
    )
    return {
        name: 'tio2-client-boundary',
        transform(code, id) {
            if (id !== mainEntry || !project.config.theme.clientEntry) return
            return `${code}\nimport ${JSON.stringify(path.resolve(project.rootDir, project.config.theme.clientEntry))};`
        },
        generateBundle() {
            const forbidden = [...this.getModuleIds()].find(
                (id) =>
                    contentRoots.some((root) => id.startsWith(`${root}/`)) ||
                    /\.(?:md|html?)(?:\?|$)/u.test(id) ||
                    vueRuntimePattern.test(id)
            )
            if (forbidden) this.error(`Client bundle imported content module: ${forbidden}`)
        }
    }
}

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
    const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
    return createClientConfig(project, mode)
})

export function createClientConfig(project: TiO2Project, mode = 'production'): UserConfig {
    return {
        root: repoRoot,
        define: {
            __TIO2_ANALYTICS__: JSON.stringify(project.config.integrations.vercelAnalytics),
            __TIO2_SEARCH__: JSON.stringify(project.config.theme.search.miniSearch),
            __TIO2_LIBRARY__: JSON.stringify(libraryIdentity(project).title)
        },
        publicDir: false,
        plugins: [clientBoundary(project)],
        build: {
            license: { fileName: 'assets/third-party-licenses.md' },
            assetsDir: 'assets/client',
            outDir: path.join(project.rootDir, '.tio2-tmp/site-client'),
            emptyOutDir: true,
            manifest: true,
            rolldownOptions: {
                input: mainEntry,
                output: {
                    postBanner:
                        '/*! Third-party licenses: /assets/third-party-licenses.md; sources: /third-party-notices.txt */',
                    ...(mode === 'development'
                        ? {
                              entryFileNames: 'assets/client/[name].js',
                              chunkFileNames: 'assets/client/[name].js',
                              assetFileNames: 'assets/client/[name][extname]'
                          }
                        : {})
                }
            }
        }
    }
}
