'use client'

import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { isAppGroupType, parseFirestoreJoinPolicy, type AppGroupJoinPolicy, type AppGroupType } from '@/types/group'
import { allowedChildGroupTypes } from '@/lib/subgroup-types'
import { getGroupLookupItems, type GroupLookupKind } from '@/lib/group-lookups'
import { normalizeGroupHandleKey } from '@/lib/group-handle'
import {
  COUNTRIES,
  countryCodeForDisplayName,
  countryDisplayName,
  subdivisionsForCountryCode,
} from '@/lib/locations'
import { HUB_TYPE_CARDS } from '@/lib/hub-type-cards'

type Phase = 'pick-type' | 'step1' | 'step2' | 'step3'

const HUB_CARDS = HUB_TYPE_CARDS

const JOIN_HELP: Record<AppGroupJoinPolicy, string> = {
  private: 'Only people you invite can join this hub.',
  restricted: 'People can request to join; you choose who is approved.',
  public: 'Anyone can discover and join this hub.',
}

const JOIN_HELP_SUBHUB: Record<AppGroupJoinPolicy, string> = {
  private:
    'Only members of the parent hub you invite can join. Invites are limited to people who already belong to the parent hub.',
  restricted:
    'Members of the parent hub can ask to join; you approve who joins. Requests are only visible within the parent hub’s membership.',
  public: 'Any member of the parent hub can join this sub hub (not the wider public).',
}

const JOIN_SEGMENTS: { id: AppGroupJoinPolicy; label: string }[] = [
  { id: 'private', label: 'private' },
  { id: 'restricted', label: 'restricted' },
  { id: 'public', label: 'public' },
]

function createTitle(t: AppGroupType): string {
  const card = HUB_CARDS.find((c) => c.type === t)
  return card ? `Create ${card.title}` : 'Create Hub'
}

function editTitle(t: AppGroupType): string {
  const card = HUB_CARDS.find((c) => c.type === t)
  return card ? `Edit ${card.title}` : 'Edit Hub'
}

function LookupSelect({
  kind,
  label,
  value,
  onChange,
  optional,
}: {
  kind: GroupLookupKind
  label: string
  value: string
  onChange: (v: string) => void
  optional?: boolean
}) {
  const items = useMemo(() => getGroupLookupItems(kind), [kind])
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
      >
        <option value="">{optional ? '— Optional —' : `Select ${label.toLowerCase()}`}</option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function Step3Fields({
  groupType,
  organizationTypeId,
  setOrganizationTypeId,
  gymTypeId,
  setGymTypeId,
  trainingModeId,
  setTrainingModeId,
  brandId,
  setBrandId,
  sportId,
  setSportId,
  levelId,
  setLevelId,
  competitionDisciplineId,
  setCompetitionDisciplineId,
  circleTypeId,
  setCircleTypeId,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}: {
  groupType: AppGroupType
  organizationTypeId: string
  setOrganizationTypeId: (v: string) => void
  gymTypeId: string
  setGymTypeId: (v: string) => void
  trainingModeId: string
  setTrainingModeId: (v: string) => void
  brandId: string
  setBrandId: (v: string) => void
  sportId: string
  setSportId: (v: string) => void
  levelId: string
  setLevelId: (v: string) => void
  competitionDisciplineId: string
  setCompetitionDisciplineId: (v: string) => void
  circleTypeId: string
  setCircleTypeId: (v: string) => void
  startDate: string
  setStartDate: (v: string) => void
  endDate: string
  setEndDate: (v: string) => void
}) {
  switch (groupType) {
    case 'organization':
      return (
        <LookupSelect
          kind="organizationType"
          label="Organization type"
          value={organizationTypeId}
          onChange={setOrganizationTypeId}
          optional
        />
      )
    case 'gym':
      return (
        <div className="space-y-4">
          <LookupSelect kind="gymType" label="Gym type" value={gymTypeId} onChange={setGymTypeId} optional />
          <LookupSelect kind="trainingMode" label="Training mode" value={trainingModeId} onChange={setTrainingModeId} optional />
          <LookupSelect kind="gymBrand" label="Brand" value={brandId} onChange={setBrandId} optional />
        </div>
      )
    case 'class':
      return (
        <LookupSelect kind="trainingMode" label="Training mode" value={trainingModeId} onChange={setTrainingModeId} optional />
      )
    case 'team':
      return (
        <div className="space-y-4">
          <LookupSelect kind="sport" label="Sport" value={sportId} onChange={setSportId} optional />
          <LookupSelect kind="level" label="Level" value={levelId} onChange={setLevelId} optional />
        </div>
      )
    case 'series':
    case 'event':
      return (
        <div className="space-y-4">
          <LookupSelect
            kind="competitionDiscipline"
            label="Competition discipline"
            value={competitionDisciplineId}
            onChange={setCompetitionDisciplineId}
            optional
          />
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Start date (optional)</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">End date (optional)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
            />
          </div>
        </div>
      )
    case 'circle':
      return (
        <LookupSelect kind="circleType" label="Circle type" value={circleTypeId} onChange={setCircleTypeId} optional />
      )
    default:
      return null
  }
}

const initialDetailState = {
  organizationTypeId: '',
  gymTypeId: '',
  trainingModeId: '',
  brandId: '',
  sportId: '',
  levelId: '',
  competitionDisciplineId: '',
  circleTypeId: '',
  startDate: '',
  endDate: '',
}

export function CreateHubWizard({
  open,
  onClose,
  user,
  onCreated,
  onUpdated,
  parentHub = null,
  editGroupId = null,
}: {
  open: boolean
  onClose: () => void
  user: User
  onCreated?: (groupId: string) => void
  onUpdated?: (groupId: string) => void
  /** When creating a subgroup, restricts type picker to allowed child types for this parent. */
  parentHub?: { id: string; groupType: AppGroupType } | null
  /** When set, opens the same steps as create to edit an existing owned hub (no type picker). */
  editGroupId?: string | null
}) {
  const [phase, setPhase] = useState<Phase>('pick-type')
  const [groupType, setGroupType] = useState<AppGroupType | null>(null)
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [joinPolicy, setJoinPolicy] = useState<AppGroupJoinPolicy>('private')
  const [countryCode, setCountryCode] = useState('')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [details, setDetails] = useState(initialDetailState)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [loadEditError, setLoadEditError] = useState<string | null>(null)
  /** Set from GET when editing; sub hubs have join-policy copy scoped to parent membership. */
  const [editLoadedParentGroupId, setEditLoadedParentGroupId] = useState<string | null>(null)

  const setD = <K extends keyof typeof initialDetailState>(key: K, v: string) => {
    setDetails((d) => ({ ...d, [key]: v }))
  }

  useEffect(() => {
    if (!open) {
      setPhase('pick-type')
      setGroupType(null)
      setName('')
      setHandle('')
      setBio('')
      setJoinPolicy('private')
      setCountryCode('')
      setRegion('')
      setCity('')
      setDetails(initialDetailState)
      setError(null)
      setSaving(false)
      setLoadingEdit(false)
      setLoadEditError(null)
      setEditLoadedParentGroupId(null)
      return
    }

    if (!editGroupId) {
      setPhase('pick-type')
      setGroupType(null)
      setName('')
      setHandle('')
      setBio('')
      setJoinPolicy('private')
      setCountryCode('')
      setRegion('')
      setCity('')
      setDetails(initialDetailState)
      setError(null)
      setLoadingEdit(false)
      setLoadEditError(null)
      setEditLoadedParentGroupId(null)
      return
    }

    let cancelled = false
    setLoadingEdit(true)
    setLoadEditError(null)
    setError(null)

    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/groups/${encodeURIComponent(editGroupId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
        if (cancelled) return

        const gtRaw = data.groupType
        if (typeof gtRaw !== 'string' || !isAppGroupType(gtRaw)) throw new Error('Invalid hub data')

        setGroupType(gtRaw)
        setName(typeof data.name === 'string' ? data.name : '')
        setHandle(typeof data.handle === 'string' ? data.handle : '')
        setBio(typeof data.bio === 'string' ? data.bio : '')
        setJoinPolicy(parseFirestoreJoinPolicy(data.joinPolicy) ?? 'private')
        setCountryCode(countryCodeForDisplayName(typeof data.country === 'string' ? data.country : null))
        setRegion(typeof data.region === 'string' ? data.region : '')
        setCity(typeof data.city === 'string' ? data.city : '')
        setDetails({
          organizationTypeId: typeof data.organizationTypeId === 'string' ? data.organizationTypeId : '',
          gymTypeId: typeof data.gymTypeId === 'string' ? data.gymTypeId : '',
          trainingModeId: typeof data.trainingModeId === 'string' ? data.trainingModeId : '',
          brandId: typeof data.brandId === 'string' ? data.brandId : '',
          sportId: typeof data.sportId === 'string' ? data.sportId : '',
          levelId: typeof data.levelId === 'string' ? data.levelId : '',
          competitionDisciplineId:
            typeof data.competitionDisciplineId === 'string' ? data.competitionDisciplineId : '',
          circleTypeId: typeof data.circleTypeId === 'string' ? data.circleTypeId : '',
          startDate: typeof data.startDate === 'string' ? data.startDate : '',
          endDate: typeof data.endDate === 'string' ? data.endDate : '',
        })
        const pgRaw = data.parentGroupId
        setEditLoadedParentGroupId(
          typeof pgRaw === 'string' && pgRaw.trim() ? pgRaw.trim() : null,
        )
        setPhase('step1')
      } catch (e) {
        if (!cancelled) {
          setEditLoadedParentGroupId(null)
          setLoadEditError(e instanceof Error ? e.message : 'Failed to load hub')
        }
      } finally {
        if (!cancelled) setLoadingEdit(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, editGroupId, user])

  useEffect(() => {
    if (!open || editGroupId || !parentHub?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/groups/${encodeURIComponent(parentHub.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok || cancelled) return
        setCountryCode(countryCodeForDisplayName(typeof data.country === 'string' ? data.country : null))
        setRegion(typeof data.region === 'string' ? data.region : '')
        setCity(typeof data.city === 'string' ? data.city : '')
      } catch {
        /* keep empty location */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, editGroupId, parentHub?.id, user])

  const handleKeyOk = normalizeGroupHandleKey(handle) !== null
  const needsHandleField = !editGroupId && !parentHub
  const isSubHubJoinHelp = Boolean(parentHub) || Boolean(editLoadedParentGroupId)
  const step1Valid = name.trim().length > 0 && (!needsHandleField || handleKeyOk)

  const regionOptions = useMemo(() => subdivisionsForCountryCode(countryCode), [countryCode])

  const typePickerCards = useMemo(() => {
    if (!parentHub) return HUB_CARDS
    const allow = new Set(allowedChildGroupTypes(parentHub.groupType))
    return HUB_CARDS.filter((c) => allow.has(c.type))
  }, [parentHub])

  const stepLabel = useMemo(() => {
    if (phase === 'step1') return 'Step 1 of 3: Basics'
    if (phase === 'step2') return 'Step 2 of 3: Location (Optional)'
    if (phase === 'step3') return 'Step 3 of 3: Details (Optional)'
    return ''
  }, [phase])

  function buildMutationBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      name: name.trim(),
      bio: bio.trim() || null,
      joinPolicy,
      country: countryCode ? countryDisplayName(countryCode)?.trim() || null : null,
      region: region.trim() || null,
      city: city.trim() || null,
    }
    if (needsHandleField) {
      body.handle = handle.trim()
    }
    if (!groupType) return body
    const d = details
    if (groupType === 'organization') {
      body.organizationTypeId = d.organizationTypeId || null
    } else if (groupType === 'gym') {
      body.gymTypeId = d.gymTypeId || null
      body.trainingModeId = d.trainingModeId || null
      body.brandId = d.brandId || null
    } else if (groupType === 'class') {
      body.trainingModeId = d.trainingModeId || null
    } else if (groupType === 'team') {
      body.sportId = d.sportId || null
      body.levelId = d.levelId || null
    } else if (groupType === 'series' || groupType === 'event') {
      body.startDate = d.startDate || null
      body.endDate = d.endDate || null
      body.competitionDisciplineId = d.competitionDisciplineId || null
    } else if (groupType === 'circle') {
      body.circleTypeId = d.circleTypeId || null
    }
    return body
  }

  async function submitSave() {
    if (!groupType) return
    setSaving(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      if (editGroupId) {
        const res = await fetch(`/api/app/groups/${encodeURIComponent(editGroupId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(buildMutationBody()),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        onUpdated?.(editGroupId)
        onClose()
        return
      }

      const body = buildMutationBody()
      body.groupType = groupType
      if (parentHub) body.parentGroupId = parentHub.id

      const res = await fetch('/api/app/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; groupId?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (!data.groupId) throw new Error('Missing group id')
      onCreated?.(data.groupId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : editGroupId ? 'Failed to save hub' : 'Failed to create hub')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden
        onClick={() => !saving && !loadingEdit && onClose()}
      />
      <div className="relative w-full max-w-md max-h-[min(92vh,40rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1"
            aria-label="Close"
            disabled={saving || loadingEdit}
            onClick={onClose}
          >
            ×
          </button>
          <h3 className="text-sm font-semibold text-gray-800 text-center flex-1 pr-8">
            {loadEditError || (loadingEdit && editGroupId)
              ? 'Edit Hub'
              : groupType
                ? editGroupId
                  ? editTitle(groupType)
                  : createTitle(groupType)
                : parentHub
                  ? 'Create Sub Hub'
                  : 'Create Hub'}
          </h3>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-4">
          {loadEditError && (
            <div className="space-y-3">
              <p className="text-sm text-red-600">{loadEditError}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-gymnext-background px-4 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Close
              </button>
            </div>
          )}
          {!loadEditError && loadingEdit && editGroupId && (
            <p className="text-sm text-gray-500 py-8 text-center">Loading hub…</p>
          )}
          {!loadEditError && !(loadingEdit && editGroupId) && phase === 'pick-type' && !editGroupId && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-3">
                {parentHub
                  ? 'Choose the type of sub hub to add under this hub.'
                  : 'Choose the type of hub you want to create.'}
              </p>
              {typePickerCards.length === 0 && (
                <p className="text-sm text-amber-800 mb-2">No sub hub types are allowed for this hub.</p>
              )}
              <ul className="space-y-2">
                {typePickerCards.map((c) => (
                  <li key={c.type}>
                    <button
                      type="button"
                      onClick={() => {
                        setGroupType(c.type)
                        setPhase('step1')
                      }}
                      className="w-full flex gap-3 text-left rounded-lg border border-gray-200 bg-white p-3 hover:bg-gray-50 transition-colors"
                    >
                      <span
                        className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                        style={{ backgroundColor: c.barColor }}
                        aria-hidden
                      />
                      <span className="text-2xl shrink-0" aria-hidden>
                        {c.emoji}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">{c.title}</span>
                        <span className="block text-xs text-gray-600 mt-0.5">{c.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loadEditError && !(loadingEdit && editGroupId) && (phase === 'step1' || phase === 'step2' || phase === 'step3') && groupType && (
            <>
              <p className="text-xs font-medium text-gray-600 mb-4">{stepLabel}</p>

              {phase === 'step1' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="hub-name" className="block text-xs font-medium text-gray-700 mb-1">
                      Name
                    </label>
                    <input
                      id="hub-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Northside Strength"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    />
                  </div>
                  {needsHandleField && (
                    <div>
                      <label htmlFor="hub-handle" className="block text-xs font-medium text-gray-700 mb-1">
                        Handle
                      </label>
                      <input
                        id="hub-handle"
                        value={handle}
                        onChange={(e) => setHandle(e.target.value)}
                        placeholder="e.g. northside (letters, numbers, - and _)"
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                      />
                      {handle.trim() && !handleKeyOk && (
                        <p className="text-xs text-red-600 mt-1">Use 1–64 characters: letters, numbers, . _ -</p>
                      )}
                    </div>
                  )}
                  <div>
                    <label htmlFor="hub-bio" className="block text-xs font-medium text-gray-700 mb-1">
                      Bio
                    </label>
                    <textarea
                      id="hub-bio"
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Short description of this hub (optional)"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    />
                  </div>
                  <div>
                    <p className="block text-xs font-medium text-gray-700 mb-2">Privacy</p>
                    <div className="inline-flex rounded border border-gymnext-muted/50 bg-white p-0.5">
                      {JOIN_SEGMENTS.map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setJoinPolicy(id)}
                          className={`rounded px-3 py-1.5 text-xs font-medium ${
                            joinPolicy === id ? 'text-white' : 'text-gray-600 hover:bg-gymnext-background'
                          }`}
                          style={joinPolicy === id ? { backgroundColor: '#6B21A8' } : undefined}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      {(isSubHubJoinHelp ? JOIN_HELP_SUBHUB : JOIN_HELP)[joinPolicy]}
                    </p>
                  </div>
                </div>
              )}

              {phase === 'step2' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="hub-country" className="block text-xs font-medium text-gray-700 mb-1">
                      Country
                    </label>
                    <select
                      id="hub-country"
                      value={countryCode}
                      onChange={(e) => {
                        setCountryCode(e.target.value)
                        setRegion('')
                      }}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    >
                      <option value="">— Optional —</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="hub-region" className="block text-xs font-medium text-gray-700 mb-1">
                      State / Province / Region
                    </label>
                    {regionOptions ? (
                      <select
                        id="hub-region"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
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
                        id="hub-region"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        placeholder="e.g. Bavaria"
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                      />
                    )}
                  </div>
                  <div>
                    <label htmlFor="hub-city" className="block text-xs font-medium text-gray-700 mb-1">
                      City
                    </label>
                    <input
                      id="hub-city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Austin"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    />
                  </div>
                </div>
              )}

              {phase === 'step3' && (
                <Step3Fields
                  groupType={groupType}
                  organizationTypeId={details.organizationTypeId}
                  setOrganizationTypeId={(v) => setD('organizationTypeId', v)}
                  gymTypeId={details.gymTypeId}
                  setGymTypeId={(v) => setD('gymTypeId', v)}
                  trainingModeId={details.trainingModeId}
                  setTrainingModeId={(v) => setD('trainingModeId', v)}
                  brandId={details.brandId}
                  setBrandId={(v) => setD('brandId', v)}
                  sportId={details.sportId}
                  setSportId={(v) => setD('sportId', v)}
                  levelId={details.levelId}
                  setLevelId={(v) => setD('levelId', v)}
                  competitionDisciplineId={details.competitionDisciplineId}
                  setCompetitionDisciplineId={(v) => setD('competitionDisciplineId', v)}
                  circleTypeId={details.circleTypeId}
                  setCircleTypeId={(v) => setD('circleTypeId', v)}
                  startDate={details.startDate}
                  setStartDate={(v) => setD('startDate', v)}
                  endDate={details.endDate}
                  setEndDate={(v) => setD('endDate', v)}
                />
              )}

              {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            </>
          )}
        </div>

        {!loadEditError && !(loadingEdit && editGroupId) && (phase === 'step1' || phase === 'step2' || phase === 'step3') && groupType && (
          <div className="border-t border-gymnext-muted/20 px-4 py-3 flex justify-between gap-2 shrink-0 bg-gymnext-background/30">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setError(null)
                if (phase === 'step1') {
                  if (editGroupId) onClose()
                  else {
                    setPhase('pick-type')
                    setGroupType(null)
                  }
                } else if (phase === 'step2') setPhase('step1')
                else setPhase('step2')
              }}
              className="rounded bg-gymnext-background px-4 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
            >
              Back
            </button>
            {phase === 'step3' ? (
              <button
                type="button"
                disabled={saving || !step1Valid}
                onClick={() => void submitSave()}
                className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <button
                type="button"
                disabled={(phase === 'step1' && !step1Valid) || saving}
                onClick={() => {
                  setError(null)
                  if (phase === 'step1') setPhase('step2')
                  else setPhase('step3')
                }}
                className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#84cc16' }}
              >
                Next
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
