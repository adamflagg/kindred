import { BookOpen, ExternalLink } from 'lucide-react'
import { getDocsUrl } from '../config/branding'
import { useHelpKey } from './useHelpKey'

/** Help-menu link to the guide page for the current screen. Hidden when the build has no docs_url. */
export function StaffGuideMenuItem({ onNavigate }: { onNavigate: () => void }) {
  const key = useHelpKey()
  const base = getDocsUrl()
  if (!base) return null
  return (
    <a
      href={`${base.replace(/\/+$/, '')}/go/${key}/`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      className="hover:bg-muted/50 text-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
    >
      <BookOpen className="text-muted-foreground h-4 w-4" />
      Staff Guide
      <ExternalLink className="text-muted-foreground ml-auto h-3 w-3" />
    </a>
  )
}
