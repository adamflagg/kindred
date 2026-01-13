import { useContext } from 'react';
import { CamperHistoryContext } from '../contexts/CamperHistoryContext';

export function useCamperHistoryContext() {
  const context = useContext(CamperHistoryContext);
  if (!context) {
    throw new Error('useCamperHistoryContext must be used within CamperHistoryProvider');
  }
  return context;
}