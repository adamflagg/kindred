/**
 * Tests for ConfigTab route-based category navigation
 * ConfigTab reads category from URL params instead of useState
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigTab } from './ConfigTab'

// Mock useSolverConfig to avoid API calls
vi.mock('../../hooks/useSolverConfig', () => ({
  useSolverConfig: vi.fn(() => ({
    data: {
      sections: [
        {
          id: 'test-section',
          name: 'Test Section',
          description: 'Test',
          configs: [
            {
              config_key: 'test_key',
              value: '10',
              description: 'A test config',
              metadata: {
                friendly_name: 'Test Setting',
                business_category: 'solver',
                component_type: 'number',
              },
            },
          ],
        },
        {
          id: 'processing-section',
          name: 'Processing Section',
          description: 'Processing',
          configs: [
            {
              config_key: 'proc_key',
              value: '5',
              description: 'A processing config',
              metadata: {
                friendly_name: 'Processing Setting',
                business_category: 'processing',
                component_type: 'number',
              },
            },
          ],
        },
      ],
    },
    isLoading: false,
    error: null,
  })),
}))

vi.mock('../../hooks/useSolverConfigMutation', () => ({
  useUpdateSolverConfig: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useResetSolverConfig: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

const renderWithRouter = (category: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/config/${category}`]}>
        <Routes>
          <Route path="/admin/config/:category" element={<ConfigTab />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ConfigTab', () => {
  it('renders category sidebar with links', () => {
    renderWithRouter('solver')

    // Category sidebar should use links, not buttons
    expect(screen.getByRole('link', { name: /bunk optimizer/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /request processing/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /data & history/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /registration/i })).toBeInTheDocument()
  })

  it('category links point to correct paths', () => {
    renderWithRouter('solver')

    expect(screen.getByRole('link', { name: /bunk optimizer/i })).toHaveAttribute(
      'href',
      '/admin/config/solver'
    )
    expect(screen.getByRole('link', { name: /request processing/i })).toHaveAttribute(
      'href',
      '/admin/config/processing'
    )
    expect(screen.getByRole('link', { name: /data & history/i })).toHaveAttribute(
      'href',
      '/admin/config/history'
    )
    expect(screen.getByRole('link', { name: /registration/i })).toHaveAttribute(
      'href',
      '/admin/config/registration'
    )
  })

  it('highlights active category from URL params - solver', () => {
    renderWithRouter('solver')

    const solverLink = screen.getByRole('link', { name: /bunk optimizer/i })
    const processingLink = screen.getByRole('link', { name: /request processing/i })

    // Active category should have the active styling
    expect(solverLink.className).toContain('text-forest-800')
    expect(processingLink.className).not.toContain('text-forest-800')
  })

  it('highlights active category from URL params - processing', () => {
    renderWithRouter('processing')

    const solverLink = screen.getByRole('link', { name: /bunk optimizer/i })
    const processingLink = screen.getByRole('link', { name: /request processing/i })

    expect(processingLink.className).toContain('text-forest-800')
    expect(solverLink.className).not.toContain('text-forest-800')
  })

  it('shows config sections for the active category', () => {
    renderWithRouter('solver')

    // Should show solver configs
    expect(screen.getByText('Test Setting')).toBeInTheDocument()
  })

  it('shows correct sections when navigating to processing', () => {
    renderWithRouter('processing')

    // Should show processing configs
    expect(screen.getByText('Processing Setting')).toBeInTheDocument()
  })
})
