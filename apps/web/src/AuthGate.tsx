import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, clearAuthToken, getAuthToken, setAuthToken } from './api'

type LoginResponse = {
  token: string
  user: { username: string }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(Boolean(getAuthToken()))
  const [checking, setChecking] = useState(Boolean(getAuthToken()))
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handleUnauthorized = () => setAuthenticated(false)
    const handleLogout = () => {
      clearAuthToken()
      setAuthenticated(false)
    }
    window.addEventListener('wapbb:unauthorized', handleUnauthorized)
    window.addEventListener('wapbb:logout', handleLogout)
    if (getAuthToken()) {
      api('/api/auth/me').then(() => setAuthenticated(true)).catch(() => setAuthenticated(false)).finally(() => setChecking(false))
    }
    return () => {
      window.removeEventListener('wapbb:unauthorized', handleUnauthorized)
      window.removeEventListener('wapbb:logout', handleLogout)
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setAuthToken(result.token, result.user.username)
      setAuthenticated(true)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  if (checking) return <main className="login-page"><div className="login-loading">Menyiapkan panel...</div></main>
  if (authenticated) return children

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-mark">W</div>
        <p className="eyebrow">PANEL OPERASIONAL</p>
        <h1>Masuk ke WAPBB</h1>
        <p className="login-subtitle">Kelola penerima, campaign, antrean, dan koneksi WhatsApp secara terpusat.</p>

        <form onSubmit={submit}>
          <label>
            Username
            <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button className="primary login-button" disabled={loading}>
            {loading ? 'Memeriksa…' : 'Masuk'}
          </button>
        </form>
      </section>
    </main>
  )
}
