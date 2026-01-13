/**
 * Utility functions for detecting and handling chunk load errors.
 *
 * These errors occur when a new deployment creates new chunk hashes,
 * old chunks are removed, and a user's inactive browser tab tries to
 * load the old chunks that no longer exist.
 */

/**
 * Error message patterns that indicate a chunk load failure.
 * These patterns match errors from:
 * - Failed dynamic imports when chunk files are missing
 * - MIME type errors when server returns HTML instead of JS
 * - Webpack/Vite chunk loading failures
 */
const CHUNK_ERROR_PATTERNS = [
  // Dynamic import failures (Vite/modern bundlers)
  /failed to fetch dynamically imported module/i,
  // MIME type errors (server returns HTML fallback)
  /expected a javascript-or-wasm module script/i,
  /strict mime type checking is enforced/i,
  /mime type.*text\/html/i,
  // Webpack-style chunk loading failures
  /loading chunk \d+ failed/i,
  /loading css chunk .* failed/i,
];

/**
 * Detect if an error is a chunk load error that can be resolved by reloading.
 *
 * @param error - The error to check (can be any type)
 * @returns true if the error is a chunk load error
 */
export function isChunkLoadError(error: unknown): boolean {
  // Handle null/undefined
  if (error == null) {
    return false;
  }

  // Only process Error objects
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Get a user-friendly message for chunk load errors.
 *
 * @returns A message explaining the error and suggesting a reload
 */
export function getChunkLoadErrorMessage(): string {
  return 'A new version of the app has been deployed. Please reload the page to get the latest updates.';
}
