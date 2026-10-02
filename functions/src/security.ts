import { logger } from 'firebase-functions'
import { HttpsError } from 'firebase-functions/v2/https'

export function requireAppCheck(app: unknown, emulator = process.env.FUNCTIONS_EMULATOR === 'true') {
  if (!emulator && !app) {
    logger.warn('Callable rejected: missing App Check attestation.', { reason: 'missing_app_check' })
    throw new HttpsError('failed-precondition', 'This request could not be verified. Refresh SmallBizz and try again.')
  }
}
