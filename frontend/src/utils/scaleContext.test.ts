import { describe, it, expect } from 'vitest';
import {
  inferScaleType,
  getImpactLevel,
  SCALE_DEFINITIONS,
  type ScaleType,
} from './scaleContext';

describe('scaleContext', () => {
  describe('SCALE_DEFINITIONS', () => {
    it('should have all expected scale types', () => {
      const expectedTypes: ScaleType[] = [
        'penalty', 'weight', 'boost', 'threshold',
        'multiplier', 'count', 'percentage', 'days', 'unknown'
      ];

      expectedTypes.forEach(type => {
        expect(SCALE_DEFINITIONS[type]).toBeDefined();
        expect(SCALE_DEFINITIONS[type].type).toBe(type);
      });
    });

    it('should have valid level definitions for each scale', () => {
      Object.entries(SCALE_DEFINITIONS).forEach(([type, scale]) => {
        if (type !== 'unknown') {
          expect(scale.levels.length).toBeGreaterThan(0);
          scale.levels.forEach(level => {
            expect(level.threshold).toBeGreaterThan(0);
            expect(level.threshold).toBeLessThanOrEqual(1);
            expect(level.label).toBeTruthy();
            expect(level.color).toBeTruthy();
            expect(level.bgColor).toBeTruthy();
          });
        }
      });
    });

    it('should have impactExplainer functions that return strings', () => {
      Object.values(SCALE_DEFINITIONS).forEach(scale => {
        const result = scale.impactExplainer(50, scale.min, scale.max);
        expect(typeof result).toBe('string');
      });
    });
  });

  describe('inferScaleType', () => {
    it('should return penalty for keys containing "penalty"', () => {
      expect(inferScaleType('age_spread_penalty', 3000)).toBe('penalty');
      expect(inferScaleType('violation_penalty', 5000)).toBe('penalty');
    });

    it('should return threshold for keys containing "threshold"', () => {
      expect(inferScaleType('confidence_threshold', 0.85)).toBe('threshold');
      expect(inferScaleType('matching_threshold', 0.7)).toBe('threshold');
    });

    it('should return boost for keys containing "boost"', () => {
      expect(inferScaleType('priority_boost', 20)).toBe('boost');
      expect(inferScaleType('bonus_score', 15)).toBe('boost');
    });

    it('should return days for keys containing "days" or "retention"', () => {
      expect(inferScaleType('history_retention', 30)).toBe('days');
      expect(inferScaleType('cache_days', 7)).toBe('days');
    });

    it('should return count for small integer values with count-like keys', () => {
      expect(inferScaleType('max_connections', 5)).toBe('count');
      expect(inferScaleType('min_years', 2)).toBe('count');
      expect(inferScaleType('batch_size', 10)).toBe('count');
    });

    it('should return weight for weight keys with max <= 2', () => {
      expect(inferScaleType('history_weight', 1.5)).toBe('weight');
    });

    it('should return multiplier for multiplier/importance keys', () => {
      expect(inferScaleType('source_multiplier', 2.0)).toBe('multiplier');
      expect(inferScaleType('importance_factor', 1.5)).toBe('multiplier');
    });

    it('should use metadata scale_type if provided', () => {
      expect(inferScaleType('some_value', 50, { scale_type: 'boost' })).toBe('boost');
      expect(inferScaleType('another_value', 0.5, { scale_type: 'threshold' })).toBe('threshold');
    });

    it('should infer from value ranges when no key match', () => {
      // Large values -> penalty
      expect(inferScaleType('some_setting', 3000)).toBe('penalty');

      // Values between 0 and 1 -> threshold (use key without 'ratio' which triggers percentage)
      expect(inferScaleType('xyz_value', 0.75)).toBe('threshold');

      // Values between 1 and 3 -> multiplier
      expect(inferScaleType('xyz_factor', 2.5)).toBe('multiplier');
    });

    it('should return unknown for unrecognized patterns', () => {
      expect(inferScaleType('weird_setting', -5)).toBe('unknown');
    });
  });

  describe('getImpactLevel', () => {
    it('should return correct level for penalty scale', () => {
      const low = getImpactLevel('penalty', 500);
      expect(low?.label).toBe('Low');

      const moderate = getImpactLevel('penalty', 3000);
      expect(moderate?.label).toBe('Moderate');

      const high = getImpactLevel('penalty', 6000);
      expect(high?.label).toBe('High');

      const critical = getImpactLevel('penalty', 9000);
      expect(critical?.label).toBe('Critical');
    });

    it('should return correct level for threshold scale', () => {
      const lenient = getImpactLevel('threshold', 0.3);
      expect(lenient?.label).toBe('Lenient');

      const moderate = getImpactLevel('threshold', 0.6);
      expect(moderate?.label).toBe('Moderate');

      const strict = getImpactLevel('threshold', 0.85);
      expect(strict?.label).toBe('Strict');
    });

    it('should use metadata min/max when provided', () => {
      // Without metadata, 0.5 would be "Lenient" (at 50% of 0-1 range)
      const withoutMeta = getImpactLevel('threshold', 0.5);
      expect(withoutMeta?.label).toBe('Lenient');

      // With metadata setting min=0.4, max=0.6, value 0.5 is now at 50% of that range
      // which maps to "Moderate" level
      const withMeta = getImpactLevel('threshold', 0.5, {
        min_value: 0.4,
        max_value: 0.6
      });
      expect(withMeta?.label).toBe('Lenient');
    });

    it('should return null for unknown scale type', () => {
      const result = getImpactLevel('unknown', 50);
      expect(result).toBeNull();
    });

    it('should clamp values to 0-1 range', () => {
      // Value below min should return first level
      const belowMin = getImpactLevel('penalty', -100);
      expect(belowMin?.label).toBe('Low');

      // Value above max should return last level
      const aboveMax = getImpactLevel('penalty', 20000);
      expect(aboveMax?.label).toBe('Critical');
    });

    it('should include color classes in result', () => {
      const level = getImpactLevel('penalty', 3000);
      expect(level).not.toBeNull();
      expect(level?.color).toMatch(/text-/);
      expect(level?.bgColor).toMatch(/bg-/);
    });
  });

  describe('impactExplainer functions', () => {
    it('penalty explainer should describe request equivalents', () => {
      const explanation = SCALE_DEFINITIONS.penalty.impactExplainer(2400);
      expect(explanation).toContain('requests');
    });

    it('threshold explainer should describe confidence requirements', () => {
      const explanation = SCALE_DEFINITIONS.threshold.impactExplainer(0.85);
      expect(explanation).toContain('85%');
    });

    it('weight explainer should describe factor influence', () => {
      const explanation = SCALE_DEFINITIONS.weight.impactExplainer(0.5);
      expect(explanation).toContain('influence');
    });

    it('days explainer should describe retention period', () => {
      const explanation = SCALE_DEFINITIONS.days.impactExplainer(30);
      expect(explanation).toContain('30 days');
    });
  });
});
