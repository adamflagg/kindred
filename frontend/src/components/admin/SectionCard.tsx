import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ConfigSection, type ConfigWithMetadata } from '../../hooks/useSolverConfig';
import { inferScaleType } from '../../utils/scaleContext';
import {
  COMPONENT_MAP,
  inferComponentType,
  ImpactBadge,
  ScaleContextBar,
  ScaleTooltip,
  PortalTooltip,
  TextInput,
  Info,
} from './ConfigInputs';

export interface SectionCardProps {
  section: ConfigSection;
  editedValues: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  defaultExpanded?: boolean;
}

export function SectionCard({ section, editedValues, onValueChange, defaultExpanded = true }: SectionCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const renderConfigRow = (item: ConfigWithMetadata) => {
    const fullKey = [item.category, item.subcategory, item.config_key].filter(Boolean).join('.');
    const editedValue = editedValues[fullKey];
    const currentValue = editedValue !== undefined ? editedValue : String(item.value);
    const hasChange = editedValue !== undefined && editedValue !== String(item.value);
    const numericValue = parseFloat(currentValue);

    // Use metadata component_type or infer from value
    let componentType = item.metadata?.['component_type'];
    if (!componentType) {
      componentType = inferComponentType(item.value, item.config_key);
    }

    // Merge component_config with metadata min/max
    const baseConfig = (item.metadata?.['component_config'] as Record<string, unknown>) || {};
    const componentConfig: Record<string, unknown> = {
      ...baseConfig,
      ...(item.metadata?.['min_value'] != null ? { min: item.metadata['min_value'] as number } : {}),
      ...(item.metadata?.['max_value'] != null ? { max: item.metadata['max_value'] as number } : {}),
    };
    const Component = COMPONENT_MAP[componentType as string] || TextInput;

    // Determine scale type for numeric values (not toggles)
    const isNumeric = componentType !== 'toggle' && componentType !== 'select' && !isNaN(numericValue);
    const scaleType = isNumeric ? inferScaleType(item.config_key, numericValue, item.metadata) : 'unknown';
    const showScaleContext = isNumeric && scaleType !== 'unknown';

    return (
      <div
        key={item.id}
        className="px-4 py-3.5 hover:bg-muted/20 dark:hover:bg-muted/10 transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
          {/* Left side: Label and description */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-base text-foreground">
                {item.metadata?.friendly_name || item.config_key}
              </span>
              {/* Impact badge for numeric values */}
              {showScaleContext && (
                <ImpactBadge scaleType={scaleType} value={numericValue} metadata={item.metadata} />
              )}
              {/* Existing tooltip */}
              {item.metadata?.tooltip && (
                <PortalTooltip
                  content={
                    <div className="bg-popover text-popover-foreground text-sm rounded-lg p-3 shadow-lg border border-border leading-relaxed">
                      {item.metadata.tooltip}
                    </div>
                  }
                >
                  <Info className="w-4 h-4 text-muted-foreground cursor-help flex-shrink-0" />
                </PortalTooltip>
              )}
            </div>
            {item.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                {item.description}
              </p>
            )}
            {/* Scale context bar */}
            {showScaleContext && (
              <div className="mt-2 max-w-[200px]">
                <ScaleContextBar scaleType={scaleType} value={numericValue} metadata={item.metadata} />
              </div>
            )}
          </div>

          {/* Right side: Input and scale tooltip */}
          <div className="flex items-center gap-2 flex-shrink-0">
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
              <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="Unsaved change" />
            )}
          </div>
        </div>
      </div>
    );
  };

  if (section.configs.length === 0) {
    return null;
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <button
        className="w-full px-5 py-4 flex items-center justify-between bg-muted/30 dark:bg-muted/50 hover:bg-muted/50 dark:hover:bg-muted/70 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="text-left">
          <h3 className="font-semibold text-base text-foreground">{section.title}</h3>
          {section.description && (
            <p className="text-sm text-muted-foreground mt-1">{section.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground font-medium">{section.configs.length}</span>
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="divide-y divide-border">
          {section.configs.map(config => renderConfigRow(config))}
        </div>
      )}
    </div>
  );
}
