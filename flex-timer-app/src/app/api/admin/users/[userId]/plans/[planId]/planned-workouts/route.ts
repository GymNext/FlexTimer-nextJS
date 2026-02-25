import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getPlannedWorkouts } from '@/lib/firestore'

/**
 * GET /api/admin/users/[userId]/plans/[planId]/planned-workouts?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns planned workouts for the plan in the given date range (e.g. week).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; planId: string }> }
) {
  const authResult = await requireAdminAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { userId, planId } = await params
  if (!userId || !planId) {
    return NextResponse.json({ error: 'userId and planId required' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const fromDate = searchParams.get('from')
  const toDate = searchParams.get('to')
  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: 'Query params from and to (YYYY-MM-DD) required' },
      { status: 400 }
    )
  }

  try {
    const plannedWorkouts = await getPlannedWorkouts(userId, planId, fromDate, toDate)
    return NextResponse.json({ plannedWorkouts })
  } catch (err) {
    console.error('[admin planned-workouts]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch planned workouts' },
      { status: 500 }
    )
  }
}
