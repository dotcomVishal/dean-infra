import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore, useIsSignedIn } from '../store/authStore';

function Forbidden() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
      <ShieldAlert size={40} className="text-rose-500" />
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">You do not have access to this page</h1>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">Your role cannot open it. If you think this is wrong, ask a system administrator.</p>
      <Link to="/" className="mt-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Back to dashboard</Link>
    </div>
  );
}

export const ProtectedRoute = ({ allowedRoles }: { allowedRoles?: string[] }) => {
  const user = useAuthStore((s) => s.user);
  const signedIn = useIsSignedIn();
  const location = useLocation();

  // Not signed in: go to /login once, remembering where the user wanted to be.
  if (!signedIn) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // Signed in, wrong role: show a 403 in place. Redirecting to another route
  // is what used to chain into the catch-all and bounce.
  if (allowedRoles && user && !allowedRoles.includes(user.role)) return <Forbidden />;

  return <Outlet />;
};
