import assert from 'node:assert/strict'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import { createReadingProject } from '../fixtures/project.js'
import { createFoundationCollection, createFoundationPageData } from '../../packages/content-core/src/index.js'
import { renderFoundationRoutesPage } from '../../site/foundation-renderer.js'

const groups = [
    {
        id: 'knowledge',
        title: 'Knowledge',
        englishTitle: 'Knowledge',
        description: 'Fixture concepts.',
        domains: [{ id: 'knowledge/basics', group: 'knowledge', title: 'Basics', description: 'Basics.' }]
    }
]
const routes = [
    {
        id: 'first',
        title: 'First route',
        audience: 'Readers',
        promise: 'Read the full sequence.',
        type: 'core' as const,
        entries: ['base', 'middle', 'end']
    },
    {
        id: 'second',
        title: 'Second route',
        audience: 'Readers',
        promise: 'Start in the middle.',
        type: 'core' as const,
        entries: ['middle', 'end']
    }
]
const collection = createFoundationCollection(
    ['base', 'middle', 'end'].map((id) => ({
        id,
        title: id,
        aliases: [],
        description: id,
        kind: 'definition' as const,
        domains: ['knowledge/basics'],
        requires: [],
        uses: [],
        implemented_by: [],
        special_case_of: [],
        equivalent_to: [],
        contrasts_with: [],
        sourcePath: `foundations/${id}.md`,
        regularPath: `/foundations/${id}.html`
    })),
    { groups, routes }
)

test('every fixture route has contextual index links and complete route-local transitions', async (t) => {
    const project = await createReadingProject(t, { groups, routes })
    const html = await renderFoundationRoutesPage(project, collection, new MarkdownIt(), {
        stylesheets: [],
        modulePreloads: [],
        script: ''
    })
    const entries = new Map(collection.entries.map((entry) => [entry.id, entry]))
    const membership = new Map<string, typeof collection.routes>()
    for (const route of collection.routes) {
        for (const id of route.entries) {
            const routes = membership.get(id) ?? []
            routes.push(route)
            membership.set(id, routes)
            assert.ok(
                html.includes(`href="${entries.get(id)!.regularPath}?route=${encodeURIComponent(route.id)}"`),
                `${route.id}: ${id}`
            )
        }
    }
    for (const [id, routes] of membership) {
        const page = createFoundationPageData(collection, id)!
        assert.equal(page.readingRoutes.length, routes.length, id)
        if (routes.length > 1) assert.equal(page.recommendedNext, null, id)
        for (const route of routes) {
            const index = route.entries.indexOf(id)
            const context = page.readingRoutes.find((context) => context.id === route.id)!
            assert.equal(context.position, index + 1, `${route.id}: ${id} position`)
            assert.equal(context.total, route.entries.length, `${route.id}: ${id} length`)
            assert.equal(context.previous?.id, route.entries[index - 1], `${route.id}: ${id} previous`)
            assert.equal(context.next?.id, route.entries[index + 1], `${route.id}: ${id} next`)
            assert.deepEqual(
                context.entryPaths,
                route.entries.map((id) => entries.get(id)!.regularPath)
            )
        }
    }
})

test('route notes consume the complete terminal self-test marker', async (t) => {
    const project = await createReadingProject(t, { groups, routes })
    const html = await renderFoundationRoutesPage(
        project,
        {
            ...collection,
            routes: [
                {
                    ...collection.routes[0],
                    promise: '先核查收敛条件。终点自测：计算合并结果。'
                }
            ]
        },
        new MarkdownIt(),
        { stylesheets: [], modulePreloads: [], script: '' }
    )
    assert.ok(html.includes('<p>先核查收敛条件。</p>'))
    assert.ok(html.includes('<p><strong>自测</strong>计算合并结果。</p>'))
    assert.ok(!html.includes('先核查收敛条件。终点'))
})
