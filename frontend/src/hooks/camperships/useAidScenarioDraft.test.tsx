/** The sandbox's work (§S5 F, A, B, G): typing prices and records nothing; a release records; writes run in order. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  scenarioDraft,
  workspace,
} from '../../components/camperships/season/scenarios/scenarioFixtures'
import { AidWriteError } from '../../services/camperships/aidApi'
import { useAidScenarioDraft } from './useAidScenarioDraft'

const calls: Array<[string, unknown]> = []
const save = vi.fn()
const load = vi.fn()
const keep = vi.fn()
const freeze = vi.fn()
vi.mock('../../services/camperships/aidApi', async (original) => ({
  ...(await original<object>()),
  saveAidScenarioDraft: (_f: unknown, _y: number, body: unknown) => {
    calls.push(['save', body])
    return save(body)
  },
  loadAidScenarioDraft: (_f: unknown, _y: number, body: unknown) => {
    calls.push(['load', body])
    return load(body)
  },
  keepAidScenario: (_f: unknown, _y: number, body: unknown) => {
    calls.push(['keep', body])
    return keep(body)
  },
  freezeAidScenarioSeason: () => {
    calls.push(['freeze', null])
    return freeze()
  },
}))
vi.mock('../useApiWithAuth', () => ({ useApiWithAuth: () => ({ fetchWithAuth: vi.fn() }) }))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

const WS = workspace({ draft: scenarioDraft({ from_code: 'B' }) })

function setup(ws = WS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useAidScenarioDraft(ws), { wrapper })
}

beforeEach(() => {
  calls.length = 0
  for (const mock of [save, load, keep, freeze]) mock.mockReset()
  save.mockImplementation((body: { document: unknown }) =>
    Promise.resolve(scenarioDraft({ document: body.document as never }))
  )
  load.mockResolvedValue(scenarioDraft())
  keep.mockResolvedValue({})
  freeze.mockResolvedValue(WS.snapshot)
})

describe('useAidScenarioDraft', () => {
  it('prices the typed document 300 ms after the typing stops, recording nothing', async () => {
    vi.useFakeTimers()
    const { result } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => result.current.type('awards.minimum', '125'))
    expect(result.current.edits.get('awards.minimum')).toBe('125')
    expect(result.current.pricedDocument?.awards.minimum).not.toBe('125')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(result.current.pricedDocument?.awards.minimum).toBe('125')
    expect(calls).toEqual([])
    vi.useRealTimers()
  })

  it('sends nothing before any applications are held, and keeps the typing (§S5 M; disagreement 17)', async () => {
    const { result } = setup(workspace({ snapshot: null }))
    act(() => result.current.type('awards.minimum', '125'))
    let landed = false
    await act(async () => {
      landed = await result.current.release()
    })
    expect([landed, calls]).toEqual([true, []]) // nothing to record yet, so nothing refused either
    expect(result.current.edits.get('awards.minimum')).toBe('125')
  })

  it('neither prices nor records a bad figure', async () => {
    const { result } = setup()
    act(() => result.current.type('awards.minimum', 'abc'))
    await act(async () => {
      await result.current.release()
    })
    expect(calls).toEqual([])
    expect(result.current.edits.get('awards.minimum')).toBe('abc')
  })

  it('records one release with the typed document and drops the edits it recorded', async () => {
    const { result } = setup()
    act(() => result.current.type('awards.minimum', '125'))
    await act(async () => {
      await result.current.release()
    })
    expect(calls.map(([name]) => name)).toEqual(['save'])
    expect(
      (calls[0]?.[1] as { document: { awards: { minimum: string } } }).document.awards.minimum
    ).toBe('125')
    expect(result.current.edits.size).toBe(0)
    await act(async () => {
      await result.current.release() // nothing typed: nothing recorded
    })
    expect(calls).toHaveLength(1)
  })

  it('keeps the typing and says the server’s words when a release is refused (Review Focus 1)', async () => {
    save.mockRejectedValueOnce(
      new AidWriteError(
        'Round 1 award table is locked: Round 1 is posted, so Scenarios models only what is still open.',
        409
      )
    )
    const { result } = setup()
    act(() => result.current.type('award_tables.general.tiers.1.r1_pct', '85'))
    let landed = true
    await act(async () => {
      landed = await result.current.release()
    })
    expect(landed).toBe(false)
    expect(result.current.error).toBe(
      'Round 1 award table is locked: Round 1 is posted, so Scenarios models only what is still open.'
    )
    expect(result.current.edits.get('award_tables.general.tiers.1.r1_pct')).toBe('85')
    act(() => result.current.type('award_tables.general.tiers.1.r1_pct', '86')) // the next action clears it
    expect(result.current.error).toBeNull()
  })

  it('runs writes in the order asked: a load waits for the release before it', async () => {
    const { result } = setup()
    act(() => result.current.type('awards.minimum', '125'))
    await act(async () => {
      void result.current.release()
      await result.current.load({ option: 'A' })
    })
    expect(calls.map(([name, body]) => [name, name === 'load' ? body : null])).toEqual([
      ['save', null],
      ['load', { option: 'A' }],
    ])
  })

  it('does not start a load until a slow release has landed', async () => {
    let finish: (value: unknown) => void = () => undefined
    save.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const { result } = setup()
    act(() => result.current.type('awards.minimum', '125'))
    let loading: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      void result.current.release()
      loading = result.current.load({ option: 'A' })
      await Promise.resolve()
    })
    expect(calls.map(([name]) => name)).toEqual(['save']) // the load is still waiting its turn
    await act(async () => {
      finish(scenarioDraft())
      await loading
    })
    expect(calls.map(([name]) => name)).toEqual(['save', 'load'])
  })

  it('discards by loading the source again: a kept option, or a built-in start', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.discard()
    })
    const fromRules = setup(workspace({ draft: scenarioDraft({ from_code: 'rules' }) }))
    await act(async () => {
      await fromRules.result.current.discard()
    })
    expect(calls).toEqual([
      ['load', { option: 'B' }],
      ['load', { start: 'rules' }],
    ])
  })

  it('keeps with the name given, and says when nothing new arrived', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.keep('Higher minimum')
      await result.current.update()
    })
    expect(calls).toEqual([
      ['keep', { name: 'Higher minimum' }],
      ['freeze', null],
    ])
    expect(result.current.nothingNew).toBe(true)
  })

  it('resolves a keep to the new code, and to null when it is refused (§S5 B)', async () => {
    keep.mockResolvedValueOnce({ code: 'C' })
    const { result } = setup()
    const codes: Array<string | null> = []
    await act(async () => {
      codes.push(await result.current.keep('Higher minimum'))
    })
    keep.mockRejectedValueOnce(
      new AidWriteError('Your draft is the same as C: there is nothing new to keep', 409)
    )
    await act(async () => {
      codes.push(await result.current.keep('Again'))
    })
    expect(codes).toEqual(['C', null])
    expect(result.current.error).toBe('Your draft is the same as C: there is nothing new to keep')
  })

  it('refuses a fitted document once the draft has moved on', async () => {
    const { result } = setup()
    let landed = true
    await act(async () => {
      landed = await result.current.adopt(WS.draft!.document, 'trail0000000099')
    })
    expect(landed).toBe(false)
    expect(result.current.error).toBe('Your draft changed since: fit again.')
    expect(calls).toEqual([])
  })

  it('sends the rules version the screen opened with on a release and on Use It (A11b; F6)', async () => {
    const ws = workspace({
      pricing_version: 3,
      draft: scenarioDraft({ trail_id: 'trail0000000001' }),
    })
    const { result } = setup(ws)
    act(() => result.current.type('awards.minimum', '125'))
    await act(async () => {
      await result.current.release()
    })
    await act(async () => {
      await result.current.adopt(ws.draft!.document, 'trail0000000001')
    })
    expect(calls.map(([, body]) => (body as { opened_version?: number }).opened_version)).toEqual([
      3, 3,
    ])
  })
})
