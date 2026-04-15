import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { loadUserConnectionsList } from '@/lib/user-connections'

/**
 * GET /api/app/connections
 * Mutual user connections (`userConnections` where `participants` contains the signed-in uid).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult

  try {
    const connections = await loadUserConnectionsList(uid)
    return NextResponse.json({ connections })
  } catch (err) {
    console.error('[app connections GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load connections' },
      { status: 500 }
    )
  }
}
