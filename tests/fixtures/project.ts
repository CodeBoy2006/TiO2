import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { createTiO2Project } from '../../packages/config/src/project.js'
import type { TiO2ConfigInput } from '../../packages/config/src/types.js'

export async function createReadingProject(t: TestContext, foundations: TiO2ConfigInput['foundations']) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tio2-reading-fixture-'))
    t.after(() => rm(rootDir, { recursive: true, force: true }))
    const project = createTiO2Project(rootDir, {
        site: { title: 'Reading Lab', url: 'https://example.test', language: 'zh-CN' },
        theme: { nav: [{ text: 'Test Library', link: '/pages/foundations' }] },
        foundations: {
            title: 'Test Library',
            englishTitle: 'Test Library',
            subtitle: 'Synthetic concepts for framework tests.',
            ...foundations
        }
    })
    await mkdir(path.join(rootDir, 'pages'))
    await Promise.all(
        [
            ['foundations', 'Test Library'],
            ['foundations-map', 'Concept Map'],
            ['foundations-routes', 'Learning Routes']
        ].map(([name, title]) => writeFile(path.join(rootDir, 'pages', `${name}.md`), `---\ntitle: ${title}\n---\n`))
    )
    return project
}
