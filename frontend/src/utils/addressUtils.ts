/**
 * Shared address utilities for parsing and displaying location
 */

interface AddressData {
  city?: string;
  state?: string;
  [key: string]: unknown;
}

/**
 * Extract city/state display string from address field
 * Handles both JSON string and object formats
 */
export function getLocationDisplay(address: string | AddressData | null | undefined | unknown): string | null {
  if (!address) return null;

  try {
    const addr: AddressData = typeof address === 'string' ? JSON.parse(address) : address;
    if (addr?.city || addr?.state) {
      return [addr.city, addr.state].filter(Boolean).join(', ');
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}
