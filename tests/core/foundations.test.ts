import assert from 'node:assert/strict'
import test from 'node:test'
import {
    auditFoundationContentContract,
    auditFoundationGraph,
    createFoundationCollection,
    createFoundationPageData,
    FOUNDATION_CONTENT_SECTIONS,
    FOUNDATION_KINDS,
    type FoundationEntryInput,
    type FoundationRoute
} from '../../packages/content-core/src/index.js'

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

function entry(
    id: string,
    requires: string[] = [],
    overrides: Partial<FoundationEntryInput> = {}
): FoundationEntryInput {
    return {
        title: id,
        id,
        aliases: [],
        kind: 'definition',
        domains: ['knowledge/basics'],
        requires,
        uses: [],
        implemented_by: [],
        special_case_of: [],
        equivalent_to: [],
        contrasts_with: [],
        description: `${id} description`,
        sourcePath: `foundations/${id}.md`,
        regularPath: `/foundations/${id}.html`,
        ...overrides
    }
}

test('foundations form a validated acyclic dependency library', async (t) => {
    await t.test('accepts capstones in custom directories and rejects unsafe URLs', () => {
        const collectionFor = (capstoneHref: string) =>
            createFoundationCollection([entry('base'), entry('next')], {
                groups,
                routes: [
                    {
                        id: 'route',
                        title: 'Route',
                        audience: 'Readers',
                        promise: 'Learn',
                        type: 'core',
                        entries: ['base', 'next'],
                        capstoneHref
                    }
                ]
            })
        for (const href of [
            '/info/Exercises.html',
            '/notes/knowledge/base.html#练习',
            '/info/Unit%201.html',
            '/%E7%9F%A5%E8%AF%86/example.html'
        ]) {
            assert.equal(collectionFor(href).routes[0].capstoneHref, href)
        }
        for (const href of [
            'javascript:alert(1)',
            '//example.com/x.html',
            '/info/../x.html',
            '/info/%2e%2e/x.html',
            '/info/x%2fy.html',
            '/info/x%5cy.html',
            '/info/%00.html',
            '/info/%.html',
            '/info/x.html?q=1',
            '/info//x.html'
        ]) {
            assert.throws(() => collectionFor(href), /capstoneHref must be a local HTML URL/u)
        }
    })

    await t.test('isolates custom domain definitions between collections', () => {
        const customGroups = (id: string) => [
            {
                id,
                title: id,
                englishTitle: id,
                description: id,
                domains: [{ id: `${id}/basics`, group: id, title: 'Basics', description: 'Basics' }]
            }
        ]
        const firstGroups = customGroups('physics')
        const secondGroups = customGroups('music')
        const first = createFoundationCollection([entry('base', [], { domains: ['physics/basics'] })], {
            groups: firstGroups
        })
        const second = createFoundationCollection([entry('base', [], { domains: ['music/basics'] })], {
            groups: secondGroups
        })
        assert.equal(first.groups, firstGroups)
        assert.equal(second.groups, secondGroups)
        assert.deepEqual(first.routes, [])
        assert.deepEqual(second.entries[0].domains, ['music/basics'])
        assert.throws(() => createFoundationCollection(first.entries, { groups: secondGroups }), /unknown domain/u)
        assert.throws(() => createFoundationCollection(second.entries, { groups: firstGroups }), /unknown domain/u)
    })

    await t.test('rejects duplicate and ambiguous definitions and mismatched membership', () => {
        const group = groups[0]
        assert.throws(
            () => createFoundationCollection([], { groups: [group, group] }),
            /duplicate foundation group id/u
        )
        assert.throws(
            () =>
                createFoundationCollection([], {
                    groups: [{ ...group, domains: [group.domains[0], group.domains[0]] }]
                }),
            /duplicate foundation domain id/u
        )
        assert.throws(
            () =>
                createFoundationCollection([], {
                    groups: [{ ...group, domains: [{ ...group.domains[0], group: 'other' }] }]
                }),
            /belongs to “other”, expected “knowledge”/u
        )
        assert.throws(
            () =>
                createFoundationCollection([], {
                    groups: [
                        {
                            ...group,
                            domains: [
                                { ...group.domains[0], id: 'knowledge/base' },
                                { ...group.domains[0], id: 'knowledge-base' }
                            ]
                        }
                    ]
                }),
            /ambiguous foundation domain anchor/u
        )
        assert.throws(
            () =>
                createFoundationCollection([], {
                    groups: [{ ...group, id: 'Bad ID', domains: [] }]
                }),
            /foundation group id.*lowercase kebab-case/u
        )
        assert.throws(
            () =>
                createFoundationCollection([], {
                    groups: [{ ...group, domains: [{ ...group.domains[0], id: 'Bad ID' }] }]
                }),
            /foundation domain id.*lowercase kebab-case/u
        )
    })

    await t.test('accepts the supported domains and canonical entry kinds', () => {
        const collection = createFoundationCollection(
            [
                entry('stiff-system', [], {
                    kind: 'definition',
                    domains: ['knowledge/methods']
                }),
                entry('hedge', [], {
                    kind: 'algorithm',
                    domains: ['knowledge/methods']
                }),
                entry('estimation', [], {
                    kind: 'method',
                    domains: ['knowledge/methods']
                }),
                entry('indexing-problem', [], {
                    kind: 'model',
                    domains: ['knowledge/structure']
                }),
                entry('proof-map', [], {
                    kind: 'theorem',
                    domains: ['knowledge/basics']
                }),
                entry('worked-example', [], {
                    kind: 'application',
                    domains: ['knowledge/methods']
                }),
                entry('static-analysis', [], {
                    kind: 'method',
                    domains: ['knowledge/basics']
                })
            ],
            { groups }
        )

        assert.deepEqual(FOUNDATION_KINDS, [
            'axiom',
            'principle',
            'definition',
            'model',
            'method',
            'algorithm',
            'theorem',
            'application',
            'navigation'
        ])
        const entryById = new Map(collection.entries.map((item) => [item.id, item]))
        assert.deepEqual(entryById.get('stiff-system')?.domains, ['knowledge/methods'])
        assert.equal(entryById.get('hedge')?.kind, 'algorithm')
        assert.equal(entryById.get('estimation')?.kind, 'method')
        assert.equal(entryById.get('indexing-problem')?.kind, 'model')
        assert.equal(entryById.get('proof-map')?.kind, 'theorem')
        assert.equal(entryById.get('worked-example')?.kind, 'application')
        assert.equal(entryById.get('static-analysis')?.kind, 'method')
    })

    await t.test('derives direct prerequisites and dependents', () => {
        const route: FoundationRoute = {
            id: 'route-proof',
            title: 'Proof route',
            audience: 'Readers',
            promise: 'Continue from logic to modus ponens.',
            entries: ['propositional-logic', 'modus-ponens'],
            type: 'core'
        }
        const collection = createFoundationCollection(
            [
                entry('propositional-logic'),
                entry('modus-ponens', ['propositional-logic'], { kind: 'principle' }),
                entry('proof-by-cases', ['propositional-logic'])
            ],
            { groups, routes: [route] }
        )
        const page = createFoundationPageData(collection, 'propositional-logic')

        assert.equal(collection.entryCount, 3)
        assert.deepEqual(collection.routes, [route])
        assert.deepEqual(page?.prerequisites, [])
        assert.deepEqual(
            page?.dependents.map((item) => item.id),
            ['modus-ponens', 'proof-by-cases']
        )
        assert.equal(page?.recommendedNext?.entry.id, 'modus-ponens')
        assert.equal(page?.recommendedNext?.routeTitle, 'Proof route')
        assert.equal(createFoundationPageData(collection, 'missing'), null)
    })

    await t.test('retains every reading route, including terminal routes, without first-match selection', () => {
        const route = (id: string, entries: string[]): FoundationRoute => ({
            id, entries, title: id, audience: 'Readers', promise: 'Read in order.', type: 'core',
            capstoneHref: '/pages/exercises.html'
        })
        const inputs = ['before', 'focus', 'next-a', 'next-b'].map((id) => entry(id))
        const routes = [
            route('route-a', ['before', 'focus', 'next-a']),
            route('route-b', ['focus', 'next-b']),
            route('route-end', ['before', 'focus'])
        ]
        const page = createFoundationPageData(createFoundationCollection(inputs, { groups, routes }), 'focus')!
        assert.equal(page.recommendedNext, null)
        assert.deepEqual(page.readingRoutes.map(({ id, position, total, previous, next }) =>
            ({ id, position, total, previous: previous?.id ?? null, next: next?.id ?? null })), [
            { id: 'route-a', position: 2, total: 3, previous: 'before', next: 'next-a' },
            { id: 'route-b', position: 1, total: 2, previous: null, next: 'next-b' },
            { id: 'route-end', position: 2, total: 2, previous: 'before', next: null }
        ])
        assert.equal(page.readingRoutes[2].capstoneHref, '/pages/exercises.html')
        assert.deepEqual(page.readingRoutes[0].entryPaths, [
            '/foundations/before.html', '/foundations/focus.html', '/foundations/next-a.html'
        ])
        const reversed = createFoundationPageData(createFoundationCollection(inputs, { groups, routes: [...routes].reverse() }), 'focus')!
        assert.equal(reversed.recommendedNext, null)
        assert.deepEqual(reversed.readingRoutes.map(({ id }) => id).sort(), page.readingRoutes.map(({ id }) => id).sort())
        const standalone = createFoundationPageData(createFoundationCollection(inputs, { groups, routes: [] }), 'focus')!
        assert.deepEqual(standalone.readingRoutes, [])
        assert.equal(standalone.recommendedNext, null)
    })

    await t.test('builds the induced dependency graph exactly three hops in both directions', () => {
        const collection = createFoundationCollection(
            [
                entry('upstream-four'),
                entry('upstream-three', ['upstream-four']),
                entry('upstream-two', ['upstream-three']),
                entry('upstream-one-a', ['upstream-two']),
                entry('upstream-one-b', ['upstream-two']),
                entry('focus', ['upstream-one-a', 'upstream-one-b']),
                entry('downstream-one-a', ['focus']),
                entry('downstream-one-b', ['focus']),
                entry('downstream-two', ['downstream-one-a', 'downstream-one-b']),
                entry('downstream-three', ['downstream-two']),
                entry('downstream-four', ['downstream-three'])
            ],
            { groups }
        )
        const graph = createFoundationPageData(collection, 'focus')?.relationGraph
        assert.ok(graph)

        assert.deepEqual(Object.fromEntries(graph.nodes.map((node) => [node.id, node.dependencyDepth])), {
            'downstream-one-a': 1,
            'downstream-one-b': 1,
            'downstream-three': 3,
            'downstream-two': 2,
            focus: 0,
            'upstream-one-a': -1,
            'upstream-one-b': -1,
            'upstream-three': -3,
            'upstream-two': -2
        })
        assert.deepEqual(
            graph.edges.map((edge) => edge.id).sort(),
            [
                'downstream-one-a->downstream-two',
                'downstream-one-b->downstream-two',
                'downstream-two->downstream-three',
                'focus->downstream-one-a',
                'focus->downstream-one-b',
                'upstream-one-a->focus',
                'upstream-one-b->focus',
                'upstream-three->upstream-two',
                'upstream-two->upstream-one-a',
                'upstream-two->upstream-one-b'
            ].sort()
        )
        assert.ok(graph.edges.every((edge) => edge.relation === 'requires'))
        const depthById = new Map(graph.nodes.map((node) => [node.id, node.dependencyDepth]))
        assert.equal(
            graph.edges.some((edge) => {
                const depths = [depthById.get(edge.source), depthById.get(edge.target)]
                return depths.includes(0) && depths.some((depth) => Math.abs(depth ?? 0) > 1)
            }),
            false
        )
        for (const node of graph.nodes.filter((entry) => Math.abs(entry.dependencyDepth ?? 0) > 1)) {
            const adjacentDepths = graph.edges.flatMap((edge) => {
                if (edge.source === node.id) return [depthById.get(edge.target)]
                if (edge.target === node.id) return [depthById.get(edge.source)]
                return []
            })
            assert.ok(adjacentDepths.some((depth) => Math.abs(depth ?? 0) === Math.abs(node.dependencyDepth ?? 0) - 1))
        }
        assert.equal(
            graph.nodes.some((node) => node.id === 'upstream-four'),
            false
        )
        assert.equal(
            graph.nodes.some((node) => node.id === 'downstream-four'),
            false
        )
    })

    await t.test('derives classification and typed relations in both directions', () => {
        const collection = createFoundationCollection(
            [
                entry('general'),
                entry('nested-tool'),
                entry('tool', [], { uses: ['nested-tool'] }),
                entry('implementation'),
                entry('peer', [], { equivalent_to: ['focus'] }),
                entry('contrast', [], { contrasts_with: ['focus'] }),
                entry('focus', [], {
                    special_case_of: ['general'],
                    uses: ['tool'],
                    implemented_by: ['implementation'],
                    equivalent_to: ['peer'],
                    contrasts_with: ['contrast']
                }),
                entry('narrower', [], { special_case_of: ['focus'] }),
                entry('consumer', [], { uses: ['focus'] }),
                entry('abstraction', [], { implemented_by: ['focus'] })
            ],
            { groups }
        )

        const page = createFoundationPageData(collection, 'focus')
        assert.deepEqual(
            page?.classification.broader.map((item) => item.id),
            ['general']
        )
        assert.deepEqual(
            page?.classification.narrower.map((item) => item.id),
            ['narrower']
        )
        assert.deepEqual(
            page?.typedRelations.uses.map((item) => item.id),
            ['tool']
        )
        assert.deepEqual(
            page?.typedRelations.usedBy.map((item) => item.id),
            ['consumer']
        )
        assert.deepEqual(
            page?.typedRelations.implementedBy.map((item) => item.id),
            ['implementation']
        )
        assert.deepEqual(
            page?.typedRelations.implements.map((item) => item.id),
            ['abstraction']
        )
        assert.deepEqual(
            page?.typedRelations.equivalentTo.map((item) => item.id),
            ['peer']
        )
        assert.deepEqual(
            page?.typedRelations.contrastsWith.map((item) => item.id),
            ['contrast']
        )
        assert.deepEqual(
            page?.relationGraph.edges.map((edge) => `${edge.relation}:${edge.source}->${edge.target}`).sort(),
            [
                'contrasts_with:focus->contrast',
                'equivalent_to:focus->peer',
                'implemented_by:abstraction->focus',
                'implemented_by:focus->implementation',
                'special_case_of:focus->narrower',
                'special_case_of:general->focus',
                'uses:consumer->focus',
                'uses:focus->tool'
            ]
        )
        assert.equal(page?.relationGraph.edges.filter((edge) => edge.relation === 'equivalent_to').length, 1)
        assert.equal(page?.relationGraph.edges.filter((edge) => edge.relation === 'contrasts_with').length, 1)
        assert.equal(
            page?.relationGraph.nodes.some((node) => node.id === 'nested-tool'),
            false
        )
        assert.deepEqual(
            Object.fromEntries(page?.relationGraph.nodes.map((node) => [node.id, node.dependencyDepth]) ?? []),
            {
                abstraction: null,
                consumer: null,
                contrast: null,
                focus: 0,
                general: null,
                implementation: null,
                narrower: null,
                peer: null,
                tool: null
            }
        )
    })

    await t.test('reports high-risk edges without rejecting review-only warnings', () => {
        const collection = createFoundationCollection(
            [
                entry('base'),
                entry('result', ['base'], { kind: 'theorem' }),
                entry('middle', ['base'], { special_case_of: ['base'] }),
                entry('foreign', [], { domains: ['knowledge/structure'] }),
                entry('leaf', ['base', 'middle', 'result', 'foreign'], {
                    kind: 'model',
                    special_case_of: ['base', 'middle']
                })
            ],
            { groups }
        )

        const audit = auditFoundationGraph(collection)
        assert.deepEqual(audit.redundantEdges, ['leaf->base'])
        assert.deepEqual(audit.redundantClassificationEdges, ['leaf->base'])
        assert.deepEqual(audit.roleMismatchEdges, ['leaf->result'])
        assert.deepEqual(audit.crossDomainEdges, ['leaf->foreign'])
        assert.deepEqual(
            auditFoundationGraph(collection, { redundantEdgeAllowlist: ['leaf->base'] }).redundantEdges,
            []
        )
    })

    await t.test('audits the foundation writing contract with one routing-page exception', () => {
        const valid = {
            id: 'valid-entry',
            title: 'Valid Entry',
            description: 'A valid entry.',
            aliases: ['Valid Entry'],
            kind: 'definition' as const,
            requires: ['base'],
            uses: [],
            implemented_by: [],
            special_case_of: [],
            equivalent_to: [],
            contrasts_with: [],
            sections: [...FOUNDATION_CONTENT_SECTIONS['zh-CN']],
            bodyReferenceTargetIds: ['foundation:base']
        }
        const audit = auditFoundationContentContract([
            valid,
            {
                ...valid,
                id: 'execution-history',
                title: 'Execution History',
                aliases: [],
                kind: 'navigation',
                sections: ['自定义结构']
            }
        ])

        assert.deepEqual(
            auditFoundationContentContract([{ ...valid, sections: FOUNDATION_CONTENT_SECTIONS.en }]).sectionErrors,
            []
        )

        assert.deepEqual(audit, {
            metadataErrors: [],
            aliasErrors: [],
            relationWitnessErrors: [],
            sectionErrors: []
        })

        const invalid = auditFoundationContentContract([
            { ...valid, id: 'z-entry', title: 'Shared Name', description: 'Broken [[wiki]].' },
            {
                ...valid,
                id: 'a-entry',
                title: ' shared   name ',
                aliases: [],
                sections: ['形式陈述', '参考资料']
            },
            {
                ...valid,
                id: 'b-entry',
                title: 'Wrong Order',
                aliases: [],
                sections: ['直觉', '形式陈述', '例子与边界', '推论与应用', '参考资料']
            },
            {
                ...valid,
                id: 'c-entry',
                title: 'Extra Section',
                aliases: [],
                sections: [...FOUNDATION_CONTENT_SECTIONS['zh-CN'], '附录']
            },
            {
                ...valid,
                id: 'missing-witness',
                title: 'Missing Witness',
                aliases: [],
                requires: ['base'],
                uses: ['tool'],
                implemented_by: ['implementation'],
                special_case_of: ['general'],
                equivalent_to: ['peer'],
                contrasts_with: ['contrast'],
                bodyReferenceTargetIds: [
                    'foundation:base',
                    'foundation:tool',
                    'foundation:implementation',
                    'foundation:general',
                    'foundation:peer'
                ]
            }
        ])

        assert.deepEqual(invalid.metadataErrors, ['z-entry: description contains body-only wiki markup'])
        assert.deepEqual(invalid.aliasErrors, ['shared name: a-entry, z-entry'])
        assert.deepEqual(invalid.relationWitnessErrors, [
            'missing-witness: contrasts_with relation “contrast” has no body wiki reference'
        ])
        assert.deepEqual(invalid.sectionErrors, [
            'a-entry: 形式陈述 / 参考资料',
            'b-entry: 直觉 / 形式陈述 / 例子与边界 / 推论与应用 / 参考资料',
            'c-entry: 形式陈述 / 直觉 / 例子与边界 / 推论与应用 / 参考资料 / 附录'
        ])

        const navigationAlias = auditFoundationContentContract([
            { ...valid, id: 'canonical', title: 'Shared Name', aliases: [] },
            {
                ...valid,
                id: 'routing-page',
                title: 'Routing Page',
                aliases: ['Shared Name'],
                kind: 'navigation',
                sections: ['术语分流']
            }
        ])
        assert.deepEqual(navigationAlias.aliasErrors, [])
        assert.deepEqual(navigationAlias.relationWitnessErrors, [])
    })

    await t.test('rejects invalid IDs, kinds, domains, references, and cycles together', () => {
        assert.throws(
            () =>
                createFoundationCollection(
                    [
                        entry('Bad ID', ['missing'], { kind: 'lemma', domains: ['unknown'] }),
                        entry('duplicate'),
                        entry('duplicate'),
                        entry('self', ['self']),
                        entry('execution-history', [], { kind: 'navigation' }),
                        entry('uses-routing-entry', ['execution-history']),
                        entry('navigation-with-edge', [], { kind: 'navigation', uses: ['duplicate'] }),
                        entry('duplicate-edge', [], { uses: ['missing-tool', 'missing-tool'] }),
                        entry('asymmetric-a', [], {
                            equivalent_to: ['asymmetric-b'],
                            contrasts_with: ['asymmetric-b']
                        }),
                        entry('asymmetric-b'),
                        entry('classification-a', [], { special_case_of: ['classification-b'] }),
                        entry('classification-b', [], { special_case_of: ['classification-a'] }),
                        entry('cycle-a', ['cycle-b']),
                        entry('cycle-b', ['cycle-a'])
                    ],
                    {
                        groups,
                        routes: [
                            {
                                id: 'route-invalid',
                                title: 'Invalid route',
                                audience: 'Readers',
                                promise: 'Invalid on purpose.',
                                entries: ['duplicate', 'missing-route-entry'],
                                type: 'core'
                            }
                        ]
                    }
                ),
            (error: Error) => {
                assert.match(error.message, /lowercase kebab-case/u)
                assert.match(error.message, /unknown kind/u)
                assert.match(error.message, /unknown domain/u)
                assert.match(error.message, /missing prerequisite/u)
                assert.match(error.message, /duplicate id/u)
                assert.match(error.message, /cannot require itself/u)
                assert.match(error.message, /navigation entry “execution-history” cannot be a requires target/u)
                assert.match(error.message, /navigation entries must keep all six relation fields empty/u)
                assert.match(error.message, /duplicate uses target “missing-tool”/u)
                assert.match(error.message, /missing uses target “missing-tool”/u)
                assert.match(error.message, /equivalent_to relation “asymmetric-a” → “asymmetric-b” must be symmetric/u)
                assert.match(error.message, /cannot be both equivalent_to and contrasts_with/u)
                assert.match(error.message, /dependency cycle: cycle-a → cycle-b → cycle-a/u)
                assert.match(
                    error.message,
                    /classification cycle: classification-a → classification-b → classification-a/u
                )
                assert.match(error.message, /route “route-invalid” references missing entry “missing-route-entry”/u)
                return true
            }
        )
    })
})
