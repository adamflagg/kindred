/**
 * CARTO Positron raster tiles — clean, muted colours under the map's markers.
 *
 * CARTO watermarks keyless tiles "API key required" (terms of 29 Sep 2026), so
 * the key comes from the private branding.local.json. A build without one
 * still renders a map, just with the watermark.
 */
const POSITRON_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

export function basemapTileUrl(key: string | null): string {
  return key ? `${POSITRON_TILES}?key=${encodeURIComponent(key)}` : POSITRON_TILES
}
