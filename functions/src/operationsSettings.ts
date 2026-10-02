import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { requireBusinessRole, type AuthContext } from './businessAccess.js'

export type OperationsSettings = { defaultExpiryWarningDays: number; defaultExpiryCriticalDays: number; expiryAlertsEnabled: boolean; expiryDiscountEnabled: boolean; discountLimits: { cashier: number; supervisor: number; manager: number }; expiryDiscountRules: Array<{ daysRemaining: number; percentage: number }> }
export const DEFAULT_OPERATIONS_SETTINGS: OperationsSettings = { defaultExpiryWarningDays: 7, defaultExpiryCriticalDays: 3, expiryAlertsEnabled: true, expiryDiscountEnabled: false, discountLimits: { cashier: 0, supervisor: 10, manager: 20 }, expiryDiscountRules: [{ daysRemaining: 1, percentage: 30 }, { daysRemaining: 3, percentage: 20 }, { daysRemaining: 7, percentage: 10 }] }

export function normalizeOperationsSettings(value: FirebaseFirestore.DocumentData | undefined): OperationsSettings {
  const source = value ?? {}; const limits = source.discountLimits ?? {}
  const integer = (input: unknown, fallback: number, max = 365) => Number.isInteger(input) && Number(input) >= 0 && Number(input) <= max ? Number(input) : fallback
  const rules = Array.isArray(source.expiryDiscountRules) ? source.expiryDiscountRules.filter((r: unknown) => r && typeof r === 'object').map((r: Record<string, unknown>) => ({ daysRemaining: integer(r.daysRemaining, -1), percentage: integer(r.percentage, -1, 100) })).filter((r: {daysRemaining:number;percentage:number}) => r.daysRemaining >= 0 && r.percentage >= 0).slice(0, 10) : DEFAULT_OPERATIONS_SETTINGS.expiryDiscountRules
  return { defaultExpiryWarningDays: integer(source.defaultExpiryWarningDays, 7), defaultExpiryCriticalDays: integer(source.defaultExpiryCriticalDays, 3), expiryAlertsEnabled: source.expiryAlertsEnabled !== false, expiryDiscountEnabled: source.expiryDiscountEnabled === true, discountLimits: { cashier: integer(limits.cashier, 0, 100), supervisor: integer(limits.supervisor, 10, 100), manager: integer(limits.manager, 20, 100) }, expiryDiscountRules: rules }
}

export function validateOperationsSettings(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpsError('invalid-argument', 'Settings are required.')
  const allowed = ['defaultExpiryWarningDays', 'defaultExpiryCriticalDays', 'expiryAlertsEnabled', 'expiryDiscountEnabled', 'discountLimits', 'expiryDiscountRules']
  if (Object.keys(data).some((key) => !allowed.includes(key))) throw new HttpsError('invalid-argument', 'Settings contain unsupported fields.')
  const normalized = normalizeOperationsSettings(data as FirebaseFirestore.DocumentData)
  if (normalized.defaultExpiryCriticalDays > normalized.defaultExpiryWarningDays) throw new HttpsError('invalid-argument', 'Critical days cannot exceed warning days.')
  if (normalized.expiryDiscountRules.length === 0) throw new HttpsError('invalid-argument', 'Add at least one expiry discount rule.')
  return normalized
}

export async function getOperationsSettingsForRequest(_data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  if (!_data || typeof _data !== 'object' || Array.isArray(_data) || Object.keys(_data as object).length) throw new HttpsError('invalid-argument', 'This request does not accept fields.')
  const caller = await requireBusinessRole(auth, ['owner', 'manager', 'supervisor', 'cashier'], db)
  const snapshot = await caller.businessRef.collection('settings').doc('operations').get()
  return normalizeOperationsSettings(snapshot.data())
}
export async function updateOperationsSettingsForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  const caller = await requireBusinessRole(auth, ['owner'], db); const settings = validateOperationsSettings(data); const now = Timestamp.now()
  await caller.businessRef.collection('settings').doc('operations').set({ ...settings, updatedAt: now, updatedBy: caller.uid }, { merge: true })
  await caller.businessRef.collection('staffActivity').add({ type: 'operations_settings_updated', actorUid: caller.uid, targetUid: caller.uid, actorName: caller.displayName, targetName: caller.business.name, description: `${caller.displayName} updated expiry and discount settings.`, createdAt: now })
  return settings
}
