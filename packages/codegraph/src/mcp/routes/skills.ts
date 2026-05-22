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
      let skills
      if (search) {
        skills = store.search(search, parseInt(limit || '50', 10)).map((r) => ({
          name: r.skill.name, category: r.skill.category, type: r.skill.type,
          description: r.skill.description.slice(0, 150), lines: r.skill.lines,
          tags: r.skill.tags,
        }))
      } else {
        skills = store.list(type, category).map((s) => ({
          name: s.name, category: s.category, type: s.type,
          description: s.description.slice(0, 150), lines: s.lines,
          tags: s.tags,
        }))
      }
      const stats = store.stats()
      closeDb(db)
      res.json({ skills, total: stats.total, stats })
    } catch {
      res.json({ skills: [], total: 0, stats: {} })
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
