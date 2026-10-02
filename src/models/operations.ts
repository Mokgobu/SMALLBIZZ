import type { ExpiryDiscountRule, ExpiryState } from '../domain/expiry'

export type OperationsSettings = { defaultExpiryWarningDays: number; defaultExpiryCriticalDays: number; expiryAlertsEnabled: boolean; expiryDiscountEnabled: boolean; discountLimits: { cashier: number; supervisor: number; manager: number }; expiryDiscountRules: ExpiryDiscountRule[] }
export type InventoryBatchStatus = 'active' | 'depleted' | 'expired' | 'quarantined'
export type InventoryBatch = { id: string; batchId: string; productId: string; productNameSnapshot: string; categorySnapshot: string; quantityReceived: number; quantityRemaining: number; receivedAt?: unknown; expiryDate: string | null; supplierId: string | null; supplierNameSnapshot: string | null; reference: string; costPriceSnapshot?: number; status: InventoryBatchStatus; createdBy: string; createdByNameSnapshot: string; createdAt?: unknown; updatedAt?: unknown; expiryState?: ExpiryState; daysRemaining?: number; suggestedDiscount?: number | null; estimatedValueAtRisk?: number }
export type ReceiveStockInput = { productId: string; quantity: number; supplierId: string | null; reference: string; costPrice?: number; expiryDate: string | null }
export type WriteOffReason = 'expired' | 'damaged' | 'spoiled' | 'stolen' | 'internal_use' | 'stock_count_correction' | 'other'
export type WriteOffInput = { productId: string; batchId: string | null; quantity: number; reason: WriteOffReason; notes: string }
export type StockCountInput = { productId: string; countedQuantity: number; reason: string; notes: string }
