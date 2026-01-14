import type { ReactElement } from 'react';
import type { RenderOptions } from '@testing-library/react';
import { render } from '@testing-library/react';
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

/**
 * Type guard helper that narrows undefined/null to a defined value.
 * Use after find() operations when you expect the value to exist.
 * @example
 * const item = items.find(i => i.id === '1');
 * const defined = expectDefined(item, 'item with id 1');
 * // defined is now narrowed to non-null type
 */
export function expectDefined<T>(
  value: T | null | undefined,
  description = 'value'
): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${description} to be defined`);
  }
  return value;
}

// Re-export everything from testing-library
// eslint-disable-next-line react-refresh/only-export-components -- test utility re-exports
export * from '@testing-library/react';
export { customRender as render };
