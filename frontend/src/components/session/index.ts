/**
 * Session components barrel export
 */

export { default as SessionHeader, type SessionHeaderProps } from './SessionHeader';

// Re-export session utilities for backward compatibility
export {
  parseSessionName,
  sortSessionsLogically,
  filterSelectableSessions,
} from '../../utils/sessionUtils';

export {
  default as AreaFilterBar,
  getAvailableAreas,
  type AreaFilterBarProps,
  type BunkArea,
} from './AreaFilterBar';

export {
  default as SessionTabs,
  createTabs,
  type TabItem,
} from './SessionTabs';

export { default as ClearAssignmentsDialog } from './ClearAssignmentsDialog';
