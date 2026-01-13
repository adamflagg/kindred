/**
 * Tests for avatar utility functions
 */
import { describe, it, expect } from 'vitest';
import { getAvatarColor, getInitial } from './avatarUtils';

describe('getAvatarColor', () => {
  it('should return sky-500 for male', () => {
    expect(getAvatarColor('M')).toBe('bg-sky-500');
  });

  it('should return pink-500 for female', () => {
    expect(getAvatarColor('F')).toBe('bg-pink-500');
  });

  it('should return purple-500 for undefined', () => {
    expect(getAvatarColor(undefined)).toBe('bg-purple-500');
  });

  it('should return purple-500 for other values', () => {
    expect(getAvatarColor('NB')).toBe('bg-purple-500');
    expect(getAvatarColor('')).toBe('bg-purple-500');
    expect(getAvatarColor('X')).toBe('bg-purple-500');
  });
});

describe('getInitial', () => {
  it('should return the first letter uppercase', () => {
    expect(getInitial('Alice')).toBe('A');
    expect(getInitial('bob')).toBe('B');
    expect(getInitial('Charlie')).toBe('C');
  });

  it('should return "?" for undefined', () => {
    expect(getInitial(undefined)).toBe('?');
  });

  it('should return "?" for empty string', () => {
    expect(getInitial('')).toBe('?');
  });

  it('should handle single character names', () => {
    expect(getInitial('Z')).toBe('Z');
    expect(getInitial('a')).toBe('A');
  });
});
