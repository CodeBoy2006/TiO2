import assert from 'node:assert/strict'
import test from 'node:test'
import { generatePaginationArray } from '../../site/render-helpers.js'

test('TiO2 pagination helper expands all pages when the page count is small', () => {
    assert.deepEqual(generatePaginationArray(5, 3), [1, 2, 3, 4, 5])
})

test('TiO2 pagination helper inserts ellipses around middle windows', () => {
    assert.deepEqual(generatePaginationArray(10, 5), [1, 2, '...', 4, 5, 6, '...', 9, 10])
})

test('TiO2 pagination helper clamps invalid inputs and supports zero margins', () => {
    assert.deepEqual(generatePaginationArray(0, 99), [1])
    assert.deepEqual(generatePaginationArray(10, -2), [1, 2, 3, 4, '...', 10])
    assert.deepEqual(generatePaginationArray(10, 10, 0), [1, '...', 9, 10])
})
