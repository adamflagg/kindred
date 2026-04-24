import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, Outlet, useNavigate } from 'react-router'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { syncService } from '../services/sync'
import { useMutation } from '@tanstack/react-query'
import {
  RefreshCw,
  Loader2,
  User,
  Home,
  ChevronDown,
  Menu,
  X,
  Sun,
  Moon,
  Clock,
  LogOut,
  Settings,
  HelpCircle,
  MessageSquareWarning,
} from 'lucide-react'
import toast from 'react-hot-toast'
import YearSelector from '../components/YearSelector'
import CacheStatus from '../components/CacheStatus'
import BunkRequestsUpload from '../components/BunkRequestsUpload'
import { BrandedLogo } from '../components/BrandedLogo'
import { useYear } from '../hooks/useCurrentYear'
import { usePermissions } from '../hooks/usePermissions'
import { Permission } from '../constants/permissions'
import { useSyncStatusAPI } from '../hooks/useSyncStatusAPI'
import { formatDistanceToNow } from 'date-fns'
import { useProgram } from '../contexts/ProgramContext'
import { getProgramFromPath, getProgramHomeUrl } from '../utils/programUrls'
import { pb } from '../lib/pocketbase'
import { VersionInfo } from '../components/VersionInfo'
import { MANAGE_TABS } from '../config/manageTabs'
import { PROGRAM_BUTTONS } from '../config/programButtons'
import { useTour } from '../hooks/useTour'
import { FeedbackModal } from '../components/FeedbackModal'

export const AppLayout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { user, isAuthenticated, logout } = useAuth()
  const { hasPermission, isAdmin } = usePermissions()
  const canAccessManage = MANAGE_TABS.some((tab) => hasPermission(tab.requiredPermission))
  const { fetchWithAuth } = useApiWithAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isProgramMenuOpen, setIsProgramMenuOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const currentYear = useYear()
  const { currentProgram, setProgram, clearProgram } = useProgram()
  const programMenuRef = useRef<HTMLDivElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false)
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false)
  const helpMenuRef = useRef<HTMLDivElement>(null)
  const canSeeSync = hasPermission(Permission.BUNKING_MANAGE)
  const { data: syncStatus } = useSyncStatusAPI({ enabled: canSeeSync })
  const { tourId, replay } = useTour()

  // Determine current program from URL if not set
  const urlProgram = getProgramFromPath(location.pathname)
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional || to fall through on empty string
  const activeProgram = urlProgram || currentProgram || 'summer'

  // Close program menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (programMenuRef.current && !programMenuRef.current.contains(event.target as Node)) {
        setIsProgramMenuOpen(false)
      }
    }

    if (isProgramMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isProgramMenuOpen])

  // Close user menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false)
      }
    }

    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isUserMenuOpen])

  // Close help menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (helpMenuRef.current && !helpMenuRef.current.contains(event.target as Node)) {
        setIsHelpMenuOpen(false)
      }
    }

    if (isHelpMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isHelpMenuOpen])

  const handleLogout = () => {
    setIsUserMenuOpen(false)
    setIsMobileMenuOpen(false)
    logout()
    void navigate('/login')
  }

  const handleProgramSwitch = (program: 'summer' | 'weekend' | 'analytics') => {
    setProgram(program)
    setIsProgramMenuOpen(false)
    void navigate(getProgramHomeUrl(program))
  }

  // Refresh bunking mutation
  const refreshBunkingMutation = useMutation({
    mutationFn: () => syncService.refreshBunking(fetchWithAuth),
    onError: (error: Error) => {
      toast.error(`Failed to refresh cabin assignments: ${error.message}`)
    },
  })

  const isActiveRoute = (path: string) => {
    // Special case: Campers nav should NOT be active on session-level campers tab
    if (path === '/camper') {
      return location.pathname === '/campers' || location.pathname.startsWith('/camper/')
    }
    return location.pathname.includes(path)
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Primary Navigation */}
      <nav className="backdrop-lodge border-border/50 sticky top-0 z-50 border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Mobile menu button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="rounded-xl p-2 text-white/70 transition-all hover:bg-white/10 hover:text-white sm:hidden"
                aria-label="Toggle navigation menu"
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              {/* Logo with subtle white outline for visibility on dark nav */}
              <Link
                to={
                  activeProgram === 'analytics'
                    ? '/analytics'
                    : activeProgram === 'weekend'
                      ? '/weekend/'
                      : '/summer/sessions'
                }
                className="flex flex-shrink-0 items-center"
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
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
                >
                  {(() => {
                    const active = PROGRAM_BUTTONS.find((b) => b.program === activeProgram)
                    if (!active) return null
                    const Icon = active.icon
                    return (
                      <>
                        <Icon className={`h-4 w-4 ${active.triggerColorClass}`} />
                        <span className="hidden sm:inline">{active.label}</span>
                      </>
                    )
                  })()}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${isProgramMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isProgramMenuOpen && (
                  <div className="card-lodge shadow-lodge-lg animate-scale-in absolute top-full left-0 z-50 mt-2 w-52 p-2">
                    {PROGRAM_BUTTONS.map((btn) => {
                      const Icon = btn.icon
                      return (
                        <button
                          key={btn.program}
                          onClick={() => handleProgramSwitch(btn.program)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                            activeProgram === btn.program ? btn.activeClass : btn.inactiveClass
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {btn.dropdownLabel}
                        </button>
                      )
                    })}
                    <div className="bg-border my-2 h-px" />
                    <button
                      onClick={() => {
                        clearProgram()
                        setIsProgramMenuOpen(false)
                        void navigate('/')
                      }}
                      className="hover:bg-muted/50 text-muted-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
                    >
                      <ChevronDown className="h-4 w-4 rotate-90" />
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
                {activeProgram === 'analytics' && (
                  <Link
                    to="/analytics"
                    className={`nav-link-lodge ${isActiveRoute('/analytics') ? 'active' : ''}`}
                  >
                    Dashboard
                  </Link>
                )}
                <Link
                  to="/campers"
                  className={`nav-link-lodge ${isActiveRoute('/camper') ? 'active' : ''}`}
                >
                  Campers
                </Link>
                <Link
                  to="/users"
                  className={`nav-link-lodge ${isActiveRoute('/users') ? 'active' : ''}`}
                >
                  Users
                </Link>
                {canAccessManage && (
                  <Link
                    to="/manage"
                    className={`nav-link-lodge ${isActiveRoute('/manage') ? 'active' : ''}`}
                  >
                    Manage
                  </Link>
                )}
                {isAdmin && (
                  <Link
                    to="/admin"
                    className={`nav-link-lodge ${isActiveRoute('/admin') ? 'active' : ''}`}
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
            <div className="hidden items-center gap-2 sm:flex">
              {/* User Menu Dropdown */}
              {isAuthenticated && user && (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-all hover:bg-white/10"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/30 bg-white/20">
                      {user['avatar'] ? (
                        <img
                          src={pb.files.getURL(user, user['avatar'])}
                          alt={(user['name'] ?? user['email']) as string}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <User className="h-4 w-4 text-white" />
                      )}
                    </div>
                    <div className="hidden text-left lg:block">
                      <div className="text-sm leading-tight font-semibold text-white">
                        {/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional || for display name fallback on empty string */}
                        {(user['name'] as string) ||
                          (user['email'] as string).split('@')[0] ||
                          'User'}
                        {/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */}
                      </div>
                      <div className="text-xs leading-tight text-white/70">
                        {typeof user['email'] === 'string' ? user['email'] : 'Profile'}
                      </div>
                    </div>
                    <ChevronDown
                      className={`h-3 w-3 text-white/70 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isUserMenuOpen && (
                    <div className="card-lodge shadow-lodge-lg animate-scale-in absolute top-full right-0 z-50 mt-2 w-64 p-2">
                      {/* User info header */}
                      <div className="border-border mb-2 border-b px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 border-primary/20 flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border">
                            {user['avatar'] ? (
                              <img
                                src={pb.files.getURL(user, user['avatar'])}
                                alt={(user['name'] ?? user['email']) as string}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <User className="text-primary h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground truncate font-semibold">
                              {/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional || for display name fallback on empty string */}
                              {(user['name'] as string) ||
                                (user['email'] as string).split('@')[0] ||
                                'User'}
                              {/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">
                              {user['email']}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Menu items */}
                      <Link
                        to="/user"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="hover:bg-muted/50 text-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
                      >
                        <Settings className="text-muted-foreground h-4 w-4" />
                        My Account
                      </Link>

                      <div className="bg-border my-2 h-px" />

                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Help Menu */}
              <div className="relative" ref={helpMenuRef}>
                <button
                  onClick={() => setIsHelpMenuOpen(!isHelpMenuOpen)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl p-0 text-white/70 transition-all hover:bg-white/10 hover:text-white"
                  aria-label="Help menu"
                >
                  <HelpCircle className="h-5 w-5" />
                </button>

                {isHelpMenuOpen && (
                  <div className="card-lodge shadow-lodge-lg animate-scale-in absolute top-full right-0 z-50 mt-2 w-56 p-2">
                    <button
                      onClick={() => {
                        setIsHelpMenuOpen(false)
                        setIsFeedbackOpen(true)
                      }}
                      className="hover:bg-muted/50 text-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
                    >
                      <MessageSquareWarning className="text-muted-foreground h-4 w-4" />
                      Report a Problem
                    </button>

                    {tourId && (
                      <button
                        onClick={() => {
                          setIsHelpMenuOpen(false)
                          replay()
                        }}
                        className="hover:bg-muted/50 text-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
                      >
                        <HelpCircle className="text-muted-foreground h-4 w-4" />
                        Tour This Page
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="flex h-10 w-10 items-center justify-center rounded-xl p-0 text-white/70 transition-all hover:bg-white/10 hover:text-white"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="border-border/50 bg-card animate-slide-down border-t sm:hidden">
            <div className="space-y-4 px-4 py-4">
              {/* Program Switcher for Mobile */}
              <div className="space-y-2">
                <p className="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase">
                  Program
                </p>
                <div className="flex gap-2">
                  {PROGRAM_BUTTONS.map((btn) => {
                    const Icon = btn.icon
                    return (
                      <button
                        key={btn.program}
                        onClick={() => handleProgramSwitch(btn.program)}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                          activeProgram === btn.program
                            ? btn.mobileActiveClass
                            : btn.mobileInactiveClass
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {btn.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* User Profile - Mobile */}
              {isAuthenticated && user && (
                <div className="border-border/50 border-t pt-4">
                  <Link
                    to="/user"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="bg-muted/30 hover:bg-muted/50 flex items-center gap-3 rounded-xl px-3 py-3 transition-colors"
                  >
                    <div className="bg-primary/10 border-primary/20 flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border">
                      {user['avatar'] ? (
                        <img
                          src={pb.files.getURL(user, user['avatar'])}
                          alt={(user['name'] ?? user['email']) as string}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <User className="text-primary h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate font-semibold">
                        {/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional || for display name fallback on empty string */}
                        {(user['name'] as string) ||
                          (user['email'] as string).split('@')[0] ||
                          'User'}
                        {/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">{user['email']}</p>
                    </div>
                    <Settings className="text-muted-foreground h-4 w-4" />
                  </Link>
                </div>
              )}

              {/* Navigation Items */}
              <div className="space-y-1">
                {activeProgram === 'summer' && (
                  <Link
                    to="/summer/sessions"
                    className={`block rounded-xl px-4 py-3 text-base font-semibold transition-all ${
                      isActiveRoute('/session')
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Sessions
                  </Link>
                )}
                {activeProgram === 'analytics' && (
                  <Link
                    to="/analytics"
                    className={`block rounded-xl px-4 py-3 text-base font-semibold transition-all ${
                      isActiveRoute('/analytics')
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                )}
                <Link
                  to="/campers"
                  className={`block rounded-xl px-4 py-3 text-base font-semibold transition-all ${
                    isActiveRoute('/camper')
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Campers
                </Link>
                <Link
                  to="/users"
                  className={`block rounded-xl px-4 py-3 text-base font-semibold transition-all ${
                    isActiveRoute('/users')
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Users
                </Link>
                {canAccessManage && (
                  <Link
                    to="/manage"
                    className={`block rounded-xl px-4 py-3 text-base font-semibold transition-all ${
                      isActiveRoute('/manage')
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Manage
                  </Link>
                )}
                {isAdmin && (
                  <Link
                    to="/admin"
                    className={`block rounded-xl px-4 py-3 text-base font-semibold transition-all ${
                      isActiveRoute('/admin')
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
                    className={`block rounded-xl px-4 py-3 text-base font-semibold transition-all ${
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
              <div className="border-border/50 space-y-3 border-t pt-4">
                {/* Help & Feedback - Mobile */}
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false)
                      setIsFeedbackOpen(true)
                    }}
                    className="hover:bg-muted/50 text-foreground flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-base font-semibold transition-colors"
                  >
                    <MessageSquareWarning className="h-4 w-4" />
                    Report a Problem
                  </button>
                  {tourId && (
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false)
                        replay()
                      }}
                      className="hover:bg-muted/50 text-foreground flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-base font-semibold transition-colors"
                    >
                      <HelpCircle className="h-4 w-4" />
                      Tour This Page
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm font-medium">Theme</span>
                  <button
                    onClick={toggleTheme}
                    className="btn-ghost flex items-center gap-2 px-3 py-2 text-sm"
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

                {/* Summer-only: Bunking controls (manage permission required) */}
                {activeProgram === 'summer' && hasPermission(Permission.BUNKING_MANAGE) && (
                  <>
                    <BunkRequestsUpload />
                    <button
                      onClick={() => {
                        toast(`Refreshing bunks & assignments for ${currentYear}...`, {
                          icon: '🔄',
                          duration: 2000,
                        })
                        refreshBunkingMutation.mutate()
                        setIsMobileMenuOpen(false)
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-base font-semibold text-red-600 transition-all hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
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
      <div className="bg-muted/20 border-border/30 hidden border-b sm:block">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            {/* Left side: Year context + sync status (summer only) */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Season
                </span>
                <YearSelector />
              </div>
              {activeProgram === 'summer' &&
                syncStatus &&
                (syncStatus.bunk_assignments?.end_time ?? syncStatus.bunk_requests?.end_time) && (
                  <div className="text-muted-foreground flex items-center gap-3 text-xs">
                    {syncStatus.bunk_assignments?.end_time && (
                      <span
                        className="flex items-center gap-1.5"
                        title="Last bunk assignments sync"
                      >
                        <Home className="h-3 w-3" />
                        Assignments{' '}
                        {formatDistanceToNow(new Date(syncStatus.bunk_assignments.end_time), {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                    {syncStatus.bunk_requests?.end_time && (
                      <span className="flex items-center gap-1.5" title="Last bunk requests sync">
                        <Clock className="h-3 w-3" />
                        Requests{' '}
                        {formatDistanceToNow(new Date(syncStatus.bunk_requests.end_time), {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                  </div>
                )}
            </div>

            {/* Right side: Program-specific actions */}
            <div className="flex items-center gap-2">
              {activeProgram === 'summer' && hasPermission(Permission.BUNKING_MANAGE) && (
                <>
                  <BunkRequestsUpload />
                  <button
                    onClick={() => {
                      toast(`Refreshing bunks & assignments for ${currentYear}...`, {
                        icon: '🔄',
                        duration: 2000,
                      })
                      refreshBunkingMutation.mutate()
                    }}
                    disabled={refreshBunkingMutation.isPending}
                    className="btn-primary nav-btn-icon-only px-4 py-2"
                    title="Refresh bunks, plans & assignments from CampMinder"
                  >
                    {refreshBunkingMutation.isPending ? (
                      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
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
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      {/* Version badge - fixed bottom right, subtle */}
      <div className="fixed right-4 bottom-4 z-10">
        <VersionInfo className="opacity-50 transition-opacity hover:opacity-100" />
      </div>

      {/* Feedback Modal */}
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </div>
  )
}
