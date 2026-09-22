import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

// Common Pages & Components
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Layout from './components/Layout';
import { ProtectedRoute } from './routes/ProtectedRoute';
import RaiseTicket from './pages/RaiseTicket';
import MyTickets from './pages/MyTickets';
import TicketDetails from './pages/TicketDetails';

// Junior Engineer (JE) Micro-Frontend Pages
import JeDashboard from './pages/je/JeDashboard';
import JeRaiseTicket from './pages/je/JeRaiseTicket';
import JeTicketDetails from './pages/je/JeTicketDetails';
import JeTenderControl from './pages/je/JeTenderControl';
// Master System Admin Micro-Frontend Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminTickets from './pages/admin/AdminTickets';
import AdminTicketDetails from './pages/admin/AdminTicketDetails';
import AdminUsers from './pages/admin/AdminUsers';
import AdminAuditLogs from './pages/admin/AdminAuditLogs';
// Authority, Clerical, and Finance Micro-Frontends
import AuthorityDashboard from './pages/authority/AuthorityDashboard';
import ClericalDashboard from './pages/clerical/ClericalDashboard';
import AccountantDashboard from './pages/finance/AccountantDashboard';

export default function App() {
  const { isAuthenticated, user } = useAuthStore();
  const isJe = user?.role === 'JE';
  const isSysAdmin = user?.role === 'SYSADMIN';
  const isClerical = user?.role === 'CLERICAL';
  const isAccountant = user?.role === 'ACCOUNTANT';
  const isAuthority = ['AE', 'SE', 'DEAN', 'DIRECTOR'].includes(user?.role || '');

  return (
    <BrowserRouter>
      <Routes>
        {/* 1. PUBLIC ROUTE: Kick authenticated users away from the login screen */}
        <Route 
          path="/login" 
          element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} 
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
                ) : isClerical ? (
                  <ClericalDashboard />
                ) : isAccountant ? (
                  <AccountantDashboard />
                ) : isAuthority ? (
                  <AuthorityDashboard />
                ) : (
                  <Dashboard />
                )}
              </Layout>
            } 
          />

          {/* Raise Ticket: Non-recurring proposal form for JE, standard recurring ticket for Applicants */}
          <Route 
            path="/raise" 
            element={
              <Layout>
                {isJe ? <JeRaiseTicket /> : <RaiseTicket />}
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

          {/* Ticket Details: JE inspection for JE, Admin master details for SYSADMIN, standard authority/applicant view otherwise */}
          <Route 
            path="/ticket/:id" 
            element={
              <Layout>
                {isJe ? <JeTicketDetails /> : isSysAdmin ? <AdminTicketDetails /> : <TicketDetails />}
              </Layout>
            } 
          />

          {/* 4. DEDICATED JE MICRO-FRONTEND ROUTES (Strict RBAC Guard) */}
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
            <Route 
              path="/je/ticket/:id" 
              element={
                <Layout>
                  <JeTicketDetails />
                </Layout>
              } 
            />
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

          {/* 5. MASTER SYSTEM ADMIN CONSOLE (Strict SYSADMIN RBAC Guard) */}
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
          </Route>

          {/* 6. AUTHORITY APPROVAL DESK (AE, SE, DEAN, DIRECTOR) */}
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

          {/* 7. CLERICAL TENDER DESK (GeM/CPP NIT & Award Management) */}
          <Route element={<ProtectedRoute allowedRoles={['CLERICAL', 'SYSADMIN']} />}>
            <Route 
              path="/clerical" 
              element={
                <Layout>
                  <ClericalDashboard />
                </Layout>
              } 
            />
          </Route>

          {/* 8. ACCOUNTANT CAPEX AUDIT DESK (Bills & PFMS Disbursements) */}
          <Route element={<ProtectedRoute allowedRoles={['ACCOUNTANT', 'SYSADMIN', 'DEAN', 'DIRECTOR']} />}>
            <Route 
              path="/finance" 
              element={
                <Layout>
                  <AccountantDashboard />
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