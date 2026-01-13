/**
 * Service for PocketBase custom sync API endpoints
 * Provides methods for triggering syncs and uploading data
 */

const API_BASE = '/api/custom/sync';

export interface UploadResponse {
  message: string;
  filename: string;
  header_count: number;
  sync_started: boolean;
}

export interface UploadError {
  error: string;
  missing_columns?: string[];
  found_columns?: string[];
  required_columns?: string[];
  details?: string;
  file_size?: number;
}

export const syncService = {
  /**
   * Refresh bunking assignments from CampMinder
   */
  async refreshBunking(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<unknown> {
    const response = await fetchWithAuth(`${API_BASE}/refresh-bunking`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to refresh cabin assignments');
    }
    return response.json();
  },

  /**
   * Upload a bunk requests CSV file
   * @throws UploadError on validation or server errors
   */
  async uploadBunkRequestsCSV(
    file: File,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetchWithAuth(`${API_BASE}/bunk_requests_upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw error as UploadError;
    }
    return response.json();
  },
};
