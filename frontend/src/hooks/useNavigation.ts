import { useNavigate, useLocation } from 'react-router';
import { useProgram } from '../contexts/ProgramContext';
import { useCallback } from 'react';
import { 
  getSessionUrl, 
  getCamperUrl, 
  getAllCampersUrl, 
  getSessionsListUrl,
  getSummerUrl,
  getFamilyUrl 
} from '../utils/programUrls';

/**
 * Hook for program-aware navigation
 * Provides utilities for navigating within the current program context
 */
export function useNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentProgram } = useProgram();
  
  // Determine active program from URL or context
  const activeProgram = location.pathname.startsWith('/summer') ? 'summer' 
    : location.pathname.startsWith('/family') ? 'family' 
    : currentProgram || 'summer';
  
  // Navigate to a session
  const navigateToSession = useCallback((sessionId: string, tab?: string) => {
    navigate(getSessionUrl(sessionId, tab));
  }, [navigate]);
  
  // Navigate to a camper detail
  const navigateToCamper = useCallback((camperId: string | number) => {
    navigate(getCamperUrl(camperId));
  }, [navigate]);
  
  // Navigate to all campers view
  const navigateToAllCampers = useCallback(() => {
    navigate(getAllCampersUrl());
  }, [navigate]);
  
  // Navigate to sessions list
  const navigateToSessions = useCallback(() => {
    navigate(getSessionsListUrl());
  }, [navigate]);
  
  // Navigate within current program
  const navigateInProgram = useCallback((path: string) => {
    if (activeProgram === 'summer') {
      navigate(getSummerUrl(path));
    } else {
      navigate(getFamilyUrl(path));
    }
  }, [navigate, activeProgram]);
  
  // Switch to a different program
  const switchProgram = useCallback((program: 'summer' | 'family') => {
    if (program === 'summer') {
      navigate('/summer/sessions');
    } else {
      navigate('/family/');
    }
  }, [navigate]);
  
  return {
    navigateToSession,
    navigateToCamper,
    navigateToAllCampers,
    navigateToSessions,
    navigateInProgram,
    switchProgram,
    activeProgram,
    // Also export the URL generators for Link components
    getSessionUrl,
    getCamperUrl,
    getAllCampersUrl,
    getSessionsListUrl,
    getSummerUrl,
    getFamilyUrl
  };
}