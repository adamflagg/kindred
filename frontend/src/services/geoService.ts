/**
 * Geo Management API Service
 *
 * Client functions for the geographic data management endpoints.
 * Handles gap analysis, canonical search, source inspection, and override CRUD.
 */

const API_BASE = '/api/geo'

// ============================================================================
// Response Types (matching backend schemas)
// ============================================================================

export interface GapItem {
  name: string
  count: number
  percentage: number
  source_count: number
}

export interface GapsResponse {
  canonical_no_coords: GapItem[]
  non_canonical_grouped: GapItem[]
  non_canonical_ungrouped: GapItem[]
  total_gaps: number
}

export interface CanonicalEntry {
  canonical_name: string
  city: string
  state: string
  source: string
  has_coords: boolean
  camper_count: number
}

export interface CanonicalSearchResponse {
  results: CanonicalEntry[]
}

export interface SourceItem {
  original_value: string
  count: number
  confidence: number
}

export interface SourcesResponse {
  canonical_name: string
  city: string
  state: string
  sources: SourceItem[]
}

export interface GeoOverride {
  id: string
  category: string
  override_type: string
  raw_value: string | null
  canonical_name: string
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  merged_into: string | null
  notes: string | null
  year: number
}

export interface OverrideCreateData {
  category: string
  override_type: string
  raw_value?: string
  canonical_name: string
  city?: string
  state?: string
  merged_into?: string
  notes?: string
  year: number
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch three-tier gap classification for a category and year.
 */
export async function fetchGeoGaps(
  category: string,
  year: number,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<GapsResponse> {
  const params = new URLSearchParams({ category, year: String(year) })
  const response = await fetchWithAuth(`${API_BASE}/gaps?${params}`)

  if (!response.ok) {
    throw new Error('Failed to fetch geo gaps')
  }
  return response.json()
}

/**
 * Search canonical entries by name, city, or state.
 */
export async function searchCanonicals(
  category: string,
  query: string,
  year: number,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<CanonicalSearchResponse> {
  const params = new URLSearchParams({ category, q: query, year: String(year) })
  const response = await fetchWithAuth(`${API_BASE}/canonicals?${params}`)

  if (!response.ok) {
    throw new Error('Failed to search canonicals')
  }
  return response.json()
}

/**
 * Get raw value variants that map to a canonical name.
 */
export async function fetchSources(
  category: string,
  canonicalName: string,
  year: number,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<SourcesResponse> {
  const params = new URLSearchParams({ category, year: String(year) })
  const response = await fetchWithAuth(
    `${API_BASE}/canonicals/${encodeURIComponent(canonicalName)}/sources?${params}`
  )

  if (!response.ok) {
    throw new Error('Failed to fetch sources')
  }
  return response.json()
}

/**
 * List all geo overrides for a category and year.
 */
export async function fetchOverrides(
  category: string,
  year: number,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<GeoOverride[]> {
  const params = new URLSearchParams({ category, year: String(year) })
  const response = await fetchWithAuth(`${API_BASE}/overrides?${params}`)

  if (!response.ok) {
    throw new Error('Failed to fetch overrides')
  }
  return response.json()
}

/**
 * Create a new geo override.
 */
export async function createOverride(
  data: OverrideCreateData,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<GeoOverride> {
  const response = await fetchWithAuth(`${API_BASE}/overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error((error as { detail?: string }).detail ?? 'Failed to create override')
  }
  return response.json()
}

/**
 * Update an existing geo override.
 */
export async function updateOverride(
  overrideId: string,
  data: Partial<OverrideCreateData>,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<GeoOverride> {
  const response = await fetchWithAuth(`${API_BASE}/overrides/${encodeURIComponent(overrideId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error((error as { detail?: string }).detail ?? 'Failed to update override')
  }
  return response.json()
}

/**
 * Delete a geo override.
 */
export async function deleteOverride(
  overrideId: string,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE}/overrides/${encodeURIComponent(overrideId)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error('Failed to delete override')
  }
}
