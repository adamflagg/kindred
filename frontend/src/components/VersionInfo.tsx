import type { FC } from 'react'
import { Tag } from 'lucide-react'
import { parseVersion } from '../utils/versionParser'

interface VersionInfoProps {
  className?: string
}

const GitHubIcon: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
)

export const VersionInfo: FC<VersionInfoProps> = ({ className = '' }) => {
  const parsed = parseVersion(import.meta.env.VITE_APP_VERSION)

  return (
    <div className={`flex items-center gap-2 text-xs text-gray-400 ${className}`}>
      {parsed && (
        <>
          <a
            href={parsed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-gray-400 transition-colors hover:text-gray-500"
          >
            <span>{`Kindred ${parsed.display}`}</span>
            {!parsed.ahead && <GitHubIcon />}
          </a>
          {parsed.ahead && (
            <a
              href={parsed.ahead.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-gray-400 transition-colors hover:text-gray-500"
            >
              <span>{parsed.ahead.display}</span>
              <GitHubIcon />
            </a>
          )}
        </>
      )}
    </div>
  )
}

interface VersionMenuRowProps {
  /** Called when either link is clicked, so the host menu can close. */
  onNavigate?: () => void
}

/**
 * The version as a row at the bottom of the Help menu, with its own divider.
 * Styled like the other help items. The tag opens the release page and "+N · sha"
 * opens the compare view; a bare-sha build is one link to the commit. Renders
 * nothing (no divider either) for a dev build.
 */
export const VersionMenuRow: FC<VersionMenuRowProps> = ({ onNavigate }) => {
  const parsed = parseVersion(import.meta.env.VITE_APP_VERSION)
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
          className="flex items-center gap-3"
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
