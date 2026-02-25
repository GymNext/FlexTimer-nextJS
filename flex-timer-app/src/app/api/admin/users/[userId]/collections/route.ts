import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { createWorkoutCollection } from '@/lib/firestore'

/**
 * POST /api/admin/users/[userId]/collections
 * Creates a new workout collection for the user. Body: { name: string, description?: string }
 */
export async function POST(
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
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  let body: { name?: string; description?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name : ''
  if (!name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description : null

  try {
    const collection = await createWorkoutCollection(userId, { name: name.trim(), description })
    return NextResponse.json(collection, { status: 201 })
  } catch (err) {
    console.error('[admin create collection]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create collection' },
      { status: 500 }
    )
  }
}
