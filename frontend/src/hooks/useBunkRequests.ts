import { useContext } from 'react';
import { BunkRequestContext } from '../contexts/BunkRequestContext';

export function useBunkRequestContext() {
  const context = useContext(BunkRequestContext);
  if (!context) {
    throw new Error('useBunkRequestContext must be used within BunkRequestProvider');
  }
  return context;
}

// Compatibility hook to match existing useBunkRequests interface
export function useBunkRequestsFromContext(camperPersonIds: number[]) {
  const { hasRequests, isLoading } = useBunkRequestContext();
  
  // React Compiler will optimize this computation
  const getRequestStatus = () => {
    const status: Record<number, boolean> = {};
    camperPersonIds.forEach(id => {
      status[id] = hasRequests(id);
    });
    return status;
  };
  
  const requestStatus = getRequestStatus();

  return {
    data: requestStatus,
    isLoading,
  };
}