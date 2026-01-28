/**
 * Tests for CollapsibleDemographicTable component - TDD tests written first.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Building2 } from 'lucide-react';
import {
  CollapsibleDemographicTable,
  type RegistrationTableData,
  type RetentionTableData,
} from './CollapsibleDemographicTable';

// ============================================================================
// Registration variant tests
// ============================================================================

describe('CollapsibleDemographicTable - registration variant', () => {
  const mockRegistrationData: RegistrationTableData[] = [
    { name: 'Oak Valley Elementary', count: 25, percentage: 25 },
    { name: 'Riverside Middle', count: 45, percentage: 45 },
    { name: 'Hillcrest High', count: 30, percentage: 30 },
  ];

  it('renders title and count', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 data-testid="icon" />}
        data={mockRegistrationData}
        variant="registration"
        nameColumn="School"
      />
    );

    expect(screen.getByText('By School')).toBeInTheDocument();
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('is collapsed by default', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 />}
        data={mockRegistrationData}
        variant="registration"
        nameColumn="School"
      />
    );

    // Table should not be visible when collapsed
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('expands when clicked', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 />}
        data={mockRegistrationData}
        variant="registration"
        nameColumn="School"
      />
    );

    // Click to expand
    fireEvent.click(screen.getByRole('button'));

    // Table should now be visible
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('can be open by default', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 />}
        data={mockRegistrationData}
        variant="registration"
        nameColumn="School"
        defaultOpen
      />
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders registration columns: Name, Count, %', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 />}
        data={mockRegistrationData}
        variant="registration"
        nameColumn="School"
        defaultOpen
      />
    );

    expect(screen.getByText('School')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('renders data rows correctly', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 />}
        data={mockRegistrationData}
        variant="registration"
        nameColumn="School"
        defaultOpen
      />
    );

    expect(screen.getByText('Oak Valley Elementary')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });

  it('shows empty state when data is empty', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 />}
        data={[]}
        variant="registration"
        nameColumn="School"
        defaultOpen
        emptyMessage="No school data available"
      />
    );

    expect(screen.getByText('No school data available')).toBeInTheDocument();
  });
});

// ============================================================================
// Retention variant tests
// ============================================================================

describe('CollapsibleDemographicTable - retention variant', () => {
  const mockRetentionData: RetentionTableData[] = [
    { name: 'Oak Valley Elementary', base_count: 30, returned_count: 24, retention_rate: 0.8 },
    { name: 'Riverside Middle', base_count: 50, returned_count: 25, retention_rate: 0.5 },
  ];

  it('renders retention columns: Name, BaseYear, Returned, Retention', () => {
    render(
      <CollapsibleDemographicTable
        title="Retention by School"
        icon={<Building2 />}
        data={mockRetentionData}
        variant="retention"
        nameColumn="School"
        baseYear={2024}
        defaultOpen
      />
    );

    expect(screen.getByText('School')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.getByText('Retention')).toBeInTheDocument();
  });

  it('renders retention data rows correctly', () => {
    render(
      <CollapsibleDemographicTable
        title="Retention by School"
        icon={<Building2 />}
        data={mockRetentionData}
        variant="retention"
        nameColumn="School"
        baseYear={2024}
        defaultOpen
      />
    );

    expect(screen.getByText('Oak Valley Elementary')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('80.0%')).toBeInTheDocument();
  });

  it('colors retention rate based on value', () => {
    render(
      <CollapsibleDemographicTable
        title="Retention by School"
        icon={<Building2 />}
        data={mockRetentionData}
        variant="retention"
        nameColumn="School"
        baseYear={2024}
        defaultOpen
      />
    );

    // 80% should be green (emerald)
    const highRate = screen.getByText('80.0%');
    expect(highRate.className).toContain('emerald');

    // 50% should be amber (between 40-60 threshold)
    const midRate = screen.getByText('50.0%');
    expect(midRate.className).toContain('amber');
  });

  it('shows low retention in red', () => {
    const lowRetentionData: RetentionTableData[] = [
      { name: 'Test School', base_count: 100, returned_count: 30, retention_rate: 0.3 },
    ];

    render(
      <CollapsibleDemographicTable
        title="Retention by School"
        icon={<Building2 />}
        data={lowRetentionData}
        variant="retention"
        nameColumn="School"
        baseYear={2024}
        defaultOpen
      />
    );

    const lowRate = screen.getByText('30.0%');
    expect(lowRate.className).toContain('red');
  });
});

// ============================================================================
// Shared behavior tests
// ============================================================================

describe('CollapsibleDemographicTable - shared behavior', () => {
  it('truncates long names with ellipsis', () => {
    const longNameData: RegistrationTableData[] = [
      {
        name: 'This Is A Very Long School Name That Should Be Truncated',
        count: 10,
        percentage: 100,
      },
    ];

    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 />}
        data={longNameData}
        variant="registration"
        nameColumn="School"
        defaultOpen
      />
    );

    const cell = screen.getByText('This Is A Very Long School Name That Should Be Truncated');
    expect(cell.className).toContain('truncate');
    expect(cell).toHaveAttribute(
      'title',
      'This Is A Very Long School Name That Should Be Truncated'
    );
  });

  it('renders icon in header', () => {
    render(
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 data-testid="header-icon" />}
        data={[]}
        variant="registration"
        nameColumn="School"
      />
    );

    expect(screen.getByTestId('header-icon')).toBeInTheDocument();
  });
});
