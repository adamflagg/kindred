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

export interface GoogleSheetsExportResponse {
  message: string;
  status: string;
  syncType: string;
  spreadsheet_id: string;
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
   * @param file The CSV file to upload
   * @param fetchWithAuth Authenticated fetch function
   * @param year Optional year to associate the CSV with (for year-prefixed storage)
   * @throws UploadError on validation or server errors
   */
  async uploadBunkRequestsCSV(
    file: File,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    year?: number
  ): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    // Build URL with optional year parameter
    let url = `${API_BASE}/bunk_requests_upload`;
    if (year !== undefined) {
      url += `?year=${year}`;
    }

    const response = await fetchWithAuth(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw error as UploadError;
    }
    return response.json();
  },

  /**
   * Export data to Google Sheets
   * @param fetchWithAuth - Authenticated fetch function
   * @param years - Optional array of years to export (defaults to current year if not specified)
   */
  async exportToGoogleSheets(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    years?: number[]
  ): Promise<GoogleSheetsExportResponse> {
    const url = years?.length
      ? `${API_BASE}/google-sheets-export?years=${years.join(',')}`
      : `${API_BASE}/google-sheets-export`;
    const response = await fetchWithAuth(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to export to Google Sheets');
    }
    return response.json();
  },
};
