import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getWorkoutsByIds } from '@/lib/firestore'

/**
 * GET /api/admin/users/[userId]/workouts?ids=id1,id2,...
 * Returns workout documents for the given workout IDs (from users/<userId>/workouts).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
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

  const { userId } = await params
  const idsParam = request.nextUrl.searchParams.get('ids')
  if (!userId || !idsParam) {
    return NextResponse.json(
      { error: 'userId and ids query parameter required' },
      { status: 400 }
    )
  }

  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  try {
    const workouts = await getWorkoutsByIds(userId, ids)
    return NextResponse.json({ workouts })
  } catch (err) {
    console.error('[admin workouts]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch workouts' },
      { status: 500 }
    )
  }
}
