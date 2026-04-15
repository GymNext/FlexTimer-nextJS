'use client'

/** Small pill used for nav / hub counts (connections invites, join requests, etc.). */
export function NavCountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  const label = count > 99 ? '99+' : String(count)
  return (
    <span
      className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm tabular-nums ring-1 ring-white/30"
      aria-hidden
    >
      {label}
    </span>
  )
}
