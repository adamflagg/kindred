import type { ReactNode } from 'react';
import { createContext, useState, useEffect, useContext, useEffectEvent } from 'react';
import type { RecordModel } from 'pocketbase';
import { pb, loginWithOAuth2, logout as pbLogout, getCurrentUser, isAuthenticated, onAuthChange, authenticateBypassMode } from '../lib/pocketbase';

interface AuthContextType {
  pb: typeof pb;
  user: RecordModel | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isBypassMode: boolean;
  login: (provider?: string) => Promise<void>;
  logout: () => void;
  error: string | null;
  checkAuth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock user for bypass mode
const BYPASS_USER: RecordModel = {
  id: 'bypass-user',
  email: 'bypass@local',
  name: 'Bypass User',
  collectionId: '_superusers',
  collectionName: '_superusers',
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<RecordModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'bypass' | 'production' | null>(null);

  // Fetch auth config on mount to determine mode
  useEffect(() => {
    const fetchAuthConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          const mode = config.auth_mode === 'bypass' ? 'bypass' : 'production';
          setAuthMode(mode);
        } else {
          // Default to production if config fetch fails
          console.warn('Failed to fetch auth config, defaulting to production mode');
          setAuthMode('production');
        }
      } catch (err) {
        console.warn('Failed to fetch auth config, defaulting to production mode:', err);
        setAuthMode('production');
      }
    };

    fetchAuthConfig();
  }, []);

  // Stable auth change handler using useEffectEvent
  // This callback always sees the latest state without causing effect re-runs
  const handleAuthChange = useEffectEvent((_token: string | null, model: RecordModel | null) => {
    // Reject admin tokens in production mode
    if (model && model.collectionName === '_superusers') {
      console.log('Production mode: rejecting admin token in auth change');
      pb.authStore.clear();
      setUser(null);
      return;
    }
    setUser(model);
  });

  // Handle auth state based on mode
  // Uses async/await with AbortController for proper cleanup
  useEffect(() => {
    if (authMode === null) return; // Wait for config to load

    const abortController = new AbortController();
    let unsubscribe: (() => void) | undefined;

    const initAuth = async () => {
      if (authMode === 'bypass') {
        // Bypass mode: authenticate PocketBase with admin credentials, then set mock user
        const success = await authenticateBypassMode();

        // Check if effect was cleaned up during async operation
        if (abortController.signal.aborted) return;

        if (success) {
          console.log('Dev bypass mode active');
          setUser(BYPASS_USER);
        } else {
          setError('Failed to authenticate in bypass mode');
        }
        setIsLoading(false);
        return;
      }

      // Production mode: check real auth state
      const currentUser = getCurrentUser();

      // In production mode, reject admin tokens (from bypass mode cache)
      // Only accept tokens from the 'users' collection (OIDC auth)
      if (currentUser && currentUser.collectionName === '_superusers') {
        console.log('Production mode: clearing cached admin token, requires OIDC login');
        pb.authStore.clear();
        setUser(null);
        setIsLoading(false);
        return;
      }

      setUser(currentUser);
      setIsLoading(false);

      // Subscribe to auth changes with stable handler
      unsubscribe = onAuthChange(handleAuthChange);
    };

    initAuth();

    return () => {
      abortController.abort();
      unsubscribe?.();
    };
  }, [authMode]);

  const login = async (provider: string = 'oidc') => {
    if (authMode === 'bypass') {
      // In bypass mode, just set the mock user
      setUser(BYPASS_USER);
      return;
    }

    try {
      setError(null);
      await loginWithOAuth2(provider);
      // User will be set by the auth change listener
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed';
      setError(errorMessage);
      throw err;
    }
  };

  const logout = () => {
    if (authMode === 'bypass') {
      // In bypass mode, just clear and reset to mock user
      setUser(BYPASS_USER);
      return;
    }

    pbLogout();
    setUser(null);
  };

  const checkAuth = async () => {
    if (authMode === 'bypass') {
      return true; // Always authenticated in bypass mode
    }

    try {
      // Check if auth store is valid locally first
      if (!pb.authStore.isValid) {
        setUser(null);
        return false;
      }

      // Only try to refresh if explicitly needed
      try {
        const authData = await pb.collection('users').authRefresh();
        setUser(authData.record as RecordModel);
        return true;
      } catch (refreshError) {
        // Only clear auth if it's a 401 error (PocketBase v0.23+ uses status at top level)
        const httpError = refreshError as { status?: number } | null;
        if (httpError?.status === 401) {
          pb.authStore.clear();
          setUser(null);
          return false;
        }
        // For other errors (network, etc), assume auth is still valid
        return true;
      }
    } catch (error) {
      console.error('Auth check error:', error);
      return pb.authStore.isValid;
    }
  };

  const value: AuthContextType = {
    pb,
    user,
    isLoading: isLoading || authMode === null, // Still loading if config not fetched
    isAuthenticated: authMode === 'bypass' ? true : isAuthenticated(),
    isBypassMode: authMode === 'bypass',
    login,
    logout,
    error,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
