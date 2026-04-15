import { FieldPath, type DocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { normalizeGroupHandleKey, normalizedGroupNameSearchKey } from '@/lib/group-handle'
import {
  isAppGroupType,
  parseFirestoreJoinPolicy,
  type AppGroupJoinPolicy,
  type AppGroupType,
} from '@/types/group'

const GROUP_HANDLE_INDEX = 'groupHandleIndex'
const GROUPS = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'

export type DiscoverableHubRow = {
  groupId: string
  handleKey: string
  handleDisplay: string
  name: string
  groupType: AppGroupType | null
  joinPolicy: AppGroupJoinPolicy
  /** True when the signed-in user owns this hub (any join policy, including private). */
  viewerOwnsHub: boolean
}

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

function nameSearchPrefixFromQuery(rawQuery: string): string | null {
  const trimmed = rawQuery.trim()
  if (!trimmed) return null
  const fromKey = normalizedGroupNameSearchKey(trimmed)
  if (fromKey && fromKey.length >= 1) return fromKey
  const q = trimmed.toLowerCase()
  const noAt = q.startsWith('@') ? q.slice(1) : q
  const folded = noAt.normalize('NFD').replace(/\p{M}/gu, '')
  return folded.length >= 1 ? folded : null
}

function rowFromGroupSnapshot(
  snap: DocumentSnapshot,
  meta: { handleKey: string; handleDisplay: string } | undefined,
  viewer: string,
): DiscoverableHubRow | null {
  if (!snap.exists) return null
  const gd = snap.data() as Record<string, unknown>
  if (gd.deletedAt != null) return null
  const jpParsed = parseFirestoreJoinPolicy(gd.joinPolicy)
  if (!jpParsed) return null
  const ownerId = str(gd, 'ownerUserId').trim()
  const viewerOwnsHub = Boolean(viewer && ownerId === viewer)
  const handleKey = (meta?.handleKey ?? str(gd, 'handleKey')).trim()
  if (!handleKey) return null
  let handleDisplay = (meta?.handleDisplay ?? str(gd, 'handle')).trim()
  if (!handleDisplay) handleDisplay = `@${handleKey}`
  const name = str(gd, 'name').trim()
  if (!name) return null
  const gtRaw = str(gd, 'groupType').trim()
  const groupType = gtRaw && isAppGroupType(gtRaw) ? gtRaw : null
  return {
    groupId: snap.id,
    handleKey,
    handleDisplay,
    name,
    groupType,
    joinPolicy: jpParsed,
    viewerOwnsHub,
  }
}

/**
 * Prefix search on `groupHandleIndex` doc ids and `publicGroupProfiles.nameSearch` (merged by group id),
 * like {@link searchAppUsersForInvite} for users.
 * Returns every matching hub (not deleted): public, restricted, and private — use
 * {@link DiscoverableHubRow.viewerOwnsHub} and `joinPolicy` in the client for actions.
 */
export async function searchDiscoverableHubs(
  rawQuery: string,
  options?: { viewerUserId?: string | null },
): Promise<DiscoverableHubRow[]> {
  const db = adminDb
  if (!db) return []
  const trimmed = rawQuery.trim()
  if (!trimmed) return []

  const viewer = typeof options?.viewerUserId === 'string' ? options.viewerUserId.trim() : ''
  const byGroupId = new Map<string, DiscoverableHubRow>()

  const handleKey = normalizeGroupHandleKey(rawQuery)
  if (handleKey && handleKey.length >= 1) {
    const idxSnap = await db
      .collection(GROUP_HANDLE_INDEX)
      .orderBy(FieldPath.documentId())
      .startAt(handleKey)
      .endAt(`${handleKey}\uf8ff`)
      .limit(24)
      .get()

    const groupIds: string[] = []
    const metaByGroupId = new Map<string, { handleKey: string; handleDisplay: string }>()
    for (const doc of idxSnap.docs) {
      const d = doc.data() as Record<string, unknown>
      const gid = str(d, 'groupId').trim()
      if (!gid) continue
      const handleDisplay = str(d, 'handle').trim() || `@${doc.id}`
      groupIds.push(gid)
      metaByGroupId.set(gid, { handleKey: doc.id, handleDisplay })
    }

    for (let i = 0; i < groupIds.length; i += 10) {
      const slice = groupIds.slice(i, i + 10)
      const refs = slice.map((id) => db.collection(GROUPS).doc(id))
      const snaps = await db.getAll(...refs)
      for (const snap of snaps) {
        const meta = metaByGroupId.get(snap.id)
        if (!meta) continue
        const row = rowFromGroupSnapshot(snap, meta, viewer)
        if (row) byGroupId.set(snap.id, row)
      }
    }
  }

  const namePrefix = nameSearchPrefixFromQuery(rawQuery)
  if (namePrefix && namePrefix.length >= 1) {
    try {
      const nameSnap = await db
        .collection(PUBLIC_GROUP_PROFILES)
        .orderBy('nameSearch')
        .startAt(namePrefix)
        .endAt(`${namePrefix}\uf8ff`)
        .limit(24)
        .get()

      const nameGroupIds: string[] = []
      for (const doc of nameSnap.docs) {
        const pd = doc.data() as Record<string, unknown>
        if (pd.deletedAt != null) continue
        const gid = doc.id
        if (byGroupId.has(gid)) continue
        nameGroupIds.push(gid)
      }

      for (let i = 0; i < nameGroupIds.length; i += 10) {
        const slice = nameGroupIds.slice(i, i + 10)
        const refs = slice.map((id) => db.collection(GROUPS).doc(id))
        const snaps = await db.getAll(...refs)
        for (const snap of snaps) {
          if (byGroupId.has(snap.id)) continue
          const row = rowFromGroupSnapshot(snap, undefined, viewer)
          if (row) byGroupId.set(snap.id, row)
        }
      }
    } catch {
      /* nameSearch index may be missing in some projects */
    }
  }

  const rows = Array.from(byGroupId.values())
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return rows.slice(0, 40)
}

/** @deprecated Prefer {@link searchDiscoverableHubs} */
export const searchDiscoverableHubsByHandlePrefix = searchDiscoverableHubs
