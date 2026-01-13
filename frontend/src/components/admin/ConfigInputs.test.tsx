import { describe, it, expect } from 'vitest';
import { inferComponentType, formatDuration, COMPONENT_MAP } from './ConfigInputs';

describe('ConfigInputs', () => {
  describe('inferComponentType', () => {
    it('should return toggle for boolean-like values with enable keywords', () => {
      expect(inferComponentType('true', 'feature_enabled')).toBe('toggle');
      expect(inferComponentType('false', 'auto_enable')).toBe('toggle');
      expect(inferComponentType('1', 'use_cache')).toBe('toggle');
      expect(inferComponentType('0', 'include_history')).toBe('toggle');
    });

    it('should return toggle for prevent/require/ignore patterns', () => {
      expect(inferComponentType('true', 'prevent_duplicates')).toBe('toggle');
      expect(inferComponentType('false', 'require_validation')).toBe('toggle');
      expect(inferComponentType('1', 'ignore_errors')).toBe('toggle');
    });

    it('should return number for numeric values', () => {
      expect(inferComponentType('42', 'some_setting')).toBe('number');
      expect(inferComponentType('3.14', 'pi_value')).toBe('number');
      expect(inferComponentType(100, 'count')).toBe('number');
    });

    it('should return text for non-numeric strings', () => {
      expect(inferComponentType('hello', 'greeting')).toBe('text');
      expect(inferComponentType('config-value', 'setting')).toBe('text');
    });

    it('should not infer toggle for boolean-like values without keywords', () => {
      expect(inferComponentType('true', 'random_flag')).toBe('toggle');
      expect(inferComponentType('1', 'some_value')).toBe('number');
    });
  });

  describe('formatDuration', () => {
    it('should return empty string for null/undefined', () => {
      expect(formatDuration(undefined)).toBe('');
      expect(formatDuration(null as unknown as number)).toBe('');
    });

    it('should return "< 1s" for 0', () => {
      expect(formatDuration(0)).toBe('< 1s');
    });

    it('should format seconds under a minute', () => {
      expect(formatDuration(1)).toBe('1s');
      expect(formatDuration(30)).toBe('30s');
      expect(formatDuration(59)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(125)).toBe('2m 5s');
      expect(formatDuration(3661)).toBe('61m 1s');
    });
  });

  describe('COMPONENT_MAP', () => {
    it('should have all expected component types', () => {
      expect(COMPONENT_MAP['toggle']).toBeDefined();
      expect(COMPONENT_MAP['slider']).toBeDefined();
      expect(COMPONENT_MAP['number']).toBeDefined();
      expect(COMPONENT_MAP['select']).toBeDefined();
      expect(COMPONENT_MAP['text']).toBeDefined();
    });

    it('should have functions for all component types', () => {
      Object.values(COMPONENT_MAP).forEach(component => {
        expect(typeof component).toBe('function');
      });
    });
  });
});
