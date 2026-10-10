import assert from 'node:assert/strict'
import test from 'node:test'
import { convertDate, convertDateV2, toIsoDate } from '../../packages/content-core/src/index.js'

test('TiO2 date utilities normalize supported inputs', async (t) => {
    await t.test('pads loose time strings and preserves plain dates', () => {
        assert.equal(convertDateV2(' 2026-03-30   7:8:9 '), '2026-03-30 07:08:09')
        assert.equal(convertDateV2('2026-03-30'), '2026-03-30')
    })

    await t.test('normalizes Date-like inputs to a yyyy-mm-dd string', () => {
        const timestamp = Date.UTC(2026, 2, 30, 7, 8, 9)

        assert.equal(convertDateV2(timestamp), '2026-03-30')
        assert.equal(convertDateV2('2026-03-30T07:08:09.000Z'), '2026-03-30')
        assert.equal(convertDateV2(new Date('2026-03-30T07:08:09.000Z')), '2026-03-30')
    })

    await t.test('returns an empty string for invalid Date objects', () => {
        assert.equal(convertDateV2(new Date('invalid')), '')
    })
})

test('TiO2 date utility extracts the calendar portion from parseable inputs', () => {
    assert.equal(convertDate('2026-03-30'), '2026-03-30')
})

test('TiO2 date utility creates deterministic ISO timestamps with an explicit site offset', () => {
    assert.equal(toIsoDate('2026-03-30', '+08:00'), '2026-03-29T16:00:00.000Z')
    assert.equal(toIsoDate('2026-03-30 7:8:9', '+08:00'), '2026-03-29T23:08:09.000Z')
    assert.equal(toIsoDate('2026-03-30T07:08:09.000Z', '+08:00'), '2026-03-30T07:08:09.000Z')
    assert.equal(toIsoDate('invalid', '+08:00'), '')
    assert.throws(() => toIsoDate('2026-03-30', 'Asia/Shanghai'), /Invalid timezone offset/)
})
