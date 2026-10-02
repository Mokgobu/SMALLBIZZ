import assert from 'node:assert/strict'
import test from 'node:test'
import { isAuthoritativeSnapshot } from '../src/auth/snapshotAuthority'

test('only server-acknowledged Firestore snapshots are authoritative', () => {
  assert.equal(isAuthoritativeSnapshot({ fromCache: false, hasPendingWrites: false }), true)
  assert.equal(isAuthoritativeSnapshot({ fromCache: true, hasPendingWrites: false }), false)
  assert.equal(isAuthoritativeSnapshot({ fromCache: false, hasPendingWrites: true }), false)
  assert.equal(isAuthoritativeSnapshot({ fromCache: true, hasPendingWrites: true }), false)
})
