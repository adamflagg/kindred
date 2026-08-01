import { useNavigate, useLocation } from 'react-router'
import { useProgram } from '../contexts/ProgramContext'
import { useCallback } from 'react'
import {
  getSessionUrl,
  getCamperUrl,
  getAllCampersUrl,
  getSessionsListUrl,
  getUsersUrl,
  getUserUrl,
  getSummerUrl,
  getWeekendUrl,
  getProgramFromPath,
  getProgramHomeUrl,
} from '../utils/programUrls'

/**
 * Hook for program-aware navigation
 * Provides utilities for navigating within the current program context
 */
export function useNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentProgram } = useProgram()

  // Determine active program from URL or context
  const activeProgram = getProgramFromPath(location.pathname) ?? currentProgram ?? 'summer'

  // Navigate to a session
  const navigateToSession = useCallback(
    (sessionId: string, tab?: string) => {
      void navigate(getSessionUrl(sessionId, tab))
    },
    [navigate]
  )

  // Navigate to a camper detail
  const navigateToCamper = useCallback(
    (camperId: string | number) => {
      void navigate(getCamperUrl(camperId))
    },
    [navigate]
  )

  // Navigate to all campers view
  const navigateToAllCampers = useCallback(() => {
    void navigate(getAllCampersUrl())
  }, [navigate])

  // Navigate to sessions list
  const navigateToSessions = useCallback(() => {
    void navigate(getSessionsListUrl())
  }, [navigate])

  // Navigate to users
  const navigateToUsers = useCallback(() => {
    void navigate(getUsersUrl())
  }, [navigate])

  // Navigate to user profile
  const navigateToUser = useCallback(() => {
    void navigate(getUserUrl())
  }, [navigate])

  // Navigate within current program
  const navigateInProgram = useCallback(
    (path: string) => {
      if (activeProgram === 'summer') {
        void navigate(getSummerUrl(path))
      } else {
        void navigate(getWeekendUrl(path))
      }
    },
    [navigate, activeProgram]
  )

  // Switch to a different program
  const switchProgram = useCallback(
    (program: 'summer' | 'weekend' | 'analytics') => {
      void navigate(getProgramHomeUrl(program))
    },
    [navigate]
  )

  return {
    navigateToSession,
    navigateToCamper,
    navigateToAllCampers,
    navigateToSessions,
    navigateToUsers,
    navigateToUser,
    navigateInProgram,
    switchProgram,
    activeProgram,
    // Also export the URL generators for Link components
    getSessionUrl,
    getCamperUrl,
    getAllCampersUrl,
    getSessionsListUrl,
    getUsersUrl,
    getUserUrl,
    getSummerUrl,
    getWeekendUrl,
  }
}
