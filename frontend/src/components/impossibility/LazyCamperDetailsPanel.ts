import { lazy } from 'react'

// Single shared lazy reference so Pre/Post/SolverDebug modals don't each
// hold their own lazy cache (which would re-fetch the chunk on warm
// navigation between modals).
export const LazyCamperDetailsPanel = lazy(() => import('../CamperDetailsPanel'))
