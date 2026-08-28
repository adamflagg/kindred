import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn() }),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026 }),
}))

vi.mock('../services/sync', () => ({
  syncService: {
    uploadBunkRequestsCSV: vi.fn(),
  },
}))

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
}

vi.mock('react-hot-toast', () => ({
  default: mockToast,
}))

const BunkRequestsUpload = (await import('./BunkRequestsUpload')).default

function renderUpload(props: { label?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BunkRequestsUpload {...props} />
    </QueryClientProvider>
  )
}

/** Drive the component from file-select through to the confirm click. */
async function uploadOnce() {
  const { syncService } = await import('../services/sync')
  vi.mocked(syncService.uploadBunkRequestsCSV).mockResolvedValueOnce({
    filename: 'test.csv',
    process_requests_started: true,
  } as never)

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['name,target\nEmma,Liam'], 'test.csv', { type: 'text/csv' })
  fireEvent.change(fileInput, { target: { files: [file] } })

  const uploadButtons = await screen.findAllByRole('button', { name: /Upload/i })
  const confirmBtn = uploadButtons[uploadButtons.length - 1]
  expect(confirmBtn).toBeDefined()
  fireEvent.click(confirmBtn!)
}

describe('BunkRequestsUpload floatover/tooltip', () => {
  it('upload button tooltip reads "Camper report: API Bunking Info"', () => {
    renderUpload()
    // The upload button has a title attribute acting as the floatover/tooltip.
    const btn = screen.getByRole('button', { name: /Upload/i })
    expect(btn.getAttribute('title')).toBe('Camper report: API Bunking Info')
  })
})

describe('BunkRequestsUpload upload success toast', () => {
  beforeEach(() => {
    mockToast.success.mockClear()
    mockToast.error.mockClear()
  })

  it('shows the locked toast copy on successful upload', async () => {
    const { syncService } = await import('../services/sync')
    vi.mocked(syncService.uploadBunkRequestsCSV).mockResolvedValueOnce({
      filename: 'test.csv',
      process_requests_started: true,
    } as never)

    renderUpload()

    // Find the hidden file input and simulate selecting a CSV file (this opens the modal).
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    const file = new File(['name,target\nEmma,Liam'], 'test.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    // The modal opens with a confirmation Upload button. Click it to fire the mutation.
    // There are now multiple "Upload" buttons (the original trigger + the confirm button in modal).
    const uploadButtons = await screen.findAllByRole('button', { name: /Upload/i })
    // The confirm button is the last one rendered (inside the modal).
    const confirmBtn = uploadButtons[uploadButtons.length - 1]
    expect(confirmBtn).toBeDefined()
    fireEvent.click(confirmBtn!)

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('Importing CSV — this may take a few minutes'),
        expect.objectContaining({ duration: 6000 })
      )
    })
  })
})

// kindred#2478 §4 TRAP 3: the weekend surface renders this same component as
// "Upload Bunk Notes". The label appears in TWO places — the button and the
// success toast — and a toast that names a button the reader cannot see is the
// defect these tests pin.
describe('BunkRequestsUpload label parameterisation (kindred#2478 §4)', () => {
  beforeEach(() => {
    mockToast.success.mockClear()
    mockToast.error.mockClear()
  })

  it('defaults to summer\'s "Upload Requests" on the button', () => {
    renderUpload()
    expect(screen.getByText('Upload Requests')).toBeInTheDocument()
  })

  it("defaults to summer's byte-identical toast copy", async () => {
    renderUpload()
    await uploadOnce()
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        "Importing CSV — this may take a few minutes. The icon next to the Upload Requests button will update when it's done.",
        { duration: 6000 }
      )
    })
  })

  it('renders a caller-supplied label on the button', () => {
    renderUpload({ label: 'Upload Bunk Notes' })
    expect(screen.getByText('Upload Bunk Notes')).toBeInTheDocument()
    expect(screen.queryByText('Upload Requests')).not.toBeInTheDocument()
  })

  it('names the caller-supplied label in the success toast, not "Upload Requests"', async () => {
    renderUpload({ label: 'Upload Bunk Notes' })
    await uploadOnce()
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('next to the Upload Bunk Notes button'),
        expect.objectContaining({ duration: 6000 })
      )
    })
    const copy = mockToast.success.mock.calls[0]?.[0] as string
    expect(copy).not.toContain('Upload Requests')
  })
})
