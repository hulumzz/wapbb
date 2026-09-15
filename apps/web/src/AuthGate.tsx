import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, clearAuthToken, getAuthToken, setAuthToken } from './api'

type LoginResponse = {
  token: string
  user: { username: string }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(Boolean(getAuthToken()))
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handleUnauthorized = () => setAuthenticated(false)
    window.addEventListener('wapbb:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('wapbb:unauthorized', handleUnauthorized)
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
      setAuthToken(result.token)
      setAuthenticated(true)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    clearAuthToken()
    setAuthenticated(false)
  }

  if (authenticated) {
    return (
      <>
        {children}
        <button className="logout-fab" onClick={logout}>Keluar</button>
      </>
    )
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-mark">W</div>
        <p className="eyebrow">WA PBB REMINDER</p>
        <h1>Masuk ke dashboard</h1>
        <p className="login-subtitle">Kelola kontak, campaign, antrean, dan koneksi WhatsApp dari satu tempat.</p>

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
