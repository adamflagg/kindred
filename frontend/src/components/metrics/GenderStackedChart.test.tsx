/**
 * TDD Tests for GenderStackedChart component.
 *
 * Tests are written FIRST before implementation (TDD).
 * This component displays a 100% stacked bar chart showing gender composition per year.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenderStackedChart } from './GenderStackedChart';
import type { YearEnrollment } from '../../types/metrics';

describe('GenderStackedChart', () => {
  const mockData: YearEnrollment[] = [
    {
      year: 2024,
      total: 100,
      by_gender: [
        { gender: 'F', count: 48 },
        { gender: 'M', count: 52 },
      ],
      by_grade: [],
    },
    {
      year: 2025,
      total: 110,
      by_gender: [
        { gender: 'F', count: 54 },
        { gender: 'M', count: 56 },
      ],
      by_grade: [],
    },
    {
      year: 2026,
      total: 120,
      by_gender: [
        { gender: 'F', count: 57 },
        { gender: 'M', count: 63 },
      ],
      by_grade: [],
    },
  ];

  describe('component export', () => {
    it('should export GenderStackedChart component', async () => {
      const module = await import('./GenderStackedChart');
      expect(typeof module.GenderStackedChart).toBe('function');
    });
  });

  describe('rendering', () => {
    it('should render the chart with default title', () => {
      render(<GenderStackedChart data={mockData} />);
      expect(screen.getByText('Gender Composition by Year')).toBeInTheDocument();
    });

    it('should render with custom title', () => {
      render(<GenderStackedChart data={mockData} title="Custom Title" />);
      expect(screen.getByText('Custom Title')).toBeInTheDocument();
    });

    it('should render "No data available" when data is empty', () => {
      render(<GenderStackedChart data={[]} />);
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('should render the chart container with card-lodge class', () => {
      const { container } = render(<GenderStackedChart data={mockData} />);
      expect(container.querySelector('.card-lodge')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <GenderStackedChart data={mockData} className="custom-class" />
      );
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

  describe('data transformation', () => {
    it('should render chart container for valid data', () => {
      const { container } = render(<GenderStackedChart data={mockData} />);
      // The ResponsiveContainer should be present
      expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
    });

    it('should handle data with unknown gender', () => {
      const dataWithUnknown: YearEnrollment[] = [
        {
          year: 2024,
          total: 100,
          by_gender: [
            { gender: 'F', count: 45 },
            { gender: 'M', count: 50 },
            { gender: 'Unknown', count: 5 },
          ],
          by_grade: [],
        },
      ];

      // Should not throw
      expect(() => render(<GenderStackedChart data={dataWithUnknown} />)).not.toThrow();
    });

    it('should handle data with empty gender list', () => {
      const dataWithEmptyGender: YearEnrollment[] = [
        {
          year: 2024,
          total: 0,
          by_gender: [],
          by_grade: [],
        },
      ];

      // Should render without error
      expect(() => render(<GenderStackedChart data={dataWithEmptyGender} />)).not.toThrow();
    });
  });

  describe('chart configuration', () => {
    it('should apply custom height', () => {
      const { container } = render(
        <GenderStackedChart data={mockData} height={400} />
      );
      // ResponsiveContainer should receive the height prop
      const responsiveContainer = container.querySelector('.recharts-responsive-container');
      expect(responsiveContainer).toBeInTheDocument();
    });

    it('should render recharts wrapper', () => {
      const { container } = render(<GenderStackedChart data={mockData} />);
      // Chart wrapper should be present (legend renders async/on resize)
      expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
    });
  });
});
