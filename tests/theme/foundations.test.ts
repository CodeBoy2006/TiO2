import { createTranslator } from '../../packages/config/src/i18n.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import { createFoundationMarkdownPlugin } from '../../.vitepress/theme/foundationMarkdownPlugin.js'
import {
    createFoundationCollection,
    createFoundationPageData,
    type FoundationEntryInput,
    type FoundationRoute
} from '../../packages/content-core/src/index.js'
import { LIFE_COLUMNS, LIFE_PATTERNS, LIFE_ROWS, nextLifeGeneration, seedLife } from '../../site/client/foundation-life'
import {
    renderFoundationPath,
    renderFoundationReadingRoutes,
    renderFoundationRelations
} from '../../site/foundation-renderer.js'
import { createReadingProject } from '../fixtures/project.js'
import { readPageMeta, readPageTitle } from '../../site/page-renderer.js'
import { libraryIdentity } from '../../site/render-helpers.js'

const groups = [
    {
        id: 'knowledge',
        title: 'Knowledge',
        englishTitle: 'Knowledge',
        description: 'Test knowledge domains.',
        domains: ['basics', 'structure', 'methods'].map((id) => ({
            id: `knowledge/${id}`,
            group: 'knowledge',
            title: id,
            description: id
        }))
    }
]

test('the library is called by one name wherever a reader meets it', async (t) => {
    const project = await createReadingProject(t, { groups })
    const library = libraryIdentity(project)
    // navigation, landing page and every cross-reference share the configured name
    assert.equal(project.config.theme.nav.find((item) => item.link === '/pages/foundations')?.text, library.title)
    assert.equal((await readPageMeta(project, 'foundations')).title, library.title)
    assert.equal(library.englishTitle, 'Test Library')
    assert.ok(library.subtitle)
    assert.notEqual(await readPageTitle(project, 'foundations-map'), library.title)
    // the framework itself holds no site's name, only a neutral fallback
    for (const file of [
        'site/foundation-renderer.ts',
        'site/foundation-atlas-renderer.ts',
        'site/client/search.ts',
        'site/client/foundation-atlas.ts',
        '.vitepress/theme/referenceMarkdownPlugin.ts'
    ])
        assert.doesNotMatch(
            fs.readFileSync(path.join(process.cwd(), file), 'utf8'),
            /公理库|公理与理论库|Foundations &amp; Theory|Theory Atlas|Theoryroad|Theoroad|['"`]理路/u,
            file
        )
    const unnamed = (language: string) =>
        libraryIdentity({
            config: {
                ...project.config,
                site: { ...project.config.site, language },
                foundations: { groups: [], routes: [] }
            }
        })
    assert.deepEqual(unnamed('en'), { title: 'Foundations', englishTitle: '', subtitle: '' })
    assert.equal(unnamed('zh-CN').title, '知识库')
})

test('Foundations exposes search-first lookup and semantic dependency navigation', () => {
    const renderer = fs.readFileSync(path.join(process.cwd(), 'site', 'foundation-renderer.ts'), 'utf8')
    const life = fs.readFileSync(path.join(process.cwd(), 'site', 'client', 'foundation-life.ts'), 'utf8')
    const styles = ['theme.css', 'foundation-library.css']
        .map((file) => fs.readFileSync(path.join(process.cwd(), 'site', 'client', file), 'utf8'))
        .join('\n')
    const dial = fs.readFileSync(path.join(process.cwd(), 'site', 'client', 'foundation-dial.ts'), 'utf8')
    const shell = fs.readFileSync(path.join(process.cwd(), 'site', 'site-renderer.ts'), 'utf8')
    const client = fs.readFileSync(path.join(process.cwd(), 'site', 'client', 'main.ts'), 'utf8')
    const graph = fs.readFileSync(path.join(process.cwd(), 'site', 'client', 'foundation-graph.ts'), 'utf8')

    // Search comes first, then the subject directory, then the learning routes.
    assert.match(renderer, /<\/form>\$\{results\}\$\{directory\}\$\{routes\}/u)
    assert.match(
        styles,
        /\.foundations-page\[data-filtering='true'\] :is\(\.foundation-routes, \.foundations-directory\)/u
    )
    assert.doesNotMatch(renderer, /foundations-wing/u)
    assert.doesNotMatch(styles, /foundations-wing/u)
    // The miniature dial draws from the catalogue rows and stays still for readers who ask for that.
    assert.match(renderer, /data-foundation-dial/u)
    assert.match(renderer, /data-dial="\$\{dial\}"/u)
    assert.match(client, /import\('\.\/foundation-dial'\)/u)
    assert.match(dial, /prefers-reduced-motion: reduce/u)
    assert.match(dial, /IntersectionObserver/u)
    assert.match(dial, /ResizeObserver/u)
    assert.doesNotMatch(dial, /innerHTML/u)
    assert.doesNotMatch(renderer, /Foundations Library/u)
    // The display band repeats the site's own lettering for a seamless loop; no name is written into the renderer.
    assert.equal((renderer.match(/foundations-marquee__word">\$\{lettering\}/gu) ?? []).length, 2)
    assert.match(styles, /@keyframes foundations-marquee/u)
    assert.doesNotMatch(renderer, /foundations-chain/u)
    assert.doesNotMatch(styles, /foundations-chain/u)
    assert.match(renderer, /aria-live="polite"/u)
    assert.match(renderer, /class="foundation-routes"/u)
    assert.match(renderer, /从一个问题开始/u)
    assert.match(renderer, /data-foundation-life/u)
    assert.match(life, /requestAnimationFrame/u)
    assert.match(life, /IntersectionObserver/u)
    assert.match(life, /visibilitychange/u)
    assert.match(life, /prefers-reduced-motion: reduce/u)
    assert.match(renderer, /aria-keyshortcuts/u)
    assert.match(life, /addEventListener\('pointerdown'/u)
    assert.match(life, /addEventListener\('mousemove'/u)
    assert.match(client, /import\('\.\/foundation-life'\)/u)
    assert.match(renderer, /foundations-entry__relations/u)
    assert.match(renderer, /直接前置/u)
    assert.match(renderer, /data-foundation-graph/u)
    assert.match(renderer, /data-foundation-graph-relation/u)
    assert.match(renderer, /data-foundation-graph-hop-select/u)
    assert.match(renderer, /type="checkbox"/u)
    assert.match(renderer, /拖动节点调整位置/u)
    assert.doesNotMatch(renderer, /正文引用|bodyReference|getFoundationBodyReferences/u)
    assert.doesNotMatch(styles, /foundation-relations__body-references/u)
    assert.match(renderer, /分类位置/u)
    assert.match(renderer, /类型化关系/u)
    assert.match(renderer, /术语导航/u)
    assert.match(renderer, /pageClass: 'foundation-entry-page'/u)
    assert.doesNotMatch(renderer, /data-foundation-folio/u)
    assert.match(renderer, /data-foundation-relations/u)
    assert.doesNotMatch(renderer, /hasAside: true/u)
    assert.match(shell, /bodyPrelude/u)
    assert.match(shell, /content-only-preview/u)
    assert.match(client, /function bindFoundationAnchors/u)
    assert.match(client, /import\('\.\/foundation-graph'\)/u)
    assert.match(graph, /cytoscape\(/u)
    assert.match(graph, /name: 'preset'/u)
    assert.match(graph, /name: 'cola'/u)
    assert.match(graph, /avoidOverlap: true/u)
    assert.match(graph, /\? \{ axis: 'y', minSeparation: 108 \}/u)
    assert.match(graph, /: \{ axis: 'x', minSeparation: 220 \}/u)
    assert.match(graph, /maxSimulationTime:/u)
    assert.match(graph, /graph\.on\('free'/u)
    assert.match(graph, /graph\.on\('dragfree'/u)
    assert.match(graph, /getCollisionFreePosition/u)
    assert.match(graph, /anchor\.boundingBox\(\)/u)
    assert.match(graph, /graph\.nodes\(':visible'\)\.not\(anchor\)/u)
    assert.match(graph, /event\.target\.animate/u)
    assert.match(graph, /duration: 180/u)
    assert.doesNotMatch(graph, /settle\(\{ anchor/u)
    assert.match(graph, /ResizeObserver/u)
    assert.match(graph, /new ResizeObserver\(\(\) => graph\.resize\(\)\)/u)
    assert.doesNotMatch(graph, /new ResizeObserver\(\(\) => fit\(\)\)/u)
    assert.match(graph, /prefers-reduced-motion: reduce/u)
    assert.match(graph, /is-second-hop-edge/u)
    assert.match(graph, /is-third-hop-edge/u)
    assert.match(graph, /edge\[relation = "requires"\]/u)
    assert.match(graph, /edge\[relation = "special_case_of"\]/u)
    assert.match(graph, /edge\[relation = "uses"\]/u)
    assert.match(graph, /edge\[relation = "implemented_by"\]/u)
    assert.match(graph, /edge\[relation = "equivalent_to"\]/u)
    assert.match(graph, /edge\[relation = "contrasts_with"\]/u)
    assert.match(graph, /graph\s*\.elements\(\)\s*\.not\('\.is-filtered'\)\s*\.layout/u)
    assert.doesNotMatch(graph, /graph\.elements\(':visible'\)\.layout/u)
    assert.match(graph, /is-filtered/u)
    assert.match(graph, /'line-style': 'dashed'/u)
    assert.doesNotMatch(graph, /is-collapsed/u)
    assert.match(client, /function syncFoundationRouteBar/u)
    assert.doesNotMatch(client, /innerHTML/u)
    assert.doesNotMatch(styles, /foundation-folio/u)
    assert.match(styles, /\.foundation-path:has\(/u)
    assert.match(styles, /animation-timeline: scroll\(root block\)/u)
    assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)/u)
    assert.match(renderer, /data-foundation-route-bar/u)
    assert.match(renderer, /@view-transition\{navigation:auto\}/u)
    assert.doesNotMatch(renderer, /foundation-index-band/u)
    assert.doesNotMatch(styles, /foundation-index-band/u)
    assert.doesNotMatch(client, /foundation-index-band/u)
    assert.doesNotMatch(renderer, /<dt>别名<\/dt>/u)
    assert.doesNotMatch(renderer, /<dt>直接前置<\/dt>/u)
    assert.match(renderer, /foundation-header__context" aria-label=/u)
    assert.match(renderer, /foundation-header__kind/u)
    assert.doesNotMatch(renderer, /转到参考资料/u)
    assert.doesNotMatch(renderer, /默认收起/u)
})

test('Foundation entries show their local path, sidebar-free reading and route-local continuation', () => {
    const entry = (
        id: string,
        requires: string[] = [],
        kind: FoundationEntryInput['kind'] = 'definition'
    ): FoundationEntryInput => ({
        title: id,
        id,
        aliases: [],
        kind,
        domains: ['knowledge/basics'],
        requires,
        uses: [],
        implemented_by: [],
        special_case_of: [],
        equivalent_to: [],
        contrasts_with: [],
        description: `${id} description`,
        sourcePath: `foundations/${id}.md`,
        regularPath: `/foundations/${id}.html`
    })
    const markdown = new MarkdownIt()
    const t = createTranslator('zh-CN')
    const page = (entries: FoundationEntryInput[], id: string, routes: FoundationRoute[] = []) => {
        const foundation = createFoundationPageData(createFoundationCollection(entries, { groups, routes }), id)
        assert.ok(foundation)
        return foundation
    }
    const route: FoundationRoute = {
        id: 'route-focus',
        title: 'Focus route',
        audience: 'Readers',
        promise: 'Continue from focus to route-next.',
        entries: ['base-a', 'focus', 'route-next'],
        type: 'core'
    }
    const recommended = page(
        [
            entry('base-a'),
            entry('base-b'),
            entry('focus', ['base-a', 'base-b']),
            entry('route-next'),
            entry('dependent', ['focus'])
        ],
        'focus',
        [route]
    )
    const pathHtml = renderFoundationPath(t, recommended, markdown)
    assert.match(pathHtml, /<nav class="foundation-path" aria-label="概念位置"/u)
    assert.match(pathHtml, /data-side="before"><p class="foundation-path__label">直接前置<small>2<\/small><\/p>/u)
    assert.match(pathHtml, /data-side="after"><p class="foundation-path__label">直接后续<small>1<\/small><\/p>/u)
    for (const id of ['base-a', 'base-b', 'dependent']) {
        assert.equal((pathHtml.match(new RegExp(`href="/foundations/${id}\\.html"`, 'gu')) ?? []).length, 1)
    }
    // One thread per listed concept; the drawing is decoration over the two lists.
    assert.equal((pathHtml.match(/<path data-side="before"/gu) ?? []).length, 2)
    assert.equal((pathHtml.match(/<path data-side="after"/gu) ?? []).length, 1)
    assert.match(pathHtml, /class="foundation-path__thread" aria-hidden="true"/u)
    assert.doesNotMatch(pathHtml, /route-next/u)

    const routesHtml = renderFoundationReadingRoutes(t, recommended, markdown)
    assert.match(
        routesHtml,
        /<nav id="foundation-reading-routes" class="foundation-reading-routes" data-foundation-reading-routes/u
    )
    assert.match(routesHtml, /data-foundation-route-panel="route-focus"/u)
    assert.match(routesHtml, /--foundation-route-progress:0\.667/u)
    assert.match(
        routesHtml,
        /<a data-foundation-route-step="next" href="\/foundations\/route-next\.html\?route=route-focus"><span>下一站<\/span>route-next<\/a>/u
    )
    assert.match(
        routesHtml,
        /<a data-foundation-route-step="previous" href="\/foundations\/base-a\.html\?route=route-focus"><span>上一站<\/span>base-a<\/a>/u
    )
    assert.match(routesHtml, /<strong>Focus route<\/strong>/u)
    assert.match(routesHtml, /第 2 \/ 3 站/u)
    assert.doesNotMatch(routesHtml, /推荐继续/u)

    const terminalHtml = renderFoundationReadingRoutes(
        t,
        page([entry('base-a'), entry('focus'), entry('route-next'), entry('other-next')], 'route-next', [
            { ...route, capstoneHref: '/pages/route-exercises.html#answers' },
            { ...route, id: 'route-other', title: 'Other route', entries: ['route-next', 'other-next'] }
        ]),
        markdown
    )
    assert.equal((terminalHtml.match(/data-foundation-route-panel=/gu) ?? []).length, 2)
    assert.match(terminalHtml, /data-foundation-route-end>已到本路线终点/u)
    assert.match(terminalHtml, /href="\/pages\/route-exercises\.html#answers"/u)
    assert.match(terminalHtml, /href="\/foundations\/other-next\.html\?route=route-other"/u)
    const panels = [...terminalHtml.matchAll(/<details data-foundation-route-panel=[^>]+>/gu)]
    assert.ok(panels.every(([tag]) => !/\b(?:open|hidden)(?:[ >])/u.test(tag)))
    assert.match(terminalHtml, /data-foundation-route-choices hidden/u)

    // Beyond five concepts a side keeps four and points at the complete relation section.
    const crowded = page(
        [
            ...Array.from({ length: 6 }, (_, index) => entry(`base-${index + 1}`)),
            entry(
                'focus',
                Array.from({ length: 6 }, (_, index) => `base-${index + 1}`)
            ),
            ...Array.from({ length: 7 }, (_, index) => entry(`dependent-${index + 1}`, ['focus'])),
            entry('grandchild', ['dependent-7'])
        ],
        'focus'
    )
    const crowdedHtml = renderFoundationPath(t, crowded, markdown, (id) => (id === 'dependent-7' ? 1 : 0))
    assert.match(crowdedHtml, /aria-label="查看其他 2 个直接前置">另 2 项<\/a>/u)
    assert.match(crowdedHtml, /aria-label="查看其他 3 个直接后续">另 3 项<\/a>/u)
    assert.equal((crowdedHtml.match(/href="#foundation-relations-title"/gu) ?? []).length, 2)
    assert.equal((crowdedHtml.match(/<path data-side="before"/gu) ?? []).length, 5)
    assert.equal((crowdedHtml.match(/<path data-side="after"/gu) ?? []).length, 5)
    assert.equal((crowdedHtml.match(/ data-more /gu) ?? []).length, 2)
    assert.match(crowdedHtml, /--foundation-path-height:150px/u)
    // The successor that carries further entries is listed first.
    assert.ok(
        crowdedHtml.indexOf('/foundations/dependent-7.html') < crowdedHtml.indexOf('/foundations/dependent-1.html')
    )
    assert.doesNotMatch(crowdedHtml, /dependent-5\.html/u)

    const startHtml = renderFoundationPath(
        t,
        page([entry('focus'), entry('dependent-a', ['focus']), entry('dependent-b', ['focus'])], 'focus'),
        markdown
    )
    assert.match(startHtml, /<p class="foundation-path__empty">无需前置<\/p>/u)
    assert.doesNotMatch(startHtml, /<path data-side="before"/u)
    const endHtml = renderFoundationPath(t, page([entry('base'), entry('focus', ['base'])], 'focus'), markdown)
    assert.match(endHtml, /<p class="foundation-path__empty">暂未收录<\/p>/u)

    // An entry with no dependency in either direction, or a navigation page, draws no path at all.
    assert.equal(renderFoundationPath(t, page([entry('focus')], 'focus'), markdown), '')
    assert.equal(
        renderFoundationPath(t, page([entry('guide', [], 'navigation'), entry('focus')], 'guide'), markdown),
        ''
    )
    assert.equal(renderFoundationReadingRoutes(t, page([entry('focus')], 'focus'), markdown), '')
    assert.doesNotMatch(renderFoundationPath(createTranslator('en-GB'), crowded, markdown), /\p{Script=Han}/u)
})

test('Foundations renders typed local relations and keeps navigation pages out of the dependency path', () => {
    const entry = (id: string, overrides: Partial<FoundationEntryInput> = {}): FoundationEntryInput => ({
        title: id,
        id,
        aliases: [],
        kind: 'definition',
        domains: ['knowledge/basics'],
        requires: [],
        uses: [],
        implemented_by: [],
        special_case_of: [],
        equivalent_to: [],
        contrasts_with: [],
        description: `${id} description`,
        sourcePath: `foundations/${id}.md`,
        regularPath: `/foundations/${id}.html`,
        ...overrides
    })
    const collection = createFoundationCollection(
        [
            entry('origin'),
            entry('root', { requires: ['origin'] }),
            entry('base', { requires: ['root'] }),
            entry('general'),
            entry('tool'),
            entry('implementation'),
            entry('peer', { equivalent_to: ['focus'] }),
            entry('contrast', { contrasts_with: ['focus'] }),
            entry('focus', {
                requires: ['base'],
                special_case_of: ['general'],
                uses: ['tool'],
                implemented_by: ['implementation'],
                equivalent_to: ['peer'],
                contrasts_with: ['contrast']
            }),
            entry('narrower', { special_case_of: ['focus'] }),
            ...Array.from({ length: 8 }, (_, index) => entry(`dependent-${index + 1}`, { requires: ['focus'] })),
            entry('dependent-two', { requires: ['dependent-1'] }),
            entry('dependent-three', { requires: ['dependent-two'] }),
            entry('typed-only-focus'),
            entry('typed-consumer', { uses: ['typed-only-focus'] }),
            entry('navigation-page', { kind: 'navigation', aliases: ['Focus overview'] })
        ],
        { groups }
    )
    const focus = createFoundationPageData(collection, 'focus')
    assert.ok(focus)
    const markdown = new MarkdownIt()
    const focusHtml = renderFoundationRelations(createTranslator('zh-CN'), focus, markdown)
    const englishHtml = renderFoundationRelations(createTranslator('en-GB'), focus, markdown)
    assert.doesNotMatch(englishHtml, /\p{Script=Han}/u)
    assert.match(englishHtml, /Dependency hops/)
    assert.match(englishHtml, /Relationships as text/)
    assert.match(englishHtml, /Implemented by/)
    assert.match(focusHtml, /分类位置/u)
    assert.match(focusHtml, /<details class="foundation-relations__section"><summary>[\s\S]*?分类位置/u)
    assert.doesNotMatch(focusHtml, /<details class="foundation-relations__section" open/u)
    assert.match(focusHtml, /上位 \/ 更一般/u)
    assert.match(focusHtml, /下位 \/ 直接特例/u)
    assert.match(focusHtml, /使用的工具/u)
    assert.match(focusHtml, /具体实现/u)
    assert.match(focusHtml, /限定层次等价/u)
    assert.match(focusHtml, /并列辨析/u)
    assert.match(focusHtml, /<strong role="heading" aria-level="2">关系图谱<\/strong><small>\d+ 个相邻概念/u)
    assert.doesNotMatch(focusHtml, /<small>focus ·/u)
    assert.match(focusHtml, /data-foundation-graph/u)
    assert.match(focusHtml, /data-foundation-graph-hops="2"/u)
    assert.match(focusHtml, /data-foundation-graph-data/u)
    assert.match(focusHtml, /data-foundation-graph-action="layout">重排/u)
    assert.match(focusHtml, /data-foundation-graph-relation/u)
    assert.match(focusHtml, /data-foundation-graph-hop-select/u)
    assert.match(focusHtml, /<option value="1">1 跳<\/option>/u)
    assert.match(focusHtml, /<option value="2" selected>2 跳<\/option>/u)
    assert.match(focusHtml, /<option value="3">3 跳<\/option>/u)
    assert.match(focusHtml, /value="requires"[^>]* checked/u)
    assert.match(focusHtml, /value="special_case_of"/u)
    assert.match(focusHtml, /value="uses"/u)
    assert.match(focusHtml, /value="implemented_by"/u)
    assert.match(focusHtml, /value="equivalent_to"/u)
    assert.match(focusHtml, /value="contrasts_with"/u)
    assert.match(focusHtml, /前置二跳/u)
    assert.match(focusHtml, /后续二跳/u)
    assert.match(focusHtml, /前置三跳/u)
    assert.match(focusHtml, /后续三跳/u)
    const graphSource = focusHtml.match(
        /<script type="application\/json" data-foundation-graph-data>(.*?)<\/script>/u
    )?.[1]
    assert.ok(graphSource)
    const graphData = JSON.parse(graphSource)
    assert.deepEqual(
        Object.fromEntries(
            graphData.nodes.map((node: { id: string; dependencyDepth: number | null }) => [
                node.id,
                node.dependencyDepth
            ])
        ),
        {
            base: -1,
            contrast: null,
            'dependent-1': 1,
            'dependent-2': 1,
            'dependent-three': 3,
            'dependent-3': 1,
            'dependent-4': 1,
            'dependent-5': 1,
            'dependent-6': 1,
            'dependent-7': 1,
            'dependent-8': 1,
            'dependent-two': 2,
            focus: 0,
            general: null,
            implementation: null,
            narrower: null,
            origin: -3,
            peer: null,
            root: -2,
            tool: null
        }
    )
    assert.deepEqual([...new Set(graphData.edges.map((edge: { relation: string }) => edge.relation))].sort(), [
        'contrasts_with',
        'equivalent_to',
        'implemented_by',
        'requires',
        'special_case_of',
        'uses'
    ])
    for (let index = 1; index <= 8; index += 1) {
        assert.equal(
            (focusHtml.match(new RegExp(`href="/foundations/dependent-${index}\\.html"`, 'gu')) ?? []).length,
            1
        )
    }
    for (const id of ['base', 'general', 'tool', 'implementation', 'peer', 'contrast']) {
        assert.equal(
            (focusHtml.match(new RegExp(`href="/foundations/${id}\\.html"`, 'gu')) ?? []).length,
            1,
            `${id} should appear only in its typed relation group`
        )
    }
    assert.doesNotMatch(focusHtml, /正文引用|body-only/u)

    const typedOnly = createFoundationPageData(collection, 'typed-only-focus')
    assert.ok(typedOnly)
    const typedOnlyHtml = renderFoundationRelations(createTranslator('zh-CN'), typedOnly, markdown)
    assert.doesNotMatch(typedOnlyHtml, /当前条目没有严格依赖链/u)
    assert.match(typedOnlyHtml, /被这些条目使用/u)
    assert.equal((typedOnlyHtml.match(/href="\/foundations\/typed-consumer\.html"/gu) ?? []).length, 1)
    assert.match(typedOnlyHtml, /data-foundation-graph/u)
    assert.match(typedOnlyHtml, /value="uses"[^>]* checked/u)
    assert.match(typedOnlyHtml, /data-foundation-graph-hop-select[^>]* disabled/u)

    const navigation = createFoundationPageData(collection, 'navigation-page')
    assert.ok(navigation)
    const navigationHtml = renderFoundationRelations(createTranslator('zh-CN'), navigation, markdown)
    assert.match(navigationHtml, /术语导航/u)
    assert.match(navigationHtml, /本页不参与六类关系/u)
    assert.doesNotMatch(navigationHtml, /返回总目录/u)
    assert.doesNotMatch(navigationHtml, /总览与术语分流/u)
    assert.doesNotMatch(navigationHtml, /正文引用|href=/u)
    assert.doesNotMatch(navigationHtml, /直接前置/u)
    assert.doesNotMatch(navigationHtml, /暂未标注严格前置/u)
    assert.doesNotMatch(navigationHtml, /data-foundation-graph/u)
})

test('Foundations life game seeds classic patterns and follows toroidal Conway rules', () => {
    assert.ok(LIFE_PATTERNS.length >= 5)
    LIFE_PATTERNS.forEach((pattern) => {
        const seeded = seedLife(pattern)
        assert.equal(seeded.length, LIFE_COLUMNS * LIFE_ROWS)
        assert.equal(
            seeded.reduce((total, cell) => total + cell, 0),
            pattern.cells.length
        )
    })

    const blinker = new Uint8Array(25)
    blinker[2 * 5 + 1] = 1
    blinker[2 * 5 + 2] = 1
    blinker[2 * 5 + 3] = 1

    const next = nextLifeGeneration(blinker, 5, 5)
    const liveCells = [...next.entries()]
        .filter(([, alive]) => alive)
        .map(([index]) => [index % 5, Math.floor(index / 5)])
    assert.deepEqual(liveCells, [
        [2, 1],
        [2, 2],
        [2, 3]
    ])
    assert.deepEqual(nextLifeGeneration(next, 5, 5), blinker)

    const wrappedBlinker = new Uint8Array(25)
    wrappedBlinker[2 * 5 + 4] = 1
    wrappedBlinker[2 * 5] = 1
    wrappedBlinker[2 * 5 + 1] = 1
    const wrappedNext = nextLifeGeneration(wrappedBlinker, 5, 5)
    const wrappedLiveCells = [...wrappedNext.entries()]
        .filter(([, alive]) => alive)
        .map(([index]) => [index % 5, Math.floor(index / 5)])
    assert.deepEqual(wrappedLiveCells, [
        [0, 1],
        [0, 2],
        [0, 3]
    ])
})

test('Foundations folds secondary reading sections without hiding the formal statement', () => {
    const md = new MarkdownIt().use(createFoundationMarkdownPlugin('knowledge/concepts'))
    const source = [
        '## 形式陈述',
        '',
        'Formal.',
        '',
        '## 直觉',
        '',
        'Intuition.',
        '',
        '## 例子与边界',
        '',
        'Examples.',
        '',
        '## 推论与应用',
        '',
        'Applications.',
        '',
        '## 参考资料',
        '',
        '- Reference'
    ].join('\n')
    const foundation = md.render(source, { relativePath: 'knowledge/concepts/example.md' })
    const article = md.render(source, { relativePath: 'posts/example.md' })

    // The statement stays open and unfolded, inside the one wrapper the page marks as canonical.
    assert.match(
        foundation,
        /^<section class="foundation-statement">\n<h2>形式陈述<\/h2>\n<p>Formal\.<\/p>\n<\/section>\n<details/u
    )
    assert.equal((foundation.match(/<section class="foundation-statement">/gu) ?? []).length, 1)
    assert.doesNotMatch(article, /foundation-statement/u)
    assert.match(
        foundation,
        /<details class="foundation-section" data-foundation-section="直觉" open><summary id="直觉">/u
    )
    assert.match(foundation, /<details class="foundation-section" data-foundation-section="例子与边界" open>/u)
    assert.match(foundation, /<details class="foundation-section" data-foundation-section="推论与应用" open>/u)
    assert.match(
        foundation,
        /<details class="foundation-section foundation-references" data-foundation-section="参考资料"><summary id="参考资料">/u
    )
    assert.match(foundation, /<ul>[\s\S]*Reference[\s\S]*<\/ul>[\s\S]*<\/details>/u)
    assert.doesNotMatch(foundation, /<details class="foundation-section foundation-references"[^>]* open/u)
    assert.doesNotMatch(article, /foundation-references/u)
    assert.doesNotMatch(
        md.render(source, { relativePath: 'knowledge/concepts-other/example.md' }),
        /foundation-references/u
    )
    assert.match(article, /<h2>参考资料<\/h2>/u)
})
