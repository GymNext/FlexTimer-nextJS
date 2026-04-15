'use client'

import { useMemo } from 'react'
import { getGroupLookupItems } from '@/lib/group-lookups'
import type { UserHubLookupIds, UserHubLookupIdKey } from '@/types/hub-profile'
import { HUB_LOOKUP_ROWS } from '@/types/hub-profile'

export function HubProfileFields({
  value,
  onChange,
  disabled = false,
}: {
  value: UserHubLookupIds
  onChange: (next: UserHubLookupIds) => void
  disabled?: boolean
}) {
  const optionsByKind = useMemo(() => {
    const map = new Map(HUB_LOOKUP_ROWS.map((row) => [row.key, getGroupLookupItems(row.kind)] as const))
    return map
  }, [])

  function setField(key: UserHubLookupIdKey, raw: string) {
    const v = raw === '' ? null : raw
    onChange({ ...value, [key]: v })
  }

  return (
    <div className="space-y-3">
      {HUB_LOOKUP_ROWS.map((row) => {
        const options = optionsByKind.get(row.key) ?? []
        const current = value[row.key] ?? ''
        return (
          <div key={row.key}>
            <label
              htmlFor={`hub-${row.key}`}
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              {row.label}
            </label>
            <select
              id={`hub-${row.key}`}
              value={current}
              disabled={disabled}
              onChange={(e) => setField(row.key, e.target.value)}
              className="w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">—</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}
