'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { Copy, Mail, MessageSquare, RefreshCw, Share2, X } from 'lucide-react'
import toast from 'react-hot-toast'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

/**
 * Strip a leading "@" (if present) so the value is safe to embed in a URL path.
 * The iOS app's URL scheme uses the bare handle (no "@").
 */
function sanitizeHandleForUrl(handle: string | null | undefined): string {
  if (!handle) return ''
  const trimmed = handle.trim()
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
}

/** Match the iOS app scheme: flextimer://user/<handle>[?instant=<code>] */
function buildInviteUrl(handle: string, code: string | null, includeCode: boolean): string {
  const base = `flextimer://user/${encodeURIComponent(handle)}`
  if (includeCode && code) {
    return `${base}?instant=${encodeURIComponent(code)}`
  }
  return base
}

/** iOS-ported copy: "Connect with me on the GymNext Flex Timer app by searching for %@ or follow this link: %@" */
function buildInviteMessage(handle: string, url: string): string {
  const atHandle = handle.startsWith('@') ? handle : `@${handle}`
  return `Connect with me on the GymNext Flex Timer app by searching for ${atHandle} or follow this link: ${url}`
}

export function SendInviteLinkDialog({
  open,
  onClose,
  user,
  handle: handleProp,
}: {
  open: boolean
  onClose: () => void
  user: User
  handle?: string | null
}) {
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [instantCode, setInstantCode] = useState<string | null>(null)
  const [handle, setHandle] = useState<string | null>(handleProp ?? null)
  const [generating, setGenerating] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [includeCodeInMessage, setIncludeCodeInMessage] = useState(false)
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const loadCurrent = useCallback(async () => {
    setLoadState('loading')
    setLoadError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/profile/instant-connect-code', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        instantConnectCode?: string | null
        handle?: string | null
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setInstantCode(typeof data.instantConnectCode === 'string' ? data.instantConnectCode : null)
      if (typeof data.handle === 'string' && data.handle.trim() !== '') {
        setHandle(data.handle)
      } else if (handleProp) {
        setHandle(handleProp)
      } else {
        setHandle(null)
      }
      setLoadState('loaded')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load instant connect code')
      setLoadState('error')
    }
  }, [user, handleProp])

  useEffect(() => {
    if (!open) return
    void loadCurrent()
  }, [open, loadCurrent])

  useEffect(() => {
    if (!open) {
      setIncludeCodeInMessage(false)
      setConfirmRegenerateOpen(false)
      setConfirmClearOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!instantCode) setIncludeCodeInMessage(false)
  }, [instantCode])

  async function regenerateCode() {
    setGenerating(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/profile/instant-connect-code', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        instantConnectCode?: string | null
        handle?: string | null
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (typeof data.instantConnectCode === 'string' && data.instantConnectCode.trim() !== '') {
        setInstantCode(data.instantConnectCode)
      }
      if (typeof data.handle === 'string' && data.handle.trim() !== '') {
        setHandle(data.handle)
      }
      toast.success('New instant connect code generated.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate code')
    } finally {
      setGenerating(false)
    }
  }

  async function clearCode() {
    setClearing(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/profile/instant-connect-code', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        instantConnectCode?: string | null
        handle?: string | null
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setInstantCode(null)
      if (typeof data.handle === 'string' && data.handle.trim() !== '') {
        setHandle(data.handle)
      }
      toast.success('Instant connect code cleared.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear code')
    } finally {
      setClearing(false)
    }
  }

  const urlHandle = sanitizeHandleForUrl(handle)
  const hasHandle = urlHandle !== ''
  const canIncludeCode = Boolean(instantCode && hasHandle)
  const effectiveInclude = includeCodeInMessage && canIncludeCode

  const previewUrl = useMemo(
    () => (hasHandle ? buildInviteUrl(urlHandle, instantCode, effectiveInclude) : ''),
    [hasHandle, urlHandle, instantCode, effectiveInclude],
  )
  const previewMessage = useMemo(
    () => (hasHandle ? buildInviteMessage(urlHandle, previewUrl) : ''),
    [hasHandle, urlHandle, previewUrl],
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
        title: 'GymNext Flex Timer — Connect with me',
        text: previewMessage,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      toast.error('Share failed.')
    }
  }

  function openEmail() {
    if (!previewMessage) return
    const subject = 'Connect with me on the GymNext Flex Timer app'
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
          <h3 className="text-sm font-semibold text-gray-800">Send Invite Link</h3>
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
          {/* Section 1: Instant Connect Code */}
          <section>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900">Instant Connect Code</h4>
                <div className="flex items-center gap-2">
                  {loadState === 'loading' ? (
                    <span className="font-mono text-sm text-gray-400">…</span>
                  ) : loadState === 'error' ? (
                    <span className="font-mono text-sm text-gray-400">-</span>
                  ) : (
                    <span className="font-mono text-sm font-medium text-gray-900 select-all">
                      {instantCode ?? '-'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (instantCode) {
                        setConfirmRegenerateOpen(true)
                      } else {
                        void regenerateCode()
                      }
                    }}
                    disabled={generating || clearing || loadState === 'loading'}
                    title={instantCode ? 'Regenerate instant connect code' : 'Generate instant connect code'}
                    aria-label={instantCode ? 'Regenerate instant connect code' : 'Generate instant connect code'}
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-gymnext-muted/40 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                  </button>
                  {instantCode && (
                    <button
                      type="button"
                      onClick={() => setConfirmClearOpen(true)}
                      disabled={generating || clearing || loadState === 'loading'}
                      title="Clear instant connect code"
                      aria-label="Clear instant connect code"
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
                Include this code when sending an invite to let others connect with you instantly—no
                approval required. Treat it like a password and only share it with people you trust.
              </p>
            </div>
          </section>

          {/* Section 2: Notification builder */}
          <section>
            <h4 className="text-sm font-semibold text-gray-900">Invite Message</h4>

            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm font-medium text-gray-800">
                  Include instant connect code
                </span>
                <ToggleSwitch
                  checked={effectiveInclude}
                  disabled={!canIncludeCode}
                  onChange={(v) => setIncludeCodeInMessage(v)}
                  ariaLabel="Include instant connect code in message"
                />
              </label>
              <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                Include your instant connect code in the link to let users connect with you
                immediately, without approval.
              </p>
              {!canIncludeCode && (
                <p className="mt-2 text-xs text-amber-700">
                  {hasHandle
                    ? 'Generate an instant connect code above to enable this option.'
                    : 'Set a handle on your profile before you can share an invite link.'}
                </p>
              )}
            </div>

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
                    Set a handle on your profile to preview the invite message.
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
            <h4 className="text-sm font-semibold text-gray-900">Regenerate instant connect code?</h4>
            <p className="mt-2 text-sm text-gray-600">
              Your current instant connect code will stop working immediately, and any links you
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
            <h4 className="text-sm font-semibold text-gray-900">Clear instant connect code?</h4>
            <p className="mt-2 text-sm text-gray-600">
              Your instant connect code will be removed, and any links you already shared that
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
