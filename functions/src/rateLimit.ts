import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

export async function consumeRateLimit(db: Firestore, key: string, maximum: number, windowSeconds: number, now = Timestamp.now()) {
  const ref = db.doc(`functionRateLimits/${key}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const data = snapshot.data()
    const windowStartedAt = data?.windowStartedAt instanceof Timestamp ? data.windowStartedAt : null
    const elapsed = windowStartedAt ? now.seconds - windowStartedAt.seconds : windowSeconds
    const count = elapsed >= windowSeconds ? 0 : Number(data?.count ?? 0)
    if (count >= maximum) throw new HttpsError('resource-exhausted', 'Too many attempts. Please wait and try again.')
    transaction.set(ref, {
      count: count + 1,
      windowStartedAt: elapsed >= windowSeconds ? now : windowStartedAt,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + windowSeconds * 2 * 1000)
    })
  })
}
