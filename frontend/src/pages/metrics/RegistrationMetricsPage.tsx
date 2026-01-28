/**
 * RegistrationMetricsPage - Main page for viewing registration metrics.
 * Registration tab shows current year only. Trends tab shows year-over-year comparison.
 */

import { useState } from 'react';
import { useCurrentYear } from '../../hooks/useCurrentYear';
import { CompareYearSelector } from '../../components/metrics/CompareYearSelector';
import { FilterBar } from '../../components/metrics/FilterBar';
import { RetentionTab } from './RetentionTab';
import { RegistrationTab } from './RegistrationTab';
import { TrendsTab } from './TrendsTab';

type TabType = 'registration' | 'retention' | 'trends';

/** Default session types for summer camp metrics */
const DEFAULT_SESSION_TYPES = ['main', 'embedded', 'ag'];

export function RegistrationMetricsPage() {
  const { currentYear, availableYears } = useCurrentYear();
  // Compare year is only used for Trends tab
  const [compareYear, setCompareYear] = useState(currentYear - 1);
  const [activeTab, setActiveTab] = useState<TabType>('registration');

  // Filter state - only session types now (status is always "enrolled")
  const [selectedSessionTypes, setSelectedSessionTypes] = useState<string[]>(DEFAULT_SESSION_TYPES);

  // Convert arrays to comma-separated strings for API
  const sessionTypesParam = selectedSessionTypes.join(',');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Registration Metrics</h1>
          <p className="mt-1 text-muted-foreground">
            Analyze registration data and retention trends
          </p>
        </div>

        {/* Compare Year Selector + Filters */}
        <div className="space-y-4 mb-6">
          {/* CompareYearSelector shown for Trends tab only */}
          {/* RetentionTab uses currentYear and calculates its own year range */}
          {/* RegistrationTab shows current year only - no comparison */}
          {activeTab === 'trends' && (
            <CompareYearSelector
              primaryYear={currentYear}
              compareYear={compareYear}
              onCompareYearChange={setCompareYear}
              availableYears={availableYears}
            />
          )}
          {/* FilterBar only shown for Trends tab */}
          {/* RegistrationTab and RetentionTab have their own session selectors */}
          {activeTab === 'trends' && (
            <FilterBar
              selectedStatuses={['enrolled']}
              onStatusChange={() => {}} // Status not changeable
              selectedSessionTypes={selectedSessionTypes}
              onSessionTypeChange={setSelectedSessionTypes}
            />
          )}
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-border mb-6">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('registration')}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'registration'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              Summer Registration
            </button>
            <button
              onClick={() => setActiveTab('retention')}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'retention'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              Retention
            </button>
            <button
              onClick={() => setActiveTab('trends')}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'trends'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              Historical Trends
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'registration' && (
            <RegistrationTab
              year={currentYear}
              sessionTypes={sessionTypesParam}
            />
          )}
          {activeTab === 'retention' && (
            <RetentionTab
              currentYear={currentYear}
              sessionTypes={sessionTypesParam}
            />
          )}
          {activeTab === 'trends' && (
            <TrendsTab sessionTypes={sessionTypesParam} />
          )}
        </div>
      </div>
    </div>
  );
}
