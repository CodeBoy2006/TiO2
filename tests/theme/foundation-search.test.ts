import assert from 'node:assert/strict'
import test from 'node:test'
import { foundationMatchRank, normalizeFoundationQuery } from '../../site/client/foundation-search.js'

test('concept lookup prioritizes exact names and aliases over incidental description matches', () => {
    const entries = [
        { title: '半单模', aliases: ['Semisimple module'], description: '比较矩阵列分解。' },
        { title: '正交矩阵', aliases: ['Orthogonal matrix'], description: '' },
        { title: '矩阵', aliases: ['Matrix'], description: '有限行列集合上的函数。' }
    ]
    const ranked = (query: string) =>
        entries
            .map((entry) => ({
                title: entry.title,
                rank: foundationMatchRank(
                    normalizeFoundationQuery(query),
                    [entry.title, ...entry.aliases].map(normalizeFoundationQuery),
                    normalizeFoundationQuery(entry.description)
                )
            }))
            .filter(({ rank }) => rank >= 0)
            .sort((a, b) => a.rank - b.rank)
            .map(({ title }) => title)
    assert.deepEqual(ranked('矩阵'), ['矩阵', '正交矩阵', '半单模'])
    assert.deepEqual(ranked(' ＭＡＴＲＩＸ '), ['矩阵', '正交矩阵'])
    assert.deepEqual(ranked('no match'), [])
    assert.equal(foundationMatchRank('', ['矩阵'], ''), 0)
})
