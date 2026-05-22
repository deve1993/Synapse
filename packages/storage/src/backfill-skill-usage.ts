/*
 * Synapse — backfill skill_usage + memory_skill_edges from existing memories.
 *
 * One-shot retroactive feed for the autolearning loop:
 *   - Scans active memories with skill signal (Memory.skill field OR tags `skill:X`)
 *   - For each (memory, skill) pair existing in `skills` table:
 *       · INSERT a skill_usage row with action='applied', ts=memory.created_at
 *       · INSERT a memory_skill_edges row (DerivedFrom, strength=0.9)
 *   - Finally re-computes aggregate counters on skills (usage_count, useful_count)
 *     so the dashboard /skills/health shows real numbers from day 1.
 *
 * Idempotent: dedupes skill_usage by (skill_name, action, ts, session_id);
 * memory_skill_edges relies on its UNIQUE constraint.
 */

import { openDb, closeDb } from './db.js'
import { randomId } from './utils/hash.js'

export interface BackfillReport {
  scannedMemories: number
  memoriesWithSkill: number
  skillUsageInserted: number
  edgesCreated: number
  countersRecomputed: number
  unknownSkills: { skill: string; count: number }[]
  perSkill: { skill: string; applied: number }[]
}

export function backfillSkillUsage(workspacePath: string, opts: { dryRun?: boolean } = {}): BackfillReport {
  const db = openDb(workspacePath)
  try {
    // Build a set of known skill names so we silently skip skill:typo tags
    const known = new Set<string>(
      (db.prepare("SELECT name FROM skills").all() as { name: string }[]).map((r) => r.name),
    )

    const memories = db.prepare(`
      SELECT id, skill, tags, created_at, source_session, created_by_user_id, project
      FROM memories
      WHERE status IN ('active', 'pending-review') OR status IS NULL
    `).all() as { id: string; skill: string | null; tags: string; created_at: string; source_session: string | null; created_by_user_id: string | null; project: string | null }[]

    const dedupCheck = db.prepare(`
      SELECT 1 FROM skill_usage
      WHERE skill_name = ? AND action = 'applied' AND ts = ? AND COALESCE(session_id,'') = COALESCE(?,'')
      LIMIT 1
    `)
    const insertUsage = db.prepare(`
      INSERT INTO skill_usage (skill_name, session_id, project, task_description, action, user_id, ts)
      VALUES (?, ?, ?, ?, 'applied', ?, ?)
    `)
    const insertEdge = db.prepare(`
      INSERT OR IGNORE INTO memory_skill_edges
        (id, memory_id, skill_name, type, strength, reason, created_at)
      VALUES (?, ?, ?, 'DerivedFrom', 0.9, 'backfill from memory tag/field', ?)
    `)

    let memoriesWithSkill = 0
    const unknown = new Map<string, number>()
    const perSkillApplied = new Map<string, number>()

    // Snapshot DB counts BEFORE the transaction so we can compute the delta
    // afterwards. Counting via let-variables inside db.transaction(fn) is
    // unreliable in better-sqlite3 — the closure mutations don't reflect back
    // to the outer scope consistently.
    const countUsage = db.prepare("SELECT COUNT(*) AS c FROM skill_usage WHERE action='applied'")
    const countEdges = db.prepare('SELECT COUNT(*) AS c FROM memory_skill_edges')
    const beforeUsage = (countUsage.get() as { c: number }).c
    const beforeEdges = (countEdges.get() as { c: number }).c

    const tx = db.transaction(() => {
      for (const m of memories) {
        const skills = new Set<string>()
        if (m.skill) skills.add(m.skill.trim())
        if (m.tags) {
          try {
            const parsed = JSON.parse(m.tags) as unknown
            if (Array.isArray(parsed)) {
              for (const t of parsed) {
                if (typeof t === 'string' && t.startsWith('skill:')) {
                  const s = t.slice('skill:'.length).trim()
                  if (s) skills.add(s)
                }
              }
            }
          } catch { /* malformed tags JSON */ }
        }
        if (skills.size === 0) continue
        memoriesWithSkill++

        for (const skillName of skills) {
          if (!known.has(skillName)) {
            unknown.set(skillName, (unknown.get(skillName) ?? 0) + 1)
            continue
          }
          if (!opts.dryRun) {
            const exists = dedupCheck.get(skillName, m.created_at, m.source_session)
            if (!exists) {
              insertUsage.run(skillName, m.source_session, m.project, null, m.created_by_user_id, m.created_at)
              perSkillApplied.set(skillName, (perSkillApplied.get(skillName) ?? 0) + 1)
            }
            insertEdge.run(`MSE-${randomId()}`, m.id, skillName, m.created_at)
          } else {
            perSkillApplied.set(skillName, (perSkillApplied.get(skillName) ?? 0) + 1)
          }
        }
      }
    })
    tx()

    const afterUsage = (countUsage.get() as { c: number }).c
    const afterEdges = (countEdges.get() as { c: number }).c
    const skillUsageInserted = opts.dryRun ? 0 : afterUsage - beforeUsage
    const edgesCreated = opts.dryRun ? 0 : afterEdges - beforeEdges

    // Recompute aggregate counters on skills table — single pass, idempotent.
    // Includes all events (loaded + applied + pre-existing) so it self-heals
    // even if skill_usage was populated by other means.
    let countersRecomputed = 0
    if (!opts.dryRun) {
      const res = db.prepare(`
        UPDATE skills SET
          usage_count = (
            SELECT COUNT(*) FROM skill_usage
            WHERE skill_name = skills.name AND action IN ('loaded','applied')
          ),
          useful_count = (
            SELECT COUNT(*) FROM skill_usage
            WHERE skill_name = skills.name AND action = 'applied'
          )
      `).run()
      countersRecomputed = res.changes ?? 0
    }

    const perSkill = [...perSkillApplied.entries()]
      .map(([skill, applied]) => ({ skill, applied }))
      .sort((a, b) => b.applied - a.applied)

    const unknownSkills = [...unknown.entries()]
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count)

    return {
      scannedMemories: memories.length,
      memoriesWithSkill,
      skillUsageInserted,
      edgesCreated,
      countersRecomputed,
      unknownSkills,
      perSkill,
    }
  } finally {
    closeDb(db)
  }
}
