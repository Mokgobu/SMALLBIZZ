import assert from 'node:assert/strict'
import test from 'node:test'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { consumeRateLimit } from './rateLimit.js'

test('fixed-window server limiter rejects excess attempts and resets after the window', async () => {
  let value: Record<string, unknown> | undefined
  const ref = {}
  const db = {
    doc: () => ref,
    runTransaction: async (work: (transaction: unknown) => Promise<void>) => work({
      get: async () => ({ data: () => value }),
      set: (_target: unknown, next: Record<string, unknown>) => { value = next }
    })
  } as unknown as Firestore
  await consumeRateLimit(db, 'test', 2, 60, Timestamp.fromMillis(1000))
  await consumeRateLimit(db, 'test', 2, 60, Timestamp.fromMillis(2000))
  await assert.rejects(() => consumeRateLimit(db, 'test', 2, 60, Timestamp.fromMillis(3000)), /Too many attempts/i)
  await assert.doesNotReject(() => consumeRateLimit(db, 'test', 2, 60, Timestamp.fromMillis(62000)))
  assert.equal(value?.count, 1)
})
