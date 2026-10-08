/** The March file in the Download CSV menu: reads fresh at each click, downloads, says what it did (§8.3; E). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidMarchFile } from '../../../types/api-types'
import { MarchFileItem, MarchFileResult } from './MarchFileButton'
import { useMarchFile } from './useMarchFile'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
const downloaded: Array<[string, string]> = []
vi.mock('../../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (content: string, name: string) => {
    downloaded.push([content, name])
  },
}))

const EMMA_ROW: ApiAidMarchFile['rows'][number] = {
  request_id: 'reqemma00000001',
  camper_first: 'Emma',
  camper_last: 'Johnson',
  total_award: 1420,
  primary_childhood_id: 1000001,
  personal_id: 1000011,
}
const FILE: ApiAidMarchFile = { year: 2027, rows: [EMMA_ROW], zero_left_out: 0 }
let answer: ApiAidMarchFile = FILE
let fetchSpy: MockInstance<typeof fetch>
beforeEach(() => {
  downloaded.length = 0
  answer = FILE
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

function Harness() {
  const march = useMarchFile(2027)
  return (
    <>
      <MarchFileItem march={march} />
      <MarchFileResult march={march} />
    </>
  )
}

function renderItem() {
  return render(
    // The app's 30-minute staleTime (utils/queryClient.ts), so a cached read would be served.
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { staleTime: 30 * 60 * 1000 } } })}
    >
      <Harness />
    </QueryClientProvider>
  )
}

const ITEM = /Download the March File, for CampMinder/
const click = () => userEvent.click(screen.getByRole('button', { name: ITEM }))

describe('the March File menu item', () => {
  it('carries the hint, and draws no result line before a click', () => {
    renderItem()
    expect(
      screen.getByText('Every Round 1 offer, not only this list · send it once; twice double-posts')
    ).toBeInTheDocument()
    expect(screen.queryByText(/March File downloaded/)).toBeNull()
  })

  it('reads the rows through fetchWithAuth, downloads the five columns, and says what it holds', async () => {
    renderItem()
    await click()
    expect(
      await screen.findByText('✓ March File downloaded: 1 row · 1 request.')
    ).toBeInTheDocument()
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/decisions/2027/march-file')
    expect(options.method).toBeUndefined()
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(downloaded[0]?.[1]).toBe('camperships-march-file-2027.csv')
    expect(downloaded[0]?.[0].split('\n')).toEqual([
      'Camper: (First),Camper: (Last),Total Award,Primary Childhood ID,Personal Id',
      'Emma,Johnson,1420,1000001,1000011',
    ])
  })

  it('says how many $0 Round 1 offers it left out, and where they stay (ruling E)', async () => {
    answer = { ...FILE, zero_left_out: 3 }
    renderItem()
    await click()
    expect(
      await screen.findByText(
        "✓ March File downloaded. 3 Round 1 offers of $0 aren't in the file; they stay in Needs an offer, for a letter and Mark Posted by hand."
      )
    ).toBeInTheDocument()
  })

  it('says it in the singular for one', async () => {
    answer = { ...FILE, zero_left_out: 1 }
    renderItem()
    await click()
    expect(
      await screen.findByText(
        "✓ March File downloaded. 1 Round 1 offer of $0 isn't in the file; it stays in Needs an offer, for a letter and Mark Posted by hand."
      )
    ).toBeInTheDocument()
  })

  it('dismisses the result line', async () => {
    renderItem()
    await click()
    await screen.findByText(/March File downloaded/)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/March File downloaded/)).toBeNull()
  })

  it('⚠ reads fresh at every click, never from the cache', async () => {
    renderItem()
    await click()
    await screen.findByText('✓ March File downloaded: 1 row · 1 request.')
    answer = { ...FILE, rows: [EMMA_ROW, { ...EMMA_ROW, request_id: 'reqliam00000001' }] }
    await click()
    expect(
      await screen.findByText('✓ March File downloaded: 2 rows · 2 requests.')
    ).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('reads "Making the File…" while it works, and ignores a second click', async () => {
    let release: (r: Response) => void = () => undefined
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        })
    )
    renderItem()
    await click()
    expect(screen.getByRole('button', { name: /Making the File…/ })).toBeDisabled()
    release(new Response(JSON.stringify(FILE), { status: 200 }))
    await screen.findByText(/March File downloaded/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("shows a refused read in the server's words, in amber, and downloads nothing", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'Not allowed' }), { status: 403 }))
    )
    renderItem()
    await click()
    const line = await screen.findByText('Not allowed')
    expect(line.className).toMatch(/amber/)
    expect(downloaded).toHaveLength(0)
  })
})
