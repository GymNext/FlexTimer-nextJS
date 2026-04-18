'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { Copy, Mail, MessageSquare, RefreshCw, Share2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AppGroupJoinPolicy } from '@/types/group'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

type HubData = {
  instantJoinCode: string | null
  handle: string | null
  name: string | null
  joinPolicy: AppGroupJoinPolicy
  parentGroupId: string | null
}

/**
 * Strip a leading "@" (if present) so the value is safe to embed in a URL path.
 * The iOS app's URL scheme uses the bare handle (no "@").
 */
function sanitizeHandleForUrl(handle: string | null | undefined): string {
  if (!handle) return ''
  const trimmed = handle.trim()
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
}

/** Match the iOS app scheme: flextimer://hub/<handle>[?instant=<code>] */
function buildInviteUrl(handle: string, code: string | null, includeCode: boolean): string {
  const base = `flextimer://hub/${encodeURIComponent(handle)}`
  if (includeCode && code) {
    return `${base}?instant=${encodeURIComponent(code)}`
  }
  return base
}

/**
 * iOS-ported copy: "Connect with %@ on the GymNext Flex Timer app by searching for %@ or follow this link: %@"
 * - first %@ = hub name
 * - second %@ = @handle
 * - third %@ = invite url
 */
function buildInviteMessage(groupName: string, handle: string, url: string): string {
  const atHandle = handle.startsWith('@') ? handle : `@${handle}`
  return `Connect with ${groupName} on the GymNext Flex Timer app by searching for ${atHandle} or follow this link: ${url}`
}

export function SendHubInviteLinkDialog({
  open,
  onClose,
  user,
  groupId,
  fallbackName,
}: {
  open: boolean
  onClose: () => void
  user: User
  groupId: string | null
  fallbackName?: string | null
}) {
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hub, setHub] = useState<HubData | null>(null)
  const [generating, setGenerating] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [includeCodeInMessage, setIncludeCodeInMessage] = useState(false)
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const loadCurrent = useCallback(async () => {
    if (!groupId) return
    setLoadState('loading')
    setLoadError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/groups/${encodeURIComponent(groupId)}/instant-join-code`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as Partial<HubData> & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setHub({
        instantJoinCode:
          typeof data.instantJoinCode === 'string' && data.instantJoinCode.trim() !== ''
            ? data.instantJoinCode
            : null,
        handle:
          typeof data.handle === 'string' && data.handle.trim() !== '' ? data.handle : null,
        name:
          typeof data.name === 'string' && data.name.trim() !== ''
            ? data.name
            : (fallbackName ?? null),
        joinPolicy: (data.joinPolicy as AppGroupJoinPolicy | undefined) ?? 'private',
        parentGroupId:
          typeof data.parentGroupId === 'string' && data.parentGroupId.trim() !== ''
            ? data.parentGroupId
            : null,
      })
      setLoadState('loaded')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load instant join code')
      setLoadState('error')
    }
  }, [user, groupId, fallbackName])

  useEffect(() => {
    if (!open || !groupId) return
    void loadCurrent()
  }, [open, groupId, loadCurrent])

  useEffect(() => {
    if (!open) {
      setIncludeCodeInMessage(false)
      setConfirmRegenerateOpen(false)
      setConfirmClearOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!hub?.instantJoinCode) setIncludeCodeInMessage(false)
  }, [hub?.instantJoinCode])

  async function regenerateCode() {
    if (!groupId) return
    setGenerating(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/groups/${encodeURIComponent(groupId)}/instant-join-code`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as Partial<HubData> & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setHub((prev) => ({
        instantJoinCode:
          typeof data.instantJoinCode === 'string' && data.instantJoinCode.trim() !== ''
            ? data.instantJoinCode
            : (prev?.instantJoinCode ?? null),
        handle:
          typeof data.handle === 'string' && data.handle.trim() !== ''
            ? data.handle
            : (prev?.handle ?? null),
        name:
          typeof data.name === 'string' && data.name.trim() !== ''
            ? data.name
            : (prev?.name ?? fallbackName ?? null),
        joinPolicy: (data.joinPolicy as AppGroupJoinPolicy | undefined) ?? prev?.joinPolicy ?? 'private',
        parentGroupId:
          typeof data.parentGroupId === 'string' && data.parentGroupId.trim() !== ''
            ? data.parentGroupId
            : (prev?.parentGroupId ?? null),
      }))
      toast.success('New instant join code generated.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate code')
    } finally {
      setGenerating(false)
    }
  }

  async function clearCode() {
    if (!groupId) return
    setClearing(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/groups/${encodeURIComponent(groupId)}/instant-join-code`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as Partial<HubData> & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setHub((prev) => ({
        instantJoinCode: null,
        handle:
          typeof data.handle === 'string' && data.handle.trim() !== ''
            ? data.handle
            : (prev?.handle ?? null),
        name:
          typeof data.name === 'string' && data.name.trim() !== ''
            ? data.name
            : (prev?.name ?? fallbackName ?? null),
        joinPolicy: (data.joinPolicy as AppGroupJoinPolicy | undefined) ?? prev?.joinPolicy ?? 'private',
        parentGroupId:
          typeof data.parentGroupId === 'string' && data.parentGroupId.trim() !== ''
            ? data.parentGroupId
            : (prev?.parentGroupId ?? null),
      }))
      toast.success('Instant join code cleared.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear code')
    } finally {
      setClearing(false)
    }
  }

  const joinPolicy = hub?.joinPolicy ?? 'private'
  const isPublicHub = joinPolicy === 'public'
  const isSubHub = Boolean(hub?.parentGroupId)
  const urlHandle = sanitizeHandleForUrl(hub?.handle ?? null)
  const hasHandle = urlHandle !== ''
  const groupDisplayName = hub?.name?.trim() || fallbackName?.trim() || 'this hub'
  const canIncludeCode = Boolean(hub?.instantJoinCode && hasHandle && !isPublicHub)
  const effectiveInclude = includeCodeInMessage && canIncludeCode

  const previewUrl = useMemo(
    () => (hasHandle ? buildInviteUrl(urlHandle, hub?.instantJoinCode ?? null, effectiveInclude) : ''),
    [hasHandle, urlHandle, hub?.instantJoinCode, effectiveInclude],
  )
  const previewMessage = useMemo(
    () => (hasHandle ? buildInviteMessage(groupDisplayName, urlHandle, previewUrl) : ''),
    [hasHandle, urlHandle, previewUrl, groupDisplayName],
  )

  const canShareViaNavigator =
    typeof navigator !== 'undefined' && typeof (navigator as Navigator).share === 'function'

  async function copyMessage() {
    if (!previewMessage) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(previewMessage)
      } else {
        const ta = document.createElement('textarea')
        ta.value = previewMessage
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      toast.success('Invite message copied.')
    } catch {
      toast.error('Could not copy to clipboard.')
    }
  }

  async function shareViaNavigator() {
    if (!previewMessage) return
    try {
      await (navigator as Navigator).share({
        title: `GymNext Flex Timer — Connect with ${groupDisplayName}`,
        text: previewMessage,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      toast.error('Share failed.')
    }
  }

  function openEmail() {
    if (!previewMessage) return
    const subject = `Connect with ${groupDisplayName} on the GymNext Flex Timer app`
    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(previewMessage)}`
    window.open(href, '_blank')
  }

  function openSms() {
    if (!previewMessage) return
    const href = `sms:?&body=${encodeURIComponent(previewMessage)}`
    window.open(href, '_blank')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-xl max-h-[min(92vh,44rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <h3 className="text-sm font-semibold text-gray-800">
            Invite via Link{hub?.name ? ` — ${hub.name}` : ''}
          </h3>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
          {/* Section 1: Instant Join Code — hidden for public hubs (not applicable). */}
          {!isPublicHub && (
            <section>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-gray-900">Instant Join Code</h4>
                  <div className="flex items-center gap-2">
                    {loadState === 'loading' ? (
                      <span className="font-mono text-sm text-gray-400">…</span>
                    ) : loadState === 'error' ? (
                      <span className="font-mono text-sm text-gray-400">-</span>
                    ) : (
                      <span className="font-mono text-sm font-medium text-gray-900 select-all">
                        {hub?.instantJoinCode ?? '-'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (hub?.instantJoinCode) {
                          setConfirmRegenerateOpen(true)
                        } else {
                          void regenerateCode()
                        }
                      }}
                      disabled={generating || clearing || loadState === 'loading'}
                      title={
                        hub?.instantJoinCode
                          ? 'Regenerate instant join code'
                          : 'Generate instant join code'
                      }
                      aria-label={
                        hub?.instantJoinCode
                          ? 'Regenerate instant join code'
                          : 'Generate instant join code'
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-gymnext-muted/40 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                    </button>
                    {hub?.instantJoinCode && (
                      <button
                        type="button"
                        onClick={() => setConfirmClearOpen(true)}
                        disabled={generating || clearing || loadState === 'loading'}
                        title="Clear instant join code"
                        aria-label="Clear instant join code"
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-gymnext-muted/40 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {loadState === 'error' && loadError && (
                  <p className="mt-2 text-xs text-red-600">{loadError}</p>
                )}
                <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                  Include this code when sending an invite to let others join this hub instantly—no
                  approval required. Treat it like a password and only share it with people you trust.
                </p>
              </div>
            </section>
          )}

          {/* Section 2: Notification builder */}
          <section>
            <h4 className="text-sm font-semibold text-gray-900">Invite Message</h4>

            {/* Include-code toggle — hidden for public hubs (not applicable). */}
            {!isPublicHub && (
              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-sm font-medium text-gray-800">
                    Include instant join code
                  </span>
                  <ToggleSwitch
                    checked={effectiveInclude}
                    disabled={!canIncludeCode}
                    onChange={(v) => setIncludeCodeInMessage(v)}
                    ariaLabel="Include instant join code in message"
                  />
                </label>
                <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                  Include your instant join code in the link to let users join the hub immediately,
                  without approval.
                </p>
                {!canIncludeCode && loadState === 'loaded' && (
                  <p className="mt-2 text-xs text-amber-700">
                    {isSubHub
                      ? 'Sub hubs don’t have their own invite link. Share the parent hub’s link instead.'
                      : !hasHandle
                        ? 'Set a handle on this hub before you can share an invite link.'
                        : 'Generate an instant join code above to enable this option.'}
                  </p>
                )}
              </div>
            )}

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Preview</p>
                {hasHandle && (
                  <button
                    type="button"
                    onClick={() => void copyMessage()}
                    title="Copy message"
                    aria-label="Copy message"
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-[#6B21A8] hover:text-[#5B1A91] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6B21A8]/40"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                )}
              </div>
              <div className="relative rounded-md border border-gray-200 bg-white">
                {hasHandle ? (
                  <p className="px-3 py-3 pr-3 text-sm text-gray-800 whitespace-pre-wrap break-words">
                    {previewMessage}
                  </p>
                ) : (
                  <p className="px-3 py-3 text-sm text-gray-500">
                    {isSubHub
                      ? 'Sub hubs don’t have their own invite link. Share the parent hub’s link instead.'
                      : 'Set a handle on this hub to preview the invite message.'}
                  </p>
                )}
              </div>
            </div>

            {hasHandle && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {canShareViaNavigator && (
                  <button
                    type="button"
                    onClick={() => void shareViaNavigator()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-purple-800 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-purple-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-700/50"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share…
                  </button>
                )}
                <button
                  type="button"
                  onClick={openEmail}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </button>
                <button
                  type="button"
                  onClick={openSms}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Text / SMS
                </button>
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-gymnext-muted/30 px-4 py-3 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>

      {confirmRegenerateOpen && (
        <div
          className="fixed inset-0 z-[61] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!generating) setConfirmRegenerateOpen(false)
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Regenerate instant join code?</h4>
            <p className="mt-2 text-sm text-gray-600">
              This hub’s current instant join code will stop working immediately, and any links you
              already shared that include it will no longer grant instant access.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={generating}
                onClick={() => setConfirmRegenerateOpen(false)}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={generating}
                onClick={async () => {
                  await regenerateCode()
                  setConfirmRegenerateOpen(false)
                }}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                {generating ? 'Regenerating…' : 'Regenerate code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClearOpen && (
        <div
          className="fixed inset-0 z-[61] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!clearing) setConfirmClearOpen(false)
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Clear instant join code?</h4>
            <p className="mt-2 text-sm text-gray-600">
              This hub’s instant join code will be removed, and any links you already shared that
              include it will no longer grant instant access.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={clearing}
                onClick={() => setConfirmClearOpen(false)}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={clearing}
                onClick={async () => {
                  await clearCode()
                  setConfirmClearOpen(false)
                }}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#b91c1c' }}
              >
                {clearing ? 'Clearing…' : 'Clear code'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-[#6B21A8]' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
