/**
 * Auto-reload utility for handling stale deployment chunk errors.
 *
 * When a new deployment removes old chunk files, inactive browser tabs
 * may fail to load those chunks. This utility provides automatic reload
 * with loop prevention to avoid infinite refresh cycles.
 */

/** Session storage key for tracking reload timestamps */
export const AUTO_RELOAD_KEY = 'kindred_auto_reload_timestamp';

/** Cooldown period in milliseconds (10 seconds) */
export const RELOAD_COOLDOWN_MS = 10000;

/**
 * Check if enough time has passed since the last auto-reload.
 *
 * Prevents infinite reload loops by enforcing a cooldown period.
 * Each browser tab has independent cooldown tracking via sessionStorage.
 *
 * @returns true if auto-reload is allowed, false if within cooldown
 */
export function shouldAutoReload(): boolean {
  const lastReload = sessionStorage.getItem(AUTO_RELOAD_KEY);
  if (!lastReload) {
    return true;
  }

  const elapsed = Date.now() - parseInt(lastReload, 10);
  return elapsed > RELOAD_COOLDOWN_MS;
}

/**
 * Trigger an auto-reload with timestamp tracking.
 *
 * Records the current timestamp in sessionStorage before reloading,
 * enabling loop prevention on the next load.
 */
export function autoReload(): void {
  sessionStorage.setItem(AUTO_RELOAD_KEY, Date.now().toString());
  window.location.reload();
}
