import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../contexts/AuthContext';
import { useApiWithAuth } from '../hooks/useApiWithAuth';
import { syncService } from '../services/sync';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw, Loader2, User, Home, ChevronDown, Menu, X, Sun, Moon, TreePine, Clock, LogOut, Settings, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';
import YearSelector from '../components/YearSelector';
import CacheStatus from '../components/CacheStatus';
import BunkRequestsUpload from '../components/BunkRequestsUpload';
import { BrandedLogo } from '../components/BrandedLogo';
import { useYear } from '../hooks/useCurrentYear';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useSyncStatusAPI } from '../hooks/useSyncStatusAPI';
import { formatDistanceToNow } from 'date-fns';
import { useProgram } from '../contexts/ProgramContext';
import { getProgramFromPath } from '../utils/programUrls';
import { pb } from '../lib/pocketbase';
import { VersionInfo } from '../components/VersionInfo';

export const AppLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, isAuthenticated, logout } = useAuth();
  const isAdmin = useIsAdmin();
  const { fetchWithAuth } = useApiWithAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProgramMenuOpen, setIsProgramMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const currentYear = useYear();
  const { currentProgram, setProgram, clearProgram } = useProgram();
  const programMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { data: syncStatus } = useSyncStatusAPI();

  // Determine current program from URL if not set
  const urlProgram = getProgramFromPath(location.pathname);
  const activeProgram = urlProgram || currentProgram || 'summer';

  // Close program menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (programMenuRef.current && !programMenuRef.current.contains(event.target as Node)) {
        setIsProgramMenuOpen(false);
      }
    };

    if (isProgramMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isProgramMenuOpen]);

  // Close user menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isUserMenuOpen]);

  const handleLogout = () => {
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
    logout();
    navigate('/login');
  };

  const handleProgramSwitch = (program: 'summer' | 'family' | 'metrics') => {
    setProgram(program);
    setIsProgramMenuOpen(false);
    if (program === 'summer') {
      navigate('/summer/sessions');
    } else if (program === 'family') {
      navigate('/family/');
    } else {
      navigate('/metrics');
    }
  };

  // Refresh bunking mutation
  const refreshBunkingMutation = useMutation({
    mutationFn: () => syncService.refreshBunking(fetchWithAuth),
    onError: (error: Error) => {
      toast.error(`Failed to refresh cabin assignments: ${error.message}`);
    },
  });

  const isActiveRoute = (path: string) => {
    // Special case: Campers nav should NOT be active on session-level campers tab
    if (path === '/camper') {
      // Match /summer/campers (all campers) or /summer/camper/ (camper detail)
      // But NOT /summer/session/*/campers
      return location.pathname === '/summer/campers' ||
             location.pathname.includes('/summer/camper/');
    }
    return location.pathname.includes(path);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Primary Navigation */}
      <nav className="sticky top-0 z-50 backdrop-lodge border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Mobile menu button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="sm:hidden p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Toggle navigation menu"
              >
                {isMobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>

              {/* Logo with subtle white outline for visibility on dark nav */}
              <Link
                to={activeProgram === 'summer' ? '/summer/sessions' : activeProgram === 'family' ? '/family/' : '/'}
                className="flex-shrink-0 flex items-center"
              >
                <BrandedLogo
                  size="small"
                  className="drop-shadow-[0_0_1px_rgba(255,255,255,0.9)] drop-shadow-[0_0_2px_rgba(255,255,255,0.6)]"
                />
              </Link>

              {/* Program Switcher */}
              <div className="relative" ref={programMenuRef}>
                <button
                  onClick={() => setIsProgramMenuOpen(!isProgramMenuOpen)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  {activeProgram === 'summer' ? (
                    <>
                      <TreePine className="w-4 h-4 text-amber-400" />
                      <span className="hidden sm:inline">Summer</span>
                    </>
                  ) : activeProgram === 'family' ? (
                    <>
                      <Home className="w-4 h-4 text-amber-400" />
                      <span className="hidden sm:inline">Family</span>
                    </>
                  ) : (
                    <>
                      <BarChart3 className="w-4 h-4 text-sky-400" />
                      <span className="hidden sm:inline">Metrics</span>
                    </>
                  )}
                  <ChevronDown className={`w-3 h-3 transition-transform ${isProgramMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isProgramMenuOpen && (
                  <div className="absolute top-full left-0 mt-2 w-52 card-lodge p-2 shadow-lodge-lg animate-scale-in z-50">
                    <button
                      onClick={() => handleProgramSwitch('summer')}
                      className={`w-full px-3 py-2.5 text-left text-sm font-medium rounded-lg transition-colors flex items-center gap-3 ${
                        activeProgram === 'summer'
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted/50 text-foreground'
                      }`}
                    >
                      <TreePine className="w-4 h-4" />
                      Summer Camp
                    </button>
                    <button
                      onClick={() => handleProgramSwitch('family')}
                      className={`w-full px-3 py-2.5 text-left text-sm font-medium rounded-lg transition-colors flex items-center gap-3 ${
                        activeProgram === 'family'
                          ? 'bg-accent/10 text-amber-600 dark:text-accent'
                          : 'hover:bg-muted/50 text-foreground'
                      }`}
                    >
                      <Home className="w-4 h-4" />
                      Family Camp
                    </button>
                    <button
                      onClick={() => handleProgramSwitch('metrics')}
                      className={`w-full px-3 py-2.5 text-left text-sm font-medium rounded-lg transition-colors flex items-center gap-3 ${
                        activeProgram === 'metrics'
                          ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                          : 'hover:bg-muted/50 text-foreground'
                      }`}
                    >
                      <BarChart3 className="w-4 h-4" />
                      Metrics
                    </button>
                    <div className="h-px bg-border my-2" />
                    <button
                      onClick={() => {
                        clearProgram();
                        setIsProgramMenuOpen(false);
                        navigate('/');
                      }}
                      className="w-full px-3 py-2.5 text-left text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors flex items-center gap-3 text-muted-foreground"
                    >
                      <ChevronDown className="w-4 h-4 rotate-90" />
                      Switch Programs
                    </button>
                  </div>
                )}
              </div>

              {/* Desktop navigation */}
              <div className="hidden sm:flex sm:gap-1">
                {activeProgram === 'summer' && (
                  <Link
                    to="/summer/sessions"
                    className={`nav-link-lodge ${isActiveRoute('/session') ? 'active' : ''}`}
                  >
                    Sessions
                  </Link>
                )}
                {(activeProgram === 'summer' || activeProgram === 'metrics') && (
                  <Link
                    to="/summer/campers"
                    className={`nav-link-lodge ${activeProgram === 'summer' && isActiveRoute('/camper') ? 'active' : ''}`}
                  >
                    Campers
                  </Link>
                )}
                <Link
                  to={`/${activeProgram}/users`}
                  className={`nav-link-lodge ${isActiveRoute('/users') ? 'active' : ''}`}
                >
                  Users
                </Link>
                {(activeProgram === 'summer' || activeProgram === 'metrics') && (
                  <Link
                    to="/summer/admin"
                    className={`nav-link-lodge ${activeProgram === 'summer' && isActiveRoute('/admin') ? 'active' : ''}`}
                  >
                    Admin
                  </Link>
                )}
                {activeProgram === 'summer' && isAdmin && (
                  <Link
                    to="/summer/debug"
                    className={`nav-link-lodge ${isActiveRoute('/debug') ? 'active' : ''}`}
                  >
                    Debug
                  </Link>
                )}
              </div>
            </div>

            {/* Right side items */}
            <div className="hidden sm:flex items-center gap-2">
              {/* User Menu Dropdown */}
              {isAuthenticated && user && (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/10 transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 overflow-hidden border border-white/30">
                      {user['avatar'] ? (
                        <img
                          src={pb.files.getURL(user, user['avatar'])}
                          alt={user['name'] || user['email']}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="h-4 w-4 text-white" />
                      )}
                    </div>
                    <div className="hidden lg:block text-left">
                      <div className="text-sm font-semibold text-white leading-tight">
                        {user['name'] || user['email']?.split('@')[0] || 'User'}
                      </div>
                      <div className="text-xs text-white/70 leading-tight">
                        {user['email'] || 'Profile'}
                      </div>
                    </div>
                    <ChevronDown className={`w-3 h-3 text-white/70 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isUserMenuOpen && (
                    <div className="absolute top-full right-0 mt-2 w-64 card-lodge p-2 shadow-lodge-lg animate-scale-in z-50">
                      {/* User info header */}
                      <div className="px-3 py-3 border-b border-border mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden border border-primary/20">
                            {user['avatar'] ? (
                              <img
                                src={pb.files.getURL(user, user['avatar'])}
                                alt={user['name'] || user['email']}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <User className="h-5 w-5 text-primary" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-foreground truncate">
                              {user['name'] || user['email']?.split('@')[0] || 'User'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {user['email']}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Menu items */}
                      <Link
                        to={`${location.pathname.startsWith('/family') ? '/family' : '/summer'}/user`}
                        onClick={() => setIsUserMenuOpen(false)}
                        className="w-full px-3 py-2.5 text-left text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors flex items-center gap-3 text-foreground"
                      >
                        <Settings className="w-4 h-4 text-muted-foreground" />
                        My Account
                      </Link>

                      <div className="h-px bg-border my-2" />

                      <button
                        onClick={handleLogout}
                        className="w-full px-3 py-2.5 text-left text-sm font-medium rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-3 text-red-600 dark:text-red-400"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="w-10 h-10 p-0 flex items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="sm:hidden border-t border-border/50 bg-card animate-slide-down">
            <div className="px-4 py-4 space-y-4">
              {/* Program Switcher for Mobile */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider px-1">Program</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleProgramSwitch('summer')}
                    className={`flex-1 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 ${
                      activeProgram === 'summer'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-foreground hover:bg-muted'
                    }`}
                  >
                    <TreePine className="w-4 h-4" />
                    Summer
                  </button>
                  <button
                    onClick={() => handleProgramSwitch('family')}
                    className={`flex-1 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 ${
                      activeProgram === 'family'
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-muted/50 text-foreground hover:bg-muted'
                    }`}
                  >
                    <Home className="w-4 h-4" />
                    Family
                  </button>
                  <button
                    onClick={() => handleProgramSwitch('metrics')}
                    className={`flex-1 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 ${
                      activeProgram === 'metrics'
                        ? 'bg-sky-500 text-white'
                        : 'bg-muted/50 text-foreground hover:bg-muted'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    Metrics
                  </button>
                </div>
              </div>

              {/* User Profile - Mobile */}
              {isAuthenticated && user && (
                <div className="border-t border-border/50 pt-4">
                  <Link
                    to={`${location.pathname.startsWith('/family') ? '/family' : '/summer'}/user`}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden border border-primary/20">
                      {user['avatar'] ? (
                        <img
                          src={pb.files.getURL(user, user['avatar'])}
                          alt={user['name'] || user['email']}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        {user['name'] || user['email']?.split('@')[0] || 'User'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {user['email']}
                      </p>
                    </div>
                    <Settings className="w-4 h-4 text-muted-foreground" />
                  </Link>
                </div>
              )}

              {/* Navigation Items */}
              <div className="space-y-1">
                {activeProgram === 'summer' && (
                  <Link
                    to="/summer/sessions"
                    className={`block px-4 py-3 text-base font-semibold rounded-xl transition-all ${
                      isActiveRoute('/session')
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Sessions
                  </Link>
                )}
                {(activeProgram === 'summer' || activeProgram === 'metrics') && (
                  <Link
                    to="/summer/campers"
                    className={`block px-4 py-3 text-base font-semibold rounded-xl transition-all ${
                      activeProgram === 'summer' && isActiveRoute('/camper')
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Campers
                  </Link>
                )}
                <Link
                  to={`/${activeProgram}/users`}
                  className={`block px-4 py-3 text-base font-semibold rounded-xl transition-all ${
                    isActiveRoute('/users')
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Users
                </Link>
                {(activeProgram === 'summer' || activeProgram === 'metrics') && (
                  <Link
                    to="/summer/admin"
                    className={`block px-4 py-3 text-base font-semibold rounded-xl transition-all ${
                      activeProgram === 'summer' && isActiveRoute('/admin')
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Admin
                  </Link>
                )}
                {activeProgram === 'summer' && isAdmin && (
                  <Link
                    to="/summer/debug"
                    className={`block px-4 py-3 text-base font-semibold rounded-xl transition-all ${
                      isActiveRoute('/debug')
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Debug
                  </Link>
                )}
              </div>

              {/* Mobile-only utilities */}
              <div className="border-t border-border/50 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Theme</span>
                  <button
                    onClick={toggleTheme}
                    className="btn-ghost px-3 py-2 flex items-center gap-2 text-sm"
                  >
                    {theme === 'dark' ? (
                      <>
                        <Sun className="h-4 w-4" />
                        Light
                      </>
                    ) : (
                      <>
                        <Moon className="h-4 w-4" />
                        Dark
                      </>
                    )}
                  </button>
                </div>

                <YearSelector />

                {/* Summer-only: Bunking controls */}
                {activeProgram === 'summer' && (
                  <>
                    <BunkRequestsUpload />
                    <button
                      onClick={() => {
                        toast(`Refreshing bunking assignments for ${currentYear}...`, {
                          icon: '🔄',
                          duration: 2000,
                        });
                        refreshBunkingMutation.mutate();
                        setIsMobileMenuOpen(false);
                      }}
                      disabled={refreshBunkingMutation.isPending}
                      className="btn-primary w-full"
                    >
                      {refreshBunkingMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span>Refresh Bunking</span>
                    </button>
                  </>
                )}

                {/* Sign Out - Mobile */}
                {isAuthenticated && (
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-3 text-base font-semibold rounded-xl transition-all flex items-center justify-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Secondary Navigation Bar - Desktop only */}
      <div className="hidden sm:block bg-muted/20 border-b border-border/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Left side: Year context + sync status (summer only) */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Year</span>
                <YearSelector />
              </div>
              {activeProgram === 'summer' && (syncStatus?.bunk_assignments?.end_time || syncStatus?.bunk_requests?.end_time) && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {syncStatus?.bunk_assignments?.end_time && (
                    <span className="flex items-center gap-1.5" title="Last bunk assignments sync">
                      <Home className="w-3 h-3" />
                      Assignments {formatDistanceToNow(new Date(syncStatus.bunk_assignments.end_time), { addSuffix: true })}
                    </span>
                  )}
                  {syncStatus?.bunk_requests?.end_time && (
                    <span className="flex items-center gap-1.5" title="Last bunk requests sync">
                      <Clock className="w-3 h-3" />
                      Requests {formatDistanceToNow(new Date(syncStatus.bunk_requests.end_time), { addSuffix: true })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Right side: Program-specific actions */}
            <div className="flex items-center gap-2">
              {activeProgram === 'summer' && (
                <>
                  <BunkRequestsUpload />
                  <button
                    onClick={() => {
                      toast(`Refreshing bunking assignments for ${currentYear}...`, {
                        icon: '🔄',
                        duration: 2000,
                      });
                      refreshBunkingMutation.mutate();
                    }}
                    disabled={refreshBunkingMutation.isPending}
                    className="btn-primary py-2 px-4 nav-btn-icon-only"
                    title="Refresh bunking assignments from CampMinder"
                  >
                    {refreshBunkingMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                    ) : (
                      <RefreshCw className="h-4 w-4 flex-shrink-0" />
                    )}
                    <span className="nav-text-short">Refresh</span>
                    <span className="nav-text-full">Refresh Bunking</span>
                  </button>
                </>
              )}
{/* Export button removed from metrics nav - export functionality will move inside metrics page if needed */}
            </div>
          </div>
        </div>
      </div>

      {/* Cache status bar */}
      <CacheStatus />

      {/* Main content */}
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      {/* Version badge - fixed bottom right, subtle */}
      <div className="fixed bottom-4 right-4 z-10">
        <VersionInfo className="opacity-50 hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
};
