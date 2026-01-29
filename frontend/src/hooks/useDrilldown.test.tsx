/**
 * TDD Tests for useDrilldown hook.
 *
 * Tests verify the hook provides:
 * - filter state management
 * - setFilter callback to open modal
 * - clearFilter callback to close modal
 * - DrilldownModal component that renders conditionally
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DrilldownFilter } from '../types/metrics';

// Test wrapper with query client
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useDrilldown', () => {
  describe('hook export', () => {
    it('should export useDrilldown hook', async () => {
      const module = await import('./useDrilldown');
      expect(typeof module.useDrilldown).toBe('function');
    });
  });

  describe('return value', () => {
    it('should return filter, setFilter, clearFilter, and DrilldownModal', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded', 'ag'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(result.current).toHaveProperty('filter');
      expect(result.current).toHaveProperty('setFilter');
      expect(result.current).toHaveProperty('clearFilter');
      expect(result.current).toHaveProperty('DrilldownModal');
    });

    it('filter should initially be null', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded', 'ag'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(result.current.filter).toBeNull();
    });

    it('setFilter should be a function', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded', 'ag'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(typeof result.current.setFilter).toBe('function');
    });

    it('clearFilter should be a function', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded', 'ag'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(typeof result.current.clearFilter).toBe('function');
    });

    it('DrilldownModal should be a function component', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded', 'ag'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(typeof result.current.DrilldownModal).toBe('function');
    });
  });

  describe('state management', () => {
    it('setFilter should update filter state', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded', 'ag'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      const testFilter: DrilldownFilter = {
        type: 'gender',
        value: 'F',
        label: 'Female',
      };

      act(() => {
        result.current.setFilter(testFilter);
      });

      expect(result.current.filter).toEqual(testFilter);
    });

    it('clearFilter should reset filter to null', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded', 'ag'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      const testFilter: DrilldownFilter = {
        type: 'gender',
        value: 'F',
        label: 'Female',
      };

      act(() => {
        result.current.setFilter(testFilter);
      });

      expect(result.current.filter).not.toBeNull();

      act(() => {
        result.current.clearFilter();
      });

      expect(result.current.filter).toBeNull();
    });
  });

  describe('DrilldownModal component', () => {
    it('should render null when filter is null', async () => {
      const { useDrilldown } = await import('./useDrilldown');

      function TestComponent() {
        const { DrilldownModal } = useDrilldown({
          year: 2026,
          sessionCmId: undefined,
          sessionTypes: ['main', 'embedded', 'ag'],
          statusFilter: ['enrolled'],
        });
        return (
          <div data-testid="container">
            <DrilldownModal />
          </div>
        );
      }

      render(<TestComponent />, { wrapper: createWrapper() });

      const container = screen.getByTestId('container');
      // Should be empty when no filter is set
      expect(container.children.length).toBe(0);
    });

    it('should render modal when filter is set', async () => {
      const { useDrilldown } = await import('./useDrilldown');

      function TestComponent() {
        const { setFilter, DrilldownModal } = useDrilldown({
          year: 2026,
          sessionCmId: undefined,
          sessionTypes: ['main', 'embedded', 'ag'],
          statusFilter: ['enrolled'],
        });

        return (
          <div data-testid="container">
            <button
              data-testid="set-filter"
              onClick={() =>
                setFilter({
                  type: 'gender',
                  value: 'F',
                  label: 'Female',
                })
              }
            >
              Set Filter
            </button>
            <DrilldownModal />
          </div>
        );
      }

      render(<TestComponent />, { wrapper: createWrapper() });

      // Click to set filter
      const button = screen.getByTestId('set-filter');
      act(() => {
        button.click();
      });

      // Modal should now be rendered - the DrillDownModal renders a fixed overlay
      // We can check for the modal's container structure
      expect(document.querySelector('.fixed.inset-0')).not.toBeNull();
    });
  });

  describe('hook parameters', () => {
    it('should accept year parameter', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2025,
            sessionCmId: undefined,
            sessionTypes: ['main'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(result.current.filter).toBeNull();
    });

    it('should accept sessionCmId parameter', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: 12345,
            sessionTypes: ['main'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(result.current.filter).toBeNull();
    });

    it('should accept sessionTypes parameter', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main', 'embedded'],
            statusFilter: ['enrolled'],
          }),
        { wrapper: createWrapper() },
      );

      expect(result.current.filter).toBeNull();
    });

    it('should accept statusFilter parameter', async () => {
      const { useDrilldown } = await import('./useDrilldown');
      const { result } = renderHook(
        () =>
          useDrilldown({
            year: 2026,
            sessionCmId: undefined,
            sessionTypes: ['main'],
            statusFilter: ['enrolled', 'waitlisted'],
          }),
        { wrapper: createWrapper() },
      );

      expect(result.current.filter).toBeNull();
    });
  });

  describe('integration with DrillDownModal', () => {
    it('should use DrillDownModal component from components/metrics', async () => {
      // Verify the hook imports the correct component
      const sourceContent = await import('./useDrilldown?raw');
      const source = sourceContent.default;

      expect(source).toContain('DrillDownModal');
      expect(source).toContain('../components/metrics/DrillDownModal');
    });
  });
});
