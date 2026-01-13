import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SessionTabs, { createTabs } from './SessionTabs';

describe('SessionTabs', () => {
  describe('createTabs', () => {
    it('creates tabs with correct icons and labels', () => {
      const tabs = createTabs({ camperCount: 50, requestCount: 25 });

      expect(tabs).toHaveLength(4);
      expect(tabs[0]).toMatchObject({ id: 'bunks', label: 'Bunks' });
      expect(tabs[1]).toMatchObject({ id: 'campers', label: 'Campers (50)' });
      expect(tabs[2]).toMatchObject({ id: 'requests', label: 'Requests (25)' });
      expect(tabs[3]).toMatchObject({ id: 'friends', label: 'Graph' });
    });

    it('creates tabs with zero counts', () => {
      const tabs = createTabs({ camperCount: 0, requestCount: 0 });

      expect(tabs.find(t => t.id === 'campers')?.label).toBe('Campers (0)');
      expect(tabs.find(t => t.id === 'requests')?.label).toBe('Requests (0)');
    });

    it('creates tabs with large counts', () => {
      const tabs = createTabs({ camperCount: 1234, requestCount: 567 });

      expect(tabs.find(t => t.id === 'campers')?.label).toBe('Campers (1234)');
      expect(tabs.find(t => t.id === 'requests')?.label).toBe('Requests (567)');
    });
  });

  describe('SessionTabs component', () => {
    const defaultProps = {
      sessionId: 'session-1',
      activeTab: 'bunks' as const,
      camperCount: 50,
      requestCount: 25,
    };

    it('renders all four tabs', () => {
      render(
        <MemoryRouter>
          <SessionTabs {...defaultProps} />
        </MemoryRouter>
      );

      expect(screen.getByRole('link', { name: /bunks/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /campers/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /requests/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /graph/i })).toBeInTheDocument();
    });

    it('applies active styling to current tab', () => {
      render(
        <MemoryRouter>
          <SessionTabs {...defaultProps} activeTab="campers" />
        </MemoryRouter>
      );

      const campersTab = screen.getByRole('link', { name: /campers/i });
      expect(campersTab).toHaveClass('bg-primary');
    });

    it('links to correct URLs', () => {
      render(
        <MemoryRouter>
          <SessionTabs {...defaultProps} sessionId="toc" />
        </MemoryRouter>
      );

      expect(screen.getByRole('link', { name: /bunks/i })).toHaveAttribute(
        'href',
        '/summer/session/toc/bunks'
      );
      expect(screen.getByRole('link', { name: /campers/i })).toHaveAttribute(
        'href',
        '/summer/session/toc/campers'
      );
    });

    it('displays counts in tab labels', () => {
      render(
        <MemoryRouter>
          <SessionTabs {...defaultProps} camperCount={123} requestCount={45} />
        </MemoryRouter>
      );

      expect(screen.getByText(/Campers \(123\)/)).toBeInTheDocument();
      expect(screen.getByText(/Requests \(45\)/)).toBeInTheDocument();
    });

    it('renders with all valid tab types', () => {
      const tabTypes = ['bunks', 'campers', 'requests', 'friends'] as const;

      tabTypes.forEach((tabType) => {
        const { unmount } = render(
          <MemoryRouter>
            <SessionTabs {...defaultProps} activeTab={tabType} />
          </MemoryRouter>
        );

        // Just verify it renders without error
        expect(screen.getByRole('navigation')).toBeInTheDocument();
        unmount();
      });
    });
  });
});
