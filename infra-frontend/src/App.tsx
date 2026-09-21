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
// Master System Admin Micro-Frontend Page
import AdminDashboard from './pages/admin/AdminDashboard';

export default function App() {
  const { isAuthenticated, user } = useAuthStore();
  const isJe = user?.role === 'JE';
  const isSysAdmin = user?.role === 'SYSADMIN';

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
                <MyTickets />
              </Layout>
            } 
          />

          {/* Ticket Details: JE inspection & timeline for JE role, standard authority/applicant view otherwise */}
          <Route 
            path="/ticket/:id" 
            element={
              <Layout>
                {isJe ? <JeTicketDetails /> : <TicketDetails />}
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
              element={
                <Layout>
                  <AdminDashboard />
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