import type { FC } from 'react'
import { Github } from 'lucide-react'

interface VersionInfoProps {
  className?: string
}

const GITHUB_REPO_URL = 'https://github.com/adamflagg/kindred'

export const VersionInfo: FC<VersionInfoProps> = ({ className = '' }) => {
  const version = import.meta.env.VITE_APP_VERSION

  return (
    <div className={`flex items-center gap-2 text-xs text-gray-400 ${className}`}>
      {version && version !== 'undefined' && (
        <>
          <span>Kindred {version}</span>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 transition-colors hover:text-gray-300"
            aria-label="View source on GitHub"
          >
            <Github size={14} />
          </a>
        </>
      )}
    </div>
  )
}
