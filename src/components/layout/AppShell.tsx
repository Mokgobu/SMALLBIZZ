import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

const links = [
  { to: '/', label: 'Dashboard', end: true, permission: 'view_dashboard' },
  { to: '/sales', label: 'Sales', end: false, permission: 'view_sales' },
  { to: '/kitchen', label: 'Kitchen', end: false, permission: 'view_kitchen' },
  { to: '/recipes', label: 'Recipes', end: false, permission: 'manage_recipes' },
  { to: '/products', label: 'Products', end: false, permission: 'view_products' },
  { to: '/inventory', label: 'Inventory', end: false, permission: 'view_inventory' },
  { to: '/expiry', label: 'Expiry', end: false, permission: 'view_expiry' },
  { to: '/promotions', label: 'Promotions', end: false, permission: 'view_promotions' },
  { to: '/customers', label: 'Customers', end: false, permission: 'view_customers' },
  { to: '/expenses', label: 'Expenses', end: false, permission: 'view_expenses' },
  { to: '/suppliers', label: 'Suppliers', end: false, permission: 'view_suppliers' },
  { to: '/reports', label: 'Reports', end: false, permission: 'view_reports' },
  { to: '/operational-reports', label: 'Operations', end: false, permission: 'view_operational_reports' },
  { to: '/staff', label: 'Staff', end: false, permission: 'manage_staff' },
  { to: '/settings', label: 'Settings', end: false, permission: 'manage_business_settings' }
] as const

export default function AppShell() {
  const { business, membership, hasPermission, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-100/70 md:flex">
      <aside className="border-b border-slate-200/80 bg-white/75 backdrop-blur-xl md:min-h-screen md:w-72 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 p-4 md:block md:p-6">
          <div>
            <p className="font-semibold text-primary">SmallBizz</p>
            <p className="max-w-40 truncate text-xs text-slate-500">{business?.name}</p>
            <p className="mt-1 text-xs capitalize text-slate-400">{membership?.role}</p>
          </div>
          <button onClick={() => void logout()} className="text-xs text-slate-500 underline md:hidden">Sign out</button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:px-4">
          {links.filter(({ permission }) => hasPermission(permission)).map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex shrink-0 items-center rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-primary/10 font-medium text-primary shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-6 pt-6 md:block">
          <button onClick={() => void logout()} className="text-sm text-slate-500 underline">Sign out</button>
        </div>
      </aside>
      <div className="app-content-enter min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
