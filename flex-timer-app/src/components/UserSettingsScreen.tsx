'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import {
  COUNTRIES,
  countryCodeForDisplayName,
  countryDisplayName,
  subdivisionsForCountryCode,
} from '@/lib/locations'
import { HUB_LOOKUP_ROWS, type UserHubLookupIds, type UserHubLookupLabels } from '@/types/hub-profile'

export type UserProfilePatch = {
  handle?: string | null
  handleKey?: string | null
  bio?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  hubLookupIds?: UserHubLookupIds
  hubLookupLabels?: UserHubLookupLabels
}

type OverviewLike = {
  bio?: string | null
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  handleKey?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  hubLookupIds?: UserHubLookupIds
  hubLookupLabels?: UserHubLookupLabels
}

function handleWithoutAt(h: string | null | undefined): string {
  return (h ?? '').trim().replace(/^@/, '')
}

export function UserSettingsScreen({
  user,
  overview,
  overviewLoading,
  openHandleEditor,
  onProfileUpdated,
}: {
  user: User
  overview: OverviewLike | null
  overviewLoading: boolean
  openHandleEditor: () => void
  onProfileUpdated: (profile: UserProfilePatch) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [handleChangePromptOpen, setHandleChangePromptOpen] = useState(false)

  const [firstNameDraft, setFirstNameDraft] = useState('')
  const [lastNameDraft, setLastNameDraft] = useState('')
  const [bioDraft, setBioDraft] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [regionDraft, setRegionDraft] = useState('')
  const [cityDraft, setCityDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFirstNameDraft(overview?.firstName ?? '')
    setLastNameDraft(overview?.lastName ?? '')
    setBioDraft(overview?.bio ?? '')
    setCountryCode(countryCodeForDisplayName(overview?.country))
    setRegionDraft(overview?.region ?? '')
    setCityDraft(overview?.city ?? '')
  }, [overview?.firstName, overview?.lastName, overview?.bio, overview?.city, overview?.region, overview?.country])

  const regionOptions = useMemo(() => subdivisionsForCountryCode(countryCode), [countryCode])

  useEffect(() => {
    if (!menuOpen) return
    function onDocMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [menuOpen])

  const draftCountryStored =
    countryCode.trim() === ''
      ? null
      : countryDisplayName(countryCode)?.trim() || null
  const storedCountry = overview?.country?.trim() || null
  const dirty =
    firstNameDraft !== (overview?.firstName ?? '') ||
    lastNameDraft !== (overview?.lastName ?? '') ||
    bioDraft !== (overview?.bio ?? '') ||
    draftCountryStored !== storedCountry ||
    regionDraft !== (overview?.region ?? '') ||
    cityDraft !== (overview?.city ?? '')

  const save = useCallback(async () => {
    if (!overview || saving || !dirty) return
    setSaving(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bio: bioDraft,
          firstName: firstNameDraft,
          lastName: lastNameDraft,
          country: draftCountryStored,
          region: regionDraft.trim() || null,
          city: cityDraft.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as UserProfilePatch
      onProfileUpdated({
        handle: data.handle ?? overview.handle ?? null,
        handleKey: data.handleKey ?? overview.handleKey ?? null,
        bio: data.bio ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        city: data.city ?? null,
        region: data.region ?? null,
        country: data.country ?? null,
        hubLookupIds: data.hubLookupIds,
        hubLookupLabels: data.hubLookupLabels,
      })
      toast.success('Profile saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }, [
    overview,
    saving,
    dirty,
    user,
    bioDraft,
    firstNameDraft,
    lastNameDraft,
    draftCountryStored,
    regionDraft,
    cityDraft,
    onProfileUpdated,
  ])

  const hubLookupLabels = overview?.hubLookupLabels
  const headerAtHandle = handleWithoutAt(overview?.handle) || overview?.handleKey?.trim() || ''
  const firestoreFullName = [overview?.firstName?.trim(), overview?.lastName?.trim()].filter(Boolean).join(' ')
  const preferredUserName =
    firestoreFullName || user.displayName?.trim() || user.email?.trim() || 'Signed in'

  const showForm = Boolean(overview) && !overviewLoading
  const saveDisabled = !showForm || saving || !dirty

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white shadow-sm">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">User settings</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Edit your profile, location, and bio.
          </p>
        </div>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded px-2 py-1 text-lg font-semibold leading-none text-gray-500 hover:bg-white/80 hover:text-gray-800"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More settings"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 min-w-[11rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gymnext-background"
                onClick={() => {
                  setMenuOpen(false)
                  openHandleEditor()
                }}
              >
                {headerAtHandle ? 'Change handle' : 'Set handle'}
              </button>
            </div>
          )}
        </div>
      </header>

      {overviewLoading && !overview ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">Loading your profile…</p>
      ) : !overview ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          Profile data is not available yet. Try again after your library finishes loading.
        </p>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
            <div className="flex items-center gap-4">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-full bg-gray-100 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gymnext-muted/30 text-xl font-medium text-gray-600">
                  {(firestoreFullName?.[0] ?? user.displayName?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{preferredUserName}</p>
                {user.email && <p className="truncate text-xs text-gray-500">{user.email}</p>}
                <p className="mt-1 text-xs text-gray-600">
                  {headerAtHandle ? (
                    <>
                      Handle:{' '}
                      <button
                        type="button"
                        onClick={() => setHandleChangePromptOpen(true)}
                        className="font-medium text-[#6B21A8] underline decoration-[#6B21A8]/40 underline-offset-2 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6B21A8] focus-visible:ring-offset-1 rounded-sm"
                      >
                        @{headerAtHandle}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-500">No handle set — </span>
                      <button
                        type="button"
                        onClick={() => setHandleChangePromptOpen(true)}
                        className="font-medium text-[#6B21A8] underline decoration-[#6B21A8]/40 underline-offset-2 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6B21A8] focus-visible:ring-offset-1 rounded-sm"
                      >
                        Set your handle
                      </button>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="settings-first-name" className="block text-xs font-medium text-gray-700">
                  First name
                </label>
                <input
                  id="settings-first-name"
                  type="text"
                  value={firstNameDraft}
                  onChange={(e) => setFirstNameDraft(e.target.value)}
                  autoComplete="given-name"
                  className="mt-1 w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40"
                  placeholder="First name"
                />
              </div>
              <div>
                <label htmlFor="settings-last-name" className="block text-xs font-medium text-gray-700">
                  Last name
                </label>
                <input
                  id="settings-last-name"
                  type="text"
                  value={lastNameDraft}
                  onChange={(e) => setLastNameDraft(e.target.value)}
                  autoComplete="family-name"
                  className="mt-1 w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40"
                  placeholder="Last name"
                />
              </div>
            </div>

            <div>
              <label htmlFor="settings-bio" className="block text-xs font-medium text-gray-700">
                Bio
              </label>
              <textarea
                id="settings-bio"
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                rows={10}
                className="mt-1 min-h-[10rem] w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40"
                placeholder="Tell people a little about yourself"
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Location</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="min-w-0">
                  <label htmlFor="settings-country" className="mb-1 block text-xs font-medium text-gray-700">
                    Country
                  </label>
                  <select
                    id="settings-country"
                    value={countryCode}
                    onChange={(e) => {
                      setCountryCode(e.target.value)
                      setRegionDraft('')
                    }}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  >
                    <option value="">— Optional —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label htmlFor="settings-region" className="mb-1 block text-xs font-medium text-gray-700">
                    State / Province / Region
                  </label>
                  {regionOptions ? (
                    <select
                      id="settings-region"
                      value={regionDraft}
                      onChange={(e) => setRegionDraft(e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    >
                      <option value="">— Optional —</option>
                      {regionOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="settings-region"
                      value={regionDraft}
                      onChange={(e) => setRegionDraft(e.target.value)}
                      placeholder="e.g. Bavaria"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    />
                  )}
                </div>
                <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                  <label htmlFor="settings-city" className="mb-1 block text-xs font-medium text-gray-700">
                    City
                  </label>
                  <input
                    id="settings-city"
                    value={cityDraft}
                    onChange={(e) => setCityDraft(e.target.value)}
                    placeholder="e.g. Austin"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  />
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              {HUB_LOOKUP_ROWS.map((row) => {
                const text = hubLookupLabels?.[row.key]
                if (!text) return null
                return (
                  <Fragment key={row.key}>
                    <dt className="font-medium text-gray-500">{row.label}</dt>
                    <dd className="text-gray-900">{text}</dd>
                  </Fragment>
                )
              })}
              {user.phoneNumber && (
                <>
                  <dt className="font-medium text-gray-500">Phone</dt>
                  <dd className="text-gray-900">{user.phoneNumber}</dd>
                </>
              )}
            </dl>
          </div>

          <footer className="shrink-0 border-t border-gymnext-muted/30 bg-gymnext-background/50 px-4 py-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saveDisabled}
                className="rounded bg-gymnext px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </footer>
        </>
      )}
      {handleChangePromptOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50"
              aria-hidden
              onClick={() => setHandleChangePromptOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="handle-change-prompt-title"
              className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white p-4 shadow-lg"
            >
              <h2 id="handle-change-prompt-title" className="text-sm font-semibold text-gray-900">
                {headerAtHandle ? 'Change your handle?' : 'Set your handle?'}
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {headerAtHandle
                  ? 'Would you like to change your handle?'
                  : 'Would you like to set a public handle for your account?'}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setHandleChangePromptOpen(false)}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHandleChangePromptOpen(false)
                    openHandleEditor()
                  }}
                  className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {headerAtHandle ? 'Change handle' : 'Set handle'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
