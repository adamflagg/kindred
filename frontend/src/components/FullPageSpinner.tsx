import { Loader2 } from 'lucide-react'

// KEPT — deliberately NOT deleted by kindred#2379, despite that issue naming
// this exact line: `role="status"` is not an AT announcement here (no AT
// users, per frontend/CLAUDE.md), it is the query handle `ProtectedRoute`,
// `AdminRoute`, and `RequirePermission`'s tests use for "still loading" — see
// this file's own regression test (kindred#2348) and its comment.
export const FullPageSpinner = () => (
  <div className="flex min-h-screen items-center justify-center" role="status">
    <Loader2 className="text-primary h-12 w-12 animate-spin" />
  </div>
)
