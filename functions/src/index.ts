import { defineSecret, defineString } from 'firebase-functions/params'
import { getFirestore } from 'firebase-admin/firestore'
import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { createSaleForRequest } from './createSale.js'
import { createEmulatorEmailService, createResendEmailService } from './emailService.js'
import { getPendingStaffInvitationStateForRequest, getStaffInvitationForRequest, inviteStaffWithEmailForRequest, resendStaffInviteForRequest, respondToStaffInvitationForRequest } from './invitations.js'
import { requireAppCheck } from './security.js'
import { adjustOperationalInventoryForRequest, getOperationalReportForRequest, listOperationalProductsForRequest, listOperationalSalesForRequest } from './operations.js'
import { acceptStaffInviteForRequest, updateStaffRoleForRequest, updateStaffStatusForRequest } from './staffAdmin.js'
import { consumeRateLimit } from './rateLimit.js'
import { getOperationsSettingsForRequest, updateOperationsSettingsForRequest } from './operationsSettings.js'
import { getExpirySummaryForRequest, listExpiryBatchesForRequest, listPromotionsForRequest, performStockCountForRequest, receiveStockForRequest, savePromotionForRequest, setPromotionStatusForRequest, writeOffStockForRequest } from './businessOperations.js'
import { getMenuCatalogForRequest, getRecipeCostPreviewForRequest, listKitchenOrdersForRequest, listRecipesForRequest, saveRecipeForRequest, updateKitchenOrderStatusForRequest } from './restaurantOperations.js'

const emailApiKey = defineSecret('STAFF_INVITE_EMAIL_API_KEY')
const emailFrom = defineString('STAFF_INVITE_EMAIL_FROM', { default: 'SmallBizz <invites@example.com>' })
const supportEmail = defineString('STAFF_INVITE_SUPPORT_EMAIL', { default: 'support@example.com' })
const appUrl = defineString('STAFF_INVITE_APP_URL', { default: 'http://localhost:5173' })
const emulator = process.env.FUNCTIONS_EMULATOR === 'true'
const staffOptions = { region: 'africa-south1' as const, maxInstances: 10, enforceAppCheck: !emulator }
const emailOptions = { ...staffOptions, secrets: [emailApiKey] }

function checked(request: CallableRequest<unknown>) {
  requireAppCheck(request.app, emulator)
}

function emailService() {
  return emulator ? createEmulatorEmailService() : createResendEmailService(emailApiKey.value(), emailFrom.value(), supportEmail.value())
}

async function limitStaffMutation(request: CallableRequest<unknown>, operation: string) {
  if (request.auth?.uid) await consumeRateLimit(getFirestore(), `staff-${operation}-${request.auth.uid}`, 60, 3600)
}

export const createSale = onCall({ ...staffOptions, maxInstances: 20 }, async (request) => {
  checked(request)
  if (request.auth?.uid) await consumeRateLimit(getFirestore(), `checkout-${request.auth.uid}`, 300, 3600)
  return createSaleForRequest(request.data, request.auth)
})

export const inviteStaff = onCall(emailOptions, (request) => {
  checked(request)
  return inviteStaffWithEmailForRequest(request.data, request.auth, emailService(), appUrl.value(), undefined, undefined, undefined, emulator)
})
export const resendStaffInvite = onCall(emailOptions, (request) => {
  checked(request)
  return resendStaffInviteForRequest(request.data, request.auth, emailService(), appUrl.value(), undefined, undefined, undefined, emulator)
})
export const updateStaffRole = onCall(staffOptions, async (request) => {
  checked(request)
  await limitStaffMutation(request, 'role')
  return updateStaffRoleForRequest(request.data, request.auth)
})
export const updateStaffStatus = onCall(staffOptions, async (request) => {
  checked(request)
  await limitStaffMutation(request, 'status')
  return updateStaffStatusForRequest(request.data, request.auth)
})
export const acceptStaffInvite = onCall(staffOptions, async (request) => {
  checked(request)
  await limitStaffMutation(request, 'legacy-accept')
  return acceptStaffInviteForRequest(request.data, request.auth)
})
export const getStaffInvitation = onCall(staffOptions, (request) => {
  checked(request)
  return getStaffInvitationForRequest(request.data, request.auth)
})
export const getPendingStaffInvitationState = onCall(staffOptions, (request) => {
  checked(request)
  return getPendingStaffInvitationStateForRequest(request.data, request.auth)
})
export const acceptStaffInvitation = onCall(staffOptions, (request) => {
  checked(request)
  return respondToStaffInvitationForRequest(request.data, request.auth, 'accept')
})
export const declineStaffInvitation = onCall(staffOptions, (request) => {
  checked(request)
  return respondToStaffInvitationForRequest(request.data, request.auth, 'decline')
})
export const listOperationalProducts = onCall(staffOptions, (request) => {
  checked(request)
  return listOperationalProductsForRequest(request.data, request.auth)
})
export const listOperationalSales = onCall(staffOptions, (request) => {
  checked(request)
  return listOperationalSalesForRequest(request.data, request.auth)
})
export const getOperationalReport = onCall(staffOptions, (request) => {
  checked(request)
  return getOperationalReportForRequest(request.data, request.auth)
})
export const adjustOperationalInventory = onCall(staffOptions, (request) => {
  checked(request)
  return adjustOperationalInventoryForRequest(request.data, request.auth)
})
export const receiveStock = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'receive-stock'); return receiveStockForRequest(request.data, request.auth) })
export const writeOffStock = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'write-off'); return writeOffStockForRequest(request.data, request.auth) })
export const performStockCount = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'stock-count'); return performStockCountForRequest(request.data, request.auth) })
export const listExpiryBatches = onCall(staffOptions, (request) => { checked(request); return listExpiryBatchesForRequest(request.data, request.auth) })
export const getExpirySummary = onCall(staffOptions, (request) => { checked(request); return getExpirySummaryForRequest(request.data, request.auth) })
export const listPromotions = onCall(staffOptions, (request) => { checked(request); return listPromotionsForRequest(request.data, request.auth) })
export const savePromotion = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'promotion'); return savePromotionForRequest(request.data, request.auth) })
export const setPromotionStatus = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'promotion-status'); return setPromotionStatusForRequest(request.data, request.auth) })
export const getOperationsSettings = onCall(staffOptions, (request) => { checked(request); return getOperationsSettingsForRequest(request.data, request.auth) })
export const updateOperationsSettings = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'operations-settings'); return updateOperationsSettingsForRequest(request.data, request.auth) })
export const listRecipes = onCall(staffOptions, (request) => { checked(request); return listRecipesForRequest(request.data, request.auth) })
export const saveRecipe = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'recipe'); return saveRecipeForRequest(request.data, request.auth) })
export const getRecipeCostPreview = onCall(staffOptions, (request) => { checked(request); return getRecipeCostPreviewForRequest(request.data, request.auth) })
export const getMenuCatalog = onCall(staffOptions, (request) => { checked(request); return getMenuCatalogForRequest(request.data, request.auth) })
export const listKitchenOrders = onCall(staffOptions, (request) => { checked(request); return listKitchenOrdersForRequest(request.data, request.auth) })
export const updateKitchenOrderStatus = onCall(staffOptions, async (request) => { checked(request); await limitStaffMutation(request, 'kitchen-status'); return updateKitchenOrderStatusForRequest(request.data, request.auth) })
