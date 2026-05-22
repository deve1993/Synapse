/*
 * Synapse — The intelligence layer for AI workflows
 * Copyright (c) 2026 Daniel De Vecchi
 *
 * Licensed under AGPL-3.0-or-later.
 * See LICENSE for details.
 *
 * Commercial license: daniel@pixarts.eu
 */

import { Router, json } from 'express'
import { openDb, closeDb } from '@skillbrain/storage'
import { SkillsStore } from '@skillbrain/storage'
import { AuditStore } from '@skillbrain/storage'
import type { RouteContext } from './index.js'

export function createSkillsRouter(ctx: RouteContext): Router {
  const router = Router()

  router.get('/api/skills', (req, res) => {
    const { type, category, search, limit } = req.query as any
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      const project = (s: { name: string; category: string; type: string; description: string; lines: number; tags: string[]; updatedAt?: string; confidence?: number; usageCount?: number; usefulCount?: number; status?: string }) => ({
        name: s.name, category: s.category, type: s.type,
        description: s.description.slice(0, 150), lines: s.lines,
        tags: s.tags,
        updatedAt: s.updatedAt,
        confidence: s.confidence ?? null,
        usageCount: s.usageCount ?? 0,
        usefulCount: s.usefulCount ?? 0,
        status: s.status ?? 'active',
      })
      let skills
      if (search) {
        skills = store.search(search, parseInt(limit || '50', 10)).map((r) => project(r.skill))
      } else {
        skills = store.list(type, category).map(project)
      }
      const stats = store.stats()
      closeDb(db)
      res.json({ skills, total: stats.total, stats })
    } catch {
      res.json({ skills: [], total: 0, stats: {} })
    }
  })

  // PUT /api/skills/:name — admin update of metadata + content.
  // Soft-validates via skill_versions (history kept). Returns the updated skill.
  router.put('/api/skills/:name', ctx.requireAdmin, json({ limit: '256kb' }), (req, res) => {
    const userId = (req as any).userId ?? 'unknown'
    const { description, category, content, tags } = (req.body || {}) as {
      description?: string; category?: string; content?: string; tags?: string[]
    }
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      const existing = store.get(String(req.params.name))
      if (!existing) { closeDb(db); res.status(404).json({ error: 'Skill not found' }); return }
      const updated = {
        ...existing,
        description: description ?? existing.description,
        category: category ?? existing.category,
        content: content ?? existing.content,
        tags: tags ?? existing.tags,
        lines: (content ?? existing.content).split('\n').length,
        updatedAt: new Date().toISOString(),
      }
      store.upsert(updated, { changedBy: userId, reason: 'dashboard edit' })
      new AuditStore(db).log({
        entityType: 'skill', entityId: existing.name, action: 'update',
        reviewedBy: userId, metadata: { fields: Object.keys(req.body || {}) },
      })
      closeDb(db)
      res.json({ skill: updated })
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  // DELETE = soft-delete (status='deprecated'). Versioning is preserved.
  router.delete('/api/skills/:name', ctx.requireAdmin, (req, res) => {
    const userId = (req as any).userId ?? 'unknown'
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      const existing = store.get(String(req.params.name))
      if (!existing) { closeDb(db); res.status(404).json({ error: 'Skill not found' }); return }
      store.upsert(
        { ...existing, status: 'deprecated', updatedAt: new Date().toISOString() },
        { changedBy: userId, reason: 'soft-delete via dashboard' },
      )
      new AuditStore(db).log({
        entityType: 'skill', entityId: existing.name, action: 'delete', reviewedBy: userId, metadata: { type: 'soft-delete' },
      })
      closeDb(db)
      res.json({ ok: true })
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  // Health dashboard — MUST be declared before `/api/skills/:name`,
  // otherwise Express matches "health" as the :name param and routes to detail.
  router.get('/api/skills/health', (_req, res) => {
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      const health = {
        confidenceStats: store.confidenceStats(),
        topCooccurrences: store.topCooccurrences(20),
        topRouted: store.topRouted(168, 20),
        topLoaded: store.topLoaded(168, 20),
        topApplied: store.topApplied(168, 20),
        deadSkills: store.deadSkills(30, 20),
        atRiskSkills: store.atRiskSkills(),
      }
      closeDb(db)
      res.json(health)
    } catch {
      res.json({
        confidenceStats: { growing: [], declining: [], usefulRate: [] },
        topCooccurrences: [], topRouted: [], topLoaded: [],
        topApplied: [], deadSkills: [], atRiskSkills: [],
      })
    }
  })

  router.get('/api/skills/:name', (req, res) => {
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      const skill = store.get(req.params.name)
      closeDb(db)
      if (!skill) { res.status(404).json({ error: 'Skill not found' }); return }
      res.json(skill)
    } catch {
      res.status(500).json({ error: 'Internal error' })
    }
  })

  router.get('/api/skills/:name/versions', (req, res) => {
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      const versions = store.listVersions(req.params.name)
      closeDb(db)
      res.json({ versions })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/api/skills/:name/rollback/:versionId', ctx.requireAdmin, (req, res) => {
    const userId = (req as any).userId ?? 'unknown'
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      const skill = store.rollback(String(req.params.name), String(req.params.versionId), userId)
      new AuditStore(db).log({
        entityType: 'skill',
        entityId: String(req.params.name),
        action: 'rollback',
        reviewedBy: userId,
        metadata: { versionId: String(req.params.versionId) },
      })
      closeDb(db)
      res.json({ skill })
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  // Telemetry: client-side Skill tool usage
  router.post('/telemetry/skill-usage', json({ limit: '8kb' }), (req, res) => {
    if (!ctx.isLocalhost(req)) { res.status(403).json({ error: 'localhost only' }); return }
    const { skill, action, sessionId, project, task, tool } = (req.body || {}) as {
      skill?: string; action?: string; sessionId?: string
      project?: string; task?: string; tool?: string
    }
    if (!skill || typeof skill !== 'string') { res.status(400).json({ error: 'skill required' }); return }
    const validAction = action === 'routed' || action === 'loaded' || action === 'applied' ? action : 'applied'
    try {
      const db = openDb(ctx.skillbrainRoot)
      const store = new SkillsStore(db)
      store.recordUsage(skill, validAction, {
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
        project: typeof project === 'string' ? project : undefined,
        task: typeof task === 'string' ? task : (typeof tool === 'string' ? `tool:${tool}` : undefined),
      })
      closeDb(db)
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'internal' })
    }
  })

  return router
}
