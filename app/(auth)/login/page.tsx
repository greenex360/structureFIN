'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6F1] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 border border-[#D7DCD1]">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#2E6F5C] text-white flex items-center justify-center text-xl font-bold mx-auto mb-3">S</div>
          <h1 className="text-2xl font-bold text-[#1C2320]">StructureFIN</h1>
          <p className="text-[#5B665D] text-sm mt-1">Finance Operations Suite</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1C2320] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              className="w-full border border-[#D7DCD1] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6F5C]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1C2320] mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full border border-[#D7DCD1] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6F5C]"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#2E6F5C] hover:bg-[#255A4A] text-white rounded-xl py-3 font-medium text-sm transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-[#8A9389] mt-6">
          Same account as StructurePay — one login, both tools.
        </p>
      </div>
    </div>
  )
}
