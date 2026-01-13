/**
 * Utilities for social graph visualization
 */

/**
 * Calculate the convex hull of a set of points using Graham's scan algorithm
 * @param points Array of {x, y} coordinates
 * @returns Array of points forming the convex hull in counter-clockwise order
 */
export function convexHull(points: Array<{x: number, y: number}>): Array<{x: number, y: number}> {
  if (points.length < 3) return points;

  // Find the bottom-most point (and left-most if tied)
  let start = points[0];
  if (!start) return []; // Handle empty array case
  
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    
    if (point.y < start.y || (point.y === start.y && point.x < start.x)) {
      start = point;
    }
  }

  // Sort points by polar angle with respect to start
  const sorted = points.slice().sort((a, b) => {
    if (a === start) return -1;
    if (b === start) return 1;
    
    const angleA = Math.atan2(a.y - start.y, a.x - start.x);
    const angleB = Math.atan2(b.y - start.y, b.x - start.x);
    
    if (angleA !== angleB) return angleA - angleB;
    
    // If angles are equal, sort by distance
    const distA = Math.pow(a.x - start.x, 2) + Math.pow(a.y - start.y, 2);
    const distB = Math.pow(b.x - start.x, 2) + Math.pow(b.y - start.y, 2);
    return distA - distB;
  });

  // Build the hull
  const hull: Array<{x: number, y: number}> = [];
  
  for (const point of sorted) {
    // Remove points that make a clockwise turn
    while (hull.length >= 2) {
      const p1 = hull[hull.length - 2];
      const p2 = hull[hull.length - 1];
      
      if (!p1 || !p2) break; // Safety check
      
      const cross = (p2.x - p1.x) * (point.y - p1.y) - (p2.y - p1.y) * (point.x - p1.x);
      
      if (cross <= 0) {
        hull.pop();
      } else {
        break;
      }
    }
    hull.push(point);
  }

  return hull;
}

/**
 * Generate a color for a bunk based on its ID
 * Uses HSL to ensure good contrast and variety
 */
export function getBunkColor(bunkId: number): string {
  // Use golden ratio for better color distribution
  const goldenRatio = 0.618033988749895;
  const hue = (bunkId * goldenRatio * 360) % 360;
  
  // Use moderate saturation and lightness for visibility
  return `hsl(${hue}, 60%, 50%)`;
}

/**
 * Create a smooth path from convex hull points
 * This creates a more organic "blob" shape instead of sharp corners
 */
export function smoothHullPath(hull: Array<{x: number, y: number}>, smoothingFactor: number = 0.2): string {
  if (hull.length < 3) return '';

  // Calculate control points for bezier curves
  const controlPoints: Array<{x: number, y: number}> = [];
  
  for (let i = 0; i < hull.length; i++) {
    const prev = hull[(i - 1 + hull.length) % hull.length];
    const curr = hull[i];
    const next = hull[(i + 1) % hull.length];
    
    if (!prev || !curr || !next) continue;
    
    // Calculate vectors
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    
    // Normalize and scale by smoothing factor
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    
    const smoothLen = Math.min(len1, len2) * smoothingFactor;
    
    controlPoints.push({
      x: curr.x - (v1.x / len1) * smoothLen,
      y: curr.y - (v1.y / len1) * smoothLen
    });
    controlPoints.push({
      x: curr.x + (v2.x / len2) * smoothLen,
      y: curr.y + (v2.y / len2) * smoothLen
    });
  }

  // Build SVG path
  const firstPoint = hull[0];
  if (!firstPoint) return '';
  
  let path = `M ${firstPoint.x} ${firstPoint.y}`;
  
  for (let i = 0; i < hull.length; i++) {
    const next = hull[(i + 1) % hull.length];
    const cp1 = controlPoints[i * 2 + 1];
    const cp2 = controlPoints[((i + 1) * 2) % controlPoints.length];
    
    if (!next || !cp1 || !cp2) continue;
    
    path += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${next.x} ${next.y}`;
  }
  
  path += ' Z'; // Close path
  return path;
}

/**
 * Expand hull to add padding around nodes
 */
export function expandHull(hull: Array<{x: number, y: number}>, padding: number): Array<{x: number, y: number}> {
  // Find centroid
  const centroid = hull.reduce((acc, p) => ({
    x: acc.x + p.x / hull.length,
    y: acc.y + p.y / hull.length
  }), {x: 0, y: 0});

  // Expand each point away from centroid
  return hull.map(point => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance === 0) return point;
    
    return {
      x: point.x + (dx / distance) * padding,
      y: point.y + (dy / distance) * padding
    };
  });
}

/**
 * Calculate optimal position for an isolated node within a bunk hull
 * Places it on the inner edge to maintain visual grouping
 */
export function positionIsolatedNode(
  hull: Array<{x: number, y: number}>, 
  existingNodes: Array<{x: number, y: number}>,
  minDistance: number = 50
): {x: number, y: number} {
  // Find centroid of hull
  const centroid = hull.reduce((acc, p) => ({
    x: acc.x + p.x / hull.length,
    y: acc.y + p.y / hull.length
  }), {x: 0, y: 0});

  // Find the hull edge with the most space
  let bestPosition = centroid;
  let maxMinDistance = 0;

  // Sample points along the hull perimeter
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    if (!p1 || !p2) continue;
    
    // Sample points along this edge
    for (let t = 0.2; t <= 0.8; t += 0.2) {
      const candidate = {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t
      };
      
      // Move slightly inward
      const toCentroid = {
        x: centroid.x - candidate.x,
        y: centroid.y - candidate.y
      };
      const len = Math.sqrt(toCentroid.x * toCentroid.x + toCentroid.y * toCentroid.y);
      
      candidate.x += (toCentroid.x / len) * 30;
      candidate.y += (toCentroid.y / len) * 30;
      
      // Calculate minimum distance to existing nodes
      let minDist = Infinity;
      for (const node of existingNodes) {
        const dist = Math.sqrt(
          Math.pow(node.x - candidate.x, 2) + 
          Math.pow(node.y - candidate.y, 2)
        );
        minDist = Math.min(minDist, dist);
      }
      
      if (minDist > maxMinDistance && minDist >= minDistance) {
        maxMinDistance = minDist;
        bestPosition = candidate;
      }
    }
  }

  return bestPosition;
}