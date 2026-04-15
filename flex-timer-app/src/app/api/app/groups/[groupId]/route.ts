import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { permanentlyDeleteOwnedGroup, softDeleteOwnedGroup } from '@/lib/delete-owned-group'
import { recoverSoftDeletedOwnedGroup } from '@/lib/recover-soft-deleted-owned-group'
import { updateOwnedGroup } from '@/lib/update-owned-group'
import { membersMayShareContentFromGroupDocs } from '@/lib/group-memberships'
import { stripAtPrefix } from '@/lib/group-handle'
import { isAppGroupType, parseFirestoreJoinPolicy } from '@/types/group'
import { isValidGroupLookupId, type GroupLookupKind } from '@/lib/group-lookups'

type PatchBody = {
  name?: string
  handle?: string
  bio?: string | null
  joinPolicy?: string
  country?: string | null
  region?: string | null
  city?: string | null
  organizationTypeId?: string | null
  gymTypeId?: string | null
  trainingModeId?: string | null
  brandId?: string | null
  sportId?: string | null
  levelId?: string | null
  competitionDisciplineId?: string | null
  circleTypeId?: string | null
  startDate?: string | null
  endDate?: string | null
  membersMayShareContent?: boolean
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

function requireValidLookup(kind: GroupLookupKind, id: string | null | undefined, label: string) {
  const t = typeof id === 'string' ? id.trim() : ''
  if (!t) return null
  if (!isValidGroupLookupId(kind, t)) return `${label} is not valid`
  return null
}

function tsToYmd(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Timestamp) return v.toDate().toISOString().slice(0, 10)
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    const fn = (v as { toDate?: () => Date }).toDate
    if (typeof fn === 'function') {
      const d = fn()
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    }
  }
  return ''
}

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

/**
 * GET /api/app/groups/[groupId]
 * Full hub document for the owner (edit form).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return bad('Invalid hub id')

  const gRef = adminDb.collection('groups').doc(gid)
  const pRef = adminDb.collection('publicGroupProfiles').doc(gid)
  const [snap, pSnap] = await adminDb.getAll(gRef, pRef)
  if (!snap.exists) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
  const d = snap.data() as Record<string, unknown>
  const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}
  if (d.deletedAt != null) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
  if (d.ownerUserId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const gtRaw = typeof d.groupType === 'string' ? d.groupType.trim() : ''
  if (!isAppGroupType(gtRaw)) return bad('Invalid hub type')

  const handleStored = str(d, 'handle')
  const handleForForm = stripAtPrefix(handleStored.startsWith('@') ? handleStored : `@${handleStored}`)

  return NextResponse.json({
    groupId: snap.id,
    groupType: gtRaw,
    name: typeof d.name === 'string' ? d.name.trim() : '',
    handle: handleForForm,
    bio: typeof d.bio === 'string' ? d.bio : null,
    joinPolicy: parseFirestoreJoinPolicy(d.joinPolicy) ?? 'private',
    country: typeof d.country === 'string' && d.country.trim() ? d.country : null,
    region: typeof d.region === 'string' && d.region.trim() ? d.region : null,
    city: typeof d.city === 'string' && d.city.trim() ? d.city : null,
    organizationTypeId: str(d, 'organizationTypeId').trim() || null,
    gymTypeId: str(d, 'gymTypeId').trim() || null,
    trainingModeId: str(d, 'trainingModeId').trim() || null,
    brandId: str(d, 'brandId').trim() || null,
    sportId: str(d, 'sportId').trim() || null,
    levelId: str(d, 'levelId').trim() || null,
    competitionDisciplineId: str(d, 'competitionDisciplineId').trim() || null,
    circleTypeId: str(d, 'circleTypeId').trim() || null,
    startDate: tsToYmd(d.startDate),
    endDate: tsToYmd(d.endDate),
    parentGroupId:
      typeof d.parentGroupId === 'string' && d.parentGroupId.trim() ? d.parentGroupId.trim() : null,
    membersMayShareContent: membersMayShareContentFromGroupDocs(d, pd),
  })
}

/**
 * PATCH /api/app/groups/[groupId]
 * - Recover soft-deleted hub: body `{ recover: true }` (owner only). Restores handle index when possible.
 * - Otherwise: update hub fields (owner only). Hub type and parent cannot be changed here.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return bad('Invalid hub id')

  const gSnap = await adminDb.collection('groups').doc(gid).get()
  if (!gSnap.exists) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.ownerUserId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: PatchBody & { recover?: boolean }
  try {
    body = (await request.json()) as PatchBody & { recover?: boolean }
  } catch {
    return bad('Invalid JSON')
  }

  if (body.recover === true) {
    if (gd.deletedAt == null) {
      return NextResponse.json({ error: 'Hub is not deleted' }, { status: 400 })
    }
    try {
      await recoverSoftDeletedOwnedGroup(uid, gid)
      return NextResponse.json({ ok: true, groupId: gid })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to restore hub'
      if (msg.includes('not own') || msg.includes('not found')) {
        return NextResponse.json({ error: msg }, { status: 403 })
      }
      if (msg.includes('Parent hub') || msg.includes('parent hub')) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      if (msg.includes('handle') || msg.includes('Handle')) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      console.error('[app groups PATCH recover]', err)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  if (gd.deletedAt != null) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })

  const groupTypeRaw = typeof gd.groupType === 'string' ? gd.groupType.trim() : ''
  if (!isAppGroupType(groupTypeRaw)) return bad('Invalid hub type')
  const groupType = groupTypeRaw

  const joinPolicyParsed = parseFirestoreJoinPolicy(body.joinPolicy)
  if (!joinPolicyParsed) {
    return bad('Invalid join policy')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return bad('Name is required')

  const handleInBody = Object.prototype.hasOwnProperty.call(body, 'handle')
  let handleForUpdate: string | undefined
  if (handleInBody) {
    const parentOnDoc =
      typeof gd.parentGroupId === 'string' && gd.parentGroupId.trim() !== ''
    if (parentOnDoc) return bad('Sub hubs do not use public handles')
    const h = typeof body.handle === 'string' ? body.handle.trim() : ''
    if (!h) return bad('Handle is required')
    handleForUpdate = h
  }

  const bio = body.bio != null && typeof body.bio === 'string' ? body.bio : null
  const country = body.country != null && typeof body.country === 'string' ? body.country : null
  const region = body.region != null && typeof body.region === 'string' ? body.region : null
  const city = body.city != null && typeof body.city === 'string' ? body.city : null

  const organizationTypeId =
    body.organizationTypeId != null && typeof body.organizationTypeId === 'string'
      ? body.organizationTypeId
      : null
  const gymTypeId = body.gymTypeId != null && typeof body.gymTypeId === 'string' ? body.gymTypeId : null
  const trainingModeId =
    body.trainingModeId != null && typeof body.trainingModeId === 'string' ? body.trainingModeId : null
  const brandId = body.brandId != null && typeof body.brandId === 'string' ? body.brandId : null
  const sportId = body.sportId != null && typeof body.sportId === 'string' ? body.sportId : null
  const levelId = body.levelId != null && typeof body.levelId === 'string' ? body.levelId : null
  const competitionDisciplineId =
    body.competitionDisciplineId != null && typeof body.competitionDisciplineId === 'string'
      ? body.competitionDisciplineId
      : null
  const circleTypeId =
    body.circleTypeId != null && typeof body.circleTypeId === 'string' ? body.circleTypeId : null

  if (groupType === 'organization') {
    const e = requireValidLookup('organizationType', organizationTypeId, 'Organization type')
    if (e) return bad(e)
  }
  if (groupType === 'gym') {
    const e = requireValidLookup('gymType', gymTypeId, 'Gym type')
    if (e) return bad(e)
    const e2 = requireValidLookup('trainingMode', trainingModeId, 'Training mode')
    if (e2) return bad(e2)
    const e3 = requireValidLookup('gymBrand', brandId, 'Brand')
    if (e3) return bad(e3)
  }
  if (groupType === 'class') {
    const e = requireValidLookup('trainingMode', trainingModeId, 'Training mode')
    if (e) return bad(e)
  }
  if (groupType === 'team') {
    const e = requireValidLookup('sport', sportId, 'Sport')
    if (e) return bad(e)
    const e2 = requireValidLookup('level', levelId, 'Level')
    if (e2) return bad(e2)
  }
  if (groupType === 'series' || groupType === 'event') {
    const e = requireValidLookup('competitionDiscipline', competitionDisciplineId, 'Competition discipline')
    if (e) return bad(e)
  }
  if (groupType === 'circle') {
    const e = requireValidLookup('circleType', circleTypeId, 'Circle type')
    if (e) return bad(e)
  }

  let startDate: Date | null = null
  let endDate: Date | null = null
  if (groupType === 'series' || groupType === 'event') {
    if (body.startDate != null && typeof body.startDate === 'string' && body.startDate.trim()) {
      const dt = new Date(body.startDate)
      if (Number.isNaN(dt.getTime())) return bad('Invalid start date')
      startDate = dt
    }
    if (body.endDate != null && typeof body.endDate === 'string' && body.endDate.trim()) {
      const dt = new Date(body.endDate)
      if (Number.isNaN(dt.getTime())) return bad('Invalid end date')
      endDate = dt
    }
    if (startDate && endDate && endDate < startDate) {
      return bad('End date must be on or after start date')
    }
  }

  const membersMayShareContent =
    typeof body.membersMayShareContent === 'boolean' ? body.membersMayShareContent : undefined

  if (
    joinPolicyParsed === 'public' &&
    typeof body.membersMayShareContent === 'boolean' &&
    body.membersMayShareContent === true
  ) {
    return bad('Member content sharing is not allowed for public hubs')
  }

  try {
    await updateOwnedGroup({
      ownerUserId: uid,
      groupId: gid,
      name,
      ...(handleForUpdate !== undefined ? { handleInput: handleForUpdate } : {}),
      bio,
      joinPolicy: joinPolicyParsed,
      country,
      region,
      city,
      organizationTypeId,
      gymTypeId,
      trainingModeId,
      brandId,
      sportId,
      levelId,
      competitionDisciplineId,
      circleTypeId,
      startDate,
      endDate,
      ...(membersMayShareContent !== undefined ? { membersMayShareContent } : {}),
    })
    return NextResponse.json({ ok: true, groupId: gid })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update hub'
    if (msg.includes('already taken')) {
      return NextResponse.json({ error: msg }, { status: 409 })
    }
    if (
      msg.includes('Invalid') ||
      msg.includes('required') ||
      msg.includes('not found') ||
      msg.includes('Sub hubs')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('[app groups PATCH]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * DELETE /api/app/groups/[groupId]
 * - Default: soft-delete hub (owner only). Fails if active sub hubs still exist.
 * - `?permanent=true` or `?permanent=1`: hard-delete a hub that is already soft-deleted (`deletedAt` set).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return bad('Invalid hub id')

  const permanentRaw = request.nextUrl.searchParams.get('permanent')
  const permanent = permanentRaw === '1' || permanentRaw?.toLowerCase() === 'true'

  try {
    if (permanent) {
      await permanentlyDeleteOwnedGroup(uid, gid)
      return new NextResponse(null, { status: 204 })
    }
    await softDeleteOwnedGroup(uid, gid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete hub'
    if (msg.includes('not own') || msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    if (msg.includes('must be in deleted state')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    if (msg.includes('sub hubs') || msg.includes('sub hub')) {
      return NextResponse.json({ error: msg }, { status: 409 })
    }
    console.error('[app groups DELETE]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
