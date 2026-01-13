import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

// Create a fresh QueryClient for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });

interface WrapperProps {
  children: React.ReactNode;
}

// Create a wrapper with both Router and QueryClient
export function createWrapper() {
  const testQueryClient = createTestQueryClient();
  return function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={testQueryClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    );
  };
}

// Custom render function with all providers
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  const Wrapper = createWrapper();
  return render(ui, { wrapper: Wrapper, ...options });
};

// Re-export everything from testing-library
export * from '@testing-library/react';
export { customRender as render };
