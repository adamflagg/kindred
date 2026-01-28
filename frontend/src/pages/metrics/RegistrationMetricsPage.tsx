/**
 * RegistrationMetricsPage - Main page for viewing registration metrics.
 * Always shows year-over-year comparison mode with "Compare to" dropdown.
 */

import { useState } from 'react';
import { Link } from 'react-router';
import { Settings } from 'lucide-react';
import { useCurrentYear } from '../../hooks/useCurrentYear';
import { CompareYearSelector } from '../../components/metrics/CompareYearSelector';
import { FilterBar } from '../../components/metrics/FilterBar';
import { RetentionTab } from './RetentionTab';
import { RegistrationTab } from './RegistrationTab';
import { TrendsTab } from './TrendsTab';

type TabType = 'registration' | 'retention' | 'trends';

/** Default session types for summer camp metrics */
const DEFAULT_SESSION_TYPES = ['main', 'embedded', 'ag'];

/** Default statuses for enrollment counts */
const DEFAULT_STATUSES = ['enrolled'];

export function RegistrationMetricsPage() {
  const { currentYear, availableYears } = useCurrentYear();
  // Always comparison mode: primary year from app context, comparison defaults to year-1
  const [compareYear, setCompareYear] = useState(currentYear - 1);
  const [activeTab, setActiveTab] = useState<TabType>('registration');

  // Filter state
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(DEFAULT_STATUSES);
  const [selectedSessionTypes, setSelectedSessionTypes] = useState<string[]>(DEFAULT_SESSION_TYPES);

  // Convert arrays to comma-separated strings for API
  const statusesParam = selectedStatuses.join(',');
  const sessionTypesParam = selectedSessionTypes.join(',');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-8">
        {/* Header with Admin Shortcut */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Registration Metrics</h1>
            <p className="mt-1 text-muted-foreground">
              Analyze registration data and retention trends
            </p>
          </div>
          <Link
            to="/summer/admin"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Admin Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>

        {/* Compare Year Selector + Filters */}
        <div className="space-y-4 mb-6">
          <CompareYearSelector
            primaryYear={currentYear}
            compareYear={compareYear}
            onCompareYearChange={setCompareYear}
            availableYears={availableYears}
          />
          {/* FilterBar only shown for Registration and Trends tabs */}
          {/* RetentionTab has its own session selector dropdown */}
          {activeTab !== 'retention' && (
            <FilterBar
              selectedStatuses={selectedStatuses}
              onStatusChange={setSelectedStatuses}
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
              compareYear={compareYear}
              statuses={statusesParam}
              sessionTypes={sessionTypesParam}
            />
          )}
          {activeTab === 'retention' && (
            <RetentionTab
              baseYear={compareYear}
              compareYear={currentYear}
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
