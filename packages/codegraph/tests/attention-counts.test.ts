/*
 * Synapse — The intelligence layer for AI workflows
 * Copyright (c) 2026 Daniel De Vecchi
 *
 * Licensed under AGPL-3.0-or-later.
 * See LICENSE for details.
 *
 * Commercial license: daniel@pixarts.eu
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, closeDb, runMigrations, MemoryStore } from '@skillbrain/storage'
import { computeAttentionCounts } from '../src/mcp/http-server.js'
import type Database from 'better-sqlite3'

describe('computeAttentionCounts', () => {
  let dir: string
  let db: Database.Database
  let store: MemoryStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sb-attn-'))
    db = openDb(dir)
    runMigrations(db)
    store = new MemoryStore(db)
  })

  afterEach(() => {
    closeDb(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns zeroes on a freshly-migrated empty DB', () => {
    const result = computeAttentionCounts(db)
    expect(result.decayCount).toBe(0)
    expect(result.staleCount).toBe(0)
    expect(result.pendingReviews).toBe(0)
  })

  it('counts decayCount: active memories with confidence < 4', () => {
    // confidence 3 (active) — should be counted
    store.add({ type: 'Pattern', context: 'ctx-decay', problem: '', solution: 'sol', reason: '', tags: [], confidence: 3 })
    // confidence 4 — boundary, should NOT be counted (< 4, not <= 4)
    store.add({ type: 'Pattern', context: 'ctx-boundary', problem: '', solution: 'sol', reason: '', tags: [], confidence: 4 })
    // confidence 7 — should NOT be counted
    store.add({ type: 'Pattern', context: 'ctx-healthy', problem: '', solution: 'sol', reason: '', tags: [], confidence: 7 })
    // confidence 2, deprecated — should NOT be counted (not active)
    const m4 = store.add({ type: 'Pattern', context: 'ctx-dep', problem: '', solution: 'sol', reason: '', tags: [], confidence: 2 })
    db.prepare("UPDATE memories SET status = 'deprecated' WHERE id = ?").run(m4.id)

    const result = computeAttentionCounts(db)
    expect(result.decayCount).toBe(1)
  })

  it('counts staleCount: active memories with COALESCE(updated_at, created_at) older than 90 days', () => {
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()

    // old created_at + old updated_at, active — should be counted
    const s1 = store.add({ type: 'Pattern', context: 'old-active', problem: '', solution: 'sol', reason: '', tags: [] })
    db.prepare('UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?').run(old, old, s1.id)

    // old created_at, updated recently — should NOT be counted (COALESCE picks updated_at)
    const s2 = store.add({ type: 'Pattern', context: 'old-created-recent-updated', problem: '', solution: 'sol', reason: '', tags: [] })
    db.prepare('UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?').run(old, recent, s2.id)

    // recent timestamps — should NOT be counted
    store.add({ type: 'Pattern', context: 'recent-active', problem: '', solution: 'sol', reason: '', tags: [] })

    // old + deprecated — should NOT be counted (not active)
    const s4 = store.add({ type: 'Pattern', context: 'old-deprecated', problem: '', solution: 'sol', reason: '', tags: [] })
    db.prepare('UPDATE memories SET created_at = ?, updated_at = ?, status = ? WHERE id = ?').run(old, old, 'deprecated', s4.id)

    const result = computeAttentionCounts(db)
    expect(result.staleCount).toBe(1)
  })

  it('counts pendingReviews: sum across memories, skills, ui_components', () => {
    const now = new Date().toISOString()

    // 2 pending-review memories
    store.add({ type: 'Pattern', context: 'pr1', problem: '', solution: 'sol', reason: '', tags: [], status: 'pending-review' })
    store.add({ type: 'Pattern', context: 'pr2', problem: '', solution: 'sol', reason: '', tags: [], status: 'pending-review' })

    // 1 pending skill (include all NOT NULL columns)
    db.prepare(
      `INSERT OR IGNORE INTO skills (name, category, description, content, type, tags, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('my-skill', 'general', 'desc', '# Content', 'domain', '[]', now, 'pending')

    // 1 pending ui_component (include all NOT NULL columns)
    db.prepare(
      `INSERT OR IGNORE INTO ui_components (id, project, name, section_type, status)
       VALUES (?, ?, ?, ?, ?)`
    ).run('comp-1', 'test-project', 'MyComp', 'hero', 'pending')

    const result = computeAttentionCounts(db)
    // 2 memory + 1 skill + 1 component = 4 (plus any proposals/dsScans from migrations)
    expect(result.pendingReviews).toBeGreaterThanOrEqual(4)
  })

  it('does not throw when skill_proposals / design_system_scans tables are absent', () => {
    // Drop tables to simulate an older DB schema
    try { db.prepare('DROP TABLE IF EXISTS skill_proposals').run() } catch { /* ok */ }
    try { db.prepare('DROP TABLE IF EXISTS design_system_scans').run() } catch { /* ok */ }

    expect(() => computeAttentionCounts(db)).not.toThrow()
    const result = computeAttentionCounts(db)
    expect(result.pendingReviews).toBe(0)
  })

  it('decayCount ignores pending-review memories (only counts active)', () => {
    // pending-review with low confidence — should NOT count towards decayCount
    store.add({ type: 'Pattern', context: 'pr-low-conf', problem: '', solution: 'sol', reason: '', tags: [], confidence: 1, status: 'pending-review' })

    const result = computeAttentionCounts(db)
    expect(result.decayCount).toBe(0)
  })
})
