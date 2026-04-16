import type { ReactNode } from 'react'
import { CalendarDays, Library, Users } from 'lucide-react'

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-900">{label}</p>
      <p className="mt-0.5 text-xs text-gray-600 leading-relaxed">{children}</p>
    </div>
  )
}

/**
 * Home-page glossary: Planning, Library, and Connect terminology for new users.
 */
export function HomeGlossaryCards() {
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
      <section className="min-w-0 rounded-lg border border-gymnext-muted/30 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <CalendarDays className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          Planning
        </h3>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          Build and view your training calendar—today&apos;s schedule, your full list of plans, and a week-by-week
          view ahead.
        </p>
        <div className="mt-4 space-y-3">
          <Term label="Plan">
            A training calendar you create or follow. It holds workouts scheduled on specific days.
          </Term>
          <Term label="Workout">
            A timed routine (segments, rounds, rest periods, etc.) that you can run using the timer.
          </Term>
          <Term label="Planned Workout">
            A workout scheduled on a specific day within a plan. It can be selected from your library or created on
            the spot.
          </Term>
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-gymnext-muted/30 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Library className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          Library
        </h3>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          Your collection of workouts and how you organize them, along with access to content shared by others.
        </p>
        <div className="mt-4 space-y-3">
          <Term label="Favorite">
            A quick-access list of workouts you use often, stored in your dedicated Favorites collection.
          </Term>
          <Term label="Collection">
            A folder for organizing your workouts (e.g., &ldquo;Leg Day&rdquo; or &ldquo;Travel&rdquo;), making them
            easier to browse and add to plans.
          </Term>
          <Term label="Bookmark">
            A saved link to someone else&apos;s shared workout or collection. Bookmarks stay synced, so updates from
            the original creator are reflected automatically.
          </Term>
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-gymnext-muted/30 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Users className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          Connect
        </h3>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          People, groups, and shared activity—how you discover content and stay connected with others.
        </p>
        <div className="mt-4 space-y-3">
          <Term label="Hub">
            A shared group space with its own activity feed and library. You can create a hub or join as a member.
          </Term>
          <Term label="Connection">
            A direct, one-to-one link with another user, allowing you to share workouts, plans, and updates
            privately.
          </Term>
          <Term label="Membership">
            Your role within a hub. As a member, you can access its shared content and activity.
          </Term>
        </div>
      </section>
    </div>
  )
}
