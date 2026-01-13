import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import clsx from 'clsx';

interface CamperLinkProps {
  /** CampMinder person ID - must be positive to be valid for linking */
  personCmId: number | null | undefined;
  /** Name to display */
  displayName: string;
  /** Whether the request/match is confirmed (resolved status) */
  isConfirmed: boolean;
  /** Whether to show "(unresolved)" suffix for unconfirmed requests */
  showUnresolved?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Renders a camper name that links to their detail page when:
 * 1. The personCmId is valid (positive number)
 * 2. The request is confirmed (isConfirmed = true)
 *
 * Otherwise renders as plain text.
 *
 * Use this for request targets to provide quick navigation to related campers.
 */
export default function CamperLink({
  personCmId,
  displayName,
  isConfirmed,
  showUnresolved = false,
  className,
}: CamperLinkProps) {
  // Determine if we can create a valid link
  const hasValidId = personCmId != null && personCmId > 0;
  const canLink = hasValidId && isConfirmed;

  // Determine display text
  const text = displayName || (hasValidId ? 'View camper' : '');

  // Build unresolved suffix
  const unresolvedSuffix = showUnresolved && !isConfirmed ? ' (unresolved)' : '';

  if (canLink) {
    return (
      <Link
        to={`/summer/camper/${personCmId}`}
        className={clsx(
          'inline-flex items-center gap-1 font-medium',
          'text-foreground hover:text-primary hover:underline',
          'transition-colors',
          className
        )}
        onClick={(e) => e.stopPropagation()}
        data-testid="camper-link-container"
      >
        {text}
        <ExternalLink className="w-3 h-3 opacity-60 flex-shrink-0" />
      </Link>
    );
  }

  // Render as plain text
  return (
    <span
      className={clsx(
        'text-muted-foreground',
        !isConfirmed && 'italic',
        className
      )}
      data-testid="camper-link-container"
    >
      {text}{unresolvedSuffix}
    </span>
  );
}
