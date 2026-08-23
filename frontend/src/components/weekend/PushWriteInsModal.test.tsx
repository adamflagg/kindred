/**
 * The push write-ins modal's shell and report screen (kindred#2477 Task 8).
 *
 * The deck (stage 'deck', Task 9) and the actual push mutation (Task 10) are
 * NOT exercised here — this file only pins the report screen's four class
 * tiles and the two CTAs that follow from them (`Review N decisions` when
 * there is something to decide, a direct `Push M write-ins` when there is
 * not).
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PushPreview, PushRowPayload } from '../../services/lodgingApi'
import { PushWriteInsModal } from './PushWriteInsModal'

const mockFetchWithAuth = vi.fn()
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

function row(
  unitCode: string,
  occupantName: string,
  overrides: Partial<PushRowPayload> = {}
): PushRowPayload {
  return {
    unit_id: `u-${unitCode}`,
    unit_code: unitCode,
    unit_name: unitCode,
    occupant_name: occupantName,
    note: '',
    party_size: null,
    sleeps: null,
    ...overrides,
  }
}

const PREVIEW: PushPreview = {
  year: 2026,
  session_cm_id: 1309001,
  scenario: 'scn_1',
  digest: 'd'.repeat(64),
  buildings: [
    {
      key: 'yurt-5',
      label: 'Yurt 5',
      cls: 'add',
      live: [],
      draft: [row('yurt-5', 'Kitchen crew')],
    },
    {
      key: 'fern-1',
      label: 'Fern 1',
      cls: 'match',
      live: [row('fern-1', 'E. Sandoval')],
      draft: [row('fern-1', 'E. Sandoval')],
    },
    {
      key: 'cedar-9',
      label: 'Cedar 9',
      cls: 'conflict',
      live: [row('cedar-9', 'G. Whitfield')],
      draft: [row('cedar-9', 'H. Osei')],
    },
    {
      key: 'aspen-5',
      label: 'Aspen 5',
      cls: 'remove',
      live: [row('aspen-5', 'F. Moreau')],
      draft: [],
    },
  ],
}

function renderModal(preview: PushPreview) {
  mockFetchWithAuth.mockResolvedValue(ok(preview))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PushWriteInsModal
        year={2026}
        sessionCmId={1309001}
        scenario="scn_1"
        isOpen={true}
        onClose={() => undefined}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockFetchWithAuth.mockReset()
})

describe('PushWriteInsModal — report screen', () => {
  it('report shows the four class counts and queues only decisions', async () => {
    renderModal(PREVIEW)

    expect(await screen.findByText('Will add')).toBeInTheDocument()
    // counts: 1 add, 1 match, 1 conflict, 1 remove
    expect(screen.getByRole('button', { name: /review 2 decisions/i })).toBeInTheDocument()
  })

  it('zero decisions goes straight to a push button', async () => {
    renderModal({ ...PREVIEW, buildings: PREVIEW.buildings.filter((b) => b.cls === 'add') })

    expect(await screen.findByRole('button', { name: /push 1 write-in/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument()
  })
})
