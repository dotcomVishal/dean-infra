import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

// Pages & Components
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Layout from './components/Layout';
import { ProtectedRoute } from './routes/ProtectedRoute';
import RaiseTicket from './pages/RaiseTicket';
import MyTickets from './pages/MyTickets';
import TicketDetails from './pages/TicketDetails';

export default function App() {
  const { isAuthenticated } = useAuthStore();

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
          
          {/* 3. DASHBOARD HUB: Wrapped in the Sidebar/Nav Layout */}
          <Route 
            path="/" 
            element={
              <Layout>
                <Dashboard />
              </Layout>
            } 
          />

          {/* Placeholder for the Raise Ticket screen */}
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
                <MyTickets />
              </Layout>
            } 
          />

          <Route 
            path="/ticket/:id" 
            element={
              <Layout>
                <TicketDetails />
              </Layout>
            } 
          />
        </Route>
        
        {/* 4. THE BLACK HOLE: Catch-all for any unknown/rogue URLs */}
        <Route 
          path="*" 
          element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} 
        />
      </Routes>
    </BrowserRouter>
  );
}