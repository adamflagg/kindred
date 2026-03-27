import { Navigate, useLocation } from 'react-router'
import { useProgram } from '../contexts/ProgramContext'
import { getProgramHomeUrl } from '../utils/programUrls'

export function ProgramRoute() {
  const { currentProgram } = useProgram()
  const location = useLocation()

  // If a program is already selected, redirect to it
  if (currentProgram) {
    return <Navigate to={getProgramHomeUrl(currentProgram)} state={{ from: location }} replace />
  }

  // Otherwise, show the program selection page
  return null
}
