import { Link } from 'react-router'
import { useProgram } from '../contexts/ProgramContext'
import { Home, Users, FileText, Settings, ArrowLeft, Sparkles, Calendar } from 'lucide-react'

export default function WeekendHousingDashboard() {
  const { clearProgram } = useProgram()

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/"
          onClick={() => clearProgram()}
          className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to program selection
        </Link>

        <h1 className="font-display text-foreground mb-2 text-3xl font-bold sm:text-4xl">
          Weekend Housing
        </h1>
        <p className="text-muted-foreground">Housing management for weekend and family programs</p>
      </div>

      {/* Coming Soon Card */}
      <div className="card-lodge relative overflow-hidden p-8 sm:p-10">
        {/* Decorative gradient */}
        <div className="from-accent/10 absolute top-0 right-0 h-64 w-64 rounded-3xl bg-gradient-to-bl to-transparent" />

        <div className="relative mx-auto max-w-xl text-center">
          {/* Icon */}
          <div className="bg-accent/10 mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl">
            <Home className="dark:text-accent h-10 w-10 text-amber-600" />
          </div>

          <div className="bg-accent/10 dark:text-accent mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-amber-700">
            <Sparkles className="h-4 w-4" />
            Coming Soon
          </div>

          <h2 className="font-display text-foreground mb-4 text-2xl font-bold sm:text-3xl">
            Weekend Housing Module
          </h2>

          <p className="text-muted-foreground mb-8 leading-relaxed">
            We're building a streamlined housing assignment system for family camps, adult retreats,
            and multi-generational programs. Focus on family groupings and relationship mapping
            without the complexity of youth session constraints.
          </p>

          {/* Feature Preview */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <div className="bg-background/50 border-border/50 rounded-xl border p-4">
              <Users className="text-primary mx-auto mb-3 h-6 w-6" />
              <h3 className="mb-1 text-sm font-semibold">Family Groupings</h3>
              <p className="text-muted-foreground text-xs">Keep families together across cabins</p>
            </div>

            <div className="bg-background/50 border-border/50 rounded-xl border p-4">
              <FileText className="text-primary mx-auto mb-3 h-6 w-6" />
              <h3 className="mb-1 text-sm font-semibold">Simple Requests</h3>
              <p className="text-muted-foreground text-xs">Lightweight request management</p>
            </div>

            <div className="bg-background/50 border-border/50 rounded-xl border p-4">
              <Settings className="text-primary mx-auto mb-3 h-6 w-6" />
              <h3 className="mb-1 text-sm font-semibold">Flexible Rules</h3>
              <p className="text-muted-foreground text-xs">Customizable for each program</p>
            </div>
          </div>

          {/* Season indicator */}
          <div className="text-muted-foreground/70 flex items-center justify-center gap-2 text-sm">
            <Calendar className="h-4 w-4" />
            <span>Weekend programs run Fall, Winter, and Spring</span>
          </div>
        </div>
      </div>

      {/* Switch program hint */}
      <p className="text-muted-foreground mt-6 text-center text-sm">
        Working on Summer Bunking instead?{' '}
        <Link
          to="/"
          onClick={() => clearProgram()}
          className="text-primary font-medium hover:underline"
        >
          Switch programs
        </Link>
      </p>
    </div>
  )
}
