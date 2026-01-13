import { Link } from 'react-router';
import { useProgram } from '../contexts/ProgramContext';
import { Home, Users, FileText, Settings, ArrowLeft, Sparkles, Calendar } from 'lucide-react';

export default function FamilyCampDashboard() {
  const { clearProgram } = useProgram();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/"
          onClick={() => clearProgram()}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to program selection
        </Link>

        <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-2">
          Family Camp
        </h1>
        <p className="text-muted-foreground">
          Bunking management for family programs
        </p>
      </div>

      {/* Coming Soon Card */}
      <div className="card-lodge p-8 sm:p-10 relative overflow-hidden">
        {/* Decorative gradient */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-accent/10 to-transparent rounded-3xl" />

        <div className="relative text-center max-w-xl mx-auto">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-20 h-20 bg-accent/10 rounded-2xl mb-6">
            <Home className="w-10 h-10 text-amber-600 dark:text-accent" />
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/10 text-amber-700 dark:text-accent rounded-full text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" />
            Coming Soon
          </div>

          <h2 className="text-2xl sm:text-3xl font-display font-bold text-foreground mb-4">
            Family Camp Module
          </h2>

          <p className="text-muted-foreground mb-8 leading-relaxed">
            We're building a streamlined cabin assignment system for family camps, adult retreats,
            and multi-generational programs. Focus on family groupings and relationship
            mapping without the complexity of youth session constraints.
          </p>

          {/* Feature Preview */}
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <Users className="w-6 h-6 text-primary mb-3 mx-auto" />
              <h3 className="font-semibold text-sm mb-1">Family Groupings</h3>
              <p className="text-xs text-muted-foreground">
                Keep families together across cabins
              </p>
            </div>

            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <FileText className="w-6 h-6 text-primary mb-3 mx-auto" />
              <h3 className="font-semibold text-sm mb-1">Simple Requests</h3>
              <p className="text-xs text-muted-foreground">
                Lightweight request management
              </p>
            </div>

            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <Settings className="w-6 h-6 text-primary mb-3 mx-auto" />
              <h3 className="font-semibold text-sm mb-1">Flexible Rules</h3>
              <p className="text-xs text-muted-foreground">
                Customizable for each program
              </p>
            </div>
          </div>

          {/* Season indicator */}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground/70">
            <Calendar className="w-4 h-4" />
            <span>Family programs run Fall, Winter, and Spring</span>
          </div>
        </div>
      </div>

      {/* Switch program hint */}
      <p className="text-center mt-6 text-sm text-muted-foreground">
        Working on Summer Camp instead?{' '}
        <Link
          to="/"
          onClick={() => clearProgram()}
          className="text-primary hover:underline font-medium"
        >
          Switch programs
        </Link>
      </p>
    </div>
  );
}
