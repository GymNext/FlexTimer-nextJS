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
          Build and view your training calendar—today, your full plan list, and week-by-week plan ahead.
        </p>
        <div className="mt-4 space-y-3">
          <Term label="Plan">
            A training calendar you own (or follow from someone else). It holds scheduled sessions, time zones,
            and how workouts appear on your schedule.
          </Term>
          <Term label="Workout">
            The timed routine you build in Library (segments, rounds, etc.). Planning does not replace that
            definition—it is where you decide which days those routines run.
          </Term>
          <Term label="Planned workout">
            A workout placed on a specific day inside a plan. It is usually created from a workout in your
            library or from something shared with you.
          </Term>
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-gymnext-muted/30 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Library className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          Library
        </h3>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          Your workouts and how you organize them—plus links to other people’s shared content.
        </p>
        <div className="mt-4 space-y-3">
          <Term label="Workout">
            A timed routine (segments, rounds, rests, etc.) that you can run in the timer. Workouts live in your
            library until you delete them.
          </Term>
          <Term label="Favorite">
            A shortcut list of workouts you use often. Favorites are stored in your special Favorites collection.
          </Term>
          <Term label="Collection">
            A folder that groups your own workouts—like “Leg day” or “Travel”—so you can browse and add them to
            plans more easily.
          </Term>
          <Term label="Bookmark">
            A saved reference to someone else’s shared workout or collection. Bookmarks stay in your library so
            you can reopen them while you still have access.
          </Term>
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-gymnext-muted/30 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Users className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          Connect
        </h3>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          People, groups, and shared activity—how you discover content and stay in sync with others.
        </p>
        <div className="mt-4 space-y-3">
          <Term label="Hub">
            A group space (sometimes called a gym or community hub) with its own feed and shared library. You
            might own a hub or join one as a member.
          </Term>
          <Term label="Connection">
            A one-to-one link with another FlexTimer user so you can share workouts, plans, and feed items
            directly, outside of a hub.
          </Term>
          <Term label="Membership">
            Your relationship to a hub: as a member you can see that hub’s activity and shared content according
            to the hub’s settings and your role.
          </Term>
        </div>
      </section>
    </div>
  )
}
