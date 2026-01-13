import { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Users,
  Home,
  Heart,
  Sparkles,
  TrendingUp,
  Target,
  Activity
} from 'lucide-react';
import { Modal } from './ui/Modal';

interface FieldStats {
  total: number;
  satisfied: number;
  satisfaction_rate: number;
}

interface ValidationStatistics {
  total_campers: number;
  assigned_campers: number;
  unassigned_campers: number;
  total_requests: number;
  satisfied_requests: number;
  request_satisfaction_rate: number;
  bunks_at_capacity: number;
  bunks_under_capacity: number;
  bunks_over_capacity: number;
  field_stats: Record<string, FieldStats>;
}

interface Issue {
  type: string;
  severity: string;
  message: string;
  details?: Record<string, unknown>;
}

interface ValidationResults {
  statistics: ValidationStatistics;
  issues: Issue[];
  validated_at: string;
}

interface PostValidationResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: ValidationResults;
  sessionId: string;
  scenarioId?: string;
}

// Parse issue into structured display data
interface ParsedIssue {
  primary: string;
  secondary?: string;
  badge?: string;
  badgeColor?: 'red' | 'amber' | 'muted';
  // For grade ratio - show all grades with counts
  gradeRatio?: {
    grades: Array<{ grade: number; count: number }>;
    total: number;
  };
}

function parseIssueMessage(issue: Issue): ParsedIssue {
  const msg = issue.message;

  // Handle unsatisfied request messages
  const unsatMatch = msg.match(/Request from (.+?) to (?:bunk with|avoid) (.+?) not satisfied/i);
  if (unsatMatch?.[1] && unsatMatch?.[2]) {
    const requester = unsatMatch[1].replace(/\s*\(\d+\)$/, '').trim();
    const requested = unsatMatch[2].replace(/\s*\(\d+\)$/, '').trim();
    return { primary: requester, secondary: requested };
  }

  // Handle capacity exceeded
  const capacityMatch = msg.match(/Bunk (.+?) is over capacity.*?(\d+).*?(\d+)/i);
  if (capacityMatch?.[1]) {
    const over = capacityMatch[2] && capacityMatch[3]
      ? parseInt(capacityMatch[2]) - parseInt(capacityMatch[3])
      : null;
    return {
      primary: capacityMatch[1],
      badge: over ? `+${over}` : 'over',
      badgeColor: 'red'
    };
  }

  // Handle unassigned campers
  const unassignedMatch = msg.match(/(.+?) is not assigned to any bunk/i);
  if (unassignedMatch?.[1]) {
    const name = unassignedMatch[1].replace(/\s*\(\d+\)$/, '').trim();
    return { primary: name, badge: 'no bunk', badgeColor: 'red' };
  }

  // Handle level regression messages
  const regressionMatch = msg.match(/(.+?) was in (.+?) last year but is now in (.+?) \(regression of (\d+) level/i);
  if (regressionMatch?.[1] && regressionMatch?.[2] && regressionMatch?.[3] && regressionMatch?.[4]) {
    const name = regressionMatch[1].replace(/\s*\(\d+\)$/, '').trim();
    return {
      primary: name,
      secondary: `${regressionMatch[2]} → ${regressionMatch[3]}`,
      badge: `−${regressionMatch[4]}`,
      badgeColor: 'amber'
    };
  }

  // Handle age flow inversion messages
  const ageFlowMatch = msg.match(/(.+?) \(avg age ([\d.]+)\) has older campers than (.+?) \(avg age ([\d.]+)\)/i);
  if (ageFlowMatch?.[1] && ageFlowMatch?.[2] && ageFlowMatch?.[3] && ageFlowMatch?.[4]) {
    return {
      primary: `${ageFlowMatch[1]} > ${ageFlowMatch[3]}`,
      badge: `${ageFlowMatch[2]} vs ${ageFlowMatch[4]}`,
      badgeColor: 'amber'
    };
  }

  // Handle isolation risk messages
  const isolationMatch = msg.match(/(.+?) has (\d+) connected friends \+ (\d+) isolated camper/i);
  if (isolationMatch?.[1] && isolationMatch?.[2] && isolationMatch?.[3]) {
    return {
      primary: isolationMatch[1],
      secondary: `${isolationMatch[2]} friends`,
      badge: `${isolationMatch[3]} alone`,
      badgeColor: 'amber'
    };
  }

  // Handle grade ratio warning messages - use all_grades for full breakdown
  // "Bunk B-6 has 75.0% of campers from grade 5 (exceeds 67% limit)"
  if (issue.type === 'grade_ratio_warning' && issue.details) {
    const d = issue.details as {
      bunk_name?: string;
      total?: number;
      all_grades?: Record<string, number>;  // { "7": 9, "6": 3 }
    };
    if (d.bunk_name && d.total !== undefined && d.all_grades) {
      // Convert all_grades object to sorted array (already sorted by count desc from backend)
      const grades = Object.entries(d.all_grades).map(([g, c]) => ({
        grade: parseInt(g, 10),
        count: c as number
      }));
      return {
        primary: d.bunk_name,
        gradeRatio: { grades, total: d.total }
      };
    }
  }
  // Fallback regex for grade ratio if details not available
  const gradeRatioMatch = msg.match(/Bunk (.+?) has ([\d.]+)% of campers from grade (\d+)/i);
  if (gradeRatioMatch?.[1] && gradeRatioMatch?.[2] && gradeRatioMatch?.[3]) {
    const percentage = parseFloat(gradeRatioMatch[2]);
    const grade = parseInt(gradeRatioMatch[3], 10);
    const estimatedTotal = 12;
    const estimatedCount = Math.round((percentage / 100) * estimatedTotal);
    return {
      primary: gradeRatioMatch[1],
      gradeRatio: {
        grades: [
          { grade, count: estimatedCount },
          { grade: grade - 1, count: estimatedTotal - estimatedCount }
        ],
        total: estimatedTotal
      }
    };
  }

  // Handle grade spread warning messages
  // "Bunk B-5 has too many different grades (4 grades, max allowed: 3)"
  const gradeSpreadMatch = msg.match(/Bunk (.+?) has too many different grades \((\d+) grades?, max.*?(\d+)\)/i);
  if (gradeSpreadMatch?.[1] && gradeSpreadMatch?.[2] && gradeSpreadMatch?.[3]) {
    return {
      primary: gradeSpreadMatch[1],
      badge: `${gradeSpreadMatch[2]}/${gradeSpreadMatch[3]} grades`,
      badgeColor: 'amber'
    };
  }

  // Handle grade adjacency warning messages
  // "Bunk B-5 has non-adjacent grades [2, 4] (missing grade 3)"
  const gradeAdjMatch = msg.match(/Bunk (.+?) has non-adjacent grades.*missing grades? (.+?)\)/i);
  if (gradeAdjMatch?.[1] && gradeAdjMatch?.[2]) {
    return {
      primary: gradeAdjMatch[1],
      badge: `gap: gr ${gradeAdjMatch[2]}`,
      badgeColor: 'amber'
    };
  }

  // Handle no requests satisfied messages
  const noReqMatch = msg.match(/(\d+) campers? have bunking requests but none were satisfied/i);
  if (noReqMatch?.[1]) {
    return {
      primary: `${noReqMatch[1]} camper${parseInt(noReqMatch[1]) > 1 ? 's' : ''}`,
      badge: '0 satisfied',
      badgeColor: 'red'
    };
  }

  // Handle negative request violated messages
  const negReqMatch = msg.match(/(\d+) 'not bunk with' request\(s\) violated/i);
  if (negReqMatch?.[1]) {
    return {
      primary: `${negReqMatch[1]} "avoid" request${parseInt(negReqMatch[1]) > 1 ? 's' : ''}`,
      badge: 'violated',
      badgeColor: 'red'
    };
  }

  // Fallback - clean up the message
  const cleaned = msg.replace(/\s*\(\d+\)/g, '').replace(/camper \d+/g, 'a camper');
  return { primary: cleaned.length > 40 ? cleaned.slice(0, 37) + '...' : cleaned };
}

// Get a human-readable label for issue types
function getIssueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'unsatisfied_request': 'Unfulfilled Requests',
    'capacity_exceeded': 'Over Capacity',
    'age_spread': 'Age Spread Issues',
    'grade_imbalance': 'Grade Imbalance',
    'unassigned_camper': 'Unassigned Campers',
    'conflicting_request': 'Conflicting Requests',
    'level_regression': 'Level Regression',
    'age_flow_inversion': 'Age Flow Issues',
    'isolation_risk': 'Isolation Risk',
    'no_requests_satisfied': 'No Requests Met',
    'negative_request_violated': 'Separation Violated',
  };
  return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Format field names nicely
function formatFieldName(fieldName: string): string {
  const labels: Record<string, string> = {
    'bunk_with': 'Bunk With',
    'not_bunk_with': 'Avoid',
    'bunking_notes': 'Bunking Notes',
    'internal_notes': 'Staff Notes',
    'socialize_with': 'Socialize With',
  };
  return labels[fieldName] || fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Satisfaction ring component - the visual centerpiece
function SatisfactionRing({ rate, size = 120 }: { rate: number; size?: number }) {
  const percentage = Math.round(rate * 100);
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (rate * circumference);

  // Color based on satisfaction rate
  const getColor = () => {
    if (rate >= 0.8) return { stroke: 'stroke-forest-500', text: 'text-forest-600', bg: 'bg-forest-500' };
    if (rate >= 0.6) return { stroke: 'stroke-amber-500', text: 'text-amber-600', bg: 'bg-amber-500' };
    return { stroke: 'stroke-red-500', text: 'text-red-600', bg: 'bg-red-500' };
  };

  const colors = getColor();

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          className="text-muted/30"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={`${colors.stroke} transition-all duration-1000 ease-out`}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: strokeDashoffset,
          }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-display font-bold ${colors.text}`}>
          {percentage}%
        </span>
        <span className="text-xs text-muted-foreground">satisfied</span>
      </div>
    </div>
  );
}

// Grade colors for visual distinction
const GRADE_COLORS = [
  'bg-amber-500',    // dominant (first)
  'bg-sky-400',      // second
  'bg-emerald-400',  // third
  'bg-violet-400',   // fourth
  'bg-rose-400',     // fifth+
];

// Mini segmented grade bar component
function GradeRatioBar({ ratio }: { ratio: NonNullable<ParsedIssue['gradeRatio']> }) {
  // Format grade as ordinal (5 -> 5th, 2 -> 2nd, etc.)
  const ordinal = (n: number): string => {
    const s = ['th', 'st', 'nd', 'rd'] as const;
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
  };

  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      {/* Segmented progress bar */}
      <div className="flex-1 h-2.5 rounded-full bg-muted/30 overflow-hidden flex">
        {ratio.grades.map((g, i) => {
          const pct = (g.count / ratio.total) * 100;
          return (
            <div
              key={g.grade}
              className={`h-full ${GRADE_COLORS[Math.min(i, GRADE_COLORS.length - 1)]} ${i === 0 ? 'rounded-l-full' : ''} ${i === ratio.grades.length - 1 ? 'rounded-r-full' : ''}`}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      {/* Grade labels with counts */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {ratio.grades.map((g, i) => (
          <span key={g.grade} className="flex items-center gap-1 text-sm">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${GRADE_COLORS[Math.min(i, GRADE_COLORS.length - 1)]}`}
            />
            <span className={`w-5 text-right tabular-nums font-semibold ${i === 0 ? 'text-foreground' : 'text-foreground/70'}`}>
              {g.count}
            </span>
            <span className="text-muted-foreground text-xs">
              {ordinal(g.grade)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Single issue item with visual structure
function IssueItem({ issue }: { issue: Issue }) {
  const parsed = parseIssueMessage(issue);

  const getBadgeStyles = () => {
    switch (parsed.badgeColor) {
      case 'red':
        return 'bg-red-500/15 text-red-600';
      case 'amber':
        return 'bg-amber-500/15 text-amber-600';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  // Special rendering for grade ratio
  if (parsed.gradeRatio) {
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="text-sm font-medium text-foreground w-12 flex-shrink-0">
          {parsed.primary}
        </span>
        <GradeRatioBar ratio={parsed.gradeRatio} />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm text-foreground truncate font-medium">
          {parsed.primary}
        </span>
        {parsed.secondary && (
          <>
            <span className="text-muted-foreground text-xs">→</span>
            <span className="text-sm text-foreground/70 truncate">
              {parsed.secondary}
            </span>
          </>
        )}
      </div>
      {parsed.badge && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${getBadgeStyles()}`}>
          {parsed.badge}
        </span>
      )}
    </div>
  );
}

// Issue group component with expand/collapse
function IssueGroup({
  type,
  issues,
  severity
}: {
  type: string;
  issues: Issue[];
  severity: string;
}) {
  const [isExpanded, setIsExpanded] = useState(issues.length <= 3);

  const getSeverityStyles = () => {
    switch (severity) {
      case 'error':
        return {
          bg: 'bg-red-500/8',
          border: 'border-red-500/20',
          icon: 'text-red-500',
          badge: 'bg-red-500/15 text-red-600',
        };
      case 'warning':
        return {
          bg: 'bg-amber-500/8',
          border: 'border-amber-500/20',
          icon: 'text-amber-500',
          badge: 'bg-amber-500/15 text-amber-600',
        };
      default:
        return {
          bg: 'bg-forest-500/8',
          border: 'border-forest-500/20',
          icon: 'text-forest-500',
          badge: 'bg-forest-500/15 text-forest-600',
        };
    }
  };

  const styles = getSeverityStyles();
  const Icon = severity === 'error' ? AlertTriangle : severity === 'warning' ? AlertCircle : Activity;

  return (
    <div className={`rounded-xl border ${styles.border} overflow-hidden`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full px-3 py-2.5 flex items-center justify-between ${styles.bg} hover:opacity-80 transition-opacity`}
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${styles.icon}`} />
          <span className="font-medium text-foreground text-sm">
            {getIssueTypeLabel(type)}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${styles.badge}`}>
            {issues.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className={`${styles.bg} border-t ${styles.border} max-h-40 overflow-y-auto`}>
          <div className="divide-y divide-border/30">
            {issues.map((issue, idx) => (
              <IssueItem key={idx} issue={issue} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PostValidationResultsModal({
  isOpen,
  onClose,
  results,
  scenarioId
}: PostValidationResultsModalProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Need to compute these even when modal is closed since Modal might render conditionally
  const statistics = results?.statistics;
  // Memoize issues to prevent dependency array changes on every render
  const issues = useMemo(() => results?.issues || [], [results?.issues]);
  const satisfactionRate = statistics?.request_satisfaction_rate ?? 0;

  // Group issues by type and severity
  const groupedIssues = useMemo(() => {
    const byType = new Map<string, { issues: Issue[]; severity: string }>();

    for (const issue of issues) {
      const existing = byType.get(issue.type);
      if (existing) {
        existing.issues.push(issue);
      } else {
        byType.set(issue.type, { issues: [issue], severity: issue.severity });
      }
    }

    // Sort by severity (errors first, then warnings, then info)
    const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
    return [...byType.entries()].sort((a, b) => {
      return (severityOrder[a[1].severity] || 3) - (severityOrder[b[1].severity] || 3);
    });
  }, [issues]);

  const hasIssues = issues.length > 0;
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  // Determine overall status
  const getOverallStatus = () => {
    if (satisfactionRate >= 0.85 && errorCount === 0) {
      return {
        label: 'Excellent!',
        sublabel: 'Bunking looks great',
        icon: Sparkles,
        gradient: 'from-forest-500/10 to-forest-400/5',
        iconBg: 'bg-forest-500 text-white shadow-lg shadow-forest-500/30'
      };
    }
    if (satisfactionRate >= 0.7 && errorCount === 0) {
      return {
        label: 'Looking Good',
        sublabel: `${Math.round(satisfactionRate * 100)}% requests satisfied`,
        icon: CheckCircle2,
        gradient: 'from-forest-500/10 to-forest-400/5',
        iconBg: 'bg-forest-500 text-white shadow-lg shadow-forest-500/30'
      };
    }
    if (satisfactionRate >= 0.5) {
      return {
        label: 'Needs Attention',
        sublabel: `${hasIssues ? issues.length : 0} issue${issues.length !== 1 ? 's' : ''} to review`,
        icon: AlertCircle,
        gradient: 'from-amber-500/15 to-amber-400/5',
        iconBg: 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
      };
    }
    return {
      label: 'Needs Work',
      sublabel: 'Consider re-running the solver',
      icon: AlertTriangle,
      gradient: 'from-red-500/15 to-red-400/5',
      iconBg: 'bg-red-500 text-white shadow-lg shadow-red-500/30'
    };
  };

  const status = getOverallStatus();
  const StatusIcon = status.icon;

  const headerContent = (
    <div className={`pl-5 pr-14 py-4 flex items-center gap-3 bg-gradient-to-r ${status.gradient}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${status.iconBg}`}>
        <StatusIcon className="w-5 h-5" />
      </div>
      <div>
        <h2 className="font-display font-bold text-lg text-foreground leading-tight">
          {status.label}
        </h2>
        <p className="text-sm text-muted-foreground">
          {status.sublabel}
          {scenarioId && <span className="ml-1 opacity-70">(Draft)</span>}
        </p>
      </div>
    </div>
  );

  const footerContent = results ? (
    <div className="px-5 py-4 bg-muted/30 border-t border-border/50 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">
        {new Date(results.validated_at).toLocaleString()}
      </span>
      <button
        onClick={onClose}
        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
          satisfactionRate >= 0.7 && errorCount === 0
            ? 'bg-forest-500 text-white hover:bg-forest-600 shadow-lg shadow-forest-500/20'
            : 'bg-muted hover:bg-muted/80 text-foreground'
        }`}
      >
        {satisfactionRate >= 0.7 && errorCount === 0 ? 'Looks Great!' : 'Close'}
      </button>
    </div>
  ) : null;

  return (
    <Modal
      isOpen={isOpen && !!results}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="md"
      noPadding
    >

        {/* Satisfaction Ring + Quick Stats */}
        <div className="px-5 py-5 flex items-center gap-6 border-b border-border/50">
          {/* Ring */}
          <SatisfactionRing rate={satisfactionRate} size={100} />

          {/* Stats grid */}
          <div className="flex-1 grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-forest-500/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-forest-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">
                  {statistics.assigned_campers}/{statistics.total_campers}
                </p>
                <p className="text-xs text-muted-foreground">assigned</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-forest-500/10 flex items-center justify-center">
                <Heart className="w-4 h-4 text-forest-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">
                  {statistics.satisfied_requests}/{statistics.total_requests}
                </p>
                <p className="text-xs text-muted-foreground">requests met</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-forest-500/10 flex items-center justify-center">
                <Home className="w-4 h-4 text-forest-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">
                  {statistics.bunks_at_capacity + statistics.bunks_under_capacity + statistics.bunks_over_capacity}
                </p>
                <p className="text-xs text-muted-foreground">bunks used</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                errorCount > 0 ? 'bg-red-500/10' : warningCount > 0 ? 'bg-amber-500/10' : 'bg-forest-500/10'
              }`}>
                <Target className={`w-4 h-4 ${
                  errorCount > 0 ? 'text-red-600' : warningCount > 0 ? 'text-amber-600' : 'text-forest-600'
                }`} />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">
                  {issues.length}
                </p>
                <p className="text-xs text-muted-foreground">issues</p>
              </div>
            </div>
          </div>
        </div>

        {/* Issues List (if any) */}
        {hasIssues && (
          <div className="px-5 py-4 space-y-2 max-h-64 overflow-y-auto">
            {groupedIssues.map(([type, { issues: typeIssues, severity }]) => (
              <IssueGroup
                key={type}
                type={type}
                issues={typeIssues}
                severity={severity}
              />
            ))}
          </div>
        )}

        {/* Success state message */}
        {!hasIssues && (
          <div className="px-5 py-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-forest-500/10 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-forest-500" />
            </div>
            <p className="text-sm text-muted-foreground">
              No issues detected. All bunking assignments look great!
            </p>
          </div>
        )}

        {/* Collapsible Details */}
        {(statistics.field_stats && Object.keys(statistics.field_stats).length > 0) && (
          <div className="border-t border-border/50">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-5 py-3 flex items-center justify-between text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Details by request source
              </span>
              {showDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {showDetails && (
              <div className="px-5 pb-4 space-y-2 animate-fade-in">
                {Object.entries(statistics.field_stats)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([fieldName, stats]) => (
                    <div
                      key={fieldName}
                      className="flex items-center justify-between p-3 rounded-xl bg-muted/40"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-foreground">
                          {formatFieldName(fieldName)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {stats.satisfied}/{stats.total}
                        </span>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        stats.satisfaction_rate >= 0.8
                          ? 'bg-forest-500/15 text-forest-600'
                          : stats.satisfaction_rate >= 0.5
                          ? 'bg-amber-500/15 text-amber-600'
                          : 'bg-red-500/15 text-red-600'
                      }`}>
                        {Math.round(stats.satisfaction_rate * 100)}%
                      </span>
                    </div>
                  ))}

                {/* Capacity info */}
                {statistics.bunks_over_capacity > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                    <span className="font-medium text-amber-600">Note:</span> {statistics.bunks_over_capacity} bunk{statistics.bunks_over_capacity > 1 ? 's are' : ' is'} over capacity
                  </div>
                )}

                {statistics.unassigned_campers > 0 && (
                  <div className="text-xs text-muted-foreground p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                    <span className="font-medium text-red-600">Note:</span> {statistics.unassigned_campers} camper{statistics.unassigned_campers > 1 ? 's need' : ' needs'} bunk assignment
                  </div>
                )}
              </div>
            )}
          </div>
        )}

    </Modal>
  );
}
