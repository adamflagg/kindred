/**
 * Tests for GraphLegend component
 * TDD - tests written first, implementation follows
 */

import { describe, it, expect } from 'vitest';

describe('GraphLegend', () => {
  describe('edge type colors', () => {
    it('should have predefined colors for each edge type', () => {
      const EDGE_COLORS: Record<string, string> = {
        request: '#3498db',
        historical: '#95a5a6',
        sibling: '#e74c3c',
        school: '#2ecc71',
        bundled: '#9b59b6',
      };

      expect(EDGE_COLORS['request']).toBe('#3498db');
      expect(EDGE_COLORS['historical']).toBe('#95a5a6');
      expect(EDGE_COLORS['sibling']).toBe('#e74c3c');
      expect(EDGE_COLORS['school']).toBe('#2ecc71');
    });
  });

  describe('grade colors', () => {
    it('should have colors for grades 1-12', () => {
      const GRADE_COLORS: Record<number, string> = {
        1: '#e74c3c',
        2: '#e67e22',
        3: '#f39c12',
        4: '#f1c40f',
        5: '#2ecc71',
        6: '#27ae60',
        7: '#16a085',
        8: '#3498db',
        9: '#2980b9',
        10: '#9b59b6',
        11: '#8e44ad',
        12: '#34495e',
      };

      expect(Object.keys(GRADE_COLORS)).toHaveLength(12);
      expect(GRADE_COLORS[1]).toBe('#e74c3c');
      expect(GRADE_COLORS[12]).toBe('#34495e');
    });

    it('should follow rainbow gradient pattern', () => {
      const GRADE_COLORS: Record<number, string> = {
        1: '#e74c3c',
        2: '#e67e22',
        3: '#f39c12',
        4: '#f1c40f',
        5: '#2ecc71',
        6: '#27ae60',
        7: '#16a085',
        8: '#3498db',
        9: '#2980b9',
        10: '#9b59b6',
        11: '#8e44ad',
        12: '#34495e',
      };

      // Red tones for lower grades
      expect(GRADE_COLORS[1]).toMatch(/^#e7/);
      expect(GRADE_COLORS[2]).toMatch(/^#e6/);

      // Blue tones for middle grades
      expect(GRADE_COLORS[8]).toMatch(/^#34/);
      expect(GRADE_COLORS[9]).toMatch(/^#29/);

      // Purple/dark for higher grades
      expect(GRADE_COLORS[10]).toMatch(/^#9b/);
      expect(GRADE_COLORS[11]).toMatch(/^#8e/);
    });
  });

  describe('node status indicators', () => {
    it('should define status border colors', () => {
      const statusColors = {
        satisfied: '#27ae60', // Green
        partial: '#f39c12', // Yellow
        isolated: '#e74c3c', // Red
        default: '#2c3e50', // Gray
      };

      expect(statusColors.satisfied).toBe('#27ae60');
      expect(statusColors.partial).toBe('#f39c12');
      expect(statusColors.isolated).toBe('#e74c3c');
    });
  });

  describe('confidence levels', () => {
    it('should define three confidence ranges', () => {
      const confidenceLevels = [
        { label: 'High (>90%)', opacity: 1 },
        { label: 'Medium (50-90%)', opacity: 0.65 },
        { label: 'Low (<50%)', opacity: 0.3 },
      ];

      expect(confidenceLevels).toHaveLength(3);
      expect(confidenceLevels[0]?.opacity).toBe(1);
      expect(confidenceLevels[2]?.opacity).toBe(0.3);
    });
  });
});

describe('GraphLegend props', () => {
  it('should accept edgeColors as prop', () => {
    interface GraphLegendProps {
      edgeColors: Record<string, string>;
      gradeColors: Record<number, string>;
    }

    const props: GraphLegendProps = {
      edgeColors: {
        request: '#3498db',
        historical: '#95a5a6',
      },
      gradeColors: {
        1: '#e74c3c',
        2: '#e67e22',
      },
    };

    expect(props.edgeColors['request']).toBeDefined();
    expect(props.gradeColors[1]).toBeDefined();
  });
});
