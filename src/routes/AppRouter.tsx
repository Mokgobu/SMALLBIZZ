import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import LoadingScreen from '../components/feedback/LoadingScreen'
import AppShell from '../components/layout/AppShell'
import {
  OnboardingRoute,
  PendingInvitationRoute,
  PermissionRoute,
  ProtectedRoute,
  PublicOnlyRoute
} from '../components/routing/RouteGuards'
import { AuthProvider } from '../context/AuthContext'

const Register = lazy(() => import('../pages/Auth/Register'))
const Login = lazy(() => import('../pages/Auth/Login'))
const ForgotPassword = lazy(() => import('../pages/Auth/ForgotPassword'))
const Onboarding = lazy(() => import('../pages/Onboarding/Onboarding'))
const Dashboard = lazy(() => import('../pages/Dashboard'))
const Products = lazy(() => import('../pages/Products'))
const Inventory = lazy(() => import('../pages/Inventory'))
const Sales = lazy(() => import('../pages/Sales'))
const Expenses = lazy(() => import('../pages/Expenses'))
const Customers = lazy(() => import('../pages/Customers'))
const Suppliers = lazy(() => import('../pages/Suppliers'))
const Reports = lazy(() => import('../pages/Reports'))
const OperationalReports = lazy(() => import('../pages/OperationalReports'))
const Staff = lazy(() => import('../pages/Staff'))
const StaffInvitation = lazy(() => import('../pages/StaffInvitation'))
const PendingStaffInvitation = lazy(() => import('../pages/PendingStaffInvitation'))
const Expiry = lazy(() => import('../pages/Expiry'))
const Promotions = lazy(() => import('../pages/Promotions'))
const BusinessSettings = lazy(() => import('../pages/BusinessSettings'))
const Recipes = lazy(() => import('../pages/Recipes'))
const Kitchen = lazy(() => import('../pages/Kitchen'))

export default function AppRouter() {
  return (
    <AuthProvider>
      <div className="min-h-screen">
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/forgot" element={<PublicOnlyRoute><ForgotPassword /></PublicOnlyRoute>} />
            <Route path="/staff-invitation" element={<StaffInvitation />} />
            <Route path="/invitation-pending" element={<PendingInvitationRoute><PendingStaffInvitation /></PendingInvitationRoute>} />
            <Route path="/onboarding" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
            <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
              <Route index element={<PermissionRoute permission="view_dashboard"><Dashboard /></PermissionRoute>} />
              <Route path="dashboard" element={<PermissionRoute permission="view_dashboard"><Dashboard /></PermissionRoute>} />
              <Route path="products" element={<PermissionRoute permission="view_products"><Products /></PermissionRoute>} />
              <Route path="inventory" element={<PermissionRoute permission="view_inventory"><Inventory /></PermissionRoute>} />
              <Route path="sales" element={<PermissionRoute permission="view_sales"><Sales /></PermissionRoute>} />
              <Route path="expenses" element={<PermissionRoute permission="view_expenses"><Expenses /></PermissionRoute>} />
              <Route path="customers" element={<PermissionRoute permission="view_customers"><Customers /></PermissionRoute>} />
              <Route path="suppliers" element={<PermissionRoute permission="view_suppliers"><Suppliers /></PermissionRoute>} />
              <Route path="reports" element={<PermissionRoute permission="view_reports"><Reports /></PermissionRoute>} />
              <Route path="operational-reports" element={<PermissionRoute permission="view_operational_reports"><OperationalReports /></PermissionRoute>} />
              <Route path="expiry" element={<PermissionRoute permission="view_expiry"><Expiry /></PermissionRoute>} />
              <Route path="promotions" element={<PermissionRoute permission="view_promotions"><Promotions /></PermissionRoute>} />
              <Route path="settings" element={<PermissionRoute permission="manage_business_settings"><BusinessSettings /></PermissionRoute>} />
              <Route path="recipes" element={<PermissionRoute permission="manage_recipes"><Recipes /></PermissionRoute>} />
              <Route path="kitchen" element={<PermissionRoute permission="view_kitchen"><Kitchen /></PermissionRoute>} />
              <Route path="staff" element={<PermissionRoute permission="manage_staff"><Staff /></PermissionRoute>} />
            </Route>
            <Route
              path="*"
              element={
                <main className="p-8">
                  <h2 className="text-xl font-semibold">Page not found</h2>
                  <Link to="/" className="text-primary underline">Back to dashboard</Link>
                </main>
              }
            />
          </Routes>
        </Suspense>
      </div>
    </AuthProvider>
  )
}
