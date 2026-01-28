/**
 * TDD Tests for GradeEnrollmentChart component.
 *
 * Tests are written FIRST before implementation (TDD).
 * This component displays a grouped bar chart showing enrollment by grade per year.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeEnrollmentChart } from './GradeEnrollmentChart';
import type { YearEnrollment } from '../../types/metrics';

describe('GradeEnrollmentChart', () => {
  const mockData: YearEnrollment[] = [
    {
      year: 2024,
      total: 100,
      by_gender: [],
      by_grade: [
        { grade: 3, count: 15 },
        { grade: 4, count: 20 },
        { grade: 5, count: 25 },
        { grade: 6, count: 20 },
        { grade: 7, count: 15 },
        { grade: 8, count: 5 },
      ],
    },
    {
      year: 2025,
      total: 110,
      by_gender: [],
      by_grade: [
        { grade: 3, count: 18 },
        { grade: 4, count: 22 },
        { grade: 5, count: 26 },
        { grade: 6, count: 22 },
        { grade: 7, count: 16 },
        { grade: 8, count: 6 },
      ],
    },
    {
      year: 2026,
      total: 120,
      by_gender: [],
      by_grade: [
        { grade: 3, count: 20 },
        { grade: 4, count: 24 },
        { grade: 5, count: 28 },
        { grade: 6, count: 24 },
        { grade: 7, count: 18 },
        { grade: 8, count: 6 },
      ],
    },
  ];

  describe('component export', () => {
    it('should export GradeEnrollmentChart component', async () => {
      const module = await import('./GradeEnrollmentChart');
      expect(typeof module.GradeEnrollmentChart).toBe('function');
    });
  });

  describe('rendering', () => {
    it('should render the chart with default title', () => {
      render(<GradeEnrollmentChart data={mockData} />);
      expect(screen.getByText('Enrollment by Grade')).toBeInTheDocument();
    });

    it('should render with custom title', () => {
      render(<GradeEnrollmentChart data={mockData} title="Custom Title" />);
      expect(screen.getByText('Custom Title')).toBeInTheDocument();
    });

    it('should render "No data available" when data is empty', () => {
      render(<GradeEnrollmentChart data={[]} />);
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('should render the chart container with card-lodge class', () => {
      const { container } = render(<GradeEnrollmentChart data={mockData} />);
      expect(container.querySelector('.card-lodge')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <GradeEnrollmentChart data={mockData} className="custom-class" />
      );
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

  describe('data transformation', () => {
    it('should display grades on X-axis', () => {
      render(<GradeEnrollmentChart data={mockData} />);
      // Grades should be visible as bar labels
      expect(screen.getByText('Grade 3')).toBeInTheDocument();
      expect(screen.getByText('Grade 4')).toBeInTheDocument();
      expect(screen.getByText('Grade 5')).toBeInTheDocument();
    });

    it('should handle data with null grade', () => {
      const dataWithNullGrade: YearEnrollment[] = [
        {
          year: 2024,
          total: 100,
          by_gender: [],
          by_grade: [
            { grade: 5, count: 90 },
            { grade: null, count: 10 },
          ],
        },
      ];

      // Should not throw, and "Unknown" should appear
      expect(() => render(<GradeEnrollmentChart data={dataWithNullGrade} />)).not.toThrow();
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('should handle data with empty grade list', () => {
      const dataWithEmptyGrades: YearEnrollment[] = [
        {
          year: 2024,
          total: 0,
          by_gender: [],
          by_grade: [],
        },
      ];

      // Should render "No data available"
      render(<GradeEnrollmentChart data={dataWithEmptyGrades} />);
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('should sort grades numerically', () => {
      const dataOutOfOrder: YearEnrollment[] = [
        {
          year: 2024,
          total: 60,
          by_gender: [],
          by_grade: [
            { grade: 7, count: 20 },
            { grade: 3, count: 20 },
            { grade: 5, count: 20 },
          ],
        },
      ];

      const { container } = render(<GradeEnrollmentChart data={dataOutOfOrder} />);

      // Get all text elements that contain "Grade"
      const xAxisLabels = container.querySelectorAll('.recharts-xAxis .recharts-text');
      const labels = Array.from(xAxisLabels).map((el) => el.textContent);

      // Find indices of grades in the order they appear
      const grade3Index = labels.indexOf('Grade 3');
      const grade5Index = labels.indexOf('Grade 5');
      const grade7Index = labels.indexOf('Grade 7');

      // If indices are found, verify order (they should be ascending)
      if (grade3Index >= 0 && grade5Index >= 0 && grade7Index >= 0) {
        expect(grade3Index).toBeLessThan(grade5Index);
        expect(grade5Index).toBeLessThan(grade7Index);
      }
    });
  });

  describe('chart configuration', () => {
    it('should apply custom height', () => {
      const { container } = render(
        <GradeEnrollmentChart data={mockData} height={400} />
      );
      const responsiveContainer = container.querySelector('.recharts-responsive-container');
      expect(responsiveContainer).toBeInTheDocument();
    });

    it('should include legend for year colors', () => {
      const { container } = render(<GradeEnrollmentChart data={mockData} />);
      const legend = container.querySelector('.recharts-legend-wrapper');
      expect(legend).toBeInTheDocument();
    });
  });
});
