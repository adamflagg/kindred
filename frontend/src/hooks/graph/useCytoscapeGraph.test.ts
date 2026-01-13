import { describe, it, expect } from 'vitest';
import {
  batchElements,
  type GraphInitConfig,
  type CytoscapeRefs,
} from './useCytoscapeGraph';

describe('useCytoscapeGraph', () => {
  describe('batchElements', () => {
    it('batches elements into chunks of specified size', () => {
      const elements = Array.from({ length: 100 }, (_, i) => ({ id: `node-${i}` }));
      const batches = batchElements(elements, 30);

      expect(batches).toHaveLength(4);
      expect(batches[0]).toHaveLength(30);
      expect(batches[1]).toHaveLength(30);
      expect(batches[2]).toHaveLength(30);
      expect(batches[3]).toHaveLength(10);
    });

    it('handles empty array', () => {
      const batches = batchElements([], 10);
      expect(batches).toHaveLength(0);
    });

    it('handles array smaller than batch size', () => {
      const elements = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const batches = batchElements(elements, 50);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual(elements);
    });

    it('handles exact batch size multiple', () => {
      const elements = Array.from({ length: 50 }, (_, i) => ({ id: `${i}` }));
      const batches = batchElements(elements, 25);

      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(25);
      expect(batches[1]).toHaveLength(25);
    });
  });

  describe('GraphInitConfig type', () => {
    it('accepts valid config', () => {
      const config: GraphInitConfig = {
        showLabels: true,
        showEdges: {
          request: true,
          historical: false,
          sibling: true,
          school: false,
        },
        showBubbles: false,
        viewMode: 'all',
      };

      expect(config.showLabels).toBe(true);
      expect(config.showEdges.request).toBe(true);
      expect(config.showBubbles).toBe(false);
      expect(config.viewMode).toBe('all');
    });
  });

  describe('CytoscapeRefs type', () => {
    it('accepts valid refs structure', () => {
      const refs: CytoscapeRefs = {
        containerRef: { current: null },
        cyRef: { current: null },
        layoutRef: { current: null },
        bubblesetsRef: { current: null },
        pathsRef: { current: [] },
        poppersRef: { current: [] },
        layoutWorkerRef: { current: null },
      };

      expect(refs.containerRef.current).toBeNull();
      expect(refs.cyRef.current).toBeNull();
    });
  });
});
