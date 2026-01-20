import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { shouldAutoReload, autoReload, AUTO_RELOAD_KEY, RELOAD_COOLDOWN_MS } from './autoReload';

describe('autoReload utility', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();

    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: vi.fn() },
      writable: true,
    });
  });

  afterEach(() => {
    // Restore original location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  describe('shouldAutoReload', () => {
    it('returns true when no previous reload timestamp exists', () => {
      expect(shouldAutoReload()).toBe(true);
    });

    it('returns false when reload happened within cooldown period', () => {
      // Simulate a reload that just happened
      sessionStorage.setItem(AUTO_RELOAD_KEY, Date.now().toString());

      expect(shouldAutoReload()).toBe(false);
    });

    it('returns true when reload happened before cooldown period', () => {
      // Simulate a reload that happened 11 seconds ago (beyond 10s cooldown)
      const oldTimestamp = Date.now() - RELOAD_COOLDOWN_MS - 1000;
      sessionStorage.setItem(AUTO_RELOAD_KEY, oldTimestamp.toString());

      expect(shouldAutoReload()).toBe(true);
    });

    it('returns true when reload happened exactly at cooldown boundary', () => {
      // Simulate a reload that happened exactly at the cooldown boundary
      const boundaryTimestamp = Date.now() - RELOAD_COOLDOWN_MS - 1;
      sessionStorage.setItem(AUTO_RELOAD_KEY, boundaryTimestamp.toString());

      expect(shouldAutoReload()).toBe(true);
    });

    it('returns false when reload happened just inside cooldown', () => {
      // Simulate a reload that happened just inside the cooldown
      const insideTimestamp = Date.now() - RELOAD_COOLDOWN_MS + 1000;
      sessionStorage.setItem(AUTO_RELOAD_KEY, insideTimestamp.toString());

      expect(shouldAutoReload()).toBe(false);
    });
  });

  describe('autoReload', () => {
    it('sets timestamp in sessionStorage before reloading', () => {
      const beforeCall = Date.now();
      autoReload();
      const afterCall = Date.now();

      const storedTimestamp = sessionStorage.getItem(AUTO_RELOAD_KEY);
      expect(storedTimestamp).toBeTruthy();

      const timestamp = parseInt(storedTimestamp!, 10);
      expect(timestamp).toBeGreaterThanOrEqual(beforeCall);
      expect(timestamp).toBeLessThanOrEqual(afterCall);
    });

    it('calls window.location.reload', () => {
      autoReload();
      expect(window.location.reload).toHaveBeenCalledTimes(1);
    });

    it('sets timestamp before calling reload', () => {
      // Verify the order: timestamp is set, then reload is called
      let timestampWhenReloadCalled: string | null = null;

      vi.mocked(window.location.reload).mockImplementation(() => {
        timestampWhenReloadCalled = sessionStorage.getItem(AUTO_RELOAD_KEY);
      });

      autoReload();

      expect(timestampWhenReloadCalled).toBeTruthy();
    });
  });

  describe('constants', () => {
    it('exports AUTO_RELOAD_KEY constant', () => {
      expect(AUTO_RELOAD_KEY).toBe('kindred_auto_reload_timestamp');
    });

    it('exports RELOAD_COOLDOWN_MS constant with 10 second value', () => {
      expect(RELOAD_COOLDOWN_MS).toBe(10000);
    });
  });
});
