/**
 * Scale Context System
 * Provides meaningful context for abstract numeric configuration values
 */

export type ScaleType = 'penalty' | 'weight' | 'boost' | 'threshold' | 'multiplier' | 'count' | 'percentage' | 'days' | 'unknown';

interface ScaleLevel {
  threshold: number;
  label: string;
  color: string;
  bgColor: string;
}

export interface ScaleDefinition {
  type: ScaleType;
  min: number;
  max: number;
  unit: string;
  levels: ScaleLevel[];
  description: string;
  impactExplainer: (value: number, min?: number, max?: number) => string;
}

export const SCALE_DEFINITIONS: Record<ScaleType, ScaleDefinition> = {
  penalty: {
    type: 'penalty',
    min: 0,
    max: 10000,
    unit: 'pts',
    levels: [
      { threshold: 0.15, label: 'Low', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 0.4, label: 'Moderate', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
      { threshold: 0.7, label: 'High', color: 'text-orange-700 dark:text-orange-300', bgColor: 'bg-orange-100 dark:bg-orange-900/50' },
      { threshold: 1, label: 'Critical', color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/50' },
    ],
    description: 'Penalties are costs subtracted from the optimizer\'s score. One satisfied request ~ 800-1500 pts, so a penalty of 3000 costs about 3-4 requests worth.',
    impactExplainer: (v) => {
      const requestsEquiv = Math.round(v / 800);
      if (v < 1000) return `Worth ~${requestsEquiv} request${requestsEquiv !== 1 ? 's' : ''}. Optimizer may allow this violation to satisfy more requests.`;
      if (v < 3000) return `Worth ~${requestsEquiv} requests. Moderately enforced-violations only when clearly beneficial.`;
      if (v < 6000) return `Worth ~${requestsEquiv} requests. Strictly enforced-optimizer avoids unless absolutely necessary.`;
      return `Worth ~${requestsEquiv}+ requests. Critical rule-optimizer will sacrifice many requests to avoid this.`;
    }
  },
  weight: {
    type: 'weight',
    min: 0,
    max: 2,
    unit: 'x',
    levels: [
      { threshold: 0.3, label: 'Minor', color: 'text-slate-600 dark:text-slate-300', bgColor: 'bg-slate-100 dark:bg-slate-800' },
      { threshold: 0.6, label: 'Standard', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 0.85, label: 'Important', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
      { threshold: 1, label: 'Priority', color: 'text-forest-700 dark:text-forest-300', bgColor: 'bg-forest-100 dark:bg-forest-900/50' },
    ],
    description: 'Score weights (0-2) multiply how much a factor contributes. 1.0 = normal, 0.5 = half importance, 2.0 = double.',
    impactExplainer: (v) => {
      if (v < 0.3) return 'This factor has minimal influence on decisions.';
      if (v < 0.7) return 'This factor has moderate influence, typical for supporting criteria.';
      if (v < 1.2) return 'This factor is weighted at full importance.';
      return 'This factor has elevated importance and will strongly influence outcomes.';
    }
  },
  boost: {
    type: 'boost',
    min: 0,
    max: 100,
    unit: 'pts',
    levels: [
      { threshold: 0.2, label: 'Small', color: 'text-slate-600 dark:text-slate-300', bgColor: 'bg-slate-100 dark:bg-slate-800' },
      { threshold: 0.4, label: 'Medium', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 0.7, label: 'Large', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
      { threshold: 1, label: 'Major', color: 'text-forest-700 dark:text-forest-300', bgColor: 'bg-forest-100 dark:bg-forest-900/50' },
    ],
    description: 'Score boosts (0-100) add bonus points to scores. Think of them as "priority bumps" for special cases.',
    impactExplainer: (v) => {
      if (v < 10) return 'A small nudge that may tip close decisions.';
      if (v < 30) return 'A noticeable advantage that helps prioritize this case.';
      if (v < 60) return 'A significant bonus that makes this case stand out.';
      return 'A major priority boost that strongly favors this case.';
    }
  },
  threshold: {
    type: 'threshold',
    min: 0,
    max: 1,
    unit: '%',
    levels: [
      { threshold: 0.5, label: 'Lenient', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 0.75, label: 'Moderate', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
      { threshold: 0.9, label: 'Strict', color: 'text-orange-700 dark:text-orange-300', bgColor: 'bg-orange-100 dark:bg-orange-900/50' },
      { threshold: 1, label: 'Very Strict', color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/50' },
    ],
    description: 'Confidence thresholds (0-100%) set the bar for automatic decisions. Higher = more certain before acting.',
    impactExplainer: (v, min = 0, max = 1) => {
      const pct = Math.round(v * 100);
      const normalized = (v - min) / (max - min);
      if (normalized < 0.5) return `System accepts decisions when ${pct}%+ confident. Many cases will pass automatically.`;
      if (normalized < 0.75) return `System requires ${pct}%+ confidence. Most clear cases pass, ambiguous ones need review.`;
      if (normalized < 0.9) return `System requires ${pct}%+ confidence. Only high-quality matches pass automatically.`;
      return `System requires ${pct}%+ confidence. Very strict-most cases need manual review.`;
    }
  },
  multiplier: {
    type: 'multiplier',
    min: 0.5,
    max: 3,
    unit: 'x',
    levels: [
      { threshold: 0.33, label: 'Reduced', color: 'text-slate-600 dark:text-slate-300', bgColor: 'bg-slate-100 dark:bg-slate-800' },
      { threshold: 0.5, label: 'Normal', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 0.75, label: 'Elevated', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
      { threshold: 1, label: 'High', color: 'text-forest-700 dark:text-forest-300', bgColor: 'bg-forest-100 dark:bg-forest-900/50' },
    ],
    description: 'Importance multipliers (0.5-3x) scale how much weight a source or factor carries. 1x = baseline importance.',
    impactExplainer: (v) => {
      if (v < 0.8) return `This source carries ${Math.round(v * 100)}% of normal weight-less influential.`;
      if (v < 1.2) return `This source carries normal weight in decisions.`;
      if (v < 2) return `This source is ${v.toFixed(1)}x more important than baseline.`;
      return `This source is heavily weighted at ${v.toFixed(1)}x normal importance.`;
    }
  },
  count: {
    type: 'count',
    min: 0,
    max: 10,
    unit: '',
    levels: [
      { threshold: 0.3, label: 'Few', color: 'text-slate-600 dark:text-slate-300', bgColor: 'bg-slate-100 dark:bg-slate-800' },
      { threshold: 0.6, label: 'Some', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 1, label: 'Many', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
    ],
    description: 'A count or quantity setting.',
    impactExplainer: (v) => `Set to ${v}.`
  },
  percentage: {
    type: 'percentage',
    min: 0,
    max: 100,
    unit: '%',
    levels: [
      { threshold: 0.33, label: 'Low', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 0.66, label: 'Medium', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
      { threshold: 1, label: 'High', color: 'text-forest-700 dark:text-forest-300', bgColor: 'bg-forest-100 dark:bg-forest-900/50' },
    ],
    description: 'A percentage value (0-100%).',
    impactExplainer: (v) => `Set to ${Math.round(v)}%.`
  },
  days: {
    type: 'days',
    min: 1,
    max: 365,
    unit: ' days',
    levels: [
      { threshold: 0.1, label: 'Short', color: 'text-sky-700 dark:text-sky-300', bgColor: 'bg-sky-100 dark:bg-sky-900/50' },
      { threshold: 0.3, label: 'Medium', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/50' },
      { threshold: 1, label: 'Long', color: 'text-forest-700 dark:text-forest-300', bgColor: 'bg-forest-100 dark:bg-forest-900/50' },
    ],
    description: 'Duration in days.',
    impactExplainer: (v) => `Data retained for ${v} days.`
  },
  unknown: {
    type: 'unknown',
    min: 0,
    max: 100,
    unit: '',
    levels: [],
    description: '',
    impactExplainer: () => ''
  }
};

/**
 * Infer scale type from config key and value
 */
export function inferScaleType(configKey: string, value: number, metadata?: Record<string, unknown>): ScaleType {
  const key = configKey.toLowerCase();

  // Check metadata first for explicit scale_type
  if (metadata?.['scale_type']) {
    return metadata['scale_type'] as ScaleType;
  }

  // Use metadata max_value for range checks
  const maxVal = (metadata?.['max_value'] as number) ?? value;

  // Infer from key name patterns (order matters - more specific checks first)
  if (key.includes('penalty') || key.includes('violation')) return 'penalty';
  if (key.includes('threshold') || (key.includes('confidence') && maxVal <= 1)) return 'threshold';
  if (key.includes('boost') || key.includes('bonus')) return 'boost';
  if (key.includes('days') || key.includes('retention')) return 'days';
  if (key.includes('percentage') || key.includes('percent') || (key.includes('ratio') && maxVal <= 100)) return 'percentage';
  if (key.includes('years') || key.includes('count') || key.includes('connections') ||
      key.includes('limit') || key.includes('size') ||
      ((key.includes('max') || key.includes('min')) && maxVal <= 50 && Number.isInteger(value))) return 'count';
  if (key.includes('weight') && maxVal <= 2) return 'weight';
  if (key.includes('multiplier') || key.includes('importance') || (key.includes('weight') && maxVal <= 3)) return 'multiplier';

  // Infer from value ranges (fallback when no metadata)
  if (value >= 100 && value <= 10000) return 'penalty';
  if (value > 0 && value <= 1) return 'threshold';
  if (value > 1 && value <= 3) return 'multiplier';
  if (value > 0 && value <= 100 && key.includes('score')) return 'boost';
  if (Number.isInteger(value) && value >= 1 && value <= 20) return 'count';

  return 'unknown';
}

/**
 * Get the impact level for a value within its scale
 */
export function getImpactLevel(
  scaleType: ScaleType,
  value: number,
  metadata?: Record<string, unknown>
): { label: string; color: string; bgColor: string } | null {
  const scale = SCALE_DEFINITIONS[scaleType];
  if (!scale || scale.levels.length === 0) return null;

  const minValue = (metadata?.['min_value'] as number) ?? scale.min;
  const maxValue = (metadata?.['max_value'] as number) ?? scale.max;

  const normalizedValue = (value - minValue) / (maxValue - minValue);
  const clampedValue = Math.max(0, Math.min(1, normalizedValue));

  for (const level of scale.levels) {
    if (clampedValue <= level.threshold) {
      return level;
    }
  }
  return scale.levels[scale.levels.length - 1] ?? null;
}
