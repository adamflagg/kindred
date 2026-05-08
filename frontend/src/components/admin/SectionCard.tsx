import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { type ConfigSection, type ConfigWithMetadata } from '../../hooks/useSolverConfig'
import { inferScaleType } from '../../utils/scaleContext'
import {
  COMPONENT_MAP,
  inferComponentType,
  ImpactBadge,
  ScaleContextBar,
  ScaleTooltip,
  PortalTooltip,
  TextInput,
  Info,
} from './ConfigInputs'

export interface SectionCardProps {
  section: ConfigSection
  editedValues: Record<string, string>
  onValueChange: (key: string, value: string) => void
  defaultExpanded?: boolean
}

export function SectionCard({
  section,
  editedValues,
  onValueChange,
  defaultExpanded = true,
}: SectionCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const renderConfigRow = (item: ConfigWithMetadata) => {
    const fullKey = [item.category, item.subcategory, item.config_key].filter(Boolean).join('.')
    const editedValue = editedValues[fullKey]
    if (item.value !== null && typeof item.value === 'object') {
      console.warn(`Config row ${fullKey} has object-typed value; not rendering`)
      return null
    }
    const currentValue = editedValue ?? String(item.value ?? '')
    const hasChange = editedValue !== undefined && editedValue !== String(item.value)
    const numericValue = parseFloat(currentValue)

    // Use metadata component_type or infer from value
    let componentType = item.metadata?.['component_type']
    componentType ??= inferComponentType(item.value, item.config_key)

    // Merge component_config with metadata min/max
    const raw = item.metadata?.['component_config']
    const baseConfig =
      raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const componentConfig: Record<string, unknown> = {
      ...baseConfig,
      ...(item.metadata?.['min_value'] != null
        ? { min: item.metadata['min_value'] as number }
        : {}),
      ...(item.metadata?.['max_value'] != null
        ? { max: item.metadata['max_value'] as number }
        : {}),
    }
    const Component = COMPONENT_MAP[componentType as string] ?? TextInput

    // Determine scale type for numeric values (not toggles)
    const isNumeric =
      componentType !== 'toggle' && componentType !== 'select' && !isNaN(numericValue)
    const scaleType = isNumeric
      ? inferScaleType(item.config_key, numericValue, item.metadata)
      : 'unknown'
    const showScaleContext = isNumeric && scaleType !== 'unknown'

    return (
      <div
        key={item.id}
        className="hover:bg-muted/20 dark:hover:bg-muted/10 px-4 py-3.5 transition-colors"
      >
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start sm:gap-4">
          {/* Left side: Label and description */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground text-base font-medium">
                {item.metadata?.friendly_name ?? item.config_key}
              </span>
              {/* Impact badge for numeric values */}
              {showScaleContext && (
                <ImpactBadge scaleType={scaleType} value={numericValue} metadata={item.metadata} />
              )}
              {/* Existing tooltip */}
              {item.metadata?.tooltip && (
                <PortalTooltip
                  content={
                    <div className="bg-popover text-popover-foreground border-border rounded-lg border p-3 text-sm leading-relaxed shadow-lg">
                      {item.metadata.tooltip}
                    </div>
                  }
                >
                  <Info className="text-muted-foreground h-4 w-4 flex-shrink-0 cursor-help" />
                </PortalTooltip>
              )}
            </div>
            {item.description && (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-relaxed">
                {item.description}
              </p>
            )}
            {/* Scale context bar */}
            {showScaleContext && (
              <div className="mt-2 max-w-[200px]">
                <ScaleContextBar
                  scaleType={scaleType}
                  value={numericValue}
                  metadata={item.metadata}
                />
              </div>
            )}
          </div>

          {/* Right side: Input and scale tooltip */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <Component
              value={currentValue}
              onChange={(value: string) => onValueChange(fullKey, value)}
              config={componentConfig}
            />
            {/* Scale explanation tooltip */}
            {showScaleContext && (
              <ScaleTooltip scaleType={scaleType} value={numericValue} metadata={item.metadata} />
            )}
            {hasChange && (
              <div
                className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-500"
                title="Unsaved change"
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  // Filter out object-typed configs so the count badge and empty-section guard are accurate.
  const displayedConfigs = section.configs.filter(
    (c) => c.value === null || typeof c.value !== 'object'
  )

  if (displayedConfigs.length === 0) {
    return null
  }

  return (
    <div className="bg-card border-border overflow-hidden rounded-xl border">
      {/* Header */}
      <button
        className="bg-muted/30 dark:bg-muted/50 hover:bg-muted/50 dark:hover:bg-muted/70 flex w-full items-center justify-between px-5 py-4 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="text-left">
          <h3 className="text-foreground text-base font-semibold">{section.title}</h3>
          {section.description && (
            <p className="text-muted-foreground mt-1 text-sm">{section.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm font-medium">
            {displayedConfigs.length}
          </span>
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground h-5 w-5" />
          ) : (
            <ChevronRight className="text-muted-foreground h-5 w-5" />
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="divide-border divide-y">
          {section.configs.map((config) => renderConfigRow(config))}
        </div>
      )}
    </div>
  )
}
