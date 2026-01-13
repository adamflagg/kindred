import { describe, it, expect } from 'vitest';
import { isChunkLoadError, getChunkLoadErrorMessage } from './chunkLoadError';

/**
 * Tests for chunk load error detection.
 *
 * These errors occur when:
 * 1. A new deployment creates new chunk hashes
 * 2. Old chunk files are removed
 * 3. A user's inactive tab tries to load old chunks
 * 4. The server returns HTML (fallback) instead of JS
 */

describe('isChunkLoadError', () => {
  describe('dynamic import errors', () => {
    it('should detect "Failed to fetch dynamically imported module" error', () => {
      const error = new Error(
        'Failed to fetch dynamically imported module: https://bunking.flagg.cloud/assets/AdminConfig-BB7qViJN.js'
      );
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('should detect TypeError for dynamically imported module', () => {
      const error = new TypeError(
        'Failed to fetch dynamically imported module: https://example.com/assets/chunk-abc123.js'
      );
      expect(isChunkLoadError(error)).toBe(true);
    });
  });

  describe('MIME type errors', () => {
    it('should detect MIME type error for module scripts', () => {
      const error = new Error(
        'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"'
      );
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('should detect MIME type error with strict enforcement message', () => {
      const error = new Error(
        'Strict MIME type checking is enforced for module scripts per HTML spec'
      );
      expect(isChunkLoadError(error)).toBe(true);
    });
  });

  describe('loading chunk errors', () => {
    it('should detect "Loading chunk X failed" error', () => {
      const error = new Error('Loading chunk 5 failed');
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('should detect "Loading CSS chunk X failed" error', () => {
      const error = new Error('Loading CSS chunk styles failed');
      expect(isChunkLoadError(error)).toBe(true);
    });
  });

  describe('non-chunk errors', () => {
    it('should return false for regular errors', () => {
      const error = new Error('Something went wrong');
      expect(isChunkLoadError(error)).toBe(false);
    });

    it('should return false for network errors', () => {
      const error = new Error('Network request failed');
      expect(isChunkLoadError(error)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
    });

    it('should handle non-Error objects gracefully', () => {
      expect(isChunkLoadError('string error')).toBe(false);
      expect(isChunkLoadError({ message: 'object error' })).toBe(false);
    });
  });
});

describe('getChunkLoadErrorMessage', () => {
  it('should return user-friendly message for chunk load errors', () => {
    const message = getChunkLoadErrorMessage();
    expect(message).toContain('new version');
    expect(message).toContain('reload');
  });
});
