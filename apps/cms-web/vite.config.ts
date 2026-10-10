import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { loadTiO2Project } from '../../packages/config/src/project.js'

const frameworkRoot = fileURLToPath(new URL('../../', import.meta.url))
const projectRoot = realpathSync(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const project = await loadTiO2Project(projectRoot)

const cmsServerPort = Number(process.env.CMS_PORT ?? 4321)
const cmsWebPort = Number(process.env.CMS_WEB_PORT ?? 4173)
const sitePreviewPort = Number(process.env.SITE_DEV_PORT ?? 5000)
const cmsServerOrigin = `http://127.0.0.1:${cmsServerPort}`
const cmsPreviewOrigin = process.env.CMS_PREVIEW_ORIGIN ?? `http://127.0.0.1:${sitePreviewPort}`

export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    publicDir: false,
    cacheDir: path.join(projectRoot, '.tio2-tmp/cms-web/vite'),
    plugins: [vue()],
    define: {
        'globalThis.__TIO2_LANGUAGE__': JSON.stringify(project.config.site.language),
        'globalThis.__CMS_PREVIEW_ORIGIN__': JSON.stringify(cmsPreviewOrigin)
    },
    server: {
        host: '127.0.0.1',
        port: cmsWebPort,
        strictPort: true,
        fs: {
            allow: [frameworkRoot, projectRoot]
        },
        proxy: {
            '/api': {
                target: cmsServerOrigin,
                // Preserve the browser host for the API's shared origin check.
                changeOrigin: false
            },
            '/health': {
                target: cmsServerOrigin,
                changeOrigin: true
            }
        }
    },
    build: {
        license: { fileName: 'assets/third-party-licenses.md' },
        outDir: path.join(projectRoot, '.tio2-tmp/cms-web/dist'),
        rolldownOptions: {
            output: {
                postBanner: '/*! Third-party licenses: /assets/third-party-licenses.md */',
                manualChunks(id) {
                    if (
                        id.includes('/node_modules/@codemirror/lang-markdown/') ||
                        id.includes('/node_modules/@lezer/markdown/')
                    ) {
                        return 'codemirror-markdown'
                    }

                    if (id.includes('/node_modules/@codemirror/') || id.includes('/node_modules/@lezer/')) {
                        return 'codemirror-core'
                    }

                    if (id.includes('/node_modules/vue/')) {
                        return 'vue'
                    }
                }
            }
        }
    }
})
