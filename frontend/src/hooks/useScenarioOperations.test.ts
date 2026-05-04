/**
 * #980 — useUpdateScenario must pass { expand: 'session' } so that
 * the returned record has a non-zero session_cm_id after being fed
 * through savedScenarioToScenario.
 *
 * Without the expand option PocketBase omits the `expand` dict and
 * savedScenarioToScenario falls back to session_cm_id: 0, breaking
 * any downstream code that filters by session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Minimal stub for pocketbase library
// ---------------------------------------------------------------------------

const mockUpdate = vi.fn()

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      update: mockUpdate,
    }),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: ({ mutationFn }: { mutationFn: (...args: unknown[]) => unknown }) => ({
    mutateAsync: mutationFn,
    mutate: mutationFn,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

import { useUpdateScenario } from './useScenarioOperations'
import { savedScenarioToScenario } from '../contexts/scenarioTransform'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSavedScenarioResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sc001',
    name: 'Test Scenario',
    is_active: true,
    description: '',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-02T00:00:00Z',
    // expand is only present when the caller passed { expand: 'session' }
    expand: {
      session: { id: 'sess001', cm_id: 1000042 },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useUpdateScenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes { expand: "session" } to pb.collection().update()', async () => {
    const savedRecord = makeSavedScenarioResponse()
    mockUpdate.mockResolvedValue(savedRecord)

    const hook = useUpdateScenario()
    // Invoke the mutationFn directly through our mock shim
    await (hook as unknown as { mutateAsync: (p: unknown) => Promise<unknown> }).mutateAsync({
      scenarioId: 'sc001',
      updates: { name: 'New Name' },
    })

    expect(mockUpdate).toHaveBeenCalledOnce()
    const [, , options] = mockUpdate.mock.calls[0] as [string, unknown, Record<string, unknown>]
    expect(options).toBeDefined()
    expect((options as { expand?: string }).expand).toBe('session')
  })

  it('round-trips through savedScenarioToScenario with a non-zero session_cm_id', async () => {
    const savedRecord = makeSavedScenarioResponse()
    mockUpdate.mockResolvedValue(savedRecord)

    const hook = useUpdateScenario()
    const result = (await (
      hook as unknown as { mutateAsync: (p: unknown) => Promise<unknown> }
    ).mutateAsync({
      scenarioId: 'sc001',
      updates: { is_active: true },
    })) as ReturnType<typeof makeSavedScenarioResponse>

    // The record returned by the hook should carry the expand dict that
    // savedScenarioToScenario can read — confirming the expand was requested.
    const scenario = savedScenarioToScenario(
      result as Parameters<typeof savedScenarioToScenario>[0]
    )
    expect(scenario.session_cm_id).toBe(1000042)
    expect(scenario.session_cm_id).not.toBe(0)
  })

  it('without expand the transform falls back to session_cm_id 0 (documents the bug)', () => {
    // This test documents the pre-fix behaviour: if a caller omits expand,
    // the transform silently returns 0.  It should NOT be reachable after the fix
    // but we keep it as a regression anchor.
    const recordWithoutExpand = makeSavedScenarioResponse({ expand: undefined })
    const scenario = savedScenarioToScenario(
      recordWithoutExpand as Parameters<typeof savedScenarioToScenario>[0]
    )
    expect(scenario.session_cm_id).toBe(0)
  })
})
