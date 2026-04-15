import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { FieldPath } from 'firebase-admin/firestore'

type HandleSearchResult = {
  handleKey: string
  ownerUserId: string
  planId: string
  privacy: number | null
  workoutPlanName: string | null
}

export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const queryRaw = (request.nextUrl.searchParams.get('query') ?? '').trim().toLowerCase()
  const query = queryRaw.startsWith('@') ? queryRaw.slice(1) : queryRaw
  if (!query || query.length < 1) {
    return NextResponse.json({ items: [] satisfies HandleSearchResult[] })
  }

  try {
    const indexRef = adminDb.collection('workoutPlanHandleIndex')
    const snap = await indexRef
      .orderBy(FieldPath.documentId())
      .startAt(query)
      .endAt(query + '\uf8ff')
      .limit(20)
      .get()

    const items: HandleSearchResult[] = []
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>
      const ownerUserId = typeof d.ownerUserId === 'string' ? d.ownerUserId : ''
      const planId = typeof d.planId === 'string' ? d.planId : ''
      const privacy = typeof d.privacy === 'number' ? d.privacy : null
      const planDeleted = d.planDeleted === true
      if (!ownerUserId || !planId || planDeleted) continue
      // Only return protected/public (shareable).
      if (privacy !== 2 && privacy !== 3) continue
      items.push({
        handleKey: doc.id,
        ownerUserId,
        planId,
        privacy,
        workoutPlanName: typeof d.workoutPlanName === 'string' ? d.workoutPlanName : null,
      })
    }
    return NextResponse.json({ items })
  } catch (err) {
    console.error('[app plans handle-search GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to search plans' },
      { status: 500 }
    )
  }
}

