import { useNavigate } from 'react-router'
import { Lock, ArrowLeft } from 'lucide-react'

export default function PermissionDeniedPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="bg-muted/50 mb-6 rounded-2xl p-6">
        <Lock className="text-muted-foreground h-12 w-12" />
      </div>
      <h1 className="font-display text-foreground mb-2 text-2xl font-bold">
        Access Restricted
      </h1>
      <p className="text-muted-foreground mb-6 max-w-md">
        You don't have permission to view this page. Contact an admin to request
        access.
      </p>
      <button
        onClick={() => navigate(-1)}
        className="btn-primary flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Go Back
      </button>
    </div>
  )
}
