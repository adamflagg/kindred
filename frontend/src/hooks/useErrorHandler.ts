import { useState, useEffect } from 'react';

// Hook for using error boundary programmatically
export function useErrorHandler() {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return setError;
}
