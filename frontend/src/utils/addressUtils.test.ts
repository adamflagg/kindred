/**
 * Tests for address utility functions
 */
import { describe, it, expect } from 'vitest';
import { getLocationDisplay } from './addressUtils';

describe('getLocationDisplay', () => {
  it('should return null for null/undefined input', () => {
    expect(getLocationDisplay(null)).toBe(null);
    expect(getLocationDisplay(undefined)).toBe(null);
  });

  it('should return null for empty string', () => {
    expect(getLocationDisplay('')).toBe(null);
  });

  it('should parse JSON string with city and state', () => {
    const json = JSON.stringify({ city: 'San Francisco', state: 'CA' });
    expect(getLocationDisplay(json)).toBe('San Francisco, CA');
  });

  it('should handle object input with city and state', () => {
    const addr = { city: 'Oakland', state: 'CA' };
    expect(getLocationDisplay(addr)).toBe('Oakland, CA');
  });

  it('should handle city only', () => {
    const addr = { city: 'Berkeley' };
    expect(getLocationDisplay(addr)).toBe('Berkeley');
  });

  it('should handle state only', () => {
    const addr = { state: 'CA' };
    expect(getLocationDisplay(addr)).toBe('CA');
  });

  it('should return null for empty object', () => {
    expect(getLocationDisplay({})).toBe(null);
  });

  it('should return null for invalid JSON string', () => {
    expect(getLocationDisplay('not valid json')).toBe(null);
  });

  it('should return null for JSON without city/state', () => {
    const json = JSON.stringify({ street: '123 Main St', zip: '94102' });
    expect(getLocationDisplay(json)).toBe(null);
  });

  it('should handle whitespace in values', () => {
    const addr = { city: 'Los Angeles', state: 'California' };
    expect(getLocationDisplay(addr)).toBe('Los Angeles, California');
  });
});
