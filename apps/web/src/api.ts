const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
export const AUTH_TOKEN_KEY = 'wapbb_admin_token'

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      clearAuthToken()
      window.dispatchEvent(new Event('wapbb:unauthorized'))
    }
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `Request gagal (${response.status})`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
