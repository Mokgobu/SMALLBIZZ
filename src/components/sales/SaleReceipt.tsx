import type { BusinessProfile } from '../../models/business'
import type { Sale } from '../../models/sale'
import { formatDateTime, formatZar } from '../../utils/format'

type Props = {
  sale: Sale
  business: BusinessProfile
  cashierName?: string | null
  onClose: () => void
}

export default function SaleReceipt({ sale, business, cashierName, onClose }: Props) {
  return (
    <div className="receipt-overlay fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
      <div className="receipt-print mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-8">
        <div className="no-print mb-6 flex justify-end gap-2">
          <button type="button" onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-white">Print receipt</button>
          <button type="button" onClick={onClose} className="rounded border px-4 py-2">Close</button>
        </div>
        <header className="border-b pb-5 text-center">
          <h2 id="receipt-title" className="text-2xl font-bold">{business.name}</h2>
          {business.address && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{business.address}</p>}
          {(business.phone || business.email) && <p className="text-sm text-slate-600">{[business.phone, business.email].filter(Boolean).join(' · ')}</p>}
          {business.registrationNumber && <p className="text-xs text-slate-500">Registration: {business.registrationNumber}</p>}
          {business.vatRegistered && business.vatNumber && <p className="text-xs text-slate-500">VAT: {business.vatNumber}</p>}
        </header>
        <dl className="my-5 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Sale reference</dt><dd className="break-all font-mono">{sale.id}</dd></div>
          <div><dt className="text-slate-500">Date and time</dt><dd>{formatDateTime(sale.createdAt)}</dd></div>
          <div><dt className="text-slate-500">Cashier</dt><dd>{cashierName || 'Not recorded'}</dd></div>
          <div><dt className="text-slate-500">Customer</dt><dd>{sale.customerNameSnapshot || 'Walk-in customer'}</dd></div>
        </dl>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-y bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit price</th><th className="p-2 text-right">Total</th></tr></thead>
            <tbody>{sale.items.map((item, index) => <tr key={`${item.productId}-${index}`} className="border-b"><td className="p-2"><div className="font-medium">{item.productName}</div>{item.sku && <div className="text-xs text-slate-500">SKU: {item.sku}</div>}{item.modifiers?.map((modifier) => <div key={modifier.id} className="text-xs text-slate-600">+ {modifier.label}{modifier.priceDelta ? ` (${formatZar(modifier.priceDelta)})` : ''}</div>)}{item.preparationNotes && <div className="mt-1 text-xs italic text-slate-500">Note: {item.preparationNotes}</div>}</td><td className="p-2 text-right">{item.quantity}</td><td className="p-2 text-right">{formatZar(item.unitPrice)}</td><td className="p-2 text-right">{formatZar(item.lineTotal)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="ml-auto mt-5 max-w-xs space-y-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatZar(sale.subtotal)}</span></div>
          {sale.manualDiscount ? <div className="flex justify-between"><span>Manual discount</span><span>-{formatZar(sale.manualDiscount)}</span></div> : null}
          {sale.promotionDiscount ? <div className="flex justify-between"><span>Promotion discount</span><span>-{formatZar(sale.promotionDiscount)}</span></div> : null}
          <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span>{formatZar(sale.total)}</span></div>
          <div className="flex justify-between"><span>Payment method</span><span className="uppercase">{sale.paymentMethod}</span></div>
        </div>
        {sale.promotionNameSnapshot && (
          <div className="mt-5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Promotion applied: <span className="font-medium">{sale.promotionNameSnapshot}</span>
          </div>
        )}
        <p className="mt-8 text-center text-sm text-slate-500">Thank you for your business.</p>
      </div>
    </div>
  )
}
