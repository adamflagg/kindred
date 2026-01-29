/**
 * GeoAnalysis - Geographic breakdown of registration data.
 *
 * Shows city and school distribution analysis.
 * Placeholder for extracted content from RegistrationOverview.
 */

import { Globe } from 'lucide-react';

export default function GeoAnalysis() {
  return (
    <div className="space-y-6">
      <div className="card-lodge p-8 text-center">
        <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">Geographic Analysis</h2>
        <p className="text-muted-foreground">
          City and school distribution analysis coming soon.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          This page will show detailed geographic breakdowns extracted from the overview.
        </p>
      </div>
    </div>
  );
}
