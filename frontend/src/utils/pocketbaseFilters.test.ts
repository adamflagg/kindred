import { describe, it, expect } from 'vitest';
import { 
  formatFilter, 
  buildFilter, 
  createExclusionFilter, 
  createInclusionFilter 
} from './pocketbaseFilters';

describe('pocketbaseFilters', () => {
  describe('formatFilter', () => {
    it('should add spaces around != operator', () => {
      expect(formatFilter('session_type!="family"')).toBe('session_type != "family"');
      expect(formatFilter('type!="test"')).toBe('type != "test"');
    });

    it('should add spaces around = operator', () => {
      expect(formatFilter('year=2025')).toBe('year = 2025');
      expect(formatFilter('status="active"')).toBe('status = "active"');
    });

    it('should add spaces around comparison operators', () => {
      expect(formatFilter('age>18')).toBe('age > 18');
      expect(formatFilter('age<65')).toBe('age < 65');
      expect(formatFilter('count>=10')).toBe('count >= 10');
      expect(formatFilter('count<=100')).toBe('count <= 100');
    });

    it('should add spaces around logical operators', () => {
      expect(formatFilter('a=1&&b=2')).toBe('a = 1 && b = 2');
      expect(formatFilter('x=1||y=2')).toBe('x = 1 || y = 2');
    });

    it('should handle complex filters', () => {
      const input = '(session_type!="family"&&session_type!="taste")&&year=2025';
      const expected = '(session_type != "family" && session_type != "taste") && year = 2025';
      expect(formatFilter(input)).toBe(expected);
    });

    it('should clean up multiple spaces', () => {
      expect(formatFilter('a   =   1    &&    b   =   2')).toBe('a = 1 && b = 2');
    });

    it('should handle empty or null filters', () => {
      expect(formatFilter('')).toBe('');
      expect(formatFilter(null as unknown as string)).toBe(null);
      expect(formatFilter(undefined as unknown as string)).toBe(undefined);
    });
  });

  describe('buildFilter', () => {
    it('should join conditions with AND by default', () => {
      const conditions = ['session_type = "main"', 'year = 2025'];
      expect(buildFilter(conditions)).toBe('(session_type = "main" && year = 2025)');
    });

    it('should join conditions with OR when specified', () => {
      const conditions = ['status = "active"', 'status = "pending"'];
      expect(buildFilter(conditions, '||')).toBe('(status = "active" || status = "pending")');
    });

    it('should format conditions before joining', () => {
      const conditions = ['type="test"', 'year=2025'];
      expect(buildFilter(conditions)).toBe('(type = "test" && year = 2025)');
    });

    it('should handle single condition without parentheses', () => {
      expect(buildFilter(['status = "active"'])).toBe('status = "active"');
    });

    it('should handle empty conditions', () => {
      expect(buildFilter([])).toBe('');
      expect(buildFilter(null as unknown as string[])).toBe('');
    });

    it('should filter out empty conditions', () => {
      const conditions = ['status = "active"', '', '  ', 'year = 2025'];
      expect(buildFilter(conditions)).toBe('(status = "active" && year = 2025)');
    });
  });

  describe('createExclusionFilter', () => {
    it('should create filter excluding single value', () => {
      expect(createExclusionFilter('type', ['family'])).toBe('type != "family"');
    });

    it('should create filter excluding multiple values', () => {
      expect(createExclusionFilter('session_type', ['family', 'taste']))
        .toBe('(session_type != "family" && session_type != "taste")');
    });

    it('should handle empty values', () => {
      expect(createExclusionFilter('type', [])).toBe('');
    });
  });

  describe('createInclusionFilter', () => {
    it('should create filter including single value', () => {
      expect(createInclusionFilter('type', ['main'])).toBe('type = "main"');
    });

    it('should create filter including multiple values', () => {
      expect(createInclusionFilter('session_type', ['main', 'taste']))
        .toBe('(session_type = "main" || session_type = "taste")');
    });

    it('should handle empty values', () => {
      expect(createInclusionFilter('type', [])).toBe('');
    });
  });
});