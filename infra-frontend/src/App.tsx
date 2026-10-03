import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuthStore, useIsSignedIn } from './store/authStore';

// Common Pages & Components
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Layout from './components/Layout';
import { ProtectedRoute } from './routes/ProtectedRoute';
import ToastHost from './components/ToastHost';
import RaiseTicket from './pages/RaiseTicket';
import MyTickets from './pages/MyTickets';
import TicketDetails from './pages/TicketDetails';

// JE pages
import JeDashboard from './pages/je/JeDashboard';
import JeRaiseTicket from './pages/je/JeRaiseTicket';
import JeTenderControl from './pages/je/JeTenderControl';
// Sysadmin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminTickets from './pages/admin/AdminTickets';
import AdminTicketDetails from './pages/admin/AdminTicketDetails';
import AdminUsers from './pages/admin/AdminUsers';
import AdminAuditLogs from './pages/admin/AdminAuditLogs';
import AdminTestTicket from './pages/admin/AdminTestTicket';
// Approvals
import AuthorityDashboard from './pages/authority/AuthorityDashboard';

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
          
          {/* 3. DASHBOARD HUB: Role-aware conditional routing */}
          <Route 
            path="/" 
            element={
              <Layout>
                {isSysAdmin ? (
                  <AdminDashboard />
                ) : isJe ? (
                  <JeDashboard />
                ) : isAuthority ? (
                  <AuthorityDashboard />
                ) : (
                  <Dashboard />
                )}
              </Layout>
            } 
          />

          {/* New ticket: the same form for every role. A JE's proposal form is at /je/raise. */}
          <Route 
            path="/raise" 
            element={
              <Layout>
                <RaiseTicket />
              </Layout>
            } 
          />

          <Route 
            path="/tickets" 
            element={
              <Layout>
                {isSysAdmin ? <AdminTickets /> : <MyTickets />}
              </Layout>
            } 
          />

          {/* Ticket Details: ONE page for every role. It renders its sections from the role and the API payload. */}
          <Route 
            path="/ticket/:id" 
            element={
              <Layout>
                <TicketDetails />
              </Layout>
            } 
          />

          {/* 4. JE routes */}
          <Route element={<ProtectedRoute allowedRoles={['JE']} />}>
            <Route 
              path="/je" 
              element={<Navigate to="/je/dashboard" replace />} 
            />
            <Route 
              path="/je/dashboard" 
              element={
                <Layout>
                  <JeDashboard />
                </Layout>
              } 
            />
            <Route 
              path="/je/raise" 
              element={
                <Layout>
                  <JeRaiseTicket />
                </Layout>
              } 
            />
            <Route path="/je/ticket/:id" element={<TicketRedirect base="/ticket" />} />
            <Route 
              path="/je/tender/:id" 
              element={
                <Layout>
                  <JeTenderControl />
                </Layout>
              } 
            />
            <Route 
              path="/je/tender" 
              element={
                <Layout>
                  <JeTenderControl />
                </Layout>
              } 
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
              element={
                <Layout>
                  <AdminTickets />
                </Layout>
              } 
            />
            <Route 
              path="/admin/ticket/:id" 
              element={
                <Layout>
                  <AdminTicketDetails />
                </Layout>
              } 
            />
            <Route 
              path="/admin/users" 
              element={
                <Layout>
                  <AdminUsers />
                </Layout>
              } 
            />
            <Route 
              path="/admin/audit" 
              element={
                <Layout>
                  <AdminAuditLogs />
                </Layout>
              } 
            />
            <Route 
              path="/admin/test" 
              element={
                <Layout>
                  <AdminTestTicket />
                </Layout>
              } 
            />
          </Route>

          {/* 6. Approvals (AE, SE, Dean, Director) */}
          <Route element={<ProtectedRoute allowedRoles={['AE', 'SE', 'DEAN', 'DIRECTOR']} />}>
            <Route 
              path="/approvals" 
              element={
                <Layout>
                  <AuthorityDashboard />
                </Layout>
              } 
            />
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