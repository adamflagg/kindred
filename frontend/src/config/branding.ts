/**
 * Branding configuration for the frontend.
 *
 * Loads generic defaults, with local overrides applied at build time.
 * Camp-specific branding (logos, names) is loaded from gitignored local files.
 *
 * Usage:
 *   import { branding, getCampName } from '../config/branding';
 *   <h1>{getCampName()}</h1>
 */

// Default branding values (generic)
const defaultBranding = {
  camp_name: 'Kindred',
  camp_name_short: 'Kindred',
  camp_description: 'a cabin assignment system that puts relationships first',
  camp_tagline: 'where campers find their people',
  sso_display_name: 'Staff SSO',
  page_title: 'Kindred',
  page_description: 'Cabin assignments that put relationships first',
  logo: {
    large: null as string | null,
    nav: null as string | null,
  },
};

// Try to load local branding overrides (injected at build time)
// In development, Vite will replace this with the actual local config if present
let localBranding: Partial<typeof defaultBranding> = {};
try {
  // This will be replaced by Vite's define plugin if local config exists
  // @ts-expect-error - VITE_LOCAL_BRANDING is injected at build time
  if (typeof VITE_LOCAL_BRANDING !== 'undefined') {
    // @ts-expect-error - VITE_LOCAL_BRANDING is injected at build time
    localBranding = VITE_LOCAL_BRANDING;
  }
} catch {
  // No local branding - use defaults
}

// Merge local overrides with defaults
export const branding = {
  ...defaultBranding,
  ...localBranding,
  logo: {
    ...defaultBranding.logo,
    ...(localBranding.logo || {}),
  },
};

// Accessor functions for convenience
export function getCampName(): string {
  return branding.camp_name;
}

export function getCampNameShort(): string {
  return branding.camp_name_short;
}

export function getCampDescription(): string {
  return branding.camp_description;
}

export function getCampTagline(): string {
  return branding.camp_tagline;
}

export function getSsoDisplayName(): string {
  return branding.sso_display_name;
}

export function getLogoPath(size: 'large' | 'nav' = 'large'): string | null {
  return branding.logo[size];
}

export function getPageTitle(): string {
  return branding.page_title;
}

export function getPageDescription(): string {
  return branding.page_description;
}
