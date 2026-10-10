import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFoundationDocument } from '../../packages/content-fs/src/index.js'

test('foundation documents require explicit canonical metadata', async (t) => {
    await t.test('normalizes valid frontmatter', async () => {
        const entry = await loadFoundationDocument('foundations/group.md', {
            source: {
                rawContent: '',
                content: 'Group body.',
                data: {
                    title: ' 群 ',
                    id: 'group',
                    aliases: [' Group ', 'Group'],
                    kind: 'definition',
                    domains: ['mathematics/algebra-structures'],
                    requires: [],
                    uses: ['set'],
                    implemented_by: [],
                    special_case_of: [],
                    equivalent_to: [],
                    contrasts_with: [],
                    description: ' 群的定义。 ',
                    page: true
                }
            }
        })

        assert.equal(entry.title, '群')
        assert.deepEqual(entry.aliases, ['Group'])
        assert.deepEqual(entry.uses, ['set'])
        assert.equal(entry.regularPath, '/foundations/group.html')
    })

    await t.test('rejects implicit or mismatched metadata', async () => {
        await assert.rejects(
            loadFoundationDocument('foundations/not-group.md', {
                source: {
                    rawContent: '',
                    content: '',
                    data: {
                        title: '群',
                        id: 'group',
                        aliases: 'Group',
                        kind: 'definition',
                        domains: [],
                        requires: [],
                        description: '群的定义。'
                    }
                }
            }),
            /aliases must be an array of strings[\s\S]*page must be true[\s\S]*filename must match id/u
        )
    })

    await t.test('rejects relation fields that are not adjacent and canonically ordered', async () => {
        await assert.rejects(
            loadFoundationDocument('foundations/group.md', {
                source: {
                    rawContent: '',
                    content: '',
                    data: {
                        title: '群',
                        id: 'group',
                        aliases: [],
                        kind: 'definition',
                        domains: ['mathematics/algebra-structures'],
                        requires: [],
                        uses: [],
                        description: '群的定义。',
                        implemented_by: [],
                        special_case_of: [],
                        equivalent_to: [],
                        contrasts_with: [],
                        page: true
                    }
                }
            }),
            /relation fields must be adjacent and ordered: requires, uses, implemented_by, special_case_of, equivalent_to, contrasts_with/u
        )
    })
})
