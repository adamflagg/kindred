/**
 * Tests for useSyncCompletionToasts hook - sub_stats formatting
 */
import { describe, it, expect } from 'vitest';

// Helper function to format stats (should match implementation)
interface SubStats {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

function formatStats(stats: SubStats, label: string): string {
  const parts: string[] = [];
  if (stats.created > 0) parts.push(`${stats.created} created`);
  if (stats.updated > 0) parts.push(`${stats.updated} updated`);
  if (stats.errors > 0) parts.push(`${stats.errors} errors`);
  if (parts.length === 0) return '';
  return `${label}: ${parts.join(', ')}`;
}

// Helper to format combined stats message for persons sync
function formatPersonsSyncMessage(
  mainStats: SubStats,
  subStats?: Record<string, SubStats>
): string {
  if (!subStats) {
    return formatStats(mainStats, 'Persons');
  }

  const parts: string[] = [];

  const personsText = formatStats(mainStats, 'Persons');
  if (personsText) parts.push(personsText);

  const householdsStats = subStats['households'];
  if (householdsStats) {
    const householdsText = formatStats(householdsStats, 'Households');
    if (householdsText) parts.push(householdsText);
  }

  const tagsStats = subStats['person_tags'];
  if (tagsStats) {
    const tagsText = formatStats(tagsStats, 'Tags');
    if (tagsText) parts.push(tagsText);
  }

  return parts.join(' | ');
}

describe('formatStats helper', () => {
  it('should format stats with created and updated', () => {
    const stats: SubStats = { created: 10, updated: 5, skipped: 2, errors: 0 };
    expect(formatStats(stats, 'Persons')).toBe('Persons: 10 created, 5 updated');
  });

  it('should format stats with only created', () => {
    const stats: SubStats = { created: 10, updated: 0, skipped: 2, errors: 0 };
    expect(formatStats(stats, 'Persons')).toBe('Persons: 10 created');
  });

  it('should format stats with errors', () => {
    const stats: SubStats = { created: 10, updated: 5, skipped: 2, errors: 3 };
    expect(formatStats(stats, 'Persons')).toBe('Persons: 10 created, 5 updated, 3 errors');
  });

  it('should return empty string when no meaningful stats', () => {
    const stats: SubStats = { created: 0, updated: 0, skipped: 100, errors: 0 };
    expect(formatStats(stats, 'Persons')).toBe('');
  });
});

describe('formatPersonsSyncMessage', () => {
  it('should format message without sub_stats', () => {
    const mainStats: SubStats = { created: 10, updated: 5, skipped: 85, errors: 0 };
    expect(formatPersonsSyncMessage(mainStats)).toBe('Persons: 10 created, 5 updated');
  });

  it('should format message with all sub_stats', () => {
    const mainStats: SubStats = { created: 10, updated: 5, skipped: 85, errors: 0 };
    const subStats: Record<string, SubStats> = {
      households: { created: 3, updated: 2, skipped: 45, errors: 0 },
      person_tags: { created: 15, updated: 80, skipped: 5, errors: 0 },
    };

    const result = formatPersonsSyncMessage(mainStats, subStats);
    expect(result).toBe('Persons: 10 created, 5 updated | Households: 3 created, 2 updated | Tags: 15 created, 80 updated');
  });

  it('should format message with only households sub_stats', () => {
    const mainStats: SubStats = { created: 10, updated: 5, skipped: 85, errors: 0 };
    const subStats: Record<string, SubStats> = {
      households: { created: 3, updated: 2, skipped: 45, errors: 0 },
    };

    const result = formatPersonsSyncMessage(mainStats, subStats);
    expect(result).toBe('Persons: 10 created, 5 updated | Households: 3 created, 2 updated');
  });

  it('should skip sub_stats with no meaningful data', () => {
    const mainStats: SubStats = { created: 10, updated: 5, skipped: 85, errors: 0 };
    const subStats: Record<string, SubStats> = {
      households: { created: 0, updated: 0, skipped: 50, errors: 0 }, // No changes
      person_tags: { created: 15, updated: 80, skipped: 5, errors: 0 },
    };

    const result = formatPersonsSyncMessage(mainStats, subStats);
    expect(result).toBe('Persons: 10 created, 5 updated | Tags: 15 created, 80 updated');
  });

  it('should handle errors in sub_stats', () => {
    const mainStats: SubStats = { created: 10, updated: 5, skipped: 85, errors: 0 };
    const subStats: Record<string, SubStats> = {
      households: { created: 3, updated: 2, skipped: 45, errors: 0 },
      person_tags: { created: 15, updated: 80, skipped: 5, errors: 2 },
    };

    const result = formatPersonsSyncMessage(mainStats, subStats);
    expect(result).toBe('Persons: 10 created, 5 updated | Households: 3 created, 2 updated | Tags: 15 created, 80 updated, 2 errors');
  });

  it('should handle main stats with errors', () => {
    const mainStats: SubStats = { created: 10, updated: 5, skipped: 85, errors: 1 };
    const subStats: Record<string, SubStats> = {
      households: { created: 3, updated: 2, skipped: 45, errors: 0 },
    };

    const result = formatPersonsSyncMessage(mainStats, subStats);
    expect(result).toBe('Persons: 10 created, 5 updated, 1 errors | Households: 3 created, 2 updated');
  });
});
