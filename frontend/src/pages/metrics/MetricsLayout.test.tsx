/**
 * Tests for MetricsLayout component
 * Shared layout with sticky nav that wraps metric routes
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe, it, expect } from 'vitest';
import MetricsLayout from './MetricsLayout';

const TestChild = ({ text }: { text: string }) => <div data-testid="child">{text}</div>;

const renderWithRouter = (initialPath: string, childText = 'Child Content') => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/metrics/*" element={<MetricsLayout />}>
          <Route path="registration/*" element={<TestChild text={childText} />} />
          <Route path="retention" element={<TestChild text="Retention" />} />
          <Route path="trends" element={<TestChild text="Trends" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
};

describe('MetricsLayout', () => {
  it('renders primary navigation tabs', () => {
    renderWithRouter('/metrics/registration/overview');

    expect(screen.getByRole('link', { name: /registration/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /retention/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument();
  });

  it('renders child content via Outlet', () => {
    renderWithRouter('/metrics/registration/overview', 'Registration Content');

    expect(screen.getByTestId('child')).toHaveTextContent('Registration Content');
  });

  it('renders sub-nav for registration routes', () => {
    renderWithRouter('/metrics/registration/overview');

    // Sub-nav items for registration
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /geographic/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /synagogue/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /waitlist/i })).toBeInTheDocument();
  });

  it('does not render sub-nav for retention routes', () => {
    renderWithRouter('/metrics/retention');

    // Primary tabs should still be visible
    expect(screen.getByRole('link', { name: /retention/i })).toBeInTheDocument();

    // Sub-nav items should NOT be present
    expect(screen.queryByRole('link', { name: /overview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /geographic/i })).not.toBeInTheDocument();
  });

  it('does not render sub-nav for trends routes', () => {
    renderWithRouter('/metrics/trends');

    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /overview/i })).not.toBeInTheDocument();
  });

  it('renders page header with title', () => {
    renderWithRouter('/metrics/registration/overview');

    expect(screen.getByText('Registration Metrics')).toBeInTheDocument();
    expect(screen.getByText(/analyze registration data/i)).toBeInTheDocument();
  });

  it('renders sticky nav container', () => {
    renderWithRouter('/metrics/registration/overview');

    // The nav container should have sticky positioning class
    const stickyContainer = document.querySelector('.sticky');
    expect(stickyContainer).toBeInTheDocument();
  });

  it('highlights correct primary tab based on route', () => {
    renderWithRouter('/metrics/retention');

    const retentionLink = screen.getByRole('link', { name: /retention/i });
    const registrationLink = screen.getByRole('link', { name: /registration/i });

    expect(retentionLink).toHaveClass('bg-primary');
    expect(registrationLink).not.toHaveClass('bg-primary');
  });
});
