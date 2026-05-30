/*
 * Synapse — The intelligence layer for AI workflows
 * Copyright (c) 2026 Daniel De Vecchi
 *
 * Licensed under AGPL-3.0-or-later.
 * See LICENSE for details.
 *
 * Commercial license: daniel@pixarts.eu
 */

/**
 * MCP HTTP Server — Dual mode entry point
 *
 * Serves both:
 * - MCP protocol via Streamable HTTP (POST/GET/DELETE /mcp)
 * - Dashboard web UI and API (GET /, /api/health, /api/data)
 *
 * Usage: node cli.js mcp --http [--port 3737] [--auth-token secret]
 */

import express, { type Request } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import { startDecayScheduler } from '@skillbrain/storage'
import { createMcpServer } from './server.js'
import { createOAuthRouter, verifyOAuthBearer } from './oauth-router.js'
import { loadRegistry, upsertRegistry } from '@skillbrain/storage'
import { openDb, closeDb } from '@skillbrain/storage'
import { MemoryStore, SkillsStore } from '@skillbrain/storage'
import { assertEncryptionUsable, decrypt } from '@skillbrain/storage'
import { dashboardUrl } from '../constants.js'
import type { RouteContext } from './routes/index.js'
import { createMemoriesRouter } from './routes/memories.js'
import { createSessionsRouter } from './routes/sessions.js'
import { createProjectsRouter } from './routes/projects.js'
import { createSkillsRouter } from './routes/skills.js'
import { createAdminRouter } from './routes/admin.js'
import { createReviewRouter } from './routes/review.js'
import { createUserProfileRouter } from './routes/user-profile.js'
import { createWhiteboardsRouter } from './routes/whiteboards.js'
import { createStudioRouter } from './routes/studio.js'
import { createStudioExportRouter } from './routes/studio-export.js'
import { createStudioConnectorsRouter } from './routes/studio-connectors.js'
import { createStudioDsRouter } from './routes/studio-ds.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let _handlersRegistered = false

const SKILLBRAIN_ROOT = process.env.SKILLBRAIN_ROOT || process.cwd()
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || ''
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || ''
const PUBLIC_ISSUER  = process.env.OAUTH_ISSUER || process.env.PUBLIC_URL || dashboardUrl()
const SMTP_HOST    = process.env.SMTP_HOST || ''
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '587', 10)
const SMTP_USER    = process.env.SMTP_USER || ''
const SMTP_PASS    = process.env.SMTP_PASS || ''
const SMTP_FROM    = process.env.SMTP_FROM || 'Synapse <noreply@dvesolutions.eu>'
const SMTP_SECURE  = process.env.SMTP_SECURE === 'true'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const LEGACY_TOKEN_USER_EMAIL = process.env.LEGACY_TOKEN_USER_EMAIL || ''

// ── Password helpers ──
const scryptAsync = promisify(crypto.scrypt)

async function hashPassword(plain: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = (await scryptAsync(plain, salt, 64) as Buffer).toString('hex')
  return { hash, salt }
}

async function verifyPassword(plain: string, hash: string, salt: string): Promise<boolean> {
  try {
    const derived = (await scryptAsync(plain, salt, 64) as Buffer)
    const stored = Buffer.from(hash, 'hex')
    return derived.length === stored.length && crypto.timingSafeEqual(derived, stored)
  } catch { return false }
}

function generatePassword(len = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(crypto.randomBytes(len)).map(b => chars[b % chars.length]).join('')
}

async function sendInviteEmail(to: string, name: string, password: string, apiKey: string): Promise<void> {
  if (!SMTP_HOST || !to) return
  const t = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } })
  await t.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Accesso a Synapse',
    text: [
      `Ciao ${name},`,
      '',
      'Sei stato aggiunto al team Synapse.',
      '',
      `Dashboard: ${dashboardUrl()}/`,
      `Email:     ${to}`,
      `Password:  ${password}`,
      '',
      'API key per Claude Code:',
      `  SKILLBRAIN_MCP_URL=${dashboardUrl()}/mcp`,
      `  CODEGRAPH_AUTH_TOKEN=${apiKey}`,
      '',
      'Cambia la password dopo il primo accesso dal menu in alto a destra.',
      'Conserva questa email in un posto sicuro.',
    ].join('\n'),
  })
}

function loadRegistrySafe() {
  try {
    return loadRegistry()
  } catch {
    return []
  }
}

// ── Dashboard data functions (imported from dashboard logic) ──

function getMemoryGraphStats() {
  try {
    const db = openDb(SKILLBRAIN_ROOT)
    const store = new MemoryStore(db)
    const stats = store.stats()
    const topMemories = store.query({ status: 'active', limit: 20 })
    const contradictions = store.getContradictions()
    const recentSessions = store.recentSessions(5)
    closeDb(db)
    return {
      ...stats,
      topMemories: topMemories.map((m) => ({
        id: m.id, type: m.type, confidence: m.confidence,
        context: m.context.slice(0, 120), tags: m.tags, skill: m.skill,
      })),
      contradictions,
      recentSessions: recentSessions.map((s) => ({
        id: s.id, session: s.sessionName, started: s.startedAt,
        summary: s.summary, memories: s.memoriesCreated,
      })),
    }
  } catch {
    return { total: 0, byType: {}, byStatus: {}, edges: 0, topMemories: [], contradictions: [], recentSessions: [] }
  }
}

// ── Attention counts (server-side, used by /api/health) ──

export function computeAttentionCounts(db: import('better-sqlite3').Database): {
  decayCount: number
  staleCount: number
  pendingReviews: number
} {
  const staleCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const decayCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM memories WHERE status = 'active' AND confidence IS NOT NULL AND confidence < 4`
  ).get() as { n: number }).n

  const staleCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM memories WHERE status = 'active' AND COALESCE(updated_at, created_at) < ?`
  ).get(staleCutoff) as { n: number }).n

  const memoriesPending = (db.prepare(
    `SELECT COUNT(*) AS n FROM memories WHERE status = 'pending-review'`
  ).get() as { n: number }).n

  const skillsPending = (db.prepare(
    `SELECT COUNT(*) AS n FROM skills WHERE status = 'pending'`
  ).get() as { n: number }).n

  const componentsPending = (db.prepare(
    `SELECT COUNT(*) AS n FROM ui_components WHERE status = 'pending'`
  ).get() as { n: number }).n

  let proposalsPending = 0
  try {
    proposalsPending = (db.prepare(
      `SELECT COUNT(*) AS n FROM skill_proposals WHERE status = 'pending'`
    ).get() as { n: number }).n
  } catch { /* table not yet migrated */ }

  let dsScansPending = 0
  try {
    dsScansPending = (db.prepare(
      `SELECT COUNT(*) AS n FROM design_system_scans WHERE status = 'pending'`
    ).get() as { n: number }).n
  } catch { /* table not yet migrated */ }

  const pendingReviews = memoriesPending + skillsPending + componentsPending + proposalsPending + dsScansPending

  return { decayCount, staleCount, pendingReviews }
}

// ── HTTP Server ──

export async function startHttpServer(port: number, authToken?: string): Promise<void> {
  const app = express()
  // Whiteboards can include base64-embedded images in state_json; allow up to 10MB.
  // The /api/codegraph/upload endpoint manages its own (much larger) limit.
  app.use((req, res, next) => {
    if (req.path === '/api/codegraph/upload') return next()
    if (req.path.startsWith('/api/whiteboards')) return express.json({ limit: '10mb' })(req, res, next)
    express.json()(req, res, next)
  })

  // Session map for MCP transports
  const transports = new Map<string, StreamableHTTPServerTransport>()
  // SSE transport sessions (legacy MCP transport, e.g. for ChatGPT)
  const sseTransports = new Map<string, SSEServerTransport>()

  // ── Auth middleware for /mcp + /sse routes (Bearer token) ──
  // On success, sets (req as any).mcpUserId when the token is bound to a user
  // (personal API key, OAuth bearer, or legacy token with LEGACY_TOKEN_USER_EMAIL set).
  const bearerAuth: express.RequestHandler = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      res.setHeader('WWW-Authenticate',
        `Bearer realm="mcp", resource_metadata="${PUBLIC_ISSUER}/.well-known/oauth-protected-resource"`)
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    // 1. Legacy env-var token (backward compat)
    // If LEGACY_TOKEN_USER_EMAIL is set, resolve it to a real userId so user-scoped
    // tools (user_env_*) work without requiring a personal API key.
    if (authToken && token === authToken) {
      if (LEGACY_TOKEN_USER_EMAIL) {
        try {
          const db = openDb(SKILLBRAIN_ROOT)
          let user = db.prepare(`SELECT id FROM users WHERE email = ?`).get(LEGACY_TOKEN_USER_EMAIL) as { id: string } | undefined
          if (!user) {
            // Auto-bootstrap: create the owner user on first use
            const newId = randomUUID().replace(/-/g, '').slice(0, 12)
            db.prepare(`INSERT INTO users (id, name, email, role) VALUES (?, 'Admin', ?, 'admin')`)
              .run(newId, LEGACY_TOKEN_USER_EMAIL)
            user = { id: newId }
            console.log(`[auth] Auto-created owner user for ${LEGACY_TOKEN_USER_EMAIL} (id=${newId})`)
          }
          closeDb(db)
          ;(req as any).mcpUserId = user.id
        } catch { /* users table not yet migrated — proceed without userId */ }
      }
      next(); return
    }
    // 2. Personal API keys table
    try {
      const db = openDb(SKILLBRAIN_ROOT)
      const hash = crypto.createHash('sha256').update(token).digest('hex')
      const key = db.prepare(
        `SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`
      ).get(hash) as { id: string; user_id: string } | undefined
      if (key) {
        db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), key.id)
        closeDb(db)
        ;(req as any).mcpUserId = key.user_id
        next(); return
      }
      closeDb(db)
    } catch { /* api_keys table not yet migrated */ }
    // 3. OAuth access token
    const oauth = verifyOAuthBearer(SKILLBRAIN_ROOT, token)
    if (oauth) {
      ;(req as any).oauthUserId = oauth.userId
      ;(req as any).oauthClientId = oauth.clientId
      ;(req as any).mcpUserId = oauth.userId
      next(); return
    }
    res.setHeader('WWW-Authenticate',
      `Bearer realm="mcp", resource_metadata="${PUBLIC_ISSUER}/.well-known/oauth-protected-resource"`)
    res.status(401).json({ error: 'Unauthorized' })
  }

  // Skip bearer auth entirely when running without a token (local dev only).
  // Production deploys set CODEGRAPH_AUTH_TOKEN which enables auth on /mcp + /sse.
  const mcpAuthMiddleware: express.RequestHandler = authToken
    ? bearerAuth
    : (_req, _res, next) => next()

  app.use('/mcp', mcpAuthMiddleware)
  app.use('/sse', mcpAuthMiddleware)

  // ── Dashboard auth (per-user email+password) ──
  function createSessionToken(userId: string): string {
    const payload = `${userId}:${Date.now()}`
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
    return Buffer.from(`${payload}:${sig}`).toString('base64url')
  }

  function parseSessionToken(token: string): string | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString()
      const lastColon = decoded.lastIndexOf(':')
      if (lastColon < 0) return null
      const sig = decoded.slice(lastColon + 1)
      const payload = decoded.slice(0, lastColon)
      const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
      if (sig.length !== expected.length) return null
      if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null
      return payload.split(':')[0] // userId
    } catch { return null }
  }

  function getUserIdFromSession(token: string | undefined): string | null {
    if (!token) return null
    // Backward compat: old 64-char hex tokens valid only when ADMIN_EMAIL not configured
    if (/^[a-f0-9]{64}$/.test(token) && !ADMIN_EMAIL) return 'legacy-admin'
    return parseSessionToken(token)
  }

  function getUserIdFromRequest(req: Request): string | null {
    const cookieToken = req.headers.cookie?.split(';')
      .map(c => c.trim().split('='))
      .find(([k]) => k === 'sb_session')?.[1]
    const headerToken = req.headers['x-dashboard-token'] as string | undefined
    return getUserIdFromSession(cookieToken) ?? getUserIdFromSession(headerToken)
  }

  // Admin bootstrap: create admin user if users table is empty and credentials are available
  {
    const db = openDb(SKILLBRAIN_ROOT)
    try {
      const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n
      if (count === 0) {
        if (ADMIN_EMAIL && DASHBOARD_PASSWORD) {
          const { hash, salt } = await hashPassword(DASHBOARD_PASSWORD)
          const adminId = randomUUID().replace(/-/g, '').slice(0, 12)
          db.prepare(`INSERT INTO users (id, name, email, role, password_hash, password_salt) VALUES (?, 'Admin', ?, 'admin', ?, ?)`)
            .run(adminId, ADMIN_EMAIL, hash, salt)
          console.log(`[auth] Bootstrap: admin user created for ${ADMIN_EMAIL}`)
          console.warn(`[auth] DEPRECATED: DASHBOARD_PASSWORD was used for bootstrap. Remove it from env once you have logged in and changed your password.`)
        } else {
          console.warn(`[auth] WARNING: users table is empty. Set ADMIN_EMAIL + DASHBOARD_PASSWORD for first-run bootstrap, or create a user via POST /api/admin/team/users.`)
        }
      } else if (DASHBOARD_PASSWORD) {
        console.warn(`[auth] DEPRECATED: DASHBOARD_PASSWORD env var is set but no longer used for login. Remove it from your Coolify env vars.`)
      }
    } catch { /* users table might not exist yet */ }
    closeDb(db)
  }

  // Login endpoint — per-user email+password only
  app.post('/auth/login', express.json(), async (req, res) => {
    const { email, password } = req.body || {}
    if (!email || !password) { res.status(400).json({ ok: false, error: 'email and password required' }); return }
    const db = openDb(SKILLBRAIN_ROOT)
    const user = db.prepare('SELECT id, password_hash, password_salt FROM users WHERE email = ?').get(email) as any
    closeDb(db)
    if (!user?.password_hash || !await verifyPassword(password, user.password_hash, user.password_salt)) {
      res.status(401).json({ ok: false, error: 'Wrong email or password' }); return
    }
    const token = createSessionToken(user.id)
    res.json({ ok: true, token })
  })

  // Change password endpoint (authenticated)
  app.put('/api/auth/password', express.json(), async (req, res) => {
    const userId = (req as any).userId
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }
    const { current, newPassword } = req.body || {}
    if (!current || !newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'current and newPassword (min 8 chars) required' }); return
    }
    const db = openDb(SKILLBRAIN_ROOT)
    const user = db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(userId) as any
    if (!user || !await verifyPassword(current, user.password_hash, user.password_salt)) {
      closeDb(db); res.status(401).json({ error: 'Current password wrong' }); return
    }
    const { hash, salt } = await hashPassword(newPassword)
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, userId)
    closeDb(db)
    res.json({ ok: true })
  })

  // Auth check for dashboard routes (not /mcp, not /sse, not /auth, not /oauth, not /.well-known)
  const authEnabled = !!ADMIN_EMAIL
  if (!authEnabled) {
    console.warn('[SECURITY] ADMIN_EMAIL not set — all API routes are UNAUTHENTICATED. Do not expose to the internet.')
  }
  const isPublicPath = (p: string) =>
    p.startsWith('/mcp') ||
    p.startsWith('/sse') ||
    p.startsWith('/auth/') ||
    p === '/oauth/register' ||
    p === '/oauth/token' ||
    p === '/oauth/revoke' ||
    p.startsWith('/.well-known/') ||
    p.startsWith('/telemetry/') ||
    p.startsWith('/api/whiteboards/shared/') ||
    p === '/api/studio/form-submit' ||
    // Static assets required to render the whiteboard share page (no auth needed)
    p.startsWith('/whiteboard/') ||
    p.startsWith('/vendor/')

  if (authEnabled) {
    app.use((req, res, next) => {
      if (isPublicPath(req.path)) { next(); return }
      // Allow public access to whiteboard.html when a ?share=TOKEN is present;
      // the page itself fetches read-only via /api/whiteboards/shared/:token.
      if (req.path === '/whiteboard.html' && (req.query as any)?.share) { next(); return }

      const userId = getUserIdFromRequest(req)
      if (userId) {
        ;(req as any).userId = userId
        next()
      } else if (req.path.startsWith('/api/')) {
        // Allow Bearer token auth for programmatic API access (e.g. proxy upload)
        const token = req.headers.authorization?.replace('Bearer ', '')
        if (authToken && token === authToken) { next(); return }
        res.status(401).json({ error: 'Authentication required' })
      } else {
        // Serve login page for HTML requests — preserve return_to
        const returnTo = (req.query as any)?.return_to as string | undefined
        res.type('html').send(getLoginPage(returnTo))
      }
    })
  }

  // Helper: require admin role for sensitive operations
  function requireAdmin(req: any, res: any, next: any) {
    const userId: string | undefined = req.userId
    if (!userId) { res.status(401).json({ error: 'Authentication required' }); return }
    try {
      const db = openDb(SKILLBRAIN_ROOT)
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
      closeDb(db)
      if (user?.role === 'admin') { next(); return }
    } catch { /* users table not yet migrated — fall through */ }
    // Legacy admin (no per-user auth) or legacy-admin placeholder: allow
    if (userId === 'legacy-admin') { next(); return }
    res.status(403).json({ error: 'Only admins can perform this action' })
  }

  // ── MCP Protocol: POST /mcp ──
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    let transport: StreamableHTTPServerTransport | undefined

    if (sessionId) {
      transport = transports.get(sessionId)
    }

    if (!transport) {
      if (isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports.set(newSessionId, transport!)
          },
        })

        transport.onclose = () => {
          const sid = (transport as any).sessionId
          if (sid) transports.delete(sid)
        }

        const mcpUserId = (req as any).mcpUserId as string | undefined
        const server = createMcpServer({ userId: mcpUserId })
        await server.connect(transport)
      } else {
        res.status(400).json({ error: 'No valid session. Send an initialize request first.' })
        return
      }
    }

    await transport.handleRequest(req, res, req.body)
  })

  // ── MCP Protocol: GET /mcp (SSE stream) ──
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId) {
      res.status(400).json({ error: 'Missing mcp-session-id header' })
      return
    }

    const transport = transports.get(sessionId)
    if (!transport) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    await transport.handleRequest(req, res)
  })

  // ── MCP Protocol: DELETE /mcp (close session) ──
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId) {
      res.status(400).json({ error: 'Missing mcp-session-id header' })
      return
    }

    const transport = transports.get(sessionId)
    if (!transport) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    await transport.handleRequest(req, res)
    transports.delete(sessionId)
  })

  // ── Legacy SSE transport (for ChatGPT + older MCP clients) ──
  // Client opens GET /sse to start the event stream, then POSTs JSON-RPC to /sse/messages?sessionId=...
  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/sse/messages', res)
    sseTransports.set(transport.sessionId, transport)
    transport.onclose = () => { sseTransports.delete(transport.sessionId) }
    const mcpUserId = (req as any).mcpUserId as string | undefined
    const server = createMcpServer({ userId: mcpUserId })
    await server.connect(transport)
    // start() is invoked by connect(); nothing more to do here — the response stays open
  })

  app.post('/sse/messages', async (req, res) => {
    const sessionId = (req.query as any).sessionId as string | undefined
    if (!sessionId) { res.status(400).json({ error: 'Missing sessionId query param' }); return }
    const transport = sseTransports.get(sessionId)
    if (!transport) { res.status(404).json({ error: 'SSE session not found' }); return }
    // Body is already parsed by express.json() earlier in the chain
    await transport.handlePostMessage(req, res, req.body)
  })

  // ── OAuth 2.1 authorization server (for ChatGPT, Claude Desktop, etc.) ──
  app.use(createOAuthRouter({
    skillbrainRoot: SKILLBRAIN_ROOT,
    issuer: PUBLIC_ISSUER,
    getUserIdFromRequest,
  }))

  // ── Dashboard: Health ──
  app.get('/api/health', (_req, res) => {
    const mg = getMemoryGraphStats()
    const repos = loadRegistrySafe()
    let attentionCounts = { decayCount: 0, staleCount: 0, pendingReviews: 0 }
    try {
      const db = openDb(SKILLBRAIN_ROOT)
      attentionCounts = computeAttentionCounts(db)
      closeDb(db)
    } catch { /* ignore — non-critical */ }
    res.json({
      status: 'ok',
      memories: mg.total,
      memoryEdges: mg.edges,
      repos: repos.length,
      activeSessions: transports.size,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      ...attentionCounts,
    })
  })

  // ── Dashboard: Data API ──
  app.get('/api/data', (_req, res) => {
    const mg = getMemoryGraphStats()
    const repos = loadRegistrySafe()
    res.json({
      memoryGraph: mg,
      repos: repos.map((r: any) => ({ name: r.name, path: r.path, stats: r.stats })),
      activeSessions: transports.size,
      timestamp: new Date().toISOString(),
    })
  })

  // ── API: CodeGraph Upload ──
  app.post('/api/codegraph/upload', bearerAuth, express.json({ limit: '512mb' }), async (req, res) => {
    const { repoName, lastCommit, stats, graphDb, compressed } = req.body || {}
    if (!repoName || typeof repoName !== 'string') {
      res.status(400).json({ error: 'repoName (string) required' }); return
    }
    if (typeof graphDb !== 'string' || graphDb.length === 0) {
      res.status(400).json({ error: 'graphDb (base64 string) required' }); return
    }
    // Sanitize repoName: only alphanumeric, hyphens, underscores, dots — no slashes or traversal
    if (!/^[\w.-]+$/.test(repoName) || repoName.includes('..')) {
      res.status(400).json({ error: 'Invalid repoName' }); return
    }
    const MAX_DB_BYTES = 200 * 1024 * 1024 // 200 MB
    let binary = Buffer.from(graphDb, 'base64')
    if (compressed) {
      const { gunzipSync } = await import('node:zlib')
      binary = gunzipSync(binary)
    }
    if (binary.length > MAX_DB_BYTES) {
      res.status(413).json({ error: 'graphDb exceeds 200 MB limit' }); return
    }
    const reposRoot = path.resolve(SKILLBRAIN_ROOT, 'repos')
    const repoPath = path.resolve(reposRoot, repoName)
    if (!repoPath.startsWith(reposRoot + path.sep)) {
      res.status(400).json({ error: 'Invalid repoName' }); return
    }
    const dbDir = path.join(repoPath, '.codegraph')
    const dbPath = path.join(dbDir, 'graph.db')
    try {
      fs.mkdirSync(dbDir, { recursive: true })

      if (fs.existsSync(dbPath)) {
        // Merge: preserve memories/sessions/skills/env — only replace CodeGraph index tables.
        // Write incoming DB to a sibling temp repo path so openDb() can open it normally.
        const tmpRepoPath = repoPath + '__upload_tmp'
        const tmpDbDir = path.join(tmpRepoPath, '.codegraph')
        try {
          fs.mkdirSync(tmpDbDir, { recursive: true })
          fs.writeFileSync(path.join(tmpDbDir, 'graph.db'), binary)

          const existingDb = openDb(repoPath)   // server DB — has memories, sessions, etc.
          const incomingDb = openDb(tmpRepoPath) // fresh client analysis DB

          try {
            existingDb.transaction(() => {
              existingDb.prepare('DELETE FROM nodes').run()
              existingDb.prepare('DELETE FROM edges').run()
              existingDb.prepare('DELETE FROM files').run()

              for (const row of incomingDb.prepare('SELECT * FROM nodes').all() as any[]) {
                existingDb.prepare(
                  'INSERT OR IGNORE INTO nodes (id,label,name,file_path,start_line,end_line,is_exported,properties) VALUES (@id,@label,@name,@file_path,@start_line,@end_line,@is_exported,@properties)'
                ).run(row)
              }
              for (const row of incomingDb.prepare('SELECT * FROM edges').all() as any[]) {
                existingDb.prepare(
                  'INSERT OR IGNORE INTO edges (id,source_id,target_id,type,confidence,reason,step) VALUES (@id,@source_id,@target_id,@type,@confidence,@reason,@step)'
                ).run(row)
              }
              for (const row of incomingDb.prepare('SELECT * FROM files').all() as any[]) {
                existingDb.prepare(
                  'INSERT OR REPLACE INTO files (path,content_hash,indexed_at,symbol_count) VALUES (@path,@content_hash,@indexed_at,@symbol_count)'
                ).run(row)
              }

              // Rebuild nodes FTS manually — search_text is computed and not stored in nodes,
              // so the content-FTS 'rebuild' command would fail with "no such column: T.search_text".
              existingDb.prepare('DELETE FROM nodes_fts').run()
              existingDb.prepare(`
                INSERT INTO nodes_fts(rowid, name, file_path, search_text)
                SELECT rowid, name, COALESCE(file_path, ''),
                  name || ' ' || REPLACE(REPLACE(LOWER(name), '_', ' '), '-', ' ') || ' ' || COALESCE(file_path, '')
                FROM nodes
              `).run()
            })()
          } finally {
            closeDb(incomingDb)
            closeDb(existingDb)
          }
        } finally {
          fs.rmSync(tmpRepoPath, { recursive: true, force: true })
        }
      } else {
        // First upload — write directly (no existing data to preserve)
        fs.writeFileSync(dbPath, binary)
      }
    } catch (err: any) {
      console.error('[codegraph/upload] fs error', err)
      res.status(500).json({ error: `Failed to write graph.db: ${err.message}` }); return
    }
    try {
      upsertRegistry({
        name: repoName,
        path: repoPath,
        lastCommit: lastCommit ?? null,
        indexedAt: new Date().toISOString(),
        stats: {
          nodes: stats?.nodes ?? 0,
          edges: stats?.edges ?? 0,
          files: stats?.files ?? 0,
          communities: stats?.communities ?? 0,
          processes: stats?.processes ?? 0,
        },
      })
    } catch (err: any) {
      console.error('[codegraph/upload] registry error', err)
      res.status(500).json({ error: `Failed to update registry: ${err.message}` }); return
    }
    res.json({ success: true, repoName, path: repoPath })
  })

  // ── Route modules ──
  const isLocalhost = (req: Request): boolean => {
    const ip = req.socket.remoteAddress ?? ''
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('::ffff:127.')
  }

  const routeCtx: RouteContext = {
    skillbrainRoot: SKILLBRAIN_ROOT,
    requireAdmin,
    hashPassword,
    generatePassword,
    sendInviteEmail,
    anthropicApiKey: ANTHROPIC_API_KEY,
    isLocalhost,
  }

  app.use(createMemoriesRouter(routeCtx))
  app.use(createSessionsRouter(routeCtx))
  app.use(createProjectsRouter(routeCtx))
  app.use(createSkillsRouter(routeCtx))
  app.use(createAdminRouter(routeCtx))
  app.use(createReviewRouter(routeCtx))
  app.use(createUserProfileRouter(routeCtx))
  app.use(createWhiteboardsRouter(routeCtx))
  app.use(createStudioRouter(routeCtx))
  app.use(createStudioExportRouter(routeCtx))
  app.use(createStudioConnectorsRouter(routeCtx))
  app.use(createStudioDsRouter(routeCtx))

  // ── Static files (dashboard SPA) ──
  const publicDir = path.resolve(__dirname, '..', '..', 'public')
  app.use(express.static(publicDir))

  // SPA fallback: serve index.html for unmatched GET routes
  app.use((_req, res, next) => {
    if (_req.method === 'GET' && !_req.path.startsWith('/api/') && !_req.path.startsWith('/mcp')) {
      res.sendFile(path.join(publicDir, 'index.html'), (err) => {
        if (err) res.type('html').send(getFallbackPage(transports.size))
      })
    } else {
      next()
    }
  })

  // Fail-fast on missing/broken ENCRYPTION_KEY if the DB has any encrypted rows.
  // Better to refuse to start than to serve requests that'll crash later.
  {
    const db = openDb(SKILLBRAIN_ROOT)
    try {
      const row = db.prepare(`SELECT COUNT(*) as n FROM project_env_vars`).get() as { n: number }
      if (row.n > 0) {
        assertEncryptionUsable()
        // Verify the current key actually matches the existing DB rows
        const sample = db.prepare(
          `SELECT encrypted_value, iv, auth_tag FROM project_env_vars LIMIT 1`,
        ).get() as { encrypted_value: string; iv: string; auth_tag: string } | undefined
        if (sample) {
          try {
            decrypt({ ciphertext: sample.encrypted_value, iv: sample.iv, authTag: sample.auth_tag })
          } catch (err) {
            throw new Error(
              `ENCRYPTION_KEY does not match existing encrypted rows in project_env_vars. ` +
              `Rotating the key requires re-encrypting all stored values first. ` +
              `Original error: ${(err as Error).message}`,
            )
          }
        }
        console.log(`✅ ENCRYPTION_KEY validated (${row.n} encrypted env vars readable)`)
      } else if (process.env.ENCRYPTION_KEY) {
        assertEncryptionUsable() // key set but no rows yet — still validate roundtrip
        console.log('✅ ENCRYPTION_KEY validated (no encrypted rows yet)')
      } else {
        console.warn('⚠️ ENCRYPTION_KEY not set — env var storage disabled until configured')
      }
    } finally {
      closeDb(db)
    }
  }

  if (!_handlersRegistered) {
    _handlersRegistered = true
    process.on('uncaughtException', (err) => {
      console.error('[http-server] uncaughtException — keeping server alive:', err.message)
    })
    process.on('unhandledRejection', (reason) => {
      console.error('[http-server] unhandledRejection — keeping server alive:', reason)
    })
  }

  app.listen(port, () => {
    console.log(`
  Synapse (HTTP mode)
  ──────────────────────────
  Dashboard:  http://localhost:${port}
  MCP:        http://localhost:${port}/mcp               (Streamable HTTP)
  SSE:        http://localhost:${port}/sse               (legacy, for ChatGPT)
  OAuth:      ${PUBLIC_ISSUER}/.well-known/oauth-authorization-server
  API:        http://localhost:${port}/api/health
  Auth:       ${authToken ? 'Bearer token required for /mcp + /sse' : 'disabled'}
`)
    if (process.env.SKILLBRAIN_DECAY_DISABLED !== '1') {
      const db = openDb(SKILLBRAIN_ROOT)
      const memStore = new MemoryStore(db)
      const skillStore = new SkillsStore(db)
      startDecayScheduler({
        runner: () => {
          memStore.autoDecayIfDue()
          // Step 3 — skills also age. applyDecay() increments
          // sessions_since_validation for every active skill, decays confidence
          // for those untouched ≥10 sessions, deprecates those ≥30 with conf <3.
          // System/Lifecycle skills are protected (see applyDecay impl).
          try { skillStore.applyDecay() } catch (err) {
            console.error('[http-server] skill decay failed', err)
          }
        },
        intervalMs: 24 * 60 * 60 * 1000, // 24h
      })
      console.log('[http-server] decay scheduler started (interval: 24h, memory + skills)')
    }
  })
}

function getLoginPage(returnTo?: string): string {
  // Only allow same-origin return_to paths (must start with /) to prevent open redirects
  const safeReturn = returnTo && /^\/[^/]/.test(returnTo) ? returnTo : ''
  const returnJson = JSON.stringify(safeReturn)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Synapse — Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#08080d;color:#d0d0d0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh}
.login{background:#0e0e16;border:1px solid #1a1a2a;border-radius:12px;padding:32px;width:320px;text-align:center}
h1{font-size:22px;background:linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}
.sub{color:#555;font-size:12px;margin-bottom:24px}
input{width:100%;padding:10px 14px;background:#111118;border:1px solid #1a1a2a;border-radius:8px;color:#d0d0d0;font-size:14px;outline:none;margin-bottom:12px}
input:focus{border-color:#6366f1}
button{width:100%;padding:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
button:hover{opacity:.9}
.err{color:#f87171;font-size:12px;margin-top:8px;display:none}
</style></head><body>
<div class="login">
<h1>Synapse</h1>
<div class="sub">Sign in to your account</div>
<form onsubmit="return doLogin(event)">
<input type="email" id="em" placeholder="Email" autofocus>
<input type="password" id="pw" placeholder="Password">
<button type="submit">Login</button>
</form>
<div class="err" id="err">Wrong email or password</div>
</div>
<script>
const RETURN_TO=${returnJson};
async function doLogin(e){
  e.preventDefault();
  const em=document.getElementById('em').value;
  const pw=document.getElementById('pw').value;
  const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})});
  const d=await r.json();
  if(d.ok){
    document.cookie='sb_session='+d.token+';path=/;max-age=604800;SameSite=Lax';
    if(RETURN_TO){location.href=RETURN_TO;}else{location.reload();}
  } else {
    document.getElementById('err').style.display='block';
  }
  return false;
}
</script></body></html>`
}

function getFallbackPage(activeSessions: number): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Synapse</title>
<style>body{background:#08080d;color:#d0d0d0;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.c{text-align:center}h1{font-size:24px;color:#a78bfa}p{color:#555;margin-top:8px}</style>
</head><body><div class="c"><h1>Synapse</h1><p>Server running. Dashboard files not found.</p>
<p>Active sessions: ${activeSessions}</p></div></body></html>`
}
