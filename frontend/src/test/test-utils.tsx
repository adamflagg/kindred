/* eslint-disable react-refresh/only-export-components */
import type { ReactElement } from 'react';
import React from 'react'
import type { RenderOptions } from '@testing-library/react';
import { render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { Toaster } from 'react-hot-toast'

import { createTestQueryClient } from './test-helpers'
import { CurrentYearProvider } from '../contexts/CurrentYearContext'
import { ScenarioProvider } from '../contexts/ScenarioContext'
interface AllTheProvidersProps {
  children: React.ReactNode
}

const AllTheProviders = ({ children }: AllTheProvidersProps) => {
  const queryClient = createTestQueryClient()
  
  return (
    <QueryClientProvider client={queryClient}>
      <CurrentYearProvider>
        <ScenarioProvider>
          <BrowserRouter>
            <Toaster />
            {children}
          </BrowserRouter>
        </ScenarioProvider>
      </CurrentYearProvider>
    </QueryClientProvider>
  )
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options })

// Re-export everything
export * from '@testing-library/react'
export { customRender as render }