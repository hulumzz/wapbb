import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'

const loginInput = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
})

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const input = loginInput.parse(request.body)
    const valid = safeEqual(input.username, config.ADMIN_USERNAME)
      && safeEqual(input.password, config.ADMIN_PASSWORD)

    if (!valid) {
      return reply.code(401).send({ message: 'Username atau password salah' })
    }

    const token = app.jwt.sign(
      { role: 'admin', username: config.ADMIN_USERNAME },
      { sub: 'admin', expiresIn: '12h' },
    )

    return {
      token,
      user: { username: config.ADMIN_USERNAME },
    }
  })

  app.get('/api/auth/me', async (request) => ({ user: request.user }))
}
