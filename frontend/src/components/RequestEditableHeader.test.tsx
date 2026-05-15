import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RequestEditableHeader } from './RequestEditableHeader'
import { computeTypeUpdate, computeTargetUpdate } from './requestEditableHelpers'
import type { BunkRequestsResponse } from '../types/pocketbase-types'

const baseRequest: Partial<BunkRequestsResponse> = {
  id: 'req-1',
  request_type: 'bunk_with',
  requestee_id: 200,
  requested_person_name: 'Olivia Chen',
  age_preference_target: '',
  status: 'pending',
  requester_id: 100,
  session_id: 1000001,
  year: 2025,
  is_reciprocal: false,
  confidence_score: 0.5,
  created: '2025-01-01',
  updated: '2025-01-01',
} as BunkRequestsResponse

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getFullList: () => Promise.resolve([]),
    }),
  },
}))

vi.mock('react-router', () => ({
  Link: ({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...p}>{children}</a>
  ),
}))

const olivia = {
  cm_id: 200,
  first_name: 'Olivia',
  last_name: 'Chen',
  year: 2025,
} as unknown as import('../types/pocketbase-types').PersonsResponse

function renderHeader(
  overrides: Partial<React.ComponentProps<typeof RequestEditableHeader>> = {},
  requestOverrides: Partial<BunkRequestsResponse> = {}
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onUpdate = vi.fn()
  const personMap = new Map([[200, olivia]])
  const result = render(
    <QueryClientProvider client={qc}>
      <RequestEditableHeader
        request={{ ...baseRequest, ...requestOverrides } as BunkRequestsResponse}
        year={2025}
        personMap={personMap}
        onUpdate={onUpdate}
        {...overrides}
      />
    </QueryClientProvider>
  )
  return { ...result, onUpdate }
}

describe('computeTypeUpdate', () => {
  it('switching to age_preference clears requestee_id and resets resolution state', () => {
    expect(computeTypeUpdate('age_preference')).toEqual({
      request_type: 'age_preference',
      requestee_id: null,
      status: 'pending',
      confidence_score: 0,
    })
  })

  it('switching to bunk_with clears age_preference_target and resets resolution state', () => {
    expect(computeTypeUpdate('bunk_with')).toEqual({
      request_type: 'bunk_with',
      age_preference_target: '',
      status: 'pending',
      confidence_score: 0,
    })
  })

  it('switching to not_bunk_with clears age_preference_target and resets resolution state', () => {
    expect(computeTypeUpdate('not_bunk_with')).toEqual({
      request_type: 'not_bunk_with',
      age_preference_target: '',
      status: 'pending',
      confidence_score: 0,
    })
  })
})

describe('computeTargetUpdate', () => {
  it('setting requestee_id > 0 also sets status=resolved + confidence=1.0', () => {
    expect(computeTargetUpdate({ requestee_id: 200 })).toEqual({
      requestee_id: 200,
      status: 'resolved',
      confidence_score: 1.0,
    })
  })

  it('clearing requestee_id (null) resets status to pending and confidence to 0 (#997)', () => {
    expect(computeTargetUpdate({ requestee_id: null })).toEqual({
      requestee_id: null,
      status: 'pending',
      confidence_score: 0,
    })
  })

  it('setting age_preference_target passes it through without resolving', () => {
    expect(computeTargetUpdate({ age_preference_target: 'older' })).toEqual({
      age_preference_target: 'older',
    })
  })
})

describe('RequestEditableHeader rendering', () => {
  it('renders the type picker (EditableRequestType) for any request', () => {
    renderHeader()
    expect(screen.getByRole('button', { name: /^Bunk With$/i })).toBeInTheDocument()
  })

  it('renders the target picker for a non-age request', () => {
    renderHeader({}, { requestee_id: 200 })
    expect(screen.getByRole('button', { name: /Olivia Chen/i })).toBeInTheDocument()
  })

  it('renders the age-preference picker when request_type is age_preference', () => {
    renderHeader(
      {},
      {
        request_type: 'age_preference',
        requestee_id: 0,
        age_preference_target: 'older',
      }
    )
    expect(screen.getByRole('button', { name: /Prefers older/i })).toBeInTheDocument()
  })

  it('emits onUpdate with computeTypeUpdate output when type changes', () => {
    const { onUpdate } = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /^Bunk With$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Age Preference$/i }))
    expect(onUpdate).toHaveBeenCalledWith({
      request_type: 'age_preference',
      requestee_id: null,
      status: 'pending',
      confidence_score: 0,
    })
  })

  it('emits onUpdate with computeTargetUpdate output when age preference is selected', () => {
    const { onUpdate } = renderHeader(
      {},
      {
        request_type: 'age_preference',
        requestee_id: 0,
        age_preference_target: '',
      }
    )
    fireEvent.click(screen.getByRole('button', { name: /Select preference/i }))
    fireEvent.click(screen.getByRole('button', { name: /Prefers younger/i }))
    expect(onUpdate).toHaveBeenCalledWith({
      age_preference_target: 'younger',
    })
  })

  it('renders the "mutual" badge when is_reciprocal is true', () => {
    renderHeader({}, { is_reciprocal: true })
    expect(screen.getByText(/mutual/i)).toBeInTheDocument()
  })

  it('renders the "Viewing" badge when isCurrent is true', () => {
    renderHeader({ isCurrent: true })
    expect(screen.getByText(/Viewing/i)).toBeInTheDocument()
  })
})
