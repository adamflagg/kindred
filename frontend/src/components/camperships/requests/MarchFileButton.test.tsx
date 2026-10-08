/** The March file's button: reads fresh at each click, downloads the CSV, says what it holds (§8.3; E). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidMarchFile } from '../../../types/api-types'
import { MarchFileButton } from './MarchFileButton'

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

function renderButton() {
  return render(
    // The app's 30-minute staleTime (utils/queryClient.ts), so a cached read would be served.
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { staleTime: 30 * 60 * 1000 } } })}
    >
      <MarchFileButton year={2027} />
    </QueryClientProvider>
  )
}

const click = () => userEvent.click(screen.getByRole('button', { name: 'Download the March File' }))

describe('MarchFileButton', () => {
  it('reads the rows through fetchWithAuth, downloads the five columns, and says what it holds', async () => {
    renderButton()
    expect(
      screen.getByText(/for every Round 1 offer this season, whatever the filters show\./)
    ).toBeInTheDocument()
    await click()
    expect(await screen.findByText('Downloaded: 1 row · 1 request.')).toBeInTheDocument()
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
    renderButton()
    await click()
    expect(
      await screen.findByText(
        "Downloaded: 1 row · 1 request. 3 Round 1 offers of $0 aren't in the file; they stay in Needs an offer, for a letter and Mark Posted by hand."
      )
    ).toBeInTheDocument()
  })

  it('⚠ reads fresh at every click, never from the cache', async () => {
    renderButton()
    await click()
    await screen.findByText('Downloaded: 1 row · 1 request.')
    answer = { ...FILE, rows: [EMMA_ROW, { ...EMMA_ROW, request_id: 'reqliam00000001' }] }
    await click()
    expect(await screen.findByText('Downloaded: 2 rows · 2 requests.')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("shows a refused read in the server's words and downloads nothing", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'Not allowed' }), { status: 403 }))
    )
    renderButton()
    await click()
    expect(await screen.findByText('Not allowed')).toBeInTheDocument()
    expect(downloaded).toHaveLength(0)
  })
})
