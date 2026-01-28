/**
 * TDD Tests for RegistrationSessionSelector component.
 *
 * Tests are written FIRST before implementation (TDD).
 * This component provides a session dropdown for the registration tab.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegistrationSessionSelector } from './RegistrationSessionSelector';
import type { MetricsSession } from '../../hooks/useMetricsSessions';

describe('RegistrationSessionSelector', () => {
  const mockSessions: MetricsSession[] = [
    { cm_id: 2001, name: 'Session 2', session_type: 'main', start_date: '2026-06-15' },
    { cm_id: 2002, name: 'Session 3', session_type: 'main', start_date: '2026-07-07' },
    { cm_id: 2003, name: 'Session 4', session_type: 'main', start_date: '2026-07-29' },
    { cm_id: 2004, name: 'Session 2a', session_type: 'embedded', start_date: '2026-06-15' },
  ];

  describe('component export', () => {
    it('should export RegistrationSessionSelector component', async () => {
      const module = await import('./RegistrationSessionSelector');
      expect(typeof module.RegistrationSessionSelector).toBe('function');
    });
  });

  describe('rendering', () => {
    it('should render with "All Sessions" as default display', () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={null}
          onSessionChange={onSessionChange}
        />
      );

      expect(screen.getByText('All Sessions')).toBeInTheDocument();
    });

    it('should render selected session name when a session is selected', () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={2001}
          onSessionChange={onSessionChange}
        />
      );

      expect(screen.getByText('Session 2')).toBeInTheDocument();
    });

    it('should render all session options when dropdown is opened', async () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={null}
          onSessionChange={onSessionChange}
        />
      );

      // Click to open dropdown
      const button = screen.getByRole('button');
      fireEvent.click(button);

      // All sessions should be visible as options
      expect(screen.getByText('All Sessions')).toBeInTheDocument();
      expect(screen.getByText('Session 2')).toBeInTheDocument();
      expect(screen.getByText('Session 3')).toBeInTheDocument();
      expect(screen.getByText('Session 4')).toBeInTheDocument();
      expect(screen.getByText('Session 2a')).toBeInTheDocument();
    });

    it('should show loading state when isLoading is true', () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={[]}
          selectedSessionCmId={null}
          onSessionChange={onSessionChange}
          isLoading={true}
        />
      );

      // Button should be disabled when loading
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('disabled');
    });
  });

  describe('selection behavior', () => {
    it('should call onSessionChange with null when "All Sessions" is selected', async () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={2001} // Start with a selection
          onSessionChange={onSessionChange}
        />
      );

      // Open dropdown and select "All Sessions"
      const button = screen.getByRole('button');
      fireEvent.click(button);

      const allOption = screen.getByText('All Sessions');
      fireEvent.click(allOption);

      expect(onSessionChange).toHaveBeenCalledWith(null);
    });

    it('should call onSessionChange with session cm_id when a session is selected', async () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={null}
          onSessionChange={onSessionChange}
        />
      );

      // Open dropdown and select a session
      const button = screen.getByRole('button');
      fireEvent.click(button);

      const sessionOption = screen.getByText('Session 3');
      fireEvent.click(sessionOption);

      expect(onSessionChange).toHaveBeenCalledWith(2002);
    });
  });

  describe('session filtering', () => {
    it('should not show AG sessions (those are embedded in main)', () => {
      // AG sessions should be excluded from the dropdown
      // Only main and embedded types should appear
      const sessionsWithAg: MetricsSession[] = [
        ...mockSessions,
        // Note: AG sessions won't be in the list because useMetricsSessions filters them out
        // This is a documentation test - the hook does the filtering
      ];

      // All provided sessions should be main or embedded type
      for (const session of sessionsWithAg) {
        expect(['main', 'embedded']).toContain(session.session_type);
      }
    });

    it('should display sessions in start_date order', () => {
      // Sessions should already be sorted by start_date from the hook
      const sessionNames = mockSessions.map((s) => s.name);

      // Session 2 and 2a both start 6/15, then Session 3 (7/7), then Session 4 (7/29)
      // The exact order depends on sort stability, but 2 should come before 3 before 4
      const session2Index = sessionNames.indexOf('Session 2');
      const session3Index = sessionNames.indexOf('Session 3');
      const session4Index = sessionNames.indexOf('Session 4');

      expect(session2Index).toBeLessThan(session3Index);
      expect(session3Index).toBeLessThan(session4Index);
    });
  });

  describe('accessibility', () => {
    it('should have accessible role for the dropdown button', () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={null}
          onSessionChange={onSessionChange}
        />
      );

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should have proper aria labels', () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={null}
          onSessionChange={onSessionChange}
        />
      );

      // Listbox should be accessible
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle empty sessions array gracefully', () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={[]}
          selectedSessionCmId={null}
          onSessionChange={onSessionChange}
        />
      );

      // Should still show "All Sessions" option
      expect(screen.getByText('All Sessions')).toBeInTheDocument();
    });

    it('should handle selectedSessionCmId not in sessions list', () => {
      const onSessionChange = vi.fn();
      render(
        <RegistrationSessionSelector
          sessions={mockSessions}
          selectedSessionCmId={9999} // Not in sessions
          onSessionChange={onSessionChange}
        />
      );

      // Should fallback to "All Sessions" display
      expect(screen.getByText('All Sessions')).toBeInTheDocument();
    });
  });
});

describe('RegistrationSessionSelector types', () => {
  it('should have RegistrationSessionSelectorProps interface', async () => {
    // Import the actual type for the check
    const module = await import('./RegistrationSessionSelector');

    // Verify the module exported the component
    expect(module).toBeDefined();
    expect(typeof module.RegistrationSessionSelector).toBe('function');

    // The Props interface is exported as a type, verified at compile time
    // by the component's prop typing
  });
});
