import { AdminGuard, AdminHeader } from './AdminGuard'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AdminGuard>
      <AdminHeader />
      <div className="max-w-6xl mx-auto px-4 py-6">{children}</div>
    </AdminGuard>
  )
}
