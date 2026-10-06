import { lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuthStore, useIsSignedIn } from './store/authStore';

// Common Pages & Components
import Login from './pages/Login';
const Dashboard = lazy(() => import('./pages/Dashboard'));
import Layout from './components/Layout';
import { ProtectedRoute } from './routes/ProtectedRoute';
import ToastHost from './components/ToastHost';
const RaiseTicket = lazy(() => import('./pages/RaiseTicket'));
const MyTickets = lazy(() => import('./pages/MyTickets'));
const TicketDetails = lazy(() => import('./pages/TicketDetails'));

// JE pages
const JeDashboard = lazy(() => import('./pages/je/JeDashboard'));
const JeRaiseTicket = lazy(() => import('./pages/je/JeRaiseTicket'));
const JeTenderControl = lazy(() => import('./pages/je/JeTenderControl'));
// Sysadmin pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminTickets = lazy(() => import('./pages/admin/AdminTickets'));
const AdminTicketDetails = lazy(() => import('./pages/admin/AdminTicketDetails'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminAuditLogs = lazy(() => import('./pages/admin/AdminAuditLogs'));
const AdminTestTicket = lazy(() => import('./pages/admin/AdminTestTicket'));
// Approvals, tenders and bills
const AuthorityDashboard = lazy(() => import('./pages/authority/AuthorityDashboard'));
const ClericalDashboard = lazy(() => import('./pages/clerical/ClericalDashboard'));
const AccountantDashboard = lazy(() => import('./pages/finance/AccountantDashboard'));

// Old per-role ticket URL: keep bookmarks and emailed links working.
function TicketRedirect({ base }: { base: string }) {
  const { id } = useParams();
  return <Navigate to={`${base}/${id}`} replace />;
}

// Signed-in users leave /login, back to where they were headed if a guard sent them here.
function LoginRoute({ signedIn }: { signedIn: boolean }) {
  const from = (useLocation().state as { from?: string } | null)?.from;
  return signedIn ? <Navigate to={from && from !== '/login' ? from : '/'} replace /> : <Login />;
}

export default function App() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useIsSignedIn();
  const isJe = user?.role === 'JE';
  const isSysAdmin = user?.role === 'SYSADMIN';
  const isClerical = user?.role === 'CLERICAL';
  const isAccountant = user?.role === 'ACCOUNTANT';
  const isAuthority = ['AE', 'SE', 'DEAN', 'DIRECTOR'].includes(user?.role || '');

  return (
    <BrowserRouter>
      <ToastHost />
      <Routes>
        {/* 1. PUBLIC ROUTE: Kick authenticated users away from the login screen */}
        <Route 
          path="/login" 
          element={<LoginRoute signedIn={isAuthenticated} />} 
        />

        {/* 2. SECURE ROUTE GUARD: Only authenticated users pass this point */}
        <Route element={<ProtectedRoute />}>
          
          <Route element={<Layout />}>

          {/* 3. DASHBOARD HUB: Role-aware conditional routing */}
          <Route 
            path="/" 
            element={isSysAdmin ? (
                  <AdminDashboard />
                ) : isJe ? (
                  <JeDashboard />
                ) : isClerical ? (
                  <ClericalDashboard />
                ) : isAccountant ? (
                  <AccountantDashboard />
                ) : isAuthority ? (
                  <AuthorityDashboard />
                ) : (
                  <Dashboard />
                )} 
          />

          {/* New ticket: the same form for every role. A JE's proposal form is at /je/raise. */}
          <Route 
            path="/raise" 
            element={<RaiseTicket />} 
          />

          <Route 
            path="/tickets" 
            element={isSysAdmin ? <AdminTickets /> : <MyTickets />} 
          />

          {/* Ticket Details: ONE page for every role. It renders its sections from the role and the API payload. */}
          <Route 
            path="/ticket/:id" 
            element={<TicketDetails />} 
          />

          {/* 4. JE routes */}
          <Route element={<ProtectedRoute allowedRoles={['JE']} />}>
            <Route 
              path="/je" 
              element={<Navigate to="/je/dashboard" replace />} 
            />
            <Route 
              path="/je/dashboard" 
              element={<JeDashboard />} 
            />
            <Route 
              path="/je/raise" 
              element={<JeRaiseTicket />} 
            />
            <Route path="/je/ticket/:id" element={<TicketRedirect base="/ticket" />} />
            <Route 
              path="/je/tender/:id" 
              element={<JeTenderControl />} 
            />
            <Route 
              path="/je/tender" 
              element={<JeTenderControl />} 
            />
          </Route>

          {/* 5. Sysadmin routes */}
          <Route element={<ProtectedRoute allowedRoles={['SYSADMIN']} />}>
            <Route 
              path="/admin" 
              element={<Navigate to="/" replace />} 
            />
            <Route 
              path="/admin/tickets" 
              element={<AdminTickets />} 
            />
            <Route 
              path="/admin/ticket/:id" 
              element={<AdminTicketDetails />} 
            />
            <Route 
              path="/admin/users" 
              element={<AdminUsers />} 
            />
            <Route 
              path="/admin/audit" 
              element={<AdminAuditLogs />} 
            />
            <Route 
              path="/admin/test" 
              element={<AdminTestTicket />} 
            />
          </Route>

          {/* 6. Approvals (AE, SE, Dean, Director) */}
          <Route element={<ProtectedRoute allowedRoles={['AE', 'SE', 'DEAN', 'DIRECTOR']} />}>
            <Route 
              path="/approvals" 
              element={<AuthorityDashboard />} 
            />
          </Route>

          {/* 7. Tenders (Clerical) */}
          <Route element={<ProtectedRoute allowedRoles={['CLERICAL', 'SYSADMIN']} />}>
            <Route 
              path="/clerical" 
              element={<ClericalDashboard />} 
            />
          </Route>

          {/* 8. Bills (Accountant, Dean, Director) */}
          <Route element={<ProtectedRoute allowedRoles={['ACCOUNTANT', 'SYSADMIN', 'DEAN', 'DIRECTOR']} />}>
            <Route 
              path="/finance" 
              element={<AccountantDashboard />} 
            />
          </Route>
          </Route>
        </Route>
        
        {/* 6. CATCH-ALL: Redirect unknown URLs */}
        <Route 
          path="*" 
          element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} 
        />
      </Routes>
    </BrowserRouter>
  );
}