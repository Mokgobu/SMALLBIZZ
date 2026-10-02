export const PROMOTION_TYPES = ['percentage','fixed','product_percentage','category_percentage'] as const
export type PromotionType = typeof PROMOTION_TYPES[number]
export type PromotionStatus = 'draft'|'scheduled'|'active'|'expired'|'disabled'

export function derivePromotionStatus(configured: unknown, startsAt: number, endsAt: number, now: number): PromotionStatus {
  if (configured === 'draft') return 'draft'; if (configured === 'disabled') return 'disabled'; if (now < startsAt) return 'scheduled'; if (now >= endsAt) return 'expired'; return 'active'
}

export function validatePromotionInput(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Promotion details are required.'); const v=data as Record<string,unknown>
  const allowed=['id','name','description','type','value','productId','category','maxDiscountAmount','status','startsAt','endsAt']; if(Object.keys(v).some(k=>!allowed.includes(k))) throw new Error('Promotion contains unsupported fields.')
  const name=typeof v.name==='string'?v.name.trim():''; if(!name||name.length>100) throw new Error('Promotion name is required.')
  if(!PROMOTION_TYPES.includes(v.type as PromotionType)) throw new Error('Choose a valid promotion type.')
  const value=Number(v.value); if(!Number.isFinite(value)||value<=0||value>100000000) throw new Error('Promotion value is invalid.')
  if(v.type!=='fixed'&&value>100) throw new Error('Percentage promotions cannot exceed 100%.')
  const status=v.status; if(!['draft','active','disabled'].includes(String(status))) throw new Error('Choose draft, active, or disabled.')
  const startsAt=Number(v.startsAt), endsAt=Number(v.endsAt); if(!Number.isFinite(startsAt)||!Number.isFinite(endsAt)||startsAt>=endsAt||endsAt-startsAt>366*86400000) throw new Error('Choose a valid promotion date range of at most one year.')
  const productId=typeof v.productId==='string'&&v.productId.trim()?v.productId.trim():null; const category=typeof v.category==='string'&&v.category.trim()?v.category.trim():null
  if(v.type==='product_percentage'&&!productId) throw new Error('Choose a product for this promotion.'); if(v.type==='category_percentage'&&!category) throw new Error('Choose a category for this promotion.')
  const max=v.maxDiscountAmount==null||v.maxDiscountAmount===''?null:Number(v.maxDiscountAmount); if(max!=null&&(!Number.isFinite(max)||max<=0)) throw new Error('Maximum discount is invalid.')
  return {name,description:typeof v.description==='string'?v.description.trim().slice(0,500):'',type:v.type as PromotionType,value:Math.round(value*100)/100,productId,category,maxDiscountAmount:max==null?null:Math.round(max*100)/100,status:status as 'draft'|'active'|'disabled',startsAt,endsAt}
}

export type PromotionLine = { productId: string; category: string; quantity: number; unitPrice: number }
export function promotionDiscount(promotion: {type:PromotionType;value:number;productId?:string|null;category?:string|null;maxDiscountAmount?:number|null}, lines: PromotionLine[]) {
  const eligible = promotion.type==='product_percentage' ? lines.filter(l=>l.productId===promotion.productId) : promotion.type==='category_percentage' ? lines.filter(l=>l.category===promotion.category) : lines
  const eligibleCents=eligible.reduce((sum,line)=>sum+Math.round(line.unitPrice*100)*line.quantity,0); if(!eligibleCents) throw new Error('This promotion does not apply to the selected products.')
  let discountCents=promotion.type==='fixed'?Math.round(promotion.value*100):Math.floor(eligibleCents*promotion.value/100)
  if(promotion.maxDiscountAmount!=null) discountCents=Math.min(discountCents,Math.round(promotion.maxDiscountAmount*100))
  return Math.min(eligibleCents,discountCents)/100
}

export function manualDiscountLimit(role: string, limits: {cashier:number;supervisor:number;manager:number}) { return role==='owner'?100:role==='manager'?limits.manager:role==='supervisor'?limits.supervisor:limits.cashier }
