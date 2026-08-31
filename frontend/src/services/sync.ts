/**
 * Service for PocketBase custom sync API endpoints
 * Provides methods for triggering syncs and uploading data
 */

const API_BASE = '/api/custom/sync'

export interface UploadResponse {
  message: string
  filename: string
  header_count: number
  sync_started: boolean
  process_requests_started?: boolean
}

export interface UploadError {
  error: string
  missing_columns?: string[]
  found_columns?: string[]
  required_columns?: string[]
  details?: string
  file_size?: number
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
    })
    if (!response.ok) {
      throw new Error('Failed to refresh cabin assignments')
    }
    return response.json()
  },

  /**
   * Refresh family camp housing placements from CampMinder.
   *
   * `sessionCmId` narrows the two expensive custom-values jobs to ONE weekend
   * (kindred#2601). Omitting it refreshes every family-camp weekend in the
   * year, which is what this call did before the parameter existed — the
   * server treats an absent session exactly that way, so the omission is a
   * supported mode rather than an accident.
   */
  async refreshFamilyCamp(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    sessionCmId?: number
  ): Promise<unknown> {
    const query = sessionCmId === undefined ? '' : `?session=${sessionCmId}`
    const response = await fetchWithAuth(`${API_BASE}/refresh-family-camp${query}`, {
      method: 'POST',
    })
    if (!response.ok) {
      throw new Error('Failed to refresh family camp housing')
    }
    return response.json()
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
    const formData = new FormData()
    formData.append('file', file)

    // Build URL with run_sync=true and run_process_requests=true
    // This chains: CSV upload → bunk_requests sync → process_requests (AI processing)
    let url = `${API_BASE}/bunk_requests_upload?run_sync=true&run_process_requests=true`
    if (year !== undefined) {
      url += `&year=${year}`
    }

    const response = await fetchWithAuth(url, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw error as UploadError
    }
    return response.json()
  },
}
