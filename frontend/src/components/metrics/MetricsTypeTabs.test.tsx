/**
 * Tests for MetricsTypeTabs component
 * Primary navigation for metrics module following SessionTabs pattern
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import MetricsTypeTabs from './MetricsTypeTabs';

const renderWithRouter = (initialPath: string) => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MetricsTypeTabs />
    </MemoryRouter>
  );
};

describe('MetricsTypeTabs', () => {
  it('renders all three metric type tabs', () => {
    renderWithRouter('/metrics/registration');

    expect(screen.getByRole('link', { name: /registration/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /retention/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument();
  });

  it('renders icons for each tab', () => {
    renderWithRouter('/metrics/registration');

    // Each tab should have an icon (rendered as svg)
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);

    links.forEach(link => {
      const svg = link.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  it('highlights registration tab when on registration route', () => {
    renderWithRouter('/metrics/registration');

    const registrationLink = screen.getByRole('link', { name: /registration/i });
    const retentionLink = screen.getByRole('link', { name: /retention/i });

    // Active tab should have primary background
    expect(registrationLink).toHaveClass('bg-primary');
    expect(retentionLink).not.toHaveClass('bg-primary');
  });

  it('highlights registration tab when on registration sub-route', () => {
    renderWithRouter('/metrics/registration/geo');

    const registrationLink = screen.getByRole('link', { name: /registration/i });
    expect(registrationLink).toHaveClass('bg-primary');
  });

  it('highlights retention tab when on retention route', () => {
    renderWithRouter('/metrics/retention');

    const retentionLink = screen.getByRole('link', { name: /retention/i });
    const registrationLink = screen.getByRole('link', { name: /registration/i });

    expect(retentionLink).toHaveClass('bg-primary');
    expect(registrationLink).not.toHaveClass('bg-primary');
  });

  it('highlights trends tab when on trends route', () => {
    renderWithRouter('/metrics/trends');

    const trendsLink = screen.getByRole('link', { name: /trends/i });
    expect(trendsLink).toHaveClass('bg-primary');
  });

  it('links to correct paths', () => {
    renderWithRouter('/metrics/registration');

    expect(screen.getByRole('link', { name: /registration/i })).toHaveAttribute(
      'href',
      '/metrics/registration'
    );
    expect(screen.getByRole('link', { name: /retention/i })).toHaveAttribute(
      'href',
      '/metrics/retention'
    );
    expect(screen.getByRole('link', { name: /trends/i })).toHaveAttribute(
      'href',
      '/metrics/trends'
    );
  });

  it('uses nav element for accessibility', () => {
    renderWithRouter('/metrics/registration');

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
