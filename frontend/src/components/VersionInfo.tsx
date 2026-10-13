import type { FC } from 'react'
import { Tag } from 'lucide-react'
import { parseVersion } from '../utils/versionParser'
import { useDeployedVersions } from '../hooks/useDeployedVersions'

interface VersionMenuRowProps {
  /** Called when either link is clicked, so the host menu can close. */
  onNavigate?: () => void
}

/**
 * The version as a row at the bottom of the Help menu, with its own divider.
 * Styled like the other help items. The tag opens the release page and "+N · sha"
 * opens the compare view; a bare-sha build is one link to the commit. Renders
 * nothing (no divider either) for a dev build.
 *
 * Shows the NEWEST of the frontend's, the api's and PocketBase's versions: CD
 * rebuilds only the images whose files changed, so the frontend's own can lag.
 * Until the servers answer, or if they fail, it is the frontend's.
 */
export const VersionMenuRow: FC<VersionMenuRowProps> = ({ onNavigate }) => {
  const parsed = parseVersion(useDeployedVersions().newest)
  if (!parsed) return null

  const isBareSha = parsed.url.includes('/commit/')

  return (
    <>
      <div className="bg-border my-2 h-px" />
      <div className="hover:bg-muted/50 text-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors">
        <a
          href={parsed.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNavigate}
          className="flex flex-1 items-center gap-3"
        >
          <Tag className="text-muted-foreground h-4 w-4" />
          <span className={isBareSha ? 'font-mono' : undefined}>{parsed.display}</span>
        </a>
        {parsed.ahead ? (
          <a
            href={parsed.ahead.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onNavigate}
            className="text-muted-foreground ml-auto text-xs"
          >
            {parsed.ahead.display} · <span className="font-mono">{parsed.ahead.sha}</span>
          </a>
        ) : (
          !isBareSha && <span className="text-muted-foreground ml-auto text-xs">release</span>
        )}
      </div>
    </>
  )
}
