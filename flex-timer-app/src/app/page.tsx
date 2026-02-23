import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">FlexTimer</h1>
        <p className="text-gray-600">
          Welcome. The main app for regular users will live here later.
        </p>
        <Link
          href="/admin"
          className="inline-block text-blue-600 hover:text-blue-800 font-medium"
        >
          Go to Admin →
        </Link>
      </div>
    </main>
  )
}
