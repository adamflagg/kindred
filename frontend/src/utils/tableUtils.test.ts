/**
 * Tests for table utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  getGridColumns,
  getCellAlignment,
  getSortIndicator,
  getVirtualRowStyles,
  getBadgeClasses,
  columnWidths,
  type TableColumn,
} from './tableUtils';

describe('getGridColumns', () => {
  it('should generate grid template columns string', () => {
    const columns: TableColumn<unknown>[] = [
      { key: 'name', header: 'Name', width: '200px' },
      { key: 'age', header: 'Age', width: '100px' },
      { key: 'status', header: 'Status', width: '150px' },
    ];
    expect(getGridColumns(columns)).toBe('200px 100px 150px');
  });

  it('should handle empty columns array', () => {
    expect(getGridColumns([])).toBe('');
  });

  it('should handle minmax widths', () => {
    const columns: TableColumn<unknown>[] = [
      { key: 'name', header: 'Name', width: 'minmax(180px,2fr)' },
      { key: 'desc', header: 'Description', width: 'minmax(200px,3fr)' },
    ];
    expect(getGridColumns(columns)).toBe('minmax(180px,2fr) minmax(200px,3fr)');
  });
});

describe('getCellAlignment', () => {
  it('should return left alignment by default', () => {
    expect(getCellAlignment()).toBe('flex items-center');
    expect(getCellAlignment('left')).toBe('flex items-center');
  });

  it('should return center alignment', () => {
    expect(getCellAlignment('center')).toBe('flex items-center justify-center');
  });

  it('should return right alignment', () => {
    expect(getCellAlignment('right')).toBe('flex items-center justify-end');
  });
});

describe('getSortIndicator', () => {
  it('should return up arrow for ascending sort', () => {
    expect(getSortIndicator('name', 'asc', 'name')).toBe('↑');
  });

  it('should return down arrow for descending sort', () => {
    expect(getSortIndicator('name', 'desc', 'name')).toBe('↓');
  });

  it('should return empty string when column is not sorted', () => {
    expect(getSortIndicator('name', 'asc', 'age')).toBe('');
    expect(getSortIndicator('status', 'desc', 'name')).toBe('');
  });
});

describe('getVirtualRowStyles', () => {
  it('should generate row styles with correct transform', () => {
    const virtualItem = { start: 100 };
    const result = getVirtualRowStyles(virtualItem);

    expect(result.style.transform).toBe('translateY(100px)');
    expect(result.style.position).toBe('absolute');
    expect(result.style.width).toBe('100%');
  });

  it('should include hover class by default', () => {
    const result = getVirtualRowStyles({ start: 0 });
    expect(result.className).toContain('hover:bg-muted/50');
  });

  it('should exclude hover class when disabled', () => {
    const result = getVirtualRowStyles({ start: 0 }, false);
    expect(result.className).not.toContain('hover:bg-muted/50');
  });

  it('should include border pseudo-element', () => {
    const result = getVirtualRowStyles({ start: 0 });
    expect(result.className).toContain('after:');
  });
});

describe('getBadgeClasses', () => {
  it('should return default classes with no options', () => {
    const classes = getBadgeClasses();
    expect(classes).toContain('rounded-full');
    expect(classes).toContain('inline-flex');
  });

  it('should apply size classes', () => {
    expect(getBadgeClasses({ size: 'xs' })).toContain('text-xs');
    expect(getBadgeClasses({ size: 'sm' })).toContain('text-xs');
    expect(getBadgeClasses({ size: 'md' })).toContain('text-sm');
  });

  it('should apply variant classes', () => {
    expect(getBadgeClasses({ variant: 'success' })).toContain('bg-green-100');
    expect(getBadgeClasses({ variant: 'warning' })).toContain('bg-yellow-100');
    expect(getBadgeClasses({ variant: 'danger' })).toContain('bg-red-100');
    expect(getBadgeClasses({ variant: 'info' })).toContain('bg-blue-100');
    expect(getBadgeClasses({ variant: 'primary' })).toContain('bg-primary/10');
  });

  it('should combine size and variant', () => {
    const classes = getBadgeClasses({ size: 'md', variant: 'success' });
    expect(classes).toContain('text-sm');
    expect(classes).toContain('bg-green-100');
  });
});

describe('columnWidths', () => {
  it('should have expected width constants', () => {
    expect(columnWidths.checkbox).toBe('40px');
    expect(columnWidths.icon).toBe('50px');
    expect(columnWidths.name).toBe('minmax(180px,2fr)');
    expect(columnWidths.age).toBe('minmax(60px,80px)');
    expect(columnWidths.grade).toBe('minmax(60px,80px)');
  });

  it('should have all expected keys', () => {
    const expectedKeys = [
      'checkbox',
      'icon',
      'name',
      'description',
      'age',
      'grade',
      'count',
      'status',
      'badge',
      'type',
      'gender',
      'genderIdentity',
      'session',
      'bunk',
      'actions',
      'priority',
      'confidence',
    ];
    for (const key of expectedKeys) {
      expect(columnWidths).toHaveProperty(key);
    }
  });
});
