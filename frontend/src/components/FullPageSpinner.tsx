import { Loader2 } from 'lucide-react'

export const FullPageSpinner = () => (
  <div className="flex min-h-screen items-center justify-center" role="status">
    <Loader2 className="text-primary h-12 w-12 animate-spin" />
  </div>
)
