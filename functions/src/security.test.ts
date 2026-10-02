import assert from 'node:assert/strict'
import test from 'node:test'
import { requireAppCheck } from './security.js'

test('App Check rejects missing production attestations and remains emulator-compatible', () => {
  assert.throws(() => requireAppCheck(undefined, false), /verified/i)
  assert.doesNotThrow(() => requireAppCheck(undefined, true))
  assert.doesNotThrow(() => requireAppCheck({ appId: 'verified' }, false))
})
