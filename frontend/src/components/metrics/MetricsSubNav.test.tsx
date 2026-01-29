/**
 * Tests for MetricsSubNav component
 * Secondary navigation following AreaFilterBar pattern
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import { LayoutDashboard, Globe, Building2, Clock } from 'lucide-react';
import MetricsSubNav, { type SubNavItem } from './MetricsSubNav';

const REGISTRATION_SUB_NAV: SubNavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/metrics/registration/overview' },
  { id: 'geo', label: 'Geographic', icon: Globe, path: '/metrics/registration/geo' },
  { id: 'synagogue', label: 'Synagogue', icon: Building2, path: '/metrics/registration/synagogue' },
  { id: 'waitlist', label: 'Waitlist', icon: Clock, path: '/metrics/registration/waitlist' },
];

const renderWithRouter = (initialPath: string, items: SubNavItem[] = REGISTRATION_SUB_NAV) => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MetricsSubNav items={items} />
    </MemoryRouter>
  );
};

describe('MetricsSubNav', () => {
  it('renders all provided sub-nav items', () => {
    renderWithRouter('/metrics/registration/overview');

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /geographic/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /synagogue/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /waitlist/i })).toBeInTheDocument();
  });

  it('renders icons for each item', () => {
    renderWithRouter('/metrics/registration/overview');

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);

    links.forEach(link => {
      const svg = link.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  it('highlights active item based on exact path match', () => {
    renderWithRouter('/metrics/registration/overview');

    const overviewLink = screen.getByRole('link', { name: /overview/i });
    const geoLink = screen.getByRole('link', { name: /geographic/i });

    expect(overviewLink).toHaveClass('bg-primary');
    expect(geoLink).not.toHaveClass('bg-primary');
  });

  it('highlights geo tab when on geo route', () => {
    renderWithRouter('/metrics/registration/geo');

    const geoLink = screen.getByRole('link', { name: /geographic/i });
    const overviewLink = screen.getByRole('link', { name: /overview/i });

    expect(geoLink).toHaveClass('bg-primary');
    expect(overviewLink).not.toHaveClass('bg-primary');
  });

  it('links to correct paths', () => {
    renderWithRouter('/metrics/registration/overview');

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute(
      'href',
      '/metrics/registration/overview'
    );
    expect(screen.getByRole('link', { name: /geographic/i })).toHaveAttribute(
      'href',
      '/metrics/registration/geo'
    );
    expect(screen.getByRole('link', { name: /synagogue/i })).toHaveAttribute(
      'href',
      '/metrics/registration/synagogue'
    );
    expect(screen.getByRole('link', { name: /waitlist/i })).toHaveAttribute(
      'href',
      '/metrics/registration/waitlist'
    );
  });

  it('renders segmented control container with proper styling', () => {
    renderWithRouter('/metrics/registration/overview');

    const container = screen.getByRole('navigation');
    // The inner div should have the segmented control styling
    const segmentedControl = container.querySelector('.rounded-xl');
    expect(segmentedControl).toBeInTheDocument();
  });

  it('uses nav element for accessibility', () => {
    renderWithRouter('/metrics/registration/overview');

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders empty when no items provided', () => {
    renderWithRouter('/metrics/registration/overview', []);

    // Nav should still be present but empty
    const nav = screen.getByRole('navigation');
    expect(nav.querySelectorAll('a')).toHaveLength(0);
  });

  it('works with subset of items', () => {
    const twoItems: SubNavItem[] = [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/metrics/registration/overview' },
      { id: 'geo', label: 'Geographic', icon: Globe, path: '/metrics/registration/geo' },
    ];

    renderWithRouter('/metrics/registration/overview', twoItems);

    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
