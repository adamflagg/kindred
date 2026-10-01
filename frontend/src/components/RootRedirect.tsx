import { Navigate } from 'react-router'

import { canOpenProgram } from '../config/programAccess'
import { useAuth } from '../contexts/AuthContext'
import { useProgram } from '../contexts/ProgramContext'
import { usePermissions } from '../hooks/usePermissions'
import ProgramLandingPage from '../pages/ProgramLandingPage'
import { getProgramHomeUrl } from '../utils/programUrls'
import { FullPageSpinner } from './FullPageSpinner'

/**
 * `/`: open the saved program, or show the picker. A saved program the user can no longer open
 * (Camperships after a role is removed) falls back to the picker (spec §3.1). The picker then
 * lists only what they can open.
 */
export function RootRedirect() {
  const { currentProgram } = useProgram()
  const { isLoading } = useAuth()
  const { hasPermission } = usePermissions()

  if (isLoading) return <FullPageSpinner />
  if (currentProgram && canOpenProgram(currentProgram, { hasPermission })) {
    return <Navigate to={getProgramHomeUrl(currentProgram)} replace />
  }
  return <ProgramLandingPage />
}
