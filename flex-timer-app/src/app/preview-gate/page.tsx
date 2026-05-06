'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function PreviewGateForm() {
  const searchParams = useSearchParams()
  const fromRaw = searchParams.get('from') ?? '/'
  const safeFrom =
    fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : '/'

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/preview-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Could not verify code')
        return
      }
      window.location.assign(safeFrom)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--gymnext-page)] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--gymnext-muted)]/40 bg-white p-8 shadow-lg shadow-[var(--gymnext)]/10">
        <h1 className="text-xl font-semibold text-[var(--gymnext-dark)]">FlexTimer preview</h1>
        <p className="mt-2 text-sm text-gray-600">
          This build is not public yet. Enter the access code to continue.
        </p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="access-code" className="sr-only">
              Access code
            </label>
            <input
              id="access-code"
              name="access-code"
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-[var(--gymnext)] focus:outline-none focus:ring-2 focus:ring-[var(--gymnext-muted)]/50"
              placeholder="Access code"
              disabled={loading}
              required
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[var(--gymnext)] px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-[var(--gymnext-dark)] disabled:opacity-60"
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function PreviewGatePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--gymnext-page)]">
          <p className="text-sm text-gray-600">Loading…</p>
        </div>
      }
    >
      <PreviewGateForm />
    </Suspense>
  )
}
