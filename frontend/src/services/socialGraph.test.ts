/**
 * Tests for socialGraph service
 */
import { describe, it, expect, vi } from 'vitest'
import { socialGraphService } from './socialGraph'

describe('socialGraphService', () => {
  describe('getSessionSocialGraph', () => {
    const makeFetchMock = () =>
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
        json: () =>
          Promise.resolve({
            nodes: [],
            edges: [],
            metrics: {},
            communities: {},
            warnings: [],
            layout_positions: {},
          }),
      })

    it('appends scenario_id query param when provided', async () => {
      const fetchWithAuth = makeFetchMock()

      await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth, 'scn_abc123')

      expect(fetchWithAuth).toHaveBeenCalledWith(expect.stringContaining('scenario_id=scn_abc123'))
      // Should still include year and include_metrics
      const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
      expect(calledUrl).toContain('year=2026')
      expect(calledUrl).toContain('include_metrics=true')
    })

    it('does NOT include scenario_id when not provided (backwards compatible)', async () => {
      const fetchWithAuth = makeFetchMock()

      await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth)

      const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
      expect(calledUrl).not.toContain('scenario_id')
    })

    it('does NOT include scenario_id when null/undefined is passed', async () => {
      const fetchWithAuth = makeFetchMock()

      await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth, null)

      const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
      expect(calledUrl).not.toContain('scenario_id')
    })

    describe('scope params', () => {
      it('appends units= when scope.units is non-empty', async () => {
        const fetchWithAuth = makeFetchMock()
        await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth, null, {
          units: ['galil', 'eilat'],
        })
        const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
        expect(calledUrl).toContain('units=galil%2Ceilat')
      })

      it('appends bunks= when scope.bunks is non-empty', async () => {
        const fetchWithAuth = makeFetchMock()
        await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth, null, {
          bunks: ['b-9', 'g-10'],
        })
        const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
        expect(calledUrl).toContain('bunks=b-9%2Cg-10')
      })

      it('appends cross_scope=true when scope.crossScope is true', async () => {
        const fetchWithAuth = makeFetchMock()
        await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth, null, {
          units: ['galil'],
          crossScope: true,
        })
        const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
        expect(calledUrl).toContain('cross_scope=true')
      })

      it('does NOT append scope params when scope is omitted', async () => {
        const fetchWithAuth = makeFetchMock()
        await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth)
        const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
        expect(calledUrl).not.toContain('units=')
        expect(calledUrl).not.toContain('bunks=')
        expect(calledUrl).not.toContain('cross_scope=')
      })

      it('does NOT append empty scope arrays', async () => {
        const fetchWithAuth = makeFetchMock()
        await socialGraphService.getSessionSocialGraph(123, 2026, fetchWithAuth, null, {
          units: [],
          bunks: [],
        })
        const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
        expect(calledUrl).not.toContain('units=')
        expect(calledUrl).not.toContain('bunks=')
      })
    })
  })

  describe('getBunkSocialGraph', () => {
    const makeFetchMock = () =>
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '',
        json: async () => ({
          bunk_cm_id: 555,
          bunk_name: 'Cabin 1',
          nodes: [],
          edges: [],
          metrics: {
            cohesion_score: 0,
            average_degree: 0,
            density: 0,
            isolated_count: 0,
            suggestions: [],
          },
          health_score: 0,
        }),
      })

    it('appends scenario_id query param when provided', async () => {
      const fetchWithAuth = makeFetchMock()

      await socialGraphService.getBunkSocialGraph(555, 123, 2026, fetchWithAuth, 'scn_abc123')

      const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
      expect(calledUrl).toContain('scenario_id=scn_abc123')
      expect(calledUrl).toContain('session_cm_id=123')
      expect(calledUrl).toContain('year=2026')
    })

    it('does NOT include scenario_id when not provided', async () => {
      const fetchWithAuth = makeFetchMock()

      await socialGraphService.getBunkSocialGraph(555, 123, 2026, fetchWithAuth)

      const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
      expect(calledUrl).not.toContain('scenario_id')
    })

    it('does NOT include scenario_id when null/undefined is passed', async () => {
      const fetchWithAuth = makeFetchMock()

      await socialGraphService.getBunkSocialGraph(555, 123, 2026, fetchWithAuth, null)

      const calledUrl = String(fetchWithAuth.mock.calls[0]?.[0])
      expect(calledUrl).not.toContain('scenario_id')
    })
  })
})
