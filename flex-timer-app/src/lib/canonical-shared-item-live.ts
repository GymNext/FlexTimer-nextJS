import { getCollectionById, getPlanById, getWorkoutById } from '@/lib/firestore'

/** True if the owner’s canonical workout / collection / plan exists and is not soft-deleted. */
export async function canonicalSharedItemLive(
  kind: 'workout' | 'collection' | 'plan',
  ownerUserId: string,
  resourceId: string
): Promise<boolean> {
  const o = ownerUserId.trim()
  const r = resourceId.trim()
  if (!o || !r) return false
  if (kind === 'workout') {
    const w = await getWorkoutById(o, r)
    return Boolean(w && !w.deletedAt)
  }
  if (kind === 'collection') {
    const c = await getCollectionById(o, r)
    return Boolean(c && !c.deletedAt)
  }
  const p = await getPlanById(o, r)
  return Boolean(p && !p.deletedAt)
}
