import assert from 'node:assert/strict'
import test from 'node:test'
import { canConvert, convertQuantity, requireValidUnit, unitCategory } from '../src/domain/units'

test('units support weight and volume conversions safely', () => {
  assert.equal(convertQuantity(1, 'kg', 'g'), 1000)
  assert.equal(convertQuantity(1, 'litre', 'ml'), 1000)
  assert.equal(unitCategory('slice'), 'count')
  assert.equal(requireValidUnit('each'), 'each')
})

test('unit conversion rejects unsafe conversion paths', () => {
  assert.equal(canConvert(1, 'kg', 'ml'), false)
  assert.throws(() => convertQuantity(1, 'kg', 'ml'), /Unsafe conversion/)
})

test('unsupported units are rejected', () => {
  assert.throws(() => requireValidUnit('half'), /Unsupported unit/)
})
