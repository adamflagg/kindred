/**
 * SynagogueAnalysis - Synagogue breakdown of registration data.
 *
 * Shows synagogue affiliation analysis.
 * Placeholder for extracted content from RegistrationOverview.
 */

import { Building2 } from 'lucide-react';

export default function SynagogueAnalysis() {
  return (
    <div className="space-y-6">
      <div className="card-lodge p-8 text-center">
        <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">Synagogue Analysis</h2>
        <p className="text-muted-foreground">
          Synagogue affiliation analysis coming soon.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          This page will show detailed synagogue breakdowns extracted from the overview.
        </p>
      </div>
    </div>
  );
}
