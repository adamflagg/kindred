/**
 * The Family Camp roster export affordance (kindred#2433, design §4.6).
 *
 * Modelled on SeasonRollForwardPanel's tests, which cover the only other
 * `/api/custom/lodging` POST: the same `fetchWithAuth` mocking, and the same
 * "never a bare fetch" assertion, because that endpoint family carries the
 * PocketBase JWT from localStorage rather than a cookie.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RosterExportButton } from './RosterExportButton'

const mockFetchWithAuth = vi.fn()
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

const RESULT = {
  spreadsheet_id: 'sheet-abc',
  url: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit',
  title: 'Family Camp 2 2026 Roster',
  tab_name: 'Aug 19, 2026 3:04 PM',
  session_cm_id: 1000001,
  session_name: 'Family Camp 2',
  year: 2026,
  household_count: 63,
  camper_count: 98,
  adult_count: 120,
  person_count: 218,
}

function ok(body: unknown = RESULT) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

function fail(status: number, error: string) {
  return { ok: false, status, json: () => Promise.resolve({ error }) }
}

// A client shared across renders inside one test, so a remount reads the cache
// the previous mount wrote — which is the whole point of the persistence tests.
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderButton(
  overrides: Partial<Parameters<typeof RosterExportButton>[0]> = {},
  client: QueryClient = newClient()
) {
  const ui = (
    <QueryClientProvider client={client}>
      <RosterExportButton year={2026} sessionCmId={1000001} sessionType="family" {...overrides} />
    </QueryClientProvider>
  )
  return { ...render(ui), client, ui }
}

const clickExport = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /export roster/i }))
}

beforeEach(() => {
  mockFetchWithAuth.mockReset()
  mockFetchWithAuth.mockResolvedValue(ok())
})

describe('RosterExportButton', () => {
  it('renders for a family weekend', () => {
    renderButton()
    expect(screen.getByRole('button', { name: /export roster/i })).toBeInTheDocument()
  })

  // Adult weekends enrol individuals rather than households and carry no
  // family_camp_adults rows at all, so the endpoint refuses them. Offering the
  // button would be an affordance whose only outcome is an error.
  it('renders nothing for an adult weekend', () => {
    const { container } = renderButton({ sessionType: 'adult' })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the session type is not yet known', () => {
    const { container } = renderButton({ sessionType: '' })
    expect(container).toBeEmptyDOMElement()
  })

  // A weekend with no enrolled campers is refused server-side. Without a
  // session there is nothing to export at all.
  it('renders nothing without a session', () => {
    const { container } = renderButton({ sessionCmId: 0 })
    expect(container).toBeEmptyDOMElement()
  })

  it('routes the export through fetchWithAuth, never a bare fetch', async () => {
    // Asserting only that a header reached an already-cooperating mock proves
    // nothing. The property worth pinning is that the raw network layer is
    // never touched: the PocketBase JWT lives in localStorage, so a bare fetch
    // would carry no Authorization header and 401 silently.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    renderButton()

    await clickExport()

    await waitFor(() => {
      expect(mockFetchWithAuth).toHaveBeenCalledTimes(1)
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    const [url, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/custom/lodging/roster-export')
    expect(url).toContain('year=2026')
    expect(url).toContain('session=1000001')
    expect(options.method).toBe('POST')
    fetchSpy.mockRestore()
  })

  it('disables the button while the export is in flight', async () => {
    let release: (value: unknown) => void = () => undefined
    mockFetchWithAuth.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    renderButton()

    await clickExport()

    const button = screen.getByRole('button', { name: /exporting/i })
    await waitFor(() => {
      expect(button).toBeDisabled()
    })

    release(ok())
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /open/i })).toBeInTheDocument()
    })
  })

  // The link IS the deliverable: the workbook lands in Drive, not in the app,
  // so an export that does not surface where it went has not finished.
  it('surfaces the workbook link and the counts on success', async () => {
    renderButton()

    await clickExport()

    const link = await screen.findByRole('link', { name: /open/i })
    expect(link).toHaveAttribute('href', RESULT.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText(/Aug 19, 2026 3:04 PM/)).toBeInTheDocument()
    expect(screen.getByText(/63 households/)).toBeInTheDocument()
    expect(screen.getByText(/218 people/)).toBeInTheDocument()
  })

  // The endpoint's refusals are prose staff can act on -- "no enrolled
  // campers" tells them the weekend is empty, which a bare status code does
  // not. This route is PocketBase, so the body carries `error`, not `detail`.
  it('surfaces the server error message', async () => {
    mockFetchWithAuth.mockResolvedValue(
      fail(400, 'session has no enrolled campers: Family Camp 8 (cm_id 1000009, year 2026)')
    )
    renderButton()

    await clickExport()

    expect(await screen.findByText(/no enrolled campers/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument()
  })

  it('falls back to the status code when the body carries no message', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    })
    renderButton()

    await clickExport()

    expect(await screen.findByText(/500/)).toBeInTheDocument()
  })

  // Re-exporting is normal: staff pull a fresh tab after a sync. The previous
  // run's link must not linger beside a new failure.
  it('clears a previous result when a later export fails', async () => {
    renderButton()
    await clickExport()
    expect(await screen.findByRole('link', { name: /open/i })).toBeInTheDocument()

    mockFetchWithAuth.mockResolvedValue(fail(500, 'Drive is unreachable'))
    await clickExport()

    expect(await screen.findByText(/Drive is unreachable/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument()
  })
})

describe('RosterExportButton persistence and layout', () => {
  // Staff export, wander off to the Housing tab or another weekend, and come
  // back. Losing the link means the only record of where the workbook went is
  // gone, and the obvious recovery -- press it again -- appends a redundant tab
  // to a workbook whose tabs are hand-edited.
  it('keeps the link when the roster is unmounted and mounted again', async () => {
    const client = newClient()
    const first = renderButton({}, client)
    await clickExport()
    expect(await screen.findByRole('link', { name: /open/i })).toBeInTheDocument()

    first.unmount()
    render(
      <QueryClientProvider client={client}>
        <RosterExportButton year={2026} sessionCmId={1000001} sessionType="family" />
      </QueryClientProvider>
    )

    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', RESULT.url)
    // Restoring from cache must not re-run the export: a second POST would
    // append a second tab to the workbook.
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1)
  })

  // Each weekend owns its own workbook, so one weekend's link must never show
  // on another's roster — that link opens the wrong families' contact details.
  it('scopes the remembered link to its own weekend', async () => {
    const client = newClient()
    const first = renderButton({}, client)
    await clickExport()
    expect(await screen.findByRole('link', { name: /open/i })).toBeInTheDocument()

    first.unmount()
    render(
      <QueryClientProvider client={client}>
        <RosterExportButton year={2026} sessionCmId={1000002} sessionType="family" />
      </QueryClientProvider>
    )

    expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument()
  })

  // The error describes the LAST ATTEMPT, not a durable fact about the weekend.
  // Re-showing it on return would report a failure that is not happening now.
  it('does not carry an error across a remount', async () => {
    const client = newClient()
    mockFetchWithAuth.mockResolvedValue(fail(500, 'Drive is unreachable'))
    const first = renderButton({}, client)
    await clickExport()
    expect(await screen.findByText(/Drive is unreachable/)).toBeInTheDocument()

    first.unmount()
    render(
      <QueryClientProvider client={client}>
        <RosterExportButton year={2026} sessionCmId={1000001} sessionType="family" />
      </QueryClientProvider>
    )

    expect(screen.queryByText(/Drive is unreachable/)).not.toBeInTheDocument()
  })

  // The result sits BESIDE the button, not under it. Stacking grew the toolbar
  // the moment a result appeared and shoved the whole roster table down the
  // page. jsdom does no layout, so this pins the mechanism -- one row, not a
  // column -- and the rendered result is confirmed by eye.
  it('renders the result beside the button rather than stacked under it', async () => {
    renderButton()
    const button = screen.getByRole('button', { name: /export roster/i })
    const row = button.parentElement
    expect(row?.className).toContain('items-center')
    expect(row?.className).not.toContain('flex-col')

    await clickExport()

    const link = await screen.findByRole('link', { name: /open/i })
    // Same row as the button: a shared parent is what keeps the toolbar one
    // line tall whether or not a result is showing.
    expect(row).toContainElement(link)
  })
})

// Caught in the browser, not by the suite above: React Query logs
//   "No queryFn was passed as an option, and no default queryFn was found"
// for a query declared without one, EVEN when `enabled: false` means it can
// never run. This slot is deliberately never fetched -- refetching would POST
// again and append a second tab -- so the queryFn has to exist and refuse.
it('declares the export cache slot without logging a React Query error', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  renderButton()

  await clickExport()
  await screen.findByRole('link', { name: /open/i })

  expect(consoleError).not.toHaveBeenCalled()
  consoleError.mockRestore()
})
