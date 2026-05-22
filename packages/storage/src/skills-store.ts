/*
 * Synapse — The intelligence layer for AI workflows
 * Copyright (c) 2026 Daniel De Vecchi
 *
 * Licensed under AGPL-3.0-or-later.
 * See LICENSE for details.
 *
 * Commercial license: daniel@pixarts.eu
 */

import type Database from 'better-sqlite3'
import { openDb, closeDb } from './db.js'
import { SKILL_DECAY_SESSIONS_THRESHOLD, SKILL_DEPRECATION_SESSIONS_THRESHOLD } from './constants.js'
import { randomId } from './utils/hash.js'

export type SkillType = 'domain' | 'lifecycle' | 'process' | 'agent' | 'command'

export interface Skill {
  name: string
  category: string
  description: string
  content: string
  type: SkillType
  tags: string[]
  lines: number
  updatedAt: string
  status?: 'active' | 'pending' | 'deprecated'
  createdByUserId?: string
  updatedByUserId?: string
  // Autolearning metrics — present once migration 016 is applied.
  // Surfaced to /api/skills so the Catalog cards can render confidence bars
  // and usage/useful badges without an extra round-trip.
  confidence?: number
  usageCount?: number
  usefulCount?: number
  sessionsSinceValidation?: number
  lastValidated?: string
}

export interface SkillVersion {
  id: string
  skillName: string
  versionNumber: number
  content: string
  description: string
  category: string
  tags: string[]
  changedBy: string | null
  changeReason: string
  createdAt: string
}

export interface SkillUpsertOptions {
  changedBy?: string
  reason?: string
  expectedUpdatedAt?: string
}

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcurrencyError'
  }
}

export interface SkillSearchResult {
  skill: Skill
  rank: number
}

export type SkillUsageAction = 'routed' | 'loaded' | 'applied' | 'dismissed'

export interface SkillUsageContext {
  sessionId?: string
  project?: string
  task?: string
  userId?: string
}

export interface SkillUsageRow {
  skillName: string
  count: number
}

// Per-instance guard against duplicate inserts within a 1s window —
// e.g. cortex_briefing internally invokes skill_route on the same store
// which would otherwise log the same (name, action, session) twice.
// Cross-instance dedup would need DB-side logic; this best-effort guard
// covers the realistic case (single store opened per request).
const DEDUP_WINDOW_MS = 1000

export class SkillsStore {
  private static _telemetryWarned = false
  private static _telemetryFailures = 0
  private stmts: ReturnType<typeof this.prepareStatements>
  private recentInserts: Map<string, number> = new Map()

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements()
  }

  static get telemetryFailures(): number {
    return SkillsStore._telemetryFailures
  }

  private prepareStatements() {
    return {
      upsert: this.db.prepare(`
        INSERT OR REPLACE INTO skills (name, category, description, content, type, tags, lines, updated_at, status, created_by_user_id, updated_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_by_user_id FROM skills WHERE name = ?), ?), ?)
      `),
      get: this.db.prepare('SELECT * FROM skills WHERE name = ?'),
      getUpdatedAt: this.db.prepare('SELECT updated_at FROM skills WHERE name = ?'),
      // Include autolearning metrics in list queries so the dashboard Catalog
      // can render confidence/usage badges without a separate fetch per card.
      // Columns from migration 016 are nullable and default to safe values.
      listAll: this.db.prepare("SELECT name, category, description, type, tags, lines, status, updated_at, created_by_user_id, confidence, usage_count, useful_count, sessions_since_validation, last_validated FROM skills WHERE status = 'active' ORDER BY category, name"),
      listByType: this.db.prepare("SELECT name, category, description, type, tags, lines, status, updated_at, created_by_user_id, confidence, usage_count, useful_count, sessions_since_validation, last_validated FROM skills WHERE type = ? AND status = 'active' ORDER BY category, name"),
      listByCategory: this.db.prepare("SELECT name, category, description, type, tags, lines, status, updated_at, created_by_user_id, confidence, usage_count, useful_count, sessions_since_validation, last_validated FROM skills WHERE category = ? AND status = 'active' ORDER BY name"),
      searchFts: this.db.prepare(`
        SELECT s.*, fts.rank
        FROM skills_fts fts
        JOIN skills s ON s.rowid = fts.rowid
        WHERE skills_fts MATCH ? AND s.status = 'active'
        ORDER BY fts.rank
        LIMIT ?
      `),
      countByType: this.db.prepare('SELECT type, COUNT(*) as count FROM skills GROUP BY type'),
      countByCategory: this.db.prepare('SELECT category, COUNT(*) as count FROM skills GROUP BY category ORDER BY count DESC'),
      total: this.db.prepare('SELECT COUNT(*) as count FROM skills'),
      deleteAll: this.db.prepare('DELETE FROM skills'),
      insertUsage: this.db.prepare(`
        INSERT INTO skill_usage (skill_name, session_id, project, task_description, action, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      // Step 2 — bump usage_count on every loaded/applied event (general activity)
      bumpUsageCount: this.db.prepare(`
        UPDATE skills SET
          usage_count = COALESCE(usage_count, 0) + 1,
          updated_at = ?
        WHERE name = ?
      `),
      topRouted: this.db.prepare(`
        SELECT skill_name as skillName, COUNT(*) as count
        FROM skill_usage
        WHERE action = 'routed' AND ts >= datetime('now', ?)
        GROUP BY skill_name ORDER BY count DESC LIMIT ?
      `),
      topLoaded: this.db.prepare(`
        SELECT skill_name as skillName, COUNT(*) as count
        FROM skill_usage
        WHERE action = 'loaded' AND ts >= datetime('now', ?)
        GROUP BY skill_name ORDER BY count DESC LIMIT ?
      `),
      topApplied: this.db.prepare(`
        SELECT skill_name as skillName, COUNT(*) as count
        FROM skill_usage
        WHERE action = 'applied' AND ts >= datetime('now', ?)
        GROUP BY skill_name ORDER BY count DESC LIMIT ?
      `),
      // Skills that look dead: never loaded AND never applied in the window.
      // Both signals count as "alive": `loaded` = read interactively in a session,
      // `applied` = referenced by a memory_add hook (real usage).
      // Without the applied check, the backfill of historical memories would flag
      // every applied-only skill as dead — false positive.
      deadSkills: this.db.prepare(`
        SELECT s.name as skillName, COUNT(u.id) as count
        FROM skills s
        LEFT JOIN skill_usage u ON u.skill_name = s.name AND u.ts >= datetime('now', ?)
        WHERE s.status = 'active'
        GROUP BY s.name
        HAVING SUM(CASE WHEN u.action = 'loaded' THEN 1 ELSE 0 END) = 0
           AND SUM(CASE WHEN u.action = 'applied' THEN 1 ELSE 0 END) = 0
        ORDER BY count DESC LIMIT ?
      `),
      lastUsed: this.db.prepare(`
        SELECT skill_name as skillName, MAX(ts) as ts
        FROM skill_usage WHERE action IN ('loaded','applied')
        GROUP BY skill_name
      `),
      countUsageSince: this.db.prepare(`
        SELECT COUNT(*) as count FROM skill_usage WHERE ts >= datetime('now', ?)
      `),
      // Confidence / decay (require migration 016)
      markUseful: this.db.prepare(`
        UPDATE skill_usage SET useful = 1
        WHERE skill_name = ? AND session_id = ? AND action IN ('loaded','applied')
      `),
      reinforceSkill: this.db.prepare(`
        UPDATE skills SET
          confidence = MIN(COALESCE(confidence, 5) + 1, 10),
          last_validated = ?,
          sessions_since_validation = 0,
          useful_count = COALESCE(useful_count, 0) + 1,
          updated_at = ?
        WHERE name = ?
      `),
      incrementSkillSessionCount: this.db.prepare(`
        UPDATE skills SET
          sessions_since_validation = COALESCE(sessions_since_validation, 0) + 1
        WHERE status = 'active'
      `),
      applySkillDecay: this.db.prepare(`
        UPDATE skills SET
          confidence = MAX(COALESCE(confidence, 5) - 1, 1),
          updated_at = ?
        WHERE sessions_since_validation >= 10 AND COALESCE(confidence, 5) > 1 AND status = 'active'
      `),
      deprecateSkills: this.db.prepare(`
        UPDATE skills SET status = 'deprecated', updated_at = ?
        WHERE sessions_since_validation >= 30 AND COALESCE(confidence, 5) < 3 AND status = 'active'
      `),
      // Recent load count for a skill in the last N hours (for usage boost in route())
      recentLoadCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM skill_usage
        WHERE skill_name = ? AND action IN ('loaded','applied') AND ts >= datetime('now', ?)
      `),
      recentAppliedCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM skill_usage
        WHERE skill_name = ? AND action = 'applied' AND ts >= datetime('now', ?)
      `),
      dismissalCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM skill_usage
        WHERE skill_name = ? AND action = 'dismissed' AND ts >= datetime('now', '-7 days')
      `),
      lastLoadedInSession: this.db.prepare(`
        SELECT skill_name FROM skill_usage
        WHERE session_id = ? AND action IN ('loaded', 'applied')
        ORDER BY ts DESC LIMIT 1
      `),
      // Upsert co-occurrence pair
      upsertCooccurrence: this.db.prepare(`
        INSERT INTO skill_cooccurrence (skill_a, skill_b, count, last_ts)
        VALUES (?, ?, 1, datetime('now'))
        ON CONFLICT(skill_a, skill_b) DO UPDATE SET
          count = count + 1,
          last_ts = datetime('now')
      `),
      // Get co-occurrence count for a pair
      getCooccurrence: this.db.prepare(`
        SELECT count FROM skill_cooccurrence WHERE skill_a = ? AND skill_b = ?
      `),
      // Project affinity: how often a skill was loaded/applied in a specific project
      projectAffinityCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM skill_usage
        WHERE skill_name = ? AND project = ? AND action IN ('loaded','applied')
        AND ts >= datetime('now', '-90 days')
      `),
    }
  }

  upsert(skill: Skill, options: SkillUpsertOptions = {}): void {
    const { changedBy, reason = 'manual', expectedUpdatedAt } = options

    if (expectedUpdatedAt) {
      const row = this.stmts.getUpdatedAt.get(skill.name) as { updated_at: string } | undefined
      if (row && row.updated_at !== expectedUpdatedAt) {
        throw new ConcurrencyError('Skill modificata da altro utente, ricarica e riprova')
      }
    }

    this.stmts.upsert.run(
      skill.name, skill.category, skill.description, skill.content,
      skill.type, JSON.stringify(skill.tags), skill.lines, skill.updatedAt,
      skill.status ?? 'active',
      skill.name, skill.createdByUserId ?? null,
      changedBy ?? null,
    )

    this.saveVersion(skill, changedBy ?? null, reason)

    // Populate FTS
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO skills_fts(rowid, name, description, content, tags)
        VALUES ((SELECT rowid FROM skills WHERE name = ?), ?, ?, ?, ?)
      `).run(skill.name, skill.name, skill.description, skill.content, skill.tags.join(' '))
    } catch { /* FTS can fail silently */ }
  }

  upsertBatch(skills: Skill[], options: SkillUpsertOptions = {}): void {
    const tx = this.db.transaction((items: Skill[]) => {
      for (const s of items) this.upsert(s, options)
    })
    tx(skills)
  }

  private saveVersion(skill: Skill, changedBy: string | null, reason: string): void {
    try {
      const maxRow = this.db.prepare(
        `SELECT MAX(version_number) as max FROM skill_versions WHERE skill_name = ?`
      ).get(skill.name) as { max: number | null } | undefined
      const nextVersion = (maxRow?.max ?? 0) + 1
      const id = `SV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      this.db.prepare(`
        INSERT INTO skill_versions (id, skill_name, version_number, content, description, category, tags, changed_by, change_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, skill.name, nextVersion, skill.content,
        skill.description, skill.category,
        JSON.stringify(skill.tags ?? []),
        changedBy, reason,
      )
    } catch { /* skill_versions table may not exist yet */ }
  }

  listVersions(skillName: string): SkillVersion[] {
    try {
      const rows = this.db.prepare(
        `SELECT * FROM skill_versions WHERE skill_name = ? ORDER BY version_number DESC`
      ).all(skillName) as any[]
      return rows.map(this.rowToVersion)
    } catch { return [] }
  }

  getVersion(versionId: string): SkillVersion | null {
    try {
      const row = this.db.prepare(`SELECT * FROM skill_versions WHERE id = ?`).get(versionId) as any
      return row ? this.rowToVersion(row) : null
    } catch { return null }
  }

  rollback(skillName: string, versionId: string, changedBy: string): Skill {
    const version = this.getVersion(versionId)
    if (!version) throw new Error(`Version ${versionId} not found`)

    const existing = this.get(skillName)
    if (!existing) throw new Error(`Skill ${skillName} not found`)

    const now = new Date().toISOString()
    const rolledBack: Skill = {
      ...existing,
      content: version.content,
      description: version.description || existing.description,
      category: version.category || existing.category,
      tags: version.tags.length ? version.tags : existing.tags,
      lines: version.content.split('\n').length,
      updatedAt: now,
      updatedByUserId: changedBy,
    }

    this.upsert(rolledBack, { changedBy, reason: 'rollback' })
    return rolledBack
  }

  get(name: string): Skill | undefined {
    const row = this.stmts.get.get(name) as any
    return row ? this.rowToSkill(row) : undefined
  }

  list(type?: SkillType, category?: string): Skill[] {
    let rows: any[]
    if (category) {
      rows = this.stmts.listByCategory.all(category) as any[]
    } else if (type) {
      rows = this.stmts.listByType.all(type) as any[]
    } else {
      rows = this.stmts.listAll.all() as any[]
    }
    return rows.map(this.rowToSkill)
  }

  search(query: string, limit = 10): SkillSearchResult[] {
    const tokens = query
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1)

    const ftsQuery = tokens.map((w) => `"${w}"`).join(' OR ')

    try {
      const rows = this.stmts.searchFts.all(ftsQuery, limit) as any[]
      return rows.map((r) => ({ skill: this.rowToSkill(r), rank: r.rank }))
    } catch {
      return []
    }
  }

  route(taskDescription: string, limit = 5, activeSkills: string[] = [], project?: string): Skill[] {
    const results = this.search(taskDescription, limit * 3)
    if (results.length === 0) return []

    const maxBm25 = Math.abs(Math.min(...results.map((r) => r.rank)))

    const scored = results.map((r) => {
      const bm25Norm = maxBm25 > 0 ? Math.abs(r.rank) / maxBm25 : 0.5
      const confidence = (() => {
        try {
          const row = this.db.prepare(`SELECT COALESCE(confidence, 5) as c FROM skills WHERE name = ?`).get(r.skill.name) as { c: number } | undefined
          return (row?.c ?? 5) / 10
        } catch { return 0.5 }
      })()
      const recentCount = (() => {
        try {
          const loaded = (this.stmts.recentLoadCount.get(r.skill.name, '-24 hours') as { count: number } | undefined)?.count ?? 0
          const applied = (this.stmts.recentAppliedCount.get(r.skill.name, '-24 hours') as { count: number } | undefined)?.count ?? 0
          return Math.log1p(loaded + applied * 3)
        } catch { return 0 }
      })()
      const recencyBoost = recentCount / (Math.log1p(100))
      const coocCount = this.getCooccurrenceCount(r.skill.name, activeSkills)
      const coocBoost = Math.min(coocCount / 100, 1.0)

      const dismissalPenalty = (() => {
        try {
          const row = this.stmts.dismissalCount.get(r.skill.name) as { count: number } | undefined
          const count = row?.count ?? 0
          return Math.min(count * 0.05, 0.20)
        } catch { return 0 }
      })()

      const categoryBoost = (() => {
        if (!activeSkills.length) return 0
        const activeCategories = new Set<string>()
        for (const as of activeSkills) {
          const skill = this.get(as)
          if (skill) activeCategories.add(skill.category)
        }
        return activeCategories.has(r.skill.category) ? 0.15 : 0
      })()

      const projectAffinity = (() => {
        if (!project) return 0
        try {
          const row = this.stmts.projectAffinityCount.get(r.skill.name, project) as { count: number } | undefined
          const count = row?.count ?? 0
          return Math.min(Math.log1p(count) / Math.log1p(50), 1.0)
        } catch { return 0 }
      })()

      const score = 0.38 * bm25Norm + 0.15 * confidence + 0.12 * recencyBoost + 0.10 * coocBoost + 0.10 * projectAffinity + categoryBoost - dismissalPenalty
      return { skill: r.skill, score }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((r) => r.skill)
  }

  stats() {
    const total = (this.stmts.total.get() as any).count
    const byType = (this.stmts.countByType.all() as any[])
      .reduce((acc, r) => ({ ...acc, [r.type]: r.count }), {} as Record<string, number>)
    const byCategory = (this.stmts.countByCategory.all() as any[])
      .reduce((acc, r) => ({ ...acc, [r.category]: r.count }), {} as Record<string, number>)
    return { total, byType, byCategory }
  }

  recordUsage(name: string, action: SkillUsageAction, ctx: SkillUsageContext = {}): void {
    if (!name) return
    const dedupKey = `${name}|${action}|${ctx.sessionId ?? ''}`
    const now = Date.now()
    const last = this.recentInserts.get(dedupKey)
    if (last && now - last < DEDUP_WINDOW_MS) return
    this.recentInserts.set(dedupKey, now)
    // Bound the in-memory map size: drop entries older than 5 minutes
    if (this.recentInserts.size > 1000) {
      const cutoff = now - 5 * 60 * 1000
      for (const [k, ts] of this.recentInserts) if (ts < cutoff) this.recentInserts.delete(k)
    }
    try {
      this.stmts.insertUsage.run(
        name,
        ctx.sessionId ?? null,
        ctx.project ?? null,
        ctx.task ?? null,
        action,
        ctx.userId ?? null,
      )
      // Step 2 — keep aggregated counters on `skills` in sync so /api/skills/health
      // and ranking reads are O(1) per skill instead of aggregating skill_usage.
      // loaded + applied count as usage; routed (system suggestion) does not.
      if (action === 'loaded' || action === 'applied') {
        const nowIso = new Date().toISOString()
        try { this.stmts.bumpUsageCount.run(nowIso, name) } catch { /* migration 016 not applied */ }
        if (action === 'applied') {
          // reinforceSkill: confidence +1 (capped at 10), useful_count +1,
          // sessions_since_validation = 0, last_validated = now.
          try { this.stmts.reinforceSkill.run(nowIso, nowIso, name) } catch { /* ok */ }
        }
      }
    } catch (err) {
      if (!SkillsStore._telemetryWarned) {
        console.warn('[skill_usage] insert failed, telemetry disabled:', (err as Error).message)
        SkillsStore._telemetryWarned = true
      }
      SkillsStore._telemetryFailures++
    }
  }

  topRouted(sinceHours = 24, limit = 20): SkillUsageRow[] {
    try {
      return this.stmts.topRouted.all(`-${sinceHours} hours`, limit) as SkillUsageRow[]
    } catch { return [] }
  }

  topLoaded(sinceHours = 24, limit = 20): SkillUsageRow[] {
    try {
      return this.stmts.topLoaded.all(`-${sinceHours} hours`, limit) as SkillUsageRow[]
    } catch { return [] }
  }

  topApplied(sinceHours = 24, limit = 20): SkillUsageRow[] {
    try {
      return this.stmts.topApplied.all(`-${sinceHours} hours`, limit) as SkillUsageRow[]
    } catch { return [] }
  }

  deadSkills(sinceDays = 30, limit = 20): SkillUsageRow[] {
    try {
      return this.stmts.deadSkills.all(`-${sinceDays} days`, limit) as SkillUsageRow[]
    } catch { return [] }
  }

  totalUsageSince(sinceHours = 24): number {
    try {
      return ((this.stmts.countUsageSince.get(`-${sinceHours} hours`) as any)?.count ?? 0) as number
    } catch { return 0 }
  }

  lastUsedMap(): Map<string, string> {
    try {
      const rows = this.stmts.lastUsed.all() as { skillName: string; ts: string }[]
      return new Map(rows.map((r) => [r.skillName, r.ts]))
    } catch { return new Map() }
  }

  lastLoadedSkill(sessionId: string): string | null {
    try {
      const row = this.stmts.lastLoadedInSession.get(sessionId) as { skill_name: string } | undefined
      return row?.skill_name ?? null
    } catch { return null }
  }

  markUseful(skillName: string, sessionId: string): void {
    try {
      this.stmts.markUseful.run(skillName, sessionId)
    } catch { /* migration 016 may not be applied yet */ }
  }

  applyDecay(usefulSkills: string[] = []): { reinforced: number; decayed: number; deprecated: number } {
    const now = new Date().toISOString()
    let reinforced = 0
    for (const name of usefulSkills) {
      try {
        this.stmts.reinforceSkill.run(now, now, name)
        reinforced++
      } catch { /* ok */ }
    }
    // System/Lifecycle skills (e.g. _routing-index, using-superpowers) are core
    // infrastructure — protect them from decay/deprecation regardless of usage.
    const PROTECTED_CATS = "'System','Lifecycle'"
    try {
      this.stmts.incrementSkillSessionCount.run()
      this.db.prepare(`
        UPDATE skills SET confidence = MAX(COALESCE(confidence, 5) - 1, 1), updated_at = ?
        WHERE sessions_since_validation >= ${SKILL_DECAY_SESSIONS_THRESHOLD}
          AND COALESCE(confidence, 5) > 1
          AND status = 'active'
          AND category NOT IN (${PROTECTED_CATS})
      `).run(now)
      const deprecated = (this.db.prepare(
        `SELECT COUNT(*) as c FROM skills
         WHERE sessions_since_validation >= ${SKILL_DEPRECATION_SESSIONS_THRESHOLD}
           AND COALESCE(confidence, 5) < 3
           AND status = 'active'
           AND category NOT IN (${PROTECTED_CATS})`
      ).get() as any)?.c ?? 0
      this.db.prepare(
        `UPDATE skills SET status = 'deprecated', updated_at = ?
         WHERE sessions_since_validation >= ${SKILL_DEPRECATION_SESSIONS_THRESHOLD}
           AND COALESCE(confidence, 5) < 3
           AND status = 'active'
           AND category NOT IN (${PROTECTED_CATS})`
      ).run(now)
      const decayed = (this.db.prepare(
        `SELECT COUNT(*) as c FROM skills
         WHERE sessions_since_validation >= ${SKILL_DECAY_SESSIONS_THRESHOLD}
           AND COALESCE(confidence, 5) > 1
           AND status = 'active'
           AND category NOT IN (${PROTECTED_CATS})`
      ).get() as any)?.c ?? 0
      return { reinforced, decayed, deprecated }
    } catch {
      return { reinforced, decayed: 0, deprecated: 0 }
    }
  }

  gcDeadSkills(opts: { threshold: number; days: number; dryRun: boolean }): { deprecated: string[]; scanned: number } {
    // Same fix as the deadSkills query: applied counts as life, otherwise
    // we'd auto-deprecate skills that are referenced by memories but not
    // currently opened in sessions.
    const sql = `
      SELECT s.name,
        SUM(CASE WHEN u.action = 'routed' THEN 1 ELSE 0 END) AS routed_count,
        SUM(CASE WHEN u.action = 'loaded' THEN 1 ELSE 0 END) AS loaded_count,
        SUM(CASE WHEN u.action = 'applied' THEN 1 ELSE 0 END) AS applied_count
      FROM skills s
      LEFT JOIN skill_usage u
        ON u.skill_name = s.name
        AND u.ts >= datetime('now', ?)
      WHERE s.status = 'active'
      GROUP BY s.name
      HAVING routed_count >= ? AND loaded_count = 0 AND applied_count = 0
    `
    const rows = this.db.prepare(sql).all(`-${opts.days} days`, opts.threshold) as any[]
    const dead = rows.map((r) => r.name as string)

    if (!opts.dryRun && dead.length > 0) {
      const update = this.db.prepare(`UPDATE skills SET status = 'deprecated', updated_at = datetime('now') WHERE name = ?`)
      const tx = this.db.transaction((names: string[]) => { for (const n of names) update.run(n) })
      tx(dead)
    }

    return { deprecated: dead, scanned: rows.length }
  }

  recordCooccurrence(skillA: string, skillB: string): void {
    if (!skillA || !skillB || skillA === skillB) return
    const [a, b] = [skillA, skillB].sort()
    try {
      this.stmts.upsertCooccurrence.run(a, b)
    } catch { /* migration 016 not applied yet */ }
  }

  // ── Memory ↔ Skill edges (Step 4 of autolearning) ──────────────────────
  // Idempotent: UNIQUE(memory_id, skill_name, type) makes re-inserts no-ops.
  // The skill MUST exist in `skills` table (FK), so this silently skips
  // memories tagged with skill:typo or skills that were deprecated/removed.
  linkMemoryToSkill(memoryId: string, skillName: string, strength: number, reason?: string): boolean {
    try {
      const id = `MSE-${randomId()}`
      const now = new Date().toISOString()
      this.db.prepare(`
        INSERT OR IGNORE INTO memory_skill_edges
          (id, memory_id, skill_name, type, strength, reason, created_at)
        VALUES (?, ?, ?, 'DerivedFrom', ?, ?, ?)
      `).run(id, memoryId, skillName, strength, reason ?? null, now)
      return true
    } catch {
      // Skill doesn't exist (typo tag) or migration not applied — safe to skip
      return false
    }
  }

  memoriesForSkill(skillName: string, limit = 50): { memoryId: string; strength: number; reason: string | null; createdAt: string }[] {
    try {
      const rows = this.db.prepare(`
        SELECT memory_id as memoryId, strength, reason, created_at as createdAt
        FROM memory_skill_edges
        WHERE skill_name = ? AND type = 'DerivedFrom'
        ORDER BY strength DESC, created_at DESC
        LIMIT ?
      `).all(skillName, limit) as any[]
      return rows
    } catch { return [] }
  }

  skillsForMemory(memoryId: string): { skillName: string; strength: number; reason: string | null }[] {
    try {
      const rows = this.db.prepare(`
        SELECT skill_name as skillName, strength, reason
        FROM memory_skill_edges
        WHERE memory_id = ? AND type = 'DerivedFrom'
        ORDER BY strength DESC
      `).all(memoryId) as any[]
      return rows
    } catch { return [] }
  }

  countMemoriesForSkill(skillName: string): number {
    try {
      const row = this.db.prepare(`
        SELECT COUNT(*) as c FROM memory_skill_edges
        WHERE skill_name = ? AND type = 'DerivedFrom'
      `).get(skillName) as { c: number } | undefined
      return row?.c ?? 0
    } catch { return 0 }
  }

  buildCooccurrences(): number {
    // Find all pairs of skills loaded in the same session within a 30-minute window
    try {
      const pairs = this.db.prepare(`
        SELECT a.skill_name as skill_a, b.skill_name as skill_b
        FROM skill_usage a
        JOIN skill_usage b ON a.session_id = b.session_id
          AND a.skill_name < b.skill_name
          AND b.action IN ('loaded','applied')
          AND ABS(JULIANDAY(a.ts) - JULIANDAY(b.ts)) * 1440 <= 30
        WHERE a.action IN ('loaded','applied')
          AND a.session_id IS NOT NULL
        GROUP BY a.skill_name, b.skill_name
      `).all() as { skill_a: string; skill_b: string }[]

      const tx = this.db.transaction(() => {
        for (const { skill_a, skill_b } of pairs) {
          this.stmts.upsertCooccurrence.run(skill_a, skill_b)
        }
      })
      tx()
      return pairs.length
    } catch { return 0 }
  }

  topCooccurrences(limit = 20): { skillA: string; skillB: string; count: number }[] {
    try {
      return (this.db.prepare(`
        SELECT skill_a as skillA, skill_b as skillB, count
        FROM skill_cooccurrence ORDER BY count DESC LIMIT ?
      `).all(limit) as any[]).map((r) => ({ skillA: r.skillA, skillB: r.skillB, count: r.count }))
    } catch { return [] }
  }

  confidenceStats(): {
    growing: { name: string; confidence: number }[]
    declining: { name: string; confidence: number; sessionsStale: number }[]
    usefulRate: { name: string; usefulCount: number; usageCount: number; rate: number }[]
  } {
    try {
      const growing = (this.db.prepare(`
        SELECT name, COALESCE(confidence, 5) as confidence
        FROM skills WHERE COALESCE(confidence, 5) >= 7 AND status = 'active'
        ORDER BY confidence DESC LIMIT 10
      `).all() as any[]).map((r) => ({ name: r.name, confidence: r.confidence }))

      const declining = (this.db.prepare(`
        SELECT name, COALESCE(confidence, 5) as confidence,
               COALESCE(sessions_since_validation, 0) as sessionsStale
        FROM skills WHERE COALESCE(confidence, 5) <= 3 AND status = 'active'
        ORDER BY confidence ASC, sessions_since_validation DESC LIMIT 10
      `).all() as any[]).map((r) => ({ name: r.name, confidence: r.confidence, sessionsStale: r.sessionsStale }))

      const usefulRate = (this.db.prepare(`
        SELECT name,
               COALESCE(useful_count, 0) as usefulCount,
               COALESCE(usage_count, 0) as usageCount,
               CASE WHEN COALESCE(usage_count, 0) > 0
                    THEN CAST(COALESCE(useful_count, 0) AS REAL) / COALESCE(usage_count, 0)
                    ELSE 0 END as rate
        FROM skills WHERE status = 'active' AND COALESCE(usage_count, 0) > 0
        ORDER BY rate DESC LIMIT 10
      `).all() as any[]).map((r) => ({ name: r.name, usefulCount: r.usefulCount, usageCount: r.usageCount, rate: r.rate }))

      return { growing, declining, usefulRate }
    } catch {
      return { growing: [], declining: [], usefulRate: [] }
    }
  }

  atRiskSkills(limit = 20): { name: string; confidence: number; sessionsStale: number; category: string }[] {
    try {
      return (this.db.prepare(`
        SELECT name, COALESCE(confidence, 5) as confidence,
               COALESCE(sessions_since_validation, 0) as sessionsStale,
               category
        FROM skills
        WHERE COALESCE(confidence, 5) <= 4
          AND COALESCE(sessions_since_validation, 0) >= 3
          AND status = 'active'
        ORDER BY confidence ASC, sessions_since_validation DESC
        LIMIT ?
      `).all(limit) as any[]).map((r) => ({
        name: r.name, confidence: r.confidence, sessionsStale: r.sessionsStale, category: r.category,
      }))
    } catch { return [] }
  }

  private getCooccurrenceCount(skillA: string, activeSkills: string[]): number {
    if (!activeSkills.length) return 0
    let max = 0
    for (const active of activeSkills) {
      const [a, b] = [skillA, active].sort()
      try {
        const row = this.stmts.getCooccurrence.get(a, b) as { count: number } | undefined
        if (row && row.count > max) max = row.count
      } catch { /* ok */ }
    }
    return max
  }

  private rowToSkill(row: any): Skill {
    return {
      name: row.name,
      category: row.category,
      description: row.description,
      content: row.content ?? '',
      type: row.type,
      tags: JSON.parse(row.tags || '[]'),
      lines: row.lines,
      updatedAt: row.updated_at,
      status: row.status ?? 'active',
      createdByUserId: row.created_by_user_id ?? undefined,
      updatedByUserId: row.updated_by_user_id ?? undefined,
      confidence: row.confidence ?? undefined,
      usageCount: row.usage_count ?? undefined,
      usefulCount: row.useful_count ?? undefined,
      sessionsSinceValidation: row.sessions_since_validation ?? undefined,
      lastValidated: row.last_validated ?? undefined,
    }
  }

  private rowToVersion(row: any): SkillVersion {
    return {
      id: row.id,
      skillName: row.skill_name,
      versionNumber: row.version_number,
      content: row.content,
      description: row.description ?? '',
      category: row.category ?? '',
      tags: JSON.parse(row.tags || '[]'),
      changedBy: row.changed_by ?? null,
      changeReason: row.change_reason ?? 'manual',
      createdAt: row.created_at,
    }
  }
}

export function withSkillsStore<T>(repoPath: string, fn: (store: SkillsStore) => T): T {
  const db = openDb(repoPath)
  const store = new SkillsStore(db)
  try {
    return fn(store)
  } finally {
    closeDb(db)
  }
}
