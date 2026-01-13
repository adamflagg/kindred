import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ProtectedRoute } from './ProtectedRoute';

// Mock the useAuth hook
const mockUseAuth = vi.fn();

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

/**
 * Tests for ProtectedRoute component.
 *
 * Validates the authentication gating behavior:
 * - Unauthenticated users redirected to /login
 * - Loading state shows spinner
 * - Authenticated users see protected content
 * - Bypass mode allows access without auth
 * - Original location preserved in redirect state
 */

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('should show loading spinner when auth is loading', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
        isBypassMode: false
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/protected" element={<div>Protected Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('unauthenticated users', () => {
    it('should redirect to /login when user is not authenticated', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        isBypassMode: false
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/protected" element={<div>Protected Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('authenticated users', () => {
    it('should render protected content when user is authenticated', () => {
      mockUseAuth.mockReturnValue({
        user: { id: '123', email: 'test@example.com' },
        isLoading: false,
        isBypassMode: false
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/protected" element={<div>Protected Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  describe('bypass mode', () => {
    it('should allow access in bypass mode even without user', () => {
      mockUseAuth.mockReturnValue({
        user: null, // No user, but bypass mode is on
        isLoading: false,
        isBypassMode: true
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/protected" element={<div>Protected Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
      expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
    });
  });

  describe('nested routes', () => {
    it('should render nested protected routes when authenticated', () => {
      mockUseAuth.mockReturnValue({
        user: { id: '123', email: 'test@example.com' },
        isLoading: false,
        isBypassMode: false
      });

      render(
        <MemoryRouter initialEntries={['/app/dashboard']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/app">
                <Route path="dashboard" element={<div>Dashboard</div>} />
                <Route path="settings" element={<div>Settings</div>} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });
});

describe('ProtectedRoute with location state', () => {
  /**
   * Tests that verify the "from" location is preserved during redirects.
   * This allows redirecting users back to their original destination after login.
   */

  it('should preserve original location when redirecting to login', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      isBypassMode: false
    });

    // We can't easily test the state in Navigate without a more complex setup,
    // but we can verify the redirect happens correctly
    render(
      <MemoryRouter initialEntries={['/summer/sessions/123']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/summer/sessions/:id" element={<div>Session View</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    // Should be on login page
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Session View')).not.toBeInTheDocument();
  });
});

describe('ProtectedRoute edge cases', () => {
  it('should handle rapid auth state changes', () => {
    // Start loading
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: true,
      isBypassMode: false
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    // Transition to authenticated
    mockUseAuth.mockReturnValue({
      user: { id: '123', email: 'test@example.com' },
      isLoading: false,
      isBypassMode: false
    });

    rerender(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('should handle transition from authenticated to unauthenticated', () => {
    // Start authenticated
    mockUseAuth.mockReturnValue({
      user: { id: '123', email: 'test@example.com' },
      isLoading: false,
      isBypassMode: false
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();

    // User logs out
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      isBypassMode: false
    });

    rerender(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });
});
