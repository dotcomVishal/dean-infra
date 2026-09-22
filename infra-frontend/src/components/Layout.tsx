import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { 
  LayoutDashboard, PlusCircle, ClipboardList, 
  CheckSquare, ShieldAlert, Menu, Sun, Moon, X, LogOut,
  FileSpreadsheet, IndianRupee
} from 'lucide-react';
import PwaInstallPrompt from './PwaInstallPrompt';

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { isDark, toggleTheme } = useThemeStore();
  
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const color = isDark ? '#0f172a' : '#ffffff';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    metas.forEach((m) => m.setAttribute('content', color));
  }, [isDark]);

  const getNavLinks = () => {
    const role = user?.role || 'APPLICANT';
    const base = [{ name: 'Dashboard', path: '/', icon: LayoutDashboard }];
    
    if (role === 'APPLICANT') {
      base.push(
        { name: 'My Tickets', path: '/tickets', icon: ClipboardList },
        { name: 'Raise Ticket', path: '/raise', icon: PlusCircle }
      );
    } else if (role === 'JE') {
      base.push(
        { name: 'Ticket Directory', path: '/tickets', icon: ClipboardList },
        { name: 'Raise Proposal', path: '/je/raise', icon: PlusCircle },
        { name: 'Tender Control', path: '/je/tender', icon: FileSpreadsheet }
      );
    } else if (['AE', 'SE'].includes(role)) {
      base.push(
        { name: 'Engineering Reviews', path: '/approvals', icon: CheckSquare },
        { name: 'Department Works', path: '/tickets', icon: ClipboardList }
      );
    } else if (role === 'DEAN') {
      base.push(
        { name: 'Deanery Sanctions', path: '/approvals', icon: CheckSquare },
        { name: 'All Campus Works', path: '/tickets', icon: ClipboardList }
      );
    } else if (role === 'DIRECTOR') {
      base.push(
        { name: 'Director Sanctions', path: '/approvals', icon: CheckSquare },
        { name: 'Global CapEx Overview', path: '/tickets', icon: ShieldAlert }
      );
    } else if (role === 'CLERICAL') {
      base.push(
        { name: 'Tender Desk', path: '/clerical', icon: FileSpreadsheet },
        { name: 'Sanctioned Directory', path: '/tickets', icon: ClipboardList }
      );
    } else if (role === 'ACCOUNTANT') {
      base.push(
        { name: 'Finance & Bills', path: '/finance', icon: IndianRupee },
        { name: 'Sanctioned Ledger', path: '/tickets', icon: ClipboardList }
      );
    } else if (role === 'SYSADMIN') {
      base.push(
        { name: 'Master Console', path: '/admin', icon: ShieldAlert },
        { name: 'Ticket Directory', path: '/tickets', icon: ClipboardList }
      );
    }
    return base;
  };
  const navLinks = getNavLinks();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-900 flex flex-col font-sans transition-colors duration-200">
      
      {/* TOP NAVBAR */}
      <header className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border-b border-gray-200 dark:border-slate-700 flex items-center justify-between px-4 sticky top-0 z-50 transition-colors pt-[env(safe-area-inset-top,0px)] h-[calc(4rem+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => window.innerWidth < 768 ? setIsMobileMenuOpen(true) : setIsDesktopCollapsed(!isDesktopCollapsed)}
            className="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
          >
            <Menu size={20} />
          </button>
          <div className="flex flex-col">
            <span className="text-[11px] font-black tracking-widest uppercase text-blue-600 dark:text-blue-400 leading-none mb-0.5">IIT Mandi</span>
            <span className="text-sm md:text-base font-semibold text-slate-900 dark:text-slate-100 leading-none">Deanery of Infrastructure</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1 md:gap-2">
          <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={handleLogout} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-600 hover:text-red-600 dark:text-slate-300 dark:hover:text-red-400 rounded-full transition-colors" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* DESKTOP SIDEBAR */}
        <aside className={`hidden md:flex flex-col bg-slate-50 dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 transition-all duration-300 ease-in-out ${isDesktopCollapsed ? 'w-20' : 'w-64'}`}>
          <div className={`p-4 flex flex-col border-b border-gray-200/50 dark:border-slate-700/50 transition-all duration-300 ${isDesktopCollapsed ? 'items-center' : 'items-start'}`}>
            {!isDesktopCollapsed ? (
              <>
                <h3 className="font-bold text-slate-900 dark:text-white truncate w-full">{user?.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate w-full mb-2">{user?.email}</p>
                <span className="text-[10px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 px-2 py-1 rounded text-slate-600 dark:text-slate-300 font-mono font-semibold shadow-sm">
                  {user?.role}
                </span>
              </>
            ) : (
               <span className="text-[10px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 px-2 py-1 rounded text-slate-600 dark:text-slate-300 font-mono font-bold shadow-sm" title={user?.role}>
                  {user?.role?.substring(0,2)}
               </span>
            )}
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.path;
              return (
                <Link key={link.name} to={link.path} title={isDesktopCollapsed ? link.name : ""} className={`flex items-center ${isDesktopCollapsed ? 'justify-center px-0' : 'justify-start px-4'} gap-3 py-3 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-600 dark:text-slate-400 hover:bg-gray-200/50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'}`}>
                  <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400'} />
                  {!isDesktopCollapsed && <span className="truncate">{link.name}</span>}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* MOBILE DRAWER */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity" onClick={() => setIsMobileMenuOpen(false)} />
        )}
        <aside className={`md:hidden fixed top-0 left-0 bottom-0 w-72 bg-white dark:bg-slate-800 z-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-16 flex items-center justify-between px-4 border-b border-gray-100 dark:border-slate-700">
            <span className="font-semibold text-slate-900 dark:text-white">Menu</span>
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400">
              <X size={20} />
            </button>
          </div>
          <nav className="p-4 space-y-1 flex-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.path;
              return (
                <Link key={link.name} to={link.path} onClick={() => setIsMobileMenuOpen(false)} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700'}`}>
                  <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400'} />
                  {link.name}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 w-full flex flex-col">
          {children}
          <footer className="mt-auto pt-12 pb-4 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
            © {new Date().getFullYear()} IIT Mandi. Deanery of Infrastructure Internal Operations.
          </footer>
        </main>
      </div>

      {/* MOBILE BOTTOM NAV */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl border-t border-gray-200/50 dark:border-slate-700/50 flex justify-around p-2 pb-safe shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-40">
        {navLinks.slice(0, 4).map((link) => {
          const Icon = link.icon;
          const isActive = location.pathname === link.path;
          return (
            <Link key={link.name} to={link.path} className={`flex flex-col items-center p-2 min-w-[64px] transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>
              <Icon size={20} className="mb-1" />
              <span className="text-[10px] font-medium text-center leading-tight">{link.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* PWA Install Banner & Offline Monitor */}
      <PwaInstallPrompt />
    </div>
  );
}