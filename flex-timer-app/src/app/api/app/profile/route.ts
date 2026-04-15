import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { isValidGroupLookupId } from '@/lib/group-lookups'
import {
  getUserDocument,
  updateUserProfileFields,
  updateUserPublicHandle,
} from '@/lib/firestore'
import {
  EMPTY_USER_HUB_LOOKUP_IDS,
  HUB_LOOKUP_ROWS,
  resolveHubLookupLabels,
  type UserHubLookupIds,
} from '@/types/hub-profile'

type ProfilePatchBody = {
  handle?: string | null
  bio?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
} & Partial<UserHubLookupIds>

/**
 * PATCH /api/app/profile
 * Updates editable user profile fields on users/<uid>.
 */
export async function PATCH(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  let body: ProfilePatchBody
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const hubPatch: Partial<UserHubLookupIds> = {}
  for (const row of HUB_LOOKUP_ROWS) {
    if (!(row.key in body)) continue
    const raw = body[row.key]
    const id = raw == null || raw === '' ? null : String(raw).trim()
    if (!isValidGroupLookupId(row.kind, id)) {
      return NextResponse.json(
        { error: `Invalid value for ${row.key}` },
        { status: 400 }
      )
    }
    hubPatch[row.key] = id
  }

  const hasHandle = 'handle' in body
  const hasBio = 'bio' in body
  const hasFirstName = 'firstName' in body
  const hasLastName = 'lastName' in body
  const hasCity = 'city' in body
  const hasRegion = 'region' in body
  const hasCountry = 'country' in body
  const hasHub = Object.keys(hubPatch).length > 0
  if (
    !hasHandle &&
    !hasBio &&
    !hasFirstName &&
    !hasLastName &&
    !hasCity &&
    !hasRegion &&
    !hasCountry &&
    !hasHub
  ) {
    return NextResponse.json(
      { error: 'No updatable profile fields provided' },
      { status: 400 }
    )
  }

  try {
    const { uid } = authResult
    if (hasHandle) {
      await updateUserPublicHandle(uid, body.handle ?? null)
    }
    const profileUpdates: {
      bio?: string | null
      firstName?: string | null
      lastName?: string | null
      city?: string | null
      region?: string | null
      country?: string | null
    } & Partial<UserHubLookupIds> = {}
    if (hasBio) profileUpdates.bio = body.bio
    if (hasFirstName) profileUpdates.firstName = body.firstName
    if (hasLastName) profileUpdates.lastName = body.lastName
    if (hasCity) profileUpdates.city = body.city != null && typeof body.city === 'string' ? body.city : null
    if (hasRegion)
      profileUpdates.region = body.region != null && typeof body.region === 'string' ? body.region : null
    if (hasCountry)
      profileUpdates.country =
        body.country != null && typeof body.country === 'string' ? body.country : null
    Object.assign(profileUpdates, hubPatch)
    if (hasBio || hasFirstName || hasLastName || hasCity || hasRegion || hasCountry || hasHub) {
      await updateUserProfileFields(uid, profileUpdates)
    }
    const userDoc = await getUserDocument(uid)
    const hubLookupIds = userDoc?.hubLookupIds ?? EMPTY_USER_HUB_LOOKUP_IDS
    return NextResponse.json({
      handle: userDoc?.handle ?? null,
      handleKey: userDoc?.handleKey ?? null,
      bio: userDoc?.bio ?? null,
      firstName: userDoc?.firstName ?? null,
      lastName: userDoc?.lastName ?? null,
      profilePhotoUrl: userDoc?.profilePhotoUrl ?? null,
      city: userDoc?.city ?? null,
      region: userDoc?.region ?? null,
      country: userDoc?.country ?? null,
      hubLookupIds,
      hubLookupLabels: resolveHubLookupLabels(hubLookupIds),
    })
  } catch (err) {
    console.error('[app profile PATCH]', err)
    const message = err instanceof Error ? err.message : 'Failed to update profile'
    const status =
      message === 'That handle is already taken'
        ? 409
        : message.startsWith('Handle must be')
          ? 400
          : 500
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}
