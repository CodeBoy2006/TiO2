import assert from 'node:assert/strict'
import test from 'node:test'
import {
    createFoundationAtlas,
    createFoundationAtlasCurves,
    foundationAtlasAngle,
    foundationAtlasColor,
    foundationAtlasWings,
    layoutFoundationNeighborhood,
    projectFoundationAtlas,
    type FoundationAtlasFilter
} from '../../packages/content-core/src/foundation-atlas'
import {
    createFoundationCollection,
    FOUNDATION_RELATION_FIELDS,
    type FoundationEntryInput
} from '../../packages/content-core/src/foundations'
import { createReadingProject } from '../fixtures/project.js'
import { renderFoundationAtlasPage, renderFoundationAtlasSvg } from '../../site/foundation-atlas-renderer'
import { libraryIdentity } from '../../site/render-helpers'

const groups = [
    {
        id: 'knowledge',
        title: 'Knowledge',
        englishTitle: 'Knowledge',
        description: 'Knowledge',
        domains: ['math', 'computing'].map((id) => ({ id, group: 'knowledge', title: id, description: id }))
    }
]
const entry = (id: string, fields: Partial<FoundationEntryInput> = {}): FoundationEntryInput => ({
    id,
    title: id,
    aliases: [],
    description: id,
    kind: 'definition',
    domains: ['math'],
    requires: [],
    uses: [],
    implemented_by: [],
    special_case_of: [],
    equivalent_to: [],
    contrasts_with: [],
    sourcePath: `foundations/${id}.md`,
    regularPath: `/foundations/${id}.html`,
    ...fields
})
const collection = createFoundationCollection(
    [
        entry('base', { equivalent_to: ['peer'], contrasts_with: ['other'] }),
        entry('peer', { equivalent_to: ['base'], domains: ['computing'] }),
        entry('other', { contrasts_with: ['base'], domains: ['computing', 'math'] }),
        entry('middle', { requires: ['base'], special_case_of: ['base'], domains: ['computing'] }),
        entry('end', { requires: ['middle'], uses: ['peer'], implemented_by: ['other'], domains: ['computing'] }),
        entry('island'),
        entry('navigation', { kind: 'navigation' })
    ],
    { groups }
)
const atlas = createFoundationAtlas(collection)
const filter = (changes: Partial<FoundationAtlasFilter> = {}): FoundationAtlasFilter => ({
    domain: 'all',
    kind: 'all',
    relations: new Set(FOUNDATION_RELATION_FIELDS),
    crossDomainOnly: false,
    hops: 1,
    ...changes
})

test('complete atlas retains canonical and isolated nodes, typed direction and unique symmetric pairs', () => {
    assert.equal(atlas.nodes.length, 6)
    assert.ok(atlas.nodes.some((node) => node.id === 'island' && node.degree === 0))
    assert.ok(!atlas.nodes.some((node) => node.id === 'navigation'))
    const triples = atlas.edges.map((edge) => `${edge.relation}:${edge.source}->${edge.target}`)
    assert.deepEqual(
        new Set(triples),
        new Set([
            'requires:base->middle',
            'requires:middle->end',
            'special_case_of:base->middle',
            'uses:end->peer',
            'implemented_by:end->other',
            'equivalent_to:base->peer',
            'contrasts_with:base->other'
        ])
    )
    assert.equal(atlas.edges.filter((edge) => edge.crossDomain).length, 3)
    assert.equal(atlas.nodes.find((node) => node.id === 'end')!.rank, 2)
    assert.equal(new Set(atlas.nodes.map((node) => `${node.x},${node.y}`)).size, 6)
    assert.deepEqual(createFoundationAtlas(collection), atlas)
})

test('projections preserve induced edges, memberships, isolated nodes and shortest selected-relation hops', () => {
    assert.equal(projectFoundationAtlas(atlas, filter()).nodeIds.size, 6)
    assert.deepEqual(projectFoundationAtlas(atlas, filter({ relations: new Set() })).edges, [])
    assert.equal(projectFoundationAtlas(atlas, filter({ relations: new Set() })).nodeIds.size, 6)
    assert.ok(projectFoundationAtlas(atlas, filter({ domain: 'math' })).nodeIds.has('other'))
    const requires = new Set<'requires'>(['requires'])
    const one = projectFoundationAtlas(atlas, filter({ focusId: 'base', relations: requires }))
    assert.deepEqual(one.nodeIds, new Set(['base', 'middle']))
    assert.equal(one.edges.length, 1)
    const two = projectFoundationAtlas(atlas, filter({ focusId: 'base', hops: 2, relations: requires }))
    assert.deepEqual(two.nodeIds, new Set(['base', 'middle', 'end']))
    assert.ok(!two.edges.some((edge) => edge.source === 'base' && edge.target === 'end'))
    assert.equal(projectFoundationAtlas(atlas, filter({ focusId: 'base', domain: 'computing' })).nodeIds.size, 0)
    assert.ok(projectFoundationAtlas(atlas, filter({ crossDomainOnly: true })).edges.every((edge) => edge.crossDomain))
})

test('the dial places subjects by angle and prerequisite depth by radius, and routes subjects through the hub', () => {
    assert.deepEqual(
        foundationAtlasWings(atlas).map((wing) => wing.domains.map((domain) => domain.id)),
        [['math', 'computing']]
    )
    assert.equal(atlas.rings.length, 4)
    assert.equal(atlas.rings.at(-1), atlas.radius)
    for (const node of atlas.nodes) {
        const domain = atlas.domains.find((item) => item.id === node.domains[0])!
        const angle = foundationAtlasAngle(node.x, node.y)
        const radius = Math.hypot(node.x, node.y)
        assert.ok(angle > domain.start && angle < domain.end, `${node.id} lies inside its subject`)
        assert.ok(radius > atlas.rings[node.rank] && radius < atlas.rings[node.rank + 1], `${node.id} lies in its band`)
    }
    const curveOf = createFoundationAtlasCurves(atlas)
    const reach = (curve: number[]) =>
        Math.min(...Array.from({ length: curve.length / 2 }, (_, at) => Math.hypot(curve[at * 2], curve[at * 2 + 1])))
    const inside = curveOf(atlas.edges.find((edge) => edge.id === 'requires:middle->end')!)
    const across = curveOf(atlas.edges.find((edge) => edge.id === 'requires:base->middle')!)
    assert.equal(inside.length, 8)
    assert.ok(reach(inside) > atlas.gate)
    assert.ok(reach(across) < atlas.gate)
    for (const curve of [inside, across]) {
        const target = atlas.nodes.find((node) => node.x === curve.at(-2) && node.y === curve.at(-1))
        assert.ok(target, 'curves end on their target concept')
    }
    assert.match(foundationAtlasColor(atlas.domains[0].hue, 'dark'), /^#[0-9a-f]{6}$/u)
    assert.notEqual(foundationAtlasColor(210, 'dark'), foundationAtlasColor(210, 'light'))
})

test('a neighborhood re-centres on its focus, groups the first hop by relation and fans the second hop behind it', () => {
    const one = layoutFoundationNeighborhood(atlas, projectFoundationAtlas(atlas, filter({ focusId: 'base' })), 'base')
    assert.deepEqual(one.positions.get('base'), { x: 0, y: 0, angle: 0, ring: 0 })
    assert.deepEqual(
        one.sectors.map((sector) => [sector.relation, sector.direction, sector.count]),
        [
            ['requires', 'outgoing', 1],
            ['equivalent_to', 'both', 1],
            ['contrasts_with', 'both', 1]
        ]
    )
    assert.equal(one.rings.length, 1)
    for (const id of ['middle', 'peer', 'other']) {
        const position = one.positions.get(id)!
        assert.equal(position.ring, 1)
        assert.ok(Math.abs(Math.hypot(position.x, position.y) - one.rings[0]) < 0.01)
        const sector = one.sectors.find((item) => position.angle > item.start && position.angle < item.end)
        assert.ok(sector, `${id} sits inside a relation sector`)
    }
    const projection = projectFoundationAtlas(atlas, filter({ focusId: 'base', hops: 2 }))
    const two = layoutFoundationNeighborhood(atlas, projection, 'base')
    assert.equal(two.positions.size, projection.nodeIds.size)
    assert.equal(two.rings.length, 2)
    assert.equal(two.radius, two.rings[1])
    const end = two.positions.get('end')!
    assert.equal(end.ring, 2)
    assert.ok(
        projection.edges.some((edge) => [edge.source, edge.target].includes(end.parent!) && edge.target === 'end')
    )
    assert.deepEqual(layoutFoundationNeighborhood(atlas, projection, 'base'), two)
    assert.equal(layoutFoundationNeighborhood(atlas, projection, 'island').positions.size, 0)
})

test('atlas and SVG cover every fixture concept and assertion with safe, semantic exports', async (t) => {
    const project = await createReadingProject(t, { groups })
    const corpus = collection
    const data = createFoundationAtlas(corpus)
    const formal = corpus.entries.filter((entry) => entry.kind !== 'navigation')
    assert.deepEqual(new Set(data.nodes.map((node) => node.id)), new Set(formal.map((entry) => entry.id)))
    const expectedEdges = formal.reduce(
        (sum, entry) =>
            sum +
            FOUNDATION_RELATION_FIELDS.reduce(
                (count, field) =>
                    count +
                    entry[field].filter((id) => !['equivalent_to', 'contrasts_with'].includes(field) || entry.id < id)
                        .length,
                0
            ),
        0
    )
    assert.equal(data.edges.length, expectedEdges)
    assert.equal(new Set(data.edges.map((edge) => edge.id)).size, expectedEdges)
    assert.equal(new Set(data.nodes.map((node) => `${node.x},${node.y}`)).size, formal.length)
    for (const node of data.nodes) {
        const domain = data.domains.find((domain) => domain.id === node.domains[0])!
        const angle = foundationAtlasAngle(node.x, node.y)
        const radius = Math.hypot(node.x, node.y)
        assert.ok(angle > domain.start && angle < domain.end)
        assert.ok(radius > data.rings[node.rank] && radius < data.rings[node.rank + 1])
    }
    assert.deepEqual(
        foundationAtlasWings(data).map((wing) => wing.domains.map((domain) => domain.id)),
        corpus.groups.map((group) => group.domains.map((domain) => domain.id))
    )
    assert.equal(
        data.domains.reduce((sum, domain) => sum + domain.count, 0),
        formal.length
    )
    const markup = await renderFoundationAtlasPage(project, data, { stylesheets: [], modulePreloads: [], script: '' })
    assert.equal((markup.match(/data-atlas-select=/gu) ?? []).length, formal.length)
    assert.match(markup, /文字目录与无障碍入口/u)
    assert.match(markup, /download>下载 SVG 全图/u)
    // The way back names the library as the site names it, never as the framework once did.
    const library = libraryIdentity(project).title
    assert.ok(markup.includes(`>返回${library}</a>`) || !markup.includes('atlas-header"><div><a'))
    assert.doesNotMatch(markup, /公理与理论库|Foundations 知识图谱/u)
    const svg = renderFoundationAtlasSvg(data, project.config.site.url)
    assert.match(
        renderFoundationAtlasSvg(data, project.config.site.url, 'zh-CN', `${library} · 概念关系图`),
        new RegExp(`<title id="title">${library} · 概念关系图</title>`, 'u')
    )
    assert.match(svg, /<title id="title">概念关系全图<\/title>/u)
    assert.equal((svg.match(/data-node-id=/gu) ?? []).length, formal.length)
    assert.equal((svg.match(/data-relation=/gu) ?? []).length, expectedEdges)
    const unsafe = structuredClone(atlas)
    unsafe.nodes[0].title = '</script><img src=x onerror=alert(1)>'
    const escaped = await renderFoundationAtlasPage(project, unsafe, {
        stylesheets: [],
        modulePreloads: [],
        script: ''
    })
    assert.ok(!escaped.includes(unsafe.nodes[0].title))
    assert.ok(escaped.includes('\\u003c/script>'))
    assert.match(renderFoundationAtlasSvg(unsafe, project.config.site.url), /&lt;\/script&gt;/u)
})
