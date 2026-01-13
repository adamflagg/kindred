import { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Users,
  Home,
  Heart,
  Zap,
  Sparkles,
  ArrowRight,
  UserMinus
} from 'lucide-react';
import { Modal } from './ui/Modal';

interface CapacityBreakdownItem {
  campers: number;
  beds: number;
  sufficient: boolean;
}

interface ValidationStatistics {
  total_campers: number;
  total_bunks: number;
  total_capacity: number;
  total_requests: number;
  campers_with_requests: number;
  campers_without_requests: number;
  unsatisfiable_requests: Array<{
    requester: string;
    requester_name?: string;
    request_type: string;
    requested_cm_id: string;
    requested_name?: string;
    reason: string;
  }>;
  capacity_breakdown?: {
    boys: CapacityBreakdownItem;
    girls: CapacityBreakdownItem;
    ag?: CapacityBreakdownItem;
  };
}

interface PreValidationResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    statistics: ValidationStatistics;
  };
  sessionId: string;
}

// Parse capacity issues from error messages
interface ParsedCapacityIssue {
  area: string;
  campers: number;
  beds: number;
  over: number;
}

function parseCapacityIssues(errors: string[]): ParsedCapacityIssue[] {
  const issues: ParsedCapacityIssue[] = [];

  for (const error of errors) {
    // Match "Gender capacity issues: Boys: 97 campers, 96 beds (1 OVER); Girls: ..."
    if (error.includes('capacity issues:')) {
      // Remove prefix, then split by semicolon only (keep colons intact for regex)
      const content = error.replace(/^.*?capacity issues:\s*/i, '');
      const parts = content.split(/;\s*/);
      for (const part of parts) {
        const match = part.match(/(\w+):\s*(\d+)\s*campers?,\s*(\d+)\s*beds?\s*\((\d+)\s*OVER\)/i);
        if (match?.[1] && match[2] && match[3] && match[4]) {
          issues.push({
            area: match[1].trim(),
            campers: parseInt(match[2], 10),
            beds: parseInt(match[3], 10),
            over: parseInt(match[4], 10)
          });
        }
      }
    }
    // Match simple capacity error
    const simpleMatch = error.match(/Insufficient capacity:\s*(\d+)\s*campers?\s*but only\s*(\d+)\s*beds/i);
    if (simpleMatch?.[1] && simpleMatch[2]) {
      issues.push({
        area: 'Total',
        campers: parseInt(simpleMatch[1], 10),
        beds: parseInt(simpleMatch[2], 10),
        over: parseInt(simpleMatch[1], 10) - parseInt(simpleMatch[2], 10)
      });
    }
  }

  return issues;
}

// Parse warnings into structured data
interface ParsedWarning {
  type: 'conflict' | 'unsatisfiable' | 'other';
  count?: number;
  names?: { requester: string; requested: string };
  message: string;
}

function parseWarnings(warnings: string[]): ParsedWarning[] {
  return warnings.map(warning => {
    // Conflicting requests
    const conflictMatch = warning.match(/(.+?) has conflicting requests for (.+?) \(both/);
    if (conflictMatch?.[1] && conflictMatch?.[2]) {
      return {
        type: 'conflict' as const,
        names: {
          requester: conflictMatch[1].replace(/\s*\(\d+\)$/, ''),
          requested: conflictMatch[2].replace(/\s*\(\d+\)$/, '')
        },
        message: warning
      };
    }

    // Unsatisfiable/unfulfillable requests - multiple formats
    // "1 camper has requests that may not be fulfilled"
    // "5 campers have requests that may not be fulfilled"
    // "X camper(s) have only unsatisfiable requests"
    const unsatMatch = warning.match(/(\d+) campers? ha(?:ve|s)(?: only unsatisfiable)? requests/i);
    if (unsatMatch?.[1]) {
      return {
        type: 'unsatisfiable' as const,
        count: parseInt(unsatMatch[1], 10),
        message: warning
      };
    }

    return {
      type: 'other' as const,
      message: warning.replace(/\s*\(\d+\)/g, '').replace(/camper \d+/g, 'a camper')
    };
  });
}

// Get non-capacity errors (for display in "other" section)
function getNonCapacityErrors(errors: string[]): string[] {
  return errors.filter(e =>
    !e.includes('capacity issues:') &&
    !e.match(/Insufficient capacity/i)
  ).map(e => e.replace(/\s*\(\d+\)/g, '').replace(/camper \d+/g, 'a camper'));
}

// Translate technical reasons into friendly labels
function friendlyReason(reason: string): string {
  const lowerReason = reason.toLowerCase();
  if (lowerReason.includes('not in session') || lowerReason.includes('not enrolled')) {
    return 'Not enrolled';
  }
  if (lowerReason.includes('gender') || lowerReason.includes('different area')) {
    return 'Different area';
  }
  if (lowerReason.includes('age') || lowerReason.includes('spread')) {
    return 'Age/grade gap';
  }
  if (lowerReason.includes('conflict')) {
    return 'Conflict';
  }
  return reason.length > 20 ? reason.slice(0, 17) + '...' : reason;
}

// Capacity issue card component
function CapacityCard({ issue }: { issue: ParsedCapacityIssue }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-destructive/8 border border-destructive/20">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-destructive/15 flex items-center justify-center">
          <Users className="w-4 h-4 text-destructive" />
        </div>
        <div>
          <span className="font-medium text-foreground">{issue.area}</span>
          <div className="text-xs text-muted-foreground">
            {issue.campers} campers · {issue.beds} beds
          </div>
        </div>
      </div>
      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-destructive/15 text-destructive">
        +{issue.over} over
      </span>
    </div>
  );
}

// Conflict warning card
function ConflictCard({ names }: { names: { requester: string; requested: string } }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
      <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center flex-shrink-0">
        <Zap className="w-3 h-3 text-amber-600" />
      </div>
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="font-medium text-foreground truncate">{names.requester}</span>
        <span className="text-muted-foreground text-xs">⇄</span>
        <span className="font-medium text-foreground truncate">{names.requested}</span>
      </div>
      <span className="ml-auto text-xs text-amber-600 whitespace-nowrap">conflict</span>
    </div>
  );
}

// Unsatisfiable count badge
function UnsatisfiableBadge({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
      <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
        <UserMinus className="w-4 h-4 text-amber-600" />
      </div>
      <div>
        <span className="font-medium text-foreground">{count} unfulfillable</span>
        <div className="text-xs text-muted-foreground">request{count !== 1 ? 's' : ''} can't be met</div>
      </div>
    </div>
  );
}

export default function PreValidationResultsModal({
  isOpen,
  onClose,
  results
}: PreValidationResultsModalProps) {
  const [showDetails, setShowDetails] = useState(false);

  const { valid, errors, warnings, statistics } = results;

  // Parse structured data from error messages
  const capacityIssues = useMemo(() => parseCapacityIssues(errors), [errors]);
  const parsedWarnings = useMemo(() => parseWarnings(warnings), [warnings]);
  const otherErrors = useMemo(() => getNonCapacityErrors(errors), [errors]);

  const hasIssues = errors.length > 0 || warnings.length > 0;
  const requestRate = statistics.total_campers > 0
    ? Math.round((statistics.campers_with_requests / statistics.total_campers) * 100)
    : 0;

  // Group warnings by type for cleaner display
  const conflictWarnings = parsedWarnings.filter(w => w.type === 'conflict');
  const unsatisfiableWarning = parsedWarnings.find(w => w.type === 'unsatisfiable');
  const otherWarnings = parsedWarnings.filter(w => w.type === 'other');

  const headerContent = (
    <div className={`pl-5 pr-14 py-4 flex items-center gap-3 ${
      valid
        ? 'bg-gradient-to-r from-forest-500/10 to-forest-400/5'
        : 'bg-gradient-to-r from-amber-500/15 to-amber-400/5'
    }`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
        valid
          ? 'bg-forest-500 text-white shadow-lg shadow-forest-500/30'
          : 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
      }`}>
        {valid ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : (
          <AlertTriangle className="w-5 h-5" />
        )}
      </div>
      <div>
        <h2 className="font-display font-bold text-lg text-foreground leading-tight">
          {valid ? 'Ready to Run!' : 'Heads Up'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {valid
            ? 'All requests look good'
            : `${errors.length + warnings.length} thing${errors.length + warnings.length > 1 ? 's' : ''} to review`
          }
        </p>
      </div>
    </div>
  );

  const footerContent = (
    <div className="px-5 py-4 bg-muted/30 border-t border-border/50 flex justify-end gap-2">
      <button
        onClick={onClose}
        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
          valid
            ? 'bg-forest-500 text-white hover:bg-forest-600 shadow-lg shadow-forest-500/20'
            : 'bg-muted hover:bg-muted/80 text-foreground'
        }`}
      >
        {valid ? 'Got it!' : 'Close'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="sm"
      noPadding
    >

        {/* Quick Stats Row */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="w-4 h-4 text-forest-500" />
              <span className="font-medium text-foreground">{statistics.total_campers}</span>
              <span>campers</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Home className="w-4 h-4 text-forest-500" />
              <span className="font-medium text-foreground">{statistics.total_bunks}</span>
              <span>bunks</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Heart className="w-4 h-4 text-forest-500" />
              <span className="font-medium text-foreground">{requestRate}%</span>
              <span>have requests</span>
            </div>
          </div>
        </div>

        {/* Issues Display - Visual cards instead of text */}
        {hasIssues && (
          <div className="px-5 py-4 space-y-3 max-h-72 overflow-y-auto">
            {/* Capacity Issues - Visual cards */}
            {capacityIssues.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-destructive uppercase tracking-wide flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  Capacity Issues
                </p>
                {capacityIssues.map((issue, i) => (
                  <CapacityCard key={i} issue={issue} />
                ))}
              </div>
            )}

            {/* Other errors (non-capacity) */}
            {otherErrors.length > 0 && (
              <div className="space-y-2">
                {otherErrors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-destructive/8 border border-destructive/20"
                  >
                    <Zap className="w-4 h-4 text-destructive flex-shrink-0" />
                    <span className="text-sm text-foreground">{err}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Unsatisfiable requests badge */}
            {unsatisfiableWarning && (
              <UnsatisfiableBadge count={unsatisfiableWarning.count ?? 1} />
            )}

            {/* Conflict warnings - compact cards */}
            {conflictWarnings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-amber-600 uppercase tracking-wide flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  Conflicting Requests
                </p>
                {conflictWarnings.map((w, i) => (
                  w.names && <ConflictCard key={i} names={w.names} />
                ))}
              </div>
            )}

            {/* Other warnings */}
            {otherWarnings.length > 0 && (
              <div className="space-y-1.5">
                {otherWarnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span className="text-sm text-foreground">{w.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Success state message */}
        {!hasIssues && (
          <div className="px-5 py-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-forest-500/10 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-forest-500" />
            </div>
            <p className="text-sm text-muted-foreground">
              No conflicts found. The optimizer should find a solution.
            </p>
          </div>
        )}

        {/* Collapsible Details */}
        {(statistics.unsatisfiable_requests?.length > 0 || hasIssues) && (
          <div className="border-t border-border/50">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-5 py-3 flex items-center justify-between text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <span>Details for nerds</span>
              {showDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {showDetails && (
              <div className="px-5 pb-4 space-y-3 animate-fade-in">
                {/* Gender capacity breakdown */}
                {statistics.capacity_breakdown && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Capacity by Area
                    </p>
                    <div className={`grid gap-2 text-xs ${statistics.capacity_breakdown.ag && statistics.capacity_breakdown.ag.campers > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      <div className={`p-2 rounded-lg ${
                        statistics.capacity_breakdown.boys.sufficient
                          ? 'bg-forest-500/10 border border-forest-500/20'
                          : 'bg-red-500/10 border border-red-500/20'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">Boys</span>
                          <span className={statistics.capacity_breakdown.boys.sufficient ? 'text-forest-600' : 'text-red-600'}>
                            {statistics.capacity_breakdown.boys.sufficient ? '✓' : `${statistics.capacity_breakdown.boys.campers - statistics.capacity_breakdown.boys.beds} over`}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-0.5">
                          {statistics.capacity_breakdown.boys.campers} / {statistics.capacity_breakdown.boys.beds}
                        </div>
                      </div>
                      <div className={`p-2 rounded-lg ${
                        statistics.capacity_breakdown.girls.sufficient
                          ? 'bg-forest-500/10 border border-forest-500/20'
                          : 'bg-red-500/10 border border-red-500/20'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">Girls</span>
                          <span className={statistics.capacity_breakdown.girls.sufficient ? 'text-forest-600' : 'text-red-600'}>
                            {statistics.capacity_breakdown.girls.sufficient ? '✓' : `${statistics.capacity_breakdown.girls.campers - statistics.capacity_breakdown.girls.beds} over`}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-0.5">
                          {statistics.capacity_breakdown.girls.campers} / {statistics.capacity_breakdown.girls.beds}
                        </div>
                      </div>
                      {/* AG column - only shown if there are AG campers */}
                      {statistics.capacity_breakdown.ag && statistics.capacity_breakdown.ag.campers > 0 && (
                        <div className={`p-2 rounded-lg ${
                          statistics.capacity_breakdown.ag.sufficient
                            ? 'bg-forest-500/10 border border-forest-500/20'
                            : 'bg-red-500/10 border border-red-500/20'
                        }`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-foreground">AG</span>
                            <span className={statistics.capacity_breakdown.ag.sufficient ? 'text-forest-600' : 'text-red-600'}>
                              {statistics.capacity_breakdown.ag.sufficient ? '✓' : `${statistics.capacity_breakdown.ag.campers - statistics.capacity_breakdown.ag.beds} over`}
                            </span>
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            {statistics.capacity_breakdown.ag.campers} / {statistics.capacity_breakdown.ag.beds}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Detailed stats - compact grid */}
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-muted/50 text-center">
                    <div className="font-semibold text-foreground">{statistics.total_capacity}</div>
                    <div className="text-muted-foreground text-[10px]">beds</div>
                  </div>
                  <div className="p-2 rounded-lg bg-muted/50 text-center">
                    <div className="font-semibold text-foreground">{statistics.total_requests}</div>
                    <div className="text-muted-foreground text-[10px]">requests</div>
                  </div>
                  <div className="p-2 rounded-lg bg-muted/50 text-center">
                    <div className="font-semibold text-foreground">{statistics.campers_with_requests}</div>
                    <div className="text-muted-foreground text-[10px]">w/ reqs</div>
                  </div>
                  <div className="p-2 rounded-lg bg-muted/50 text-center">
                    <div className="font-semibold text-foreground">{statistics.campers_without_requests}</div>
                    <div className="text-muted-foreground text-[10px]">no reqs</div>
                  </div>
                </div>

                {/* Unsatisfiable requests detail - compact table */}
                {statistics.unsatisfiable_requests?.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Unfulfillable Requests
                    </p>
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-border/50">
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-border/30">
                          {statistics.unsatisfiable_requests.map((req, index) => (
                            <tr key={index} className="hover:bg-muted/30">
                              <td className="px-2 py-1.5 text-foreground truncate max-w-[120px]">
                                {req.requester_name || 'Unknown'}
                              </td>
                              <td className="px-1 py-1.5 text-muted-foreground text-center">
                                <ArrowRight className="w-3 h-3 inline" />
                              </td>
                              <td className="px-2 py-1.5 text-foreground truncate max-w-[120px]">
                                {req.requested_name || 'Unknown'}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  {friendlyReason(req.reason)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Tip for capacity issues */}
                {capacityIssues.length > 0 && (
                  <div className="text-xs text-muted-foreground p-2 rounded-lg bg-primary/5 border border-primary/10">
                    <span className="font-medium text-primary">Tip:</span> Capacity issues must be resolved before running. Check bunk counts or camper enrollment.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

    </Modal>
  );
}
