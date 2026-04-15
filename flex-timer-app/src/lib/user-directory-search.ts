import { FieldPath } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { normalizeGroupHandleKey } from '@/lib/group-handle'
import { getPublicProfileSnippet, isUserMemberOfGroup, type MemberListItem } from '@/lib/group-invite'

const USER_HANDLE_INDEX = 'userHandleIndex'

/**
 * Prefix search on `userHandleIndex` and `publicUserProfiles.fullNameSearch` (OR merge by user id).
 */
export async function searchAppUsersForInvite(
  queryRaw: string,
  options: { restrictToMemberOfGroupId: string | null },
): Promise<MemberListItem[]> {
  if (!adminDb) return []
  const q = queryRaw.trim().toLowerCase()
  const noAt = q.startsWith('@') ? q.slice(1) : q
  if (noAt.length < 1) return []

  const byId = new Map<string, Partial<MemberListItem> & { userId: string }>()

  const handlePrefix = normalizeGroupHandleKey(noAt) ?? noAt.replace(/[^a-z0-9._-]/g, '')
  if (handlePrefix.length >= 1) {
    const idxSnap = await adminDb
      .collection(USER_HANDLE_INDEX)
      .orderBy(FieldPath.documentId())
      .startAt(handlePrefix)
      .endAt(handlePrefix + '\uf8ff')
      .limit(30)
      .get()

    for (const doc of idxSnap.docs) {
      const d = doc.data() as Record<string, unknown>
      const uid = typeof d.ownerUserId === 'string' ? d.ownerUserId : ''
      if (!uid) continue
      const handle = typeof d.handle === 'string' && d.handle.trim() ? d.handle.trim() : `@${doc.id}`
      const cur = byId.get(uid) ?? { userId: uid }
      cur.handle = handle
      byId.set(uid, cur)
    }
  }

  try {
    const nameSnap = await adminDb
      .collection('publicUserProfiles')
      .orderBy('fullNameSearch')
      .startAt(noAt)
      .endAt(noAt + '\uf8ff')
      .limit(30)
      .get()

    for (const doc of nameSnap.docs) {
      const d = doc.data() as Record<string, unknown>
      const fullName = typeof d.fullName === 'string' ? d.fullName.trim() : ''
      const handle = typeof d.handle === 'string' && d.handle.trim() ? d.handle.trim() : null
      const cur = byId.get(doc.id) ?? { userId: doc.id }
      if (fullName) cur.displayName = fullName
      if (handle) cur.handle = handle
      byId.set(doc.id, cur)
    }
  } catch {
    /* fullNameSearch index may be missing in some projects */
  }

  let rows: MemberListItem[] = []
  for (const partial of byId.values()) {
    rows.push({
      userId: partial.userId,
      displayName: partial.displayName ?? '',
      handle: partial.handle ?? null,
    })
  }

  if (options.restrictToMemberOfGroupId) {
    const parentId = options.restrictToMemberOfGroupId
    const flags = await Promise.all(rows.map((r) => isUserMemberOfGroup(parentId, r.userId)))
    rows = rows.filter((_, i) => flags[i])
  }

  const enriched = await Promise.all(
    rows.map(async (r) => {
      if (r.displayName && r.handle !== undefined && r.handle !== null) return r
      const full = await getPublicProfileSnippet(r.userId)
      return {
        userId: r.userId,
        displayName: r.displayName || full.displayName,
        handle: r.handle ?? full.handle,
      }
    }),
  )

  enriched.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  )
  return enriched.slice(0, 40)
}
