import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const BunkRequestsUpload = (await import('./BunkRequestsUpload')).default

function renderUpload() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BunkRequestsUpload />
    </QueryClientProvider>
  )
}

describe('BunkRequestsUpload floatover/tooltip', () => {
  it('upload button tooltip reads "Camper report: API Bunking Info"', () => {
    renderUpload()
    // The upload button has a title attribute acting as the floatover/tooltip.
    const btn = screen.getByRole('button', { name: /Upload/i })
    expect(btn.getAttribute('title')).toBe('Camper report: API Bunking Info')
  })
})
