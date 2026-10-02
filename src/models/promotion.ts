export type PromotionType = 'percentage' | 'fixed' | 'product_percentage' | 'category_percentage'
export type PromotionStatus = 'draft' | 'scheduled' | 'active' | 'expired' | 'disabled'
export type Promotion = { id: string; name: string; description: string; type: PromotionType; value: number; productId: string | null; category: string | null; maxDiscountAmount: number | null; status: PromotionStatus; startsAt: number; endsAt: number; createdBy: string; createdAt?: unknown; updatedAt?: unknown }
export type PromotionInput = Omit<Promotion, 'id' | 'createdBy' | 'createdAt' | 'updatedAt' | 'status'> & { status: 'draft' | 'active' | 'disabled' }
