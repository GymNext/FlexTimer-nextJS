import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import type { AdminUserRecord } from '@/types/user'

/**
 * GET /api/admin/users
 * Query: search (optional) - filter by userId, email, or displayName (partial match)
 * Returns list of Firebase Auth users for admin.
 */
export async function GET(request: NextRequest) {
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

  const search = request.nextUrl.searchParams.get('search')?.trim().toLowerCase() || ''

  const providerIdToLabel: Record<string, string> = {
    'google.com': 'Google',
    'apple.com': 'Apple',
    'password': 'Email',
    'phone': 'Phone',
    'anonymous': 'Anonymous',
    'facebook.com': 'Facebook',
    'github.com': 'GitHub',
    'microsoft.com': 'Microsoft',
    'twitter.com': 'Twitter',
    'yahoo.com': 'Yahoo',
  }
  const unknownProviderLabel = 'Guest'

  try {
    const listResult = await adminAuth.listUsers(1000)
    let users: AdminUserRecord[] = listResult.users.map((u) => {
      const providers =
        u.providerData?.length > 0
          ? [...new Set(u.providerData.map((p) => providerIdToLabel[p.providerId] ?? p.providerId))]
          : u.providerId ? [providerIdToLabel[u.providerId] ?? u.providerId] : [unknownProviderLabel]
      return {
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,
        emailVerified: u.emailVerified,
        disabled: u.disabled,
        providers,
        metadata: {
          creationTime: u.metadata.creationTime,
          lastSignInTime: u.metadata.lastSignInTime ?? null,
        },
      }
    })

    if (search) {
      users = users.filter((u) => {
        const uid = u.uid.toLowerCase()
        const email = (u.email ?? '').toLowerCase()
        const displayName = (u.displayName ?? '').toLowerCase()
        return uid.includes(search) || email.includes(search) || displayName.includes(search)
      })
    }

    return NextResponse.json({ users, total: users.length })
  } catch (err) {
    console.error('Admin list users error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list users' },
      { status: 500 }
    )
  }
}
