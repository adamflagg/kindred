/**
 * Graph visualization constants
 * Extracted from SocialNetworkGraph.tsx
 */

// Grade color scheme - using a rainbow gradient
export const GRADE_COLORS: Record<number, string> = {
  1: '#e74c3c', // Red
  2: '#e67e22', // Orange
  3: '#f39c12', // Yellow-Orange
  4: '#f1c40f', // Yellow
  5: '#2ecc71', // Green
  6: '#27ae60', // Dark Green
  7: '#16a085', // Teal
  8: '#3498db', // Blue
  9: '#2980b9', // Dark Blue
  10: '#9b59b6', // Purple
  11: '#8e44ad', // Dark Purple
  12: '#34495e', // Dark Gray
};

// Edge type colors
export const EDGE_COLORS: Record<string, string> = {
  request: '#3498db',
  historical: '#95a5a6',
  sibling: '#e74c3c',
  school: '#2ecc71',
  bundled: '#9b59b6', // Purple for bundled edges
};

// Node satisfaction status colors (for borders)
export const STATUS_COLORS: Record<string, string> = {
  satisfied: '#27ae60', // Green
  partial: '#f39c12', // Yellow
  isolated: '#e74c3c', // Red
  default: '#2c3e50', // Gray
};

// Edge type display labels
export const EDGE_LABELS: Record<string, string> = {
  request: 'Requests',
  historical: 'Historical',
  sibling: 'Siblings',
  school: 'Classmates',
};

// Confidence level definitions
export const CONFIDENCE_LEVELS = [
  { label: 'High (>90%)', opacity: 1, threshold: 0.9 },
  { label: 'Medium (50-90%)', opacity: 0.65, threshold: 0.5 },
  { label: 'Low (<50%)', opacity: 0.3, threshold: 0 },
] as const;

// Zoom settings
export const ZOOM_SETTINGS = {
  inMultiplier: 1.2,
  outMultiplier: 0.8,
  min: 0.1,
  max: 10,
} as const;
