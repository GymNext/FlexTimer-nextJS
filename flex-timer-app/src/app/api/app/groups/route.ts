import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { createOwnedGroup } from '@/lib/create-owned-group'
import { isAllowedChildGroupType } from '@/lib/subgroup-types'
import { isAppGroupType, parseFirestoreJoinPolicy } from '@/types/group'
import { isValidGroupLookupId, type GroupLookupKind } from '@/lib/group-lookups'

type Body = {
  groupType?: string
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
  parentGroupId?: string | null
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

/**
 * POST /api/app/groups
 * Create a hub the signed-in user owns (root or subgroup; iOS create flow parity).
 */
export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return bad('Invalid JSON')
  }

  const groupType = typeof body.groupType === 'string' ? body.groupType.trim() : ''
  if (!isAppGroupType(groupType)) {
    return bad('Invalid group type')
  }

  let parentGroupId: string | null = null
  if (body.parentGroupId != null && typeof body.parentGroupId === 'string') {
    const pid = body.parentGroupId.trim()
    if (pid) {
      const pSnap = await adminDb.collection('groups').doc(pid).get()
      if (!pSnap.exists) return bad('Parent hub not found')
      const pd = pSnap.data() as Record<string, unknown>
      if (pd.deletedAt != null) return bad('Parent hub is not available')
      const owner = pd.ownerUserId
      if (typeof owner !== 'string' || owner !== uid) return bad('You do not own the parent hub')
      const pt = pd.groupType
      if (typeof pt !== 'string' || !isAppGroupType(pt)) return bad('Parent hub has an invalid type')
      if (!isAllowedChildGroupType(pt, groupType)) {
        return bad('This hub type cannot be created under the selected parent')
      }
      parentGroupId = pid
    }
  }

  const joinPolicyParsed = parseFirestoreJoinPolicy(body.joinPolicy)
  if (!joinPolicyParsed) {
    return bad('Invalid join policy')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return bad('Name is required')

  const handle = typeof body.handle === 'string' ? body.handle : ''
  if (!parentGroupId && !handle.trim()) return bad('Handle is required')

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
      const d = new Date(body.startDate)
      if (Number.isNaN(d.getTime())) return bad('Invalid start date')
      startDate = d
    }
    if (body.endDate != null && typeof body.endDate === 'string' && body.endDate.trim()) {
      const d = new Date(body.endDate)
      if (Number.isNaN(d.getTime())) return bad('Invalid end date')
      endDate = d
    }
    if (startDate && endDate && endDate < startDate) {
      return bad('End date must be on or after start date')
    }
  }

  const membersMayShareContent =
    typeof body.membersMayShareContent === 'boolean' ? body.membersMayShareContent : false

  if (joinPolicyParsed === 'public' && membersMayShareContent) {
    return bad('Member content sharing is not allowed for public hubs')
  }

  try {
    const { groupId } = await createOwnedGroup({
      ownerUserId: uid,
      groupType,
      name,
      ...(parentGroupId ? {} : { handleInput: handle }),
      bio,
      joinPolicy: joinPolicyParsed,
      country,
      region,
      city,
      parentGroupId,
      membersMayShareContent,
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
    })
    return NextResponse.json({ groupId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create hub'
    if (msg.includes('already taken')) {
      return NextResponse.json({ error: msg }, { status: 409 })
    }
    if (msg.includes('Invalid') || msg.includes('required')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('[app groups POST]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
