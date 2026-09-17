import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export const ProtectedRoute = ({ allowedRoles }: { allowedRoles?: string[] }) => {
  const { user, isAuthenticated } = useAuthStore();

  // 1. Rogue user trying to access protected content
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  
  // 2. Authenticated user without the correct privileges (RBAC)
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // 3. Authorized access granted
  return <Outlet />;
};