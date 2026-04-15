import { normalizeBioDisplayText } from '@/lib/format-bio-display'
import { adminDb } from '@/lib/firebase-admin'
import type { PublicUserProfileHubRow, PublicUserProfileView } from '@/types/public-profile'
import {
  HUB_LOOKUP_ROWS,
  resolveHubLookupLabels,
  userHubLookupIdsFromFirestore,
} from '@/types/hub-profile'

export type { PublicUserProfileView } from '@/types/public-profile'

/**
 * Read `publicUserProfiles/{userId}` for display in user search / profile preview (no private fields).
 */
export async function loadPublicUserProfileView(targetUserId: string): Promise<PublicUserProfileView> {
  const uid = targetUserId.trim()
  if (!adminDb || !uid) {
    return {
      userId: uid,
      displayName: 'Member',
      handle: null,
      bio: null,
      profilePhotoUrl: null,
      city: null,
      region: null,
      country: null,
      hubLookups: [],
    }
  }

  const snap = await adminDb.collection('publicUserProfiles').doc(uid).get()
  if (!snap.exists) {
    return {
      userId: uid,
      displayName: uid.slice(0, 8) + '…',
      handle: null,
      bio: null,
      profilePhotoUrl: null,
      city: null,
      region: null,
      country: null,
      hubLookups: [],
    }
  }

  const d = snap.data() as Record<string, unknown>
  const fullName = typeof d.fullName === 'string' ? d.fullName.trim() : ''
  const first = typeof d.firstName === 'string' ? d.firstName.trim() : ''
  const last = typeof d.lastName === 'string' ? d.lastName.trim() : ''
  const displayName =
    fullName || [first, last].filter(Boolean).join(' ').trim() || uid.slice(0, 8) + '…'

  let handle: string | null = null
  const h = typeof d.handle === 'string' ? d.handle.trim() : ''
  if (h) handle = h.startsWith('@') ? h : `@${h}`

  const bioRaw = typeof d.bio === 'string' && d.bio.trim() ? d.bio.trim() : null
  const bio = bioRaw ? normalizeBioDisplayText(bioRaw) : null
  const profilePhotoUrl =
    typeof d.profilePhotoUrl === 'string' && d.profilePhotoUrl.trim() ? d.profilePhotoUrl.trim() : null
  const city = typeof d.city === 'string' && d.city.trim() ? d.city.trim() : null
  const region = typeof d.region === 'string' && d.region.trim() ? d.region.trim() : null
  const country = typeof d.country === 'string' && d.country.trim() ? d.country.trim() : null

  const ids = userHubLookupIdsFromFirestore(d)
  const resolved = resolveHubLookupLabels(ids)
  const hubLookups: PublicUserProfileHubRow[] = []
  for (const row of HUB_LOOKUP_ROWS) {
    const v = resolved[row.key]
    if (v && v.trim()) hubLookups.push({ label: row.label, value: v.trim() })
  }

  return {
    userId: uid,
    displayName,
    handle,
    bio,
    profilePhotoUrl,
    city,
    region,
    country,
    hubLookups,
  }
}
