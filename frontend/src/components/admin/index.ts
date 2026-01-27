// Admin component exports
// Re-export components for external use

export { SyncTab } from './SyncTab';
export { SYNC_TYPES, YEAR_SYNC_TYPES, getYearSyncTypes } from './syncTypes';
export { ConfigTab, CATEGORIES } from './ConfigTab';
export { SectionCard, type SectionCardProps } from './SectionCard';
export { ScaleGuideSidebar, type ScaleGuideSidebarProps } from './ScaleGuideSidebar';
export {
  // Input components
  ToggleSwitch,
  Slider,
  NumberInput,
  SelectInput,
  TextInput,
  COMPONENT_MAP,
  inferComponentType,
  // Status components
  StatusIcon,
  formatDuration,
  // Scale context UI
  ImpactBadge,
  ScaleContextBar,
  PortalTooltip,
  ScaleTooltip,
  // Types
  type ToggleSwitchProps,
  type SliderProps,
  type NumberInputProps,
  type SelectInputProps,
  type TextInputProps,
  type ImpactBadgeProps,
  type ScaleContextBarProps,
  type PortalTooltipProps,
  type ScaleTooltipProps,
} from './ConfigInputs';
