import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { clearPlanDeletedAt, deletePlan, getPlanById, setPlanDeletedAt } from '@/lib/firestore'

/**
 * GET /api/admin/users/[userId]/plans/[planId]
 * Returns a single workout plan document.
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

  try {
    const plan = await getPlanById(userId, planId)
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    return NextResponse.json(plan)
  } catch (err) {
    console.error('[admin plan]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch plan' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/users/[userId]/plans/[planId]
 * Soft-deletes the plan (sets deletedAt) or recovers (clears deletedAt). Body: { recover: true } to recover.
 */
export async function PATCH(
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

  try {
    const plan = await getPlanById(userId, planId)
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    const body = await request.json().catch(() => ({}))
    if (body.recover === true) {
      if (!plan.deletedAt) {
        return NextResponse.json({ error: 'Plan is not deleted' }, { status: 400 })
      }
      await clearPlanDeletedAt(userId, planId)
      return NextResponse.json({ ok: true })
    }
    if (plan.deletedAt) {
      return NextResponse.json({ error: 'Plan is already deleted' }, { status: 400 })
    }
    await setPlanDeletedAt(userId, planId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin plan patch]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update plan' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/users/[userId]/plans/[planId]
 * Permanently deletes the plan document and all planDays. Only allowed when plan is soft-deleted (deletedAt set).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; planId: string }> }
) {
  const authResult = await requireAdminAuth(_request.headers.get('authorization'))
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

  try {
    const plan = await getPlanById(userId, planId)
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (!plan.deletedAt) {
      return NextResponse.json(
        { error: 'Plan must be soft-deleted before permanent deletion' },
        { status: 400 }
      )
    }
    await deletePlan(userId, planId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[admin plan delete]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete plan' },
      { status: 500 }
    )
  }
}
