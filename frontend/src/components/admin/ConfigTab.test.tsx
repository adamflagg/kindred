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
      <MemoryRouter initialEntries={[`/manage/config/${category}`]}>
        <Routes>
          <Route path="/manage/config/:category" element={<ConfigTab />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ConfigTab', () => {
  // Both mobile and desktop sidebars render links, so we use getAllByRole
  it('renders category sidebar with links', () => {
    renderWithRouter('solver')

    // Each category appears twice (mobile + desktop), all as links
    expect(screen.getAllByRole('link', { name: /bunk optimizer/i })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /request processing/i })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /data & history/i })).toHaveLength(2)
  })

  it('category links point to correct paths', () => {
    renderWithRouter('solver')

    // Check all instances point to correct paths
    for (const link of screen.getAllByRole('link', { name: /bunk optimizer/i })) {
      expect(link).toHaveAttribute('href', '/manage/config/solver')
    }
    for (const link of screen.getAllByRole('link', { name: /request processing/i })) {
      expect(link).toHaveAttribute('href', '/manage/config/processing')
    }
    for (const link of screen.getAllByRole('link', { name: /data & history/i })) {
      expect(link).toHaveAttribute('href', '/manage/config/history')
    }
  })

  it('highlights active category from URL params - solver', () => {
    renderWithRouter('solver')

    const solverLinks = screen.getAllByRole('link', { name: /bunk optimizer/i })
    const processingLinks = screen.getAllByRole('link', { name: /request processing/i })

    // At least one solver link should have active styling
    expect(solverLinks.some((link) => link.className.includes('text-forest-800'))).toBe(true)
    // No processing link should have active styling
    expect(processingLinks.every((link) => !link.className.includes('text-forest-800'))).toBe(true)
  })

  it('highlights active category from URL params - processing', () => {
    renderWithRouter('processing')

    const solverLinks = screen.getAllByRole('link', { name: /bunk optimizer/i })
    const processingLinks = screen.getAllByRole('link', { name: /request processing/i })

    expect(processingLinks.some((link) => link.className.includes('text-forest-800'))).toBe(true)
    expect(solverLinks.every((link) => !link.className.includes('text-forest-800'))).toBe(true)
  })

  it('shows config sections for the active category', () => {
    renderWithRouter('solver')

    expect(screen.getByText('Test Setting')).toBeInTheDocument()
  })

  it('shows correct sections when navigating to processing', () => {
    renderWithRouter('processing')

    expect(screen.getByText('Processing Setting')).toBeInTheDocument()
  })
})
