/**
 * Tests for sync service
 */
import { describe, it, expect, vi } from 'vitest';
import { syncService } from './sync';

describe('syncService', () => {
  describe('uploadBunkRequestsCSV', () => {
    it('should include year parameter in upload URL when provided', async () => {
      const mockFile = new File(['PersonID,Last Name,First Name\n123,Doe,John'], 'test.csv', { type: 'text/csv' });
      const mockFetchWithAuth = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          message: 'CSV uploaded successfully',
          filename: 'test.csv',
          header_count: 3,
          sync_started: false,
        }),
      });

      // Call with year parameter
      await syncService.uploadBunkRequestsCSV(mockFile, mockFetchWithAuth, 2024);

      // Verify the URL includes year parameter
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('?year=2024'),
        expect.any(Object)
      );
    });

    it('should not include year parameter when not provided', async () => {
      const mockFile = new File(['PersonID,Last Name,First Name\n123,Doe,John'], 'test.csv', { type: 'text/csv' });
      const mockFetchWithAuth = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          message: 'CSV uploaded successfully',
          filename: 'test.csv',
          header_count: 3,
          sync_started: false,
        }),
      });

      // Call without year parameter
      await syncService.uploadBunkRequestsCSV(mockFile, mockFetchWithAuth);

      // Verify the URL does NOT include year parameter
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.not.stringContaining('?year='),
        expect.any(Object)
      );
    });

    it('should send file as FormData', async () => {
      const mockFile = new File(['content'], 'test.csv', { type: 'text/csv' });
      let capturedBody: FormData | undefined;

      const mockFetchWithAuth = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        capturedBody = options?.body as FormData;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            message: 'success',
            filename: 'test.csv',
            header_count: 1,
            sync_started: false,
          }),
        });
      });

      await syncService.uploadBunkRequestsCSV(mockFile, mockFetchWithAuth);

      expect(capturedBody).toBeInstanceOf(FormData);
      expect(capturedBody?.get('file')).toBe(mockFile);
    });

    it('should throw UploadError on non-ok response', async () => {
      const mockFile = new File(['content'], 'test.csv', { type: 'text/csv' });
      const mockFetchWithAuth = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({
          error: 'Missing required columns',
          missing_columns: ['PersonID'],
        }),
      });

      await expect(syncService.uploadBunkRequestsCSV(mockFile, mockFetchWithAuth))
        .rejects.toEqual({
          error: 'Missing required columns',
          missing_columns: ['PersonID'],
        });
    });
  });
});
