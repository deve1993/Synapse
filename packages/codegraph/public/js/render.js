// Synapse — Rendering / DOM-building module

import { api } from './api.js'

// ── Pure helpers ──

export function escHtml(s) {
  return s?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || ''
}

export function formatUptime(s) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s/60)}m`
  const h = Math.floor(s/3600)
  const m = Math.floor((s%3600)/60)
  return `${h}h ${m}m`
}

export function badge(type) {
  const cls = `badge-${type.toLowerCase().replace(/\s/g,'')}`
  return `<span class="badge ${cls}">${type}</span>`
}

export function confBar(val) {
  const pct = val * 10
  const cls = val >= 7 ? 'conf-high' : val >= 4 ? 'conf-mid' : 'conf-low'
  return `<div class="conf-bar"><div class="conf-track"><div class="conf-fill ${cls}" style="width:${pct}%"></div></div><span>${val}</span></div>`
}

export function tagsHtml(tags) {
  if (!tags?.length) return ''
  return `<div class="tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>`
}

export function simpleMarkdown(md) {
  return escHtml(md)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .replace(/\|(.+)\|/g, (m) => {
      const cells = m.split('|').filter(c => c.trim())
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'
    })
}

// ── Hub helpers ──

const SAFE = (p) => p.catch(() => ({}))

function greetingLine(name) {
  const now = new Date()
  const h = now.getHours()
  const salute = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return `${salute}, ${name} · ${date}`
}

// Inline keydown handler — makes a div with onclick keyboard-accessible (Enter/Space → click)
const KEY_CLICK = `onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"`

let _hubRefreshTimer = null

function clearHubRefresh() {
  if (_hubRefreshTimer) { clearInterval(_hubRefreshTimer); _hubRefreshTimer = null }
}

async function refreshHubLive() {
  const hash = location.hash || '#/'
  if (hash !== '#/' && hash !== '#' && hash !== '#/home') { clearHubRefresh(); return }
  try {
    const health = await SAFE(api.get('/api/health'))
    const memVal = document.querySelector('.hub-kpi-purple .hub-kpi-val')
    if (memVal) memVal.textContent = health.memories || 0
    const sessVal = document.querySelector('.hub-kpi-pink .hub-kpi-val')
    if (sessVal) sessVal.textContent = health.activeSessions || 0
    const reviewTotal = health.pendingReviews ?? 0
    const reviewRow = document.querySelector('[data-health="review"]')
    if (reviewRow) {
      reviewRow.querySelector('.health-row-val').textContent = reviewTotal
      const dot = reviewRow.querySelector('.health-dot')
      dot.className = 'health-dot ' + (reviewTotal === 0 ? 'health-dot-ok' : reviewTotal <= 5 ? 'health-dot-warn' : 'health-dot-crit')
    }
    const uptimeStrong = document.querySelector('.health-footer span:first-child strong')
    if (uptimeStrong) uptimeStrong.textContent = formatUptime(health.uptime || 0)
    const statusEl = document.getElementById('server-status')
    if (statusEl) statusEl.textContent = `${formatUptime(health.uptime || 0)} uptime`
  } catch { /* ignore transient errors */ }
}

function hubSkeleton() {
  return `
    <section class="hub-hero">
      <div class="hub-greeting-line" style="opacity:.4">Loading workspace…</div>
      <div class="hub-actions">
        <div class="hub-skel hub-skel-chip"></div>
        <div class="hub-skel hub-skel-chip"></div>
        <div class="hub-skel hub-skel-chip"></div>
      </div>
      <div class="hub-kpi-row">
        <div class="hub-skel hub-skel-kpi"></div>
        <div class="hub-skel hub-skel-kpi"></div>
        <div class="hub-skel hub-skel-kpi"></div>
      </div>
    </section>
    <section class="hub-grid">
      <div class="hub-col-main"><div class="hub-skel hub-skel-card" style="height:280px"></div></div>
      <aside class="hub-col-side">
        <div class="hub-skel hub-skel-card" style="height:140px"></div>
        <div class="hub-skel hub-skel-card" style="height:180px"></div>
      </aside>
    </section>`
}

function timeAgo(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const ms = Date.now() - t
  if (ms < 0) return 'now'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

function dayGroup(iso) {
  if (!iso) return 'Earlier'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yest = new Date(today); yest.setDate(yest.getDate() - 1)
  const start = new Date(d); start.setHours(0, 0, 0, 0)
  if (start.getTime() === today.getTime()) return 'Today'
  if (start.getTime() === yest.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}

function daysSince(iso) {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.floor((Date.now() - t) / 86400000)
}

const HUB_ICONS = {
  session: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.07-4.54A2.5 2.5 0 0 1 6.5 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 3-2.48z"/></svg>',
  skill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
}

// ── Home ──

export async function renderHome() {
  clearHubRefresh()

  const pageEl = document.getElementById('page')
  pageEl.innerHTML = hubSkeleton()

  const [health, data, me, memR, sessR, review, skillsR] = await Promise.all([
    SAFE(api.get('/api/health')),
    SAFE(api.get('/api/data')),
    SAFE(api.get('/api/me')),
    SAFE(api.get('/api/memories?limit=100')),
    SAFE(api.get('/api/sessions?limit=20')),
    SAFE(api.get('/api/review/pending')),
    SAFE(api.get('/api/skills?limit=1')),
  ])

  const userName = (me.user?.name?.split(' ')[0]) || 'Daniel'
  const memories = memR.memories || []
  const sessions = sessR.sessions || []
  const skillsTotal = skillsR.total || 0
  const byType = data.memoryGraph?.byType || {}
  const recentSession = sessions[0] || data.memoryGraph?.recentSessions?.[0] || null

  // ── Activity Feed: merge memories + sessions, sort desc, group by day ──
  const events = []
  for (const s of sessions.slice(0, 15)) {
    events.push({
      kind: 'session',
      ts: s.started || s.startedAt || s.created_at || s.createdAt,
      title: s.session || s.name || s.id || 'session',
      desc: s.summary || '',
      project: s.project,
    })
  }
  for (const m of memories.slice(0, 25)) {
    events.push({
      kind: 'memory',
      ts: m.createdAt || m.created_at || m.updatedAt || m.updated_at,
      type: m.type || 'Fact',
      desc: m.context || '',
      id: m.id,
    })
  }
  events.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))
  const top = events.filter(e => e.ts).slice(0, 25)

  const groups = {}
  for (const e of top) {
    const k = dayGroup(e.ts)
    if (!groups[k]) groups[k] = []
    groups[k].push(e)
  }

  const activityRow = (e) => {
    if (e.kind === 'session') {
      const openSess = e.project
        ? `openProjectDetail('${escHtml(e.project)}')`
        : `location.hash='#/sessions'`
      return `<div class="activity-row" tabindex="0" role="button" aria-label="Session ${escHtml(e.title)}" onclick="${openSess}" ${KEY_CLICK}>
        <span class="activity-icon activity-icon-session">${HUB_ICONS.session}</span>
        <div class="activity-body">
          <div class="activity-title"><span class="activity-kind">Session</span> ${escHtml(e.title)}${e.project ? ` <span class="activity-tag">${escHtml(e.project)}</span>` : ''}</div>
          <div class="activity-desc">${escHtml((e.desc || 'session opened').slice(0, 110))}</div>
        </div>
        <span class="activity-time">${timeAgo(e.ts)}</span>
      </div>`
    }
    return `<div class="activity-row" tabindex="0" role="button" aria-label="${escHtml(e.type)} memory" onclick="openMemoryDetail('${escHtml(e.id)}')" ${KEY_CLICK}>
      <span class="activity-icon activity-icon-memory">${HUB_ICONS.memory}</span>
      <div class="activity-body">
        <div class="activity-title">${badge(e.type)} <span class="activity-context">${escHtml((e.desc || '').slice(0, 110))}</span></div>
      </div>
      <span class="activity-time">${timeAgo(e.ts)}</span>
    </div>`
  }

  const activityHtml = Object.entries(groups).map(([day, items]) => `
    <div class="activity-day">
      <div class="activity-day-label">${escHtml(day)}</div>
      ${items.map(activityRow).join('')}
    </div>
  `).join('') || '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">No recent activity yet.</p>'

  // ── Knowledge Snapshot ──
  const maxByType = Math.max(1, ...Object.values(byType))
  const snapshotHtml = Object.entries(byType).map(([t, c]) => `
    <div class="snapshot-row" tabindex="0" role="button" aria-label="Filter memories by ${escHtml(t)}" onclick="location.hash='#/memories/${encodeURIComponent(t)}'" ${KEY_CLICK}>
      <span class="snapshot-label">${badge(t)}</span>
      <div class="snapshot-bar"><div class="snapshot-bar-fill" style="width:${(c / maxByType) * 100}%"></div></div>
      <span class="snapshot-count">${c}</span>
    </div>
  `).join('') || '<p style="color:var(--text-muted);font-size:12px">No memories yet.</p>'

  // ── System Health ──
  const decayCount = health.decayCount ?? memories.filter(m => (m.confidence ?? 10) < 4).length
  const staleCount = health.staleCount ?? memories.filter(m => {
    const ts = m.updatedAt || m.updated_at || m.createdAt || m.created_at
    return ts && daysSince(ts) > 90
  }).length
  const reviewTotal = health.pendingReviews ?? ((review.memories?.length || 0) + (review.skills?.length || 0) +
    (review.components?.length || 0) + (review.proposals?.length || 0) + (review.dsScans?.length || 0))

  const dotClass = (n) => n === 0 ? 'health-dot-ok' : n <= 5 ? 'health-dot-warn' : 'health-dot-crit'

  const resumeDisabled = !recentSession
  const resumeProject = recentSession?.project
  const resumeTitle = recentSession
    ? `Resume: ${resumeProject || recentSession.session || recentSession.sessionName || recentSession.id || ''}${recentSession.summary ? ' — ' + recentSession.summary.slice(0, 60) : ''}`
    : 'No recent session yet'
  const resumeOnClick = resumeProject
    ? `openProjectDetail('${escHtml(resumeProject)}')`
    : recentSession ? `location.hash='#/sessions'` : ''

  pageEl.innerHTML = `
    <section class="hub-hero">
      <div class="hub-greeting-line">${escHtml(greetingLine(userName))}</div>

      <div class="hub-actions">
        <button class="hub-chip hub-chip-primary" onclick="openNewProjectModal()">
          <span class="hub-chip-icon">${HUB_ICONS.plus}</span>New project
        </button>
        <button class="hub-chip${resumeDisabled ? ' hub-chip-disabled' : ''}"
                ${resumeDisabled ? 'disabled' : `onclick="${resumeOnClick}"`}
                title="${escHtml(resumeTitle)}">
          <span class="hub-chip-icon">${HUB_ICONS.play}</span>Resume last session${resumeProject ? ` · <span style="opacity:.7">${escHtml(resumeProject)}</span>` : ''}
        </button>
        <button class="hub-chip" onclick="openQuickMemoryModal()">
          <span class="hub-chip-icon">${HUB_ICONS.plus}</span>Capture memory
        </button>
        <a class="hub-chip" href="#/skills">
          <span class="hub-chip-icon">${HUB_ICONS.skill}</span>Browse skills
        </a>
      </div>

      <div class="hub-kpi-row">
        <a class="hub-kpi hub-kpi-purple" href="#/memories">
          <span class="hub-kpi-icon">${HUB_ICONS.memory}</span>
          <div>
            <div class="hub-kpi-val">${health.memories || 0}</div>
            <div class="hub-kpi-label">Memories</div>
          </div>
        </a>
        <a class="hub-kpi hub-kpi-green" href="#/skills">
          <span class="hub-kpi-icon">${HUB_ICONS.skill}</span>
          <div>
            <div class="hub-kpi-val">${skillsTotal}</div>
            <div class="hub-kpi-label">Skills</div>
          </div>
        </a>
        <a class="hub-kpi hub-kpi-pink" href="#/sessions">
          <span class="hub-kpi-icon">${HUB_ICONS.session}</span>
          <div>
            <div class="hub-kpi-val">${health.activeSessions || 0}</div>
            <div class="hub-kpi-label">Active sessions</div>
          </div>
        </a>
      </div>
    </section>

    <section class="hub-grid">
      <div class="hub-col-main">
        <div class="card hub-activity">
          <div class="card-title">Recent activity <span class="count">${top.length}</span></div>
          ${activityHtml}
        </div>
      </div>
      <aside class="hub-col-side">
        <div class="card hub-snapshot">
          <div class="card-title">Memory by type</div>
          ${snapshotHtml}
        </div>
        <div class="card hub-health">
          <div class="card-title">System health</div>
          <div class="health-row" tabindex="0" role="button" aria-label="Decay alerts: ${decayCount}" onclick="location.hash='#/memories'" ${KEY_CLICK}>
            <span class="health-dot ${dotClass(decayCount)}"></span>
            <span class="health-row-label">Decay alerts <span class="health-row-hint">(conf &lt; 4)</span></span>
            <span class="health-row-val">${decayCount}</span>
          </div>
          <div class="health-row" data-health="review" tabindex="0" role="button" aria-label="Pending reviews: ${reviewTotal}" onclick="location.hash='#/review'" ${KEY_CLICK}>
            <span class="health-dot ${dotClass(reviewTotal)}"></span>
            <span class="health-row-label">Pending reviews</span>
            <span class="health-row-val">${reviewTotal}</span>
          </div>
          <div class="health-row" tabindex="0" role="button" aria-label="Stale memories: ${staleCount}" onclick="location.hash='#/memories'" ${KEY_CLICK}>
            <span class="health-dot ${dotClass(staleCount)}"></span>
            <span class="health-row-label">Stale memories <span class="health-row-hint">(&gt;90d)</span></span>
            <span class="health-row-val">${staleCount}</span>
          </div>
          <div class="health-footer">
            <span><strong>${formatUptime(health.uptime || 0)}</strong> uptime</span>
            <span><strong>${health.repos || 0}</strong> repos</span>
            <span><strong>${health.memoryEdges || 0}</strong> edges</span>
          </div>
        </div>
      </aside>
    </section>
  `

  document.getElementById('server-status').textContent = `${formatUptime(health.uptime || 0)} uptime`

  // Live refresh every 30s — auto-clears when user navigates away
  _hubRefreshTimer = setInterval(refreshHubLive, 30000)
}

// ── Skills ──

function skillsViewToggle(active) {
  return `
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="filter-btn ${active === 'catalog' ? 'active' : ''}" onclick="renderSkills()">Catalog</button>
      <button class="filter-btn ${active === 'health' ? 'active' : ''}" onclick="renderSkillsHealth()">Health</button>
    </div>
  `
}

// Visual confidence bar (1-10), colored by health.
function confidenceBar(conf) {
  if (conf == null) return ''
  const c = Math.max(1, Math.min(10, conf))
  const color = c >= 7 ? '#22c55e' : c >= 4 ? '#eab308' : '#ef4444'
  return `
    <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text-dim)">
      <div style="width:60px;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden">
        <div style="width:${c * 10}%;height:100%;background:${color}"></div>
      </div>
      <span style="font-variant-numeric:tabular-nums">${c}/10</span>
    </div>
  `
}

function usageBadge(s) {
  if (!s.usageCount) return ''
  return `<span style="font-size:10px;color:var(--text-dim);padding:1px 6px;border-radius:3px;background:rgba(255,255,255,0.04)">↻ ${s.usageCount} · ✓ ${s.usefulCount || 0}</span>`
}

export async function renderSkills(typeFilter) {
  const url = typeFilter ? `/api/skills?type=${typeFilter}` : `/api/skills`
  const data = await api.get(url)
  window.skillsCache = data.skills || []

  const types = ['domain', 'agent', 'command', 'lifecycle', 'process']

  // Group skills by category, sorted by count desc for visual hierarchy.
  const byCategory = new Map()
  for (const s of window.skillsCache) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, [])
    byCategory.get(s.category).push(s)
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)

  const cardHtml = (s) => `
    <div class="skill-card" style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border-subtle)'" onclick="openSkillDetail('${escHtml(s.name)}')">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
          <span style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.name)}</span>
          <span style="font-size:10px;color:var(--text-dim)">${badge(s.type)} · ${s.lines}L</span>
        </div>
        ${usageBadge(s)}
      </div>
      <div style="font-size:11px;color:var(--text-muted);line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escHtml(s.description)}</div>
      ${confidenceBar(s.confidence)}
      <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin-top:auto">
        <button class="btn-sm" onclick="event.stopPropagation();openSkillEditModal('${escHtml(s.name)}')" style="font-size:10px;padding:2px 8px">Edit</button>
        <button class="btn-sm" onclick="event.stopPropagation();viewSkillHistory('${escHtml(s.name)}')" style="font-size:10px;padding:2px 8px">History</button>
      </div>
    </div>
  `

  document.getElementById('page').innerHTML = `
    <div class="section-title">Skills Catalog <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">${data.total} total</span></div>

    ${skillsViewToggle('catalog')}

    <div class="filters">
      <button class="filter-btn ${!typeFilter ? 'active' : ''}" onclick="renderSkills()">All</button>
      ${types.map(t => `<button class="filter-btn ${typeFilter === t ? 'active' : ''}" onclick="renderSkills('${t}')">${t}</button>`).join('')}
    </div>

    ${categories.map(([cat, skills]) => `
      <div style="margin:18px 0 6px;display:flex;align-items:baseline;gap:10px">
        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin:0">${escHtml(cat)}</h3>
        <span style="font-size:11px;color:var(--text-dim)">${skills.length}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
        ${skills.map(cardHtml).join('')}
      </div>
    `).join('')}
  `
}

// Edit modal — admin only. Loads current content, lets edit metadata + content,
// PUTs to /api/skills/:name. The dashboard already protects admin endpoints
// upstream so the modal only opens for authenticated admins.
export async function openSkillEditModal(name) {
  const skill = await api.get(`/api/skills/${encodeURIComponent(name)}`)
  if (skill.error) { alert(skill.error); return }
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px'
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:20px;width:min(720px,100%);max-height:90vh;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:16px">Edit ${escHtml(skill.name)}</h3>
        <button class="btn-sm" onclick="this.closest('div[style*=fixed]').remove()" style="font-size:11px">✕ Close</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-muted)">
          Category
          <input id="edit-skill-category" type="text" value="${escHtml(skill.category)}" style="padding:6px 8px;background:var(--bg-input,#0a0a14);border:1px solid var(--border-subtle);border-radius:4px;color:var(--text);font-size:13px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-muted)">
          Tags (comma-separated)
          <input id="edit-skill-tags" type="text" value="${escHtml((skill.tags || []).join(', '))}" style="padding:6px 8px;background:var(--bg-input,#0a0a14);border:1px solid var(--border-subtle);border-radius:4px;color:var(--text);font-size:13px">
        </label>
      </div>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-muted)">
        Description
        <textarea id="edit-skill-description" rows="3" style="padding:6px 8px;background:var(--bg-input,#0a0a14);border:1px solid var(--border-subtle);border-radius:4px;color:var(--text);font-size:13px;resize:vertical;font-family:inherit">${escHtml(skill.description)}</textarea>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-muted);flex:1;min-height:0">
        Content (Markdown)
        <textarea id="edit-skill-content" style="padding:8px;background:var(--bg-input,#0a0a14);border:1px solid var(--border-subtle);border-radius:4px;color:var(--text);font-size:12px;font-family:'SF Mono',Monaco,monospace;resize:vertical;height:320px">${escHtml(skill.content)}</textarea>
      </label>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
        <button class="btn-sm" onclick="saveSkillEdit('${escHtml(skill.name)}')" style="font-size:12px;padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer">Save</button>
        <button class="btn-sm" onclick="deleteSkill('${escHtml(skill.name)}')" style="font-size:11px;color:#ef4444;background:transparent;border:1px solid #ef4444;padding:4px 10px;border-radius:4px;cursor:pointer">Deprecate</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
}

export async function saveSkillEdit(name) {
  const body = {
    category: document.getElementById('edit-skill-category').value.trim(),
    description: document.getElementById('edit-skill-description').value.trim(),
    content: document.getElementById('edit-skill-content').value,
    tags: document.getElementById('edit-skill-tags').value
      .split(',').map((t) => t.trim()).filter(Boolean),
  }
  const result = await api.put(`/api/skills/${encodeURIComponent(name)}`, body)
  if (result.error) { alert('Save failed: ' + result.error); return }
  document.querySelector('div[style*=fixed]')?.remove()
  await renderSkills()
}

export async function deleteSkill(name) {
  if (!confirm(`Deprecate skill "${name}"? It will be hidden from suggestions but versioning is preserved.`)) return
  const result = await api.del(`/api/skills/${encodeURIComponent(name)}`)
  if (result.error) { alert('Delete failed: ' + result.error); return }
  document.querySelector('div[style*=fixed]')?.remove()
  await renderSkills()
}

// ── Skills Health (autolearning dashboard) ──
// Surfaces /api/skills/health which aggregates skill_usage telemetry,
// confidence trends, and at-risk/dead detection. Until autolearning was
// wired up (Steps 1-4), all these arrays were empty. Now they fill.

export async function renderSkillsHealth() {
  const h = await api.get('/api/skills/health')

  const list = (rows, valueKey = 'count') => rows && rows.length
    ? rows.map(r => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-subtle)">
          <a href="#" onclick="event.preventDefault();openSkillDetail('${escHtml(r.skillName || r.name)}')" style="color:var(--text);text-decoration:none">${escHtml(r.skillName || r.name)}</a>
          <span style="color:var(--text-muted);font-variant-numeric:tabular-nums">${r[valueKey] ?? r.count ?? ''}</span>
        </div>
      `).join('')
    : `<div style="color:var(--text-dim);font-size:12px;padding:8px 0">— no data yet —</div>`

  const atRiskList = (rows) => rows && rows.length
    ? rows.map(r => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-subtle)">
          <a href="#" onclick="event.preventDefault();openSkillDetail('${escHtml(r.name)}')" style="color:var(--text);text-decoration:none">${escHtml(r.name)}</a>
          <span style="color:var(--text-muted);font-size:11px">conf:${r.confidence} · stale:${r.sessionsStale}</span>
        </div>
      `).join('')
    : `<div style="color:var(--text-dim);font-size:12px;padding:8px 0">— all skills healthy —</div>`

  const cooccList = (rows) => rows && rows.length
    ? rows.map(r => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-subtle);font-size:13px">
          <span>${escHtml(r.skillA)} ↔ ${escHtml(r.skillB)}</span>
          <span style="color:var(--text-muted)">${r.cooccurrenceCount}</span>
        </div>
      `).join('')
    : `<div style="color:var(--text-dim);font-size:12px;padding:8px 0">— no cooccurrence signal yet —</div>`

  const panel = (title, body, hint) => `
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:14px;min-height:140px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:10px">${title}</div>
      ${body}
      ${hint ? `<div style="font-size:10px;color:var(--text-dim);margin-top:8px;font-style:italic">${hint}</div>` : ''}
    </div>
  `

  document.getElementById('page').innerHTML = `
    <div class="section-title">Skills Health
      <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">autolearning telemetry &middot; last 7 days</span>
    </div>

    ${skillsViewToggle('health')}

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px">
      ${panel('Top Routed (7d)', list(h.topRouted), 'skills proposed by skill_route')}
      ${panel('Top Loaded (7d)', list(h.topLoaded), 'skills opened via skill_read')}
      ${panel('Top Applied (7d)', list(h.topApplied), 'memories saved with skill:* tag')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      ${panel('⚠ At Risk', atRiskList(h.atRiskSkills), 'low confidence + many stale sessions — re-validate or deprecate')}
      ${panel('💀 Dead Skills (30d)', list(h.deadSkills), 'routed but never loaded — likely noise or wrong description')}
    </div>

    ${panel('🔁 Top Cooccurrences', cooccList(h.topCooccurrences), 'skills frequently used together in the same session — drives "you might also need" suggestions')}
  `
}

export async function searchSkills(q) {
  const data = await api.get(`/api/skills?search=${encodeURIComponent(q)}`)
  const skills = data.skills || []

  document.getElementById('page').innerHTML = `
    <div class="section-title">Search: "${q}" <span class="count">${skills.length} results</span></div>
    <div class="item-list">
      ${skills.map(s => `
        <div class="item" onclick="openSkillDetail('${s.name}')">
          <div class="item-header">
            <span class="item-name">${badge(s.type)} ${s.name}</span>
            <span class="item-meta">${s.lines} lines</span>
          </div>
          <div class="item-desc">${escHtml(s.description)}</div>
        </div>
      `).join('')}
    </div>
  `
}

export async function openSkillDetail(name, openDetailFn) {
  const skill = await api.get(`/api/skills/${encodeURIComponent(name)}`)
  if (skill.error) { openDetailFn(name, `<p style="color:var(--red)">${skill.error}</p>`); return }

  openDetailFn(skill.name, `
    <div style="margin-bottom:12px">
      ${badge(skill.type)} <span style="color:var(--text-muted)">${skill.category} &middot; ${skill.lines} lines</span>
    </div>
    ${tagsHtml(skill.tags)}
    <div style="margin-top:16px">${simpleMarkdown(skill.content)}</div>
  `)
}

// ── Memories ──

export async function renderMemories(typeFilter, scopeFilter) {
  let url = `/api/memories?limit=100`
  if (typeFilter) url += `&type=${typeFilter}`
  if (scopeFilter === 'mine') {
    url += `&mine=true`
  } else if (scopeFilter) {
    url += `&scope=${scopeFilter}`
  }
  const data = await api.get(url)
  window.memoriesCache = data.memories || []

  const types = ['Pattern', 'BugFix', 'AntiPattern', 'Fact', 'Decision', 'Preference', 'Goal', 'Todo']
  const scopes = [{ val: '', label: 'All' }, { val: 'mine', label: 'My memories' }, { val: 'team', label: 'Team' }, { val: 'project', label: 'Project' }]

  document.getElementById('page').innerHTML = `
    <div class="section-title">Memory Explorer <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">${data.total} total</span></div>

    <div class="filters">
      <button class="filter-btn ${!typeFilter ? 'active' : ''}" onclick="renderMemories(null, '${scopeFilter||''}')">All types</button>
      ${types.map(t => `<button class="filter-btn ${typeFilter === t ? 'active' : ''}" onclick="renderMemories('${t}', '${scopeFilter||''}')">${t}</button>`).join('')}
    </div>
    <div class="filters" style="margin-top:4px">
      ${scopes.map(s => `<button class="filter-btn ${(scopeFilter||'') === s.val ? 'active' : ''}" onclick="renderMemories('${typeFilter||''}', '${s.val}')">${s.label}</button>`).join('')}
    </div>

    <div class="item-list">
      ${window.memoriesCache.map(m => `
        <div class="item" onclick="openMemoryDetail('${m.id}')">
          <div class="item-header">
            <span class="item-name">${badge(m.type)} ${m.id}</span>
            <span class="item-meta">${confBar(m.confidence)}</span>
          </div>
          <div class="item-desc">${escHtml(m.context)}</div>
          <div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${m.skill || ''} ${m.scope && m.scope !== 'team' && m.scope !== 'global' ? `&middot; <span style="color:var(--blue)">${m.scope}</span>` : ''}</div>
          ${tagsHtml(m.tags)}
        </div>
      `).join('')}
    </div>
  `
}

export async function searchMemories(q) {
  const data = await api.get(`/api/memories?search=${encodeURIComponent(q)}`)
  const memories = data.memories || []

  document.getElementById('page').innerHTML = `
    <div class="section-title">Search: "${q}" <span class="count">${memories.length} results</span></div>
    <div class="item-list">
      ${memories.map(m => `
        <div class="item" onclick="openMemoryDetail('${m.id}')">
          <div class="item-header">
            <span class="item-name">${badge(m.type)} ${m.id}</span>
            <span class="item-meta">${confBar(m.confidence)}</span>
          </div>
          <div class="item-desc">${escHtml(m.context)}</div>
        </div>
      `).join('')}
    </div>
  `
}

export async function openMemoryDetail(id, openDetailFn) {
  const m = await api.get(`/api/memories/${encodeURIComponent(id)}`)
  if (m.error) { openDetailFn(id, `<p style="color:var(--red)">${m.error}</p>`); return }

  const edges = m.edges || []

  openDetailFn(m.id, `
    <div style="margin-bottom:12px">
      ${badge(m.type)} ${confBar(m.confidence)}
      <span style="color:var(--text-muted);font-size:11px;margin-left:8px">${m.skill || ''} &middot; ${m.scope}</span>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button onclick="deprecateMemory('${m.id}')" style="padding:4px 12px;border-radius:6px;background:rgba(245,158,11,.1);border:1px solid var(--yellow);color:var(--yellow);font-size:11px;cursor:pointer">Deprecate</button>
      <button onclick="deleteMemory('${m.id}')" style="padding:4px 12px;border-radius:6px;background:rgba(248,113,113,.1);border:1px solid var(--red);color:var(--red);font-size:11px;cursor:pointer">Delete</button>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="card-title">Context</div>
      <p>${escHtml(m.context)}</p>
    </div>

    <div class="card">
      <div class="card-title">Problem</div>
      <p>${escHtml(m.problem)}</p>
    </div>

    <div class="card">
      <div class="card-title">Solution</div>
      <p>${escHtml(m.solution)}</p>
    </div>

    <div class="card">
      <div class="card-title">Reason</div>
      <p>${escHtml(m.reason)}</p>
    </div>

    ${tagsHtml(m.tags)}

    ${edges.length ? `
    <div class="card" style="margin-top:12px">
      <div class="card-title">Edges <span class="count">${edges.length}</span></div>
      ${edges.map(e => `
        <div class="row">
          <span class="row-label">${badge(e.type)} ${e.sourceId === m.id ? e.targetId : e.sourceId}</span>
          <span class="row-val" style="font-size:11px">${e.reason || ''}</span>
        </div>
      `).join('')}
    </div>` : ''}

    <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">
      Created: ${m.createdAt?.split('T')[0] || '?'} &middot;
      Updated: ${m.updatedAt?.split('T')[0] || '?'} &middot;
      Sessions since validation: ${m.sessionsSinceValidation || 0}
    </div>
  `)
}

// ── Sessions ──

export async function renderSessions() {
  const data = await api.get('/api/sessions')
  const sessions = data.sessions || []

  document.getElementById('page').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="section-title" style="margin-bottom:0">Session History <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">${sessions.length} sessions</span></div>
      <button onclick="cleanupDuplicates()" style="padding:6px 12px;border-radius:6px;background:rgba(245,158,11,.1);border:1px solid var(--yellow);color:var(--yellow);font-size:12px;cursor:pointer">Cleanup Duplicates</button>
    </div>

    ${sessions.length === 0 ? '<p style="color:var(--text-muted);font-size:13px">No sessions recorded yet.</p>' : ''}

    <div class="timeline">
      ${sessions.map(s => `
        <div class="timeline-item">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div class="timeline-name">${s.sessionName}</div>
            <button onclick="event.stopPropagation();deleteSession('${s.id}')" style="padding:2px 8px;border-radius:4px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.3);color:var(--red);font-size:10px;cursor:pointer">Delete</button>
          </div>
          <div class="timeline-date">${s.startedAt?.replace('T',' ').slice(0,16) || '?'}${s.endedAt ? ' — ' + s.endedAt.replace('T',' ').slice(11,16) : ' (running)'}</div>
          <div class="timeline-summary">${s.summary || 'No summary'}</div>
          <div class="timeline-stats">+${s.memoriesCreated || 0} memories${s.project ? ' &middot; ' + s.project : ''}${s.status ? ' &middot; ' + s.status : ''}</div>
        </div>
      `).join('')}
    </div>
  `
}

// ── Projects v2 ──

const ALLOWED_VIEWS = new Set(['grid', 'list', 'kanban', 'table'])
const ALLOWED_SORTS = new Set([
  'lastActivity-desc', 'lastActivity-asc',
  'name-asc', 'name-desc',
  'status-asc', 'status-desc',
  'sessions-desc', 'sessions-asc',
  'memories-desc', 'memories-asc',
  'created-desc', 'created-asc',
  'client-asc', 'client-desc',
  'category-asc', 'category-desc',
])
const ALLOWED_GROUPS = new Set(['none', 'client', 'status', 'category'])
const ALLOWED_STATUSES = new Set(['active', 'paused', 'completed', 'archived'])

function escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function safeUrl(url) {
  if (typeof url !== 'string' || !url) return null
  // Allow only http(s) and protocol-relative; reject javascript:, data:, vbscript:, etc.
  if (/^(https?:)?\/\//i.test(url)) return url
  return null
}

const CATEGORY_ICONS = {
  landing: '🚀', ecommerce: '🛒', app: '📱', dashboard: '📊',
  'corporate-site': '💼', blog: '📝', portfolio: '🎨', other: '📦',
}
const STATUS_COLORS_V2 = {
  active: 'var(--green)', paused: 'var(--yellow)', completed: 'var(--blue)',
  archived: 'var(--text-muted)', 'in-progress': 'var(--blue)', blocked: 'var(--red)',
  unknown: 'var(--text-muted)',
}

function projectState(p) {
  const last = p.lastSession
  // Phase 2: server-side hasBlockers + isStale flags are authoritative when present
  if (p._summary?.hasBlockers || last?.blockers) return 'blocked'
  if (!p._meta?.category) return 'setup'
  if (p._summary?.isStale === true) return 'stale'
  if (p._summary?.isStale === false) return ''  // server says "fresh"
  // Fallback (no server summary): client-side rule
  if (last?.date) {
    const days = (Date.now() - new Date(last.date).getTime()) / 86400000
    if (days > 30) return 'stale'
  } else if (p.totalSessions === 0) {
    return 'stale'
  }
  return ''
}

// Projects v2 "time ago" variant — distinct from the module-scope `timeAgo`
// (which returns '' for null). This one returns 'never' so the stats row reads
// naturally ("0 sess · 0 mem · never").
function timeAgoV2(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (isNaN(d)) return 'never'
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec/60)}min ago`
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`
  if (sec < 604800) return `${Math.floor(sec/86400)}gg fa`
  if (sec < 2592000) return `${Math.floor(sec/604800)}w fa`
  return `${Math.floor(sec/2592000)}mo fa`
}

function renderCardGrid(p) {
  const s = getProjectsState()
  const m = p._meta || {}
  const status = m.status || p.lastSession?.status || 'unknown'
  const statusColor = STATUS_COLORS_V2[status] || 'var(--text-muted)'
  const displayName = m.displayName || p.name
  const stateClass = projectState(p)
  const stateBadge = stateClass === 'stale' ? '<span class="proj-card-badge badge-stale">Stale</span>'
    : stateClass === 'setup' ? '<span class="proj-card-badge badge-setup">Setup</span>' : ''
  const catIcon = m.category ? CATEGORY_ICONS[m.category] || '📦' : ''
  const stack = m.stack || []
  const visibleStack = stack.slice(0, 3)
  const moreStack = stack.length > 3 ? stack.length - 3 : 0
  const isPinned = s.pinned.has(p.name)
  const isSelected = s.selection.has(p.name)
  const onCardClick = `if(event.target.closest('.proj-card-actions,.proj-card-pin,.proj-card-select,.proj-menu-pop'))return;openProjectDetail('${escAttr(p.name)}')`

  return `<div class="proj-card-v2 ${stateClass ? 'state-'+stateClass : ''} ${isSelected ? 'selected' : ''}"
    role="button" tabindex="0"
    data-name="${escAttr(p.name)}" onclick="${onCardClick}"
    onkeydown="if(event.target.closest('.proj-card-actions,.proj-card-pin,.proj-card-select,.proj-menu-pop'))return;if(event.key==='Enter'){event.preventDefault();this.click()}else if(event.key===' '){event.preventDefault()}">
    <input type="checkbox" class="proj-card-select" ${isSelected ? 'checked' : ''}
      aria-label="Select ${escAttr(displayName)}"
      onclick="event.stopPropagation();toggleProjectSelection('${escAttr(p.name)}',this.checked)">
    <div class="proj-card-row1">
      <button class="proj-card-pin ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin'}"
        aria-label="${isPinned ? 'Unpin' : 'Pin'} ${escAttr(displayName)}"
        onclick="event.stopPropagation();toggleProjectPin('${escAttr(p.name)}')">${isPinned ? '★' : '☆'}</button>
      <span class="status-dot" style="background:${statusColor}" title="${escAttr(status)}"></span>
      <span class="name" title="${escAttr(displayName)}">${escHtml(displayName)}</span>
      ${stateBadge}
      ${(() => { const u = safeUrl(m.liveUrl); return u ? `<a class="live" href="${escAttr(u)}" target="_blank" rel="noopener" title="Open live site" onclick="event.stopPropagation()">↗</a>` : '' })()}
      <div class="proj-card-actions" style="position:relative">
        <button class="menu-btn" title="More actions" aria-label="More actions for ${escAttr(displayName)}"
          onclick="event.stopPropagation();toggleCardMenu('${escAttr(p.name)}',this)">⋯</button>
      </div>
    </div>
    <div class="proj-card-meta">
      ${catIcon ? `<span class="cat-icon" aria-hidden="true">${catIcon}</span>` : ''}
      ${m.category ? `<span>${escHtml(m.category)}</span>` : ''}
      ${m.category && m.clientName ? '<span class="sep">·</span>' : ''}
      ${m.clientName ? `<span>${escHtml(m.clientName)}</span>` : ''}
    </div>
    <div class="proj-card-stats">
      ${p.totalSessions || 0} sess · ${p.totalMemories || 0} mem · ${escHtml(timeAgoV2(p.lastSession?.date))}
    </div>
    ${p.lastSession?.blockers ? `<div class="proj-card-blocker">⚠ ${escHtml(p.lastSession.blockers)}</div>` : ''}
    ${p.lastSession?.nextSteps && !p.lastSession?.blockers ? `<div class="proj-card-next">▌ ${escHtml(p.lastSession.nextSteps)}</div>` : ''}
    ${visibleStack.length ? `<div class="proj-card-chips">
      ${visibleStack.map(t => `<span class="proj-card-chip">${escHtml(t)}</span>`).join('')}
      ${moreStack ? `<span class="proj-card-chip more">+${moreStack}</span>` : ''}
    </div>` : ''}
  </div>`
}

function renderGridView() {
  const s = getProjectsState()
  const el = document.getElementById('proj-body')
  if (!el) return
  if (s.filtered.length === 0) { renderEmptyState(el); return }
  // Exclude pinned from main grid (already shown above)
  const main = s.filtered.filter(p => !s.pinned.has(p.name))
  if (main.length === 0) { el.innerHTML = ''; return }
  if (s.group === 'none') {
    el.innerHTML = `<div class="proj-grid">${main.map(renderCardGrid).join('')}</div>`
  } else {
    el.innerHTML = renderGroupedView(main, renderCardGrid, 'proj-grid')
  }
}

function renderGroupedView(items, renderItem, wrapperClass) {
  const s = getProjectsState()
  const groups = {}
  for (const p of items) {
    let key
    if (s.group === 'client') key = p._meta?.clientName || '(No client)'
    else if (s.group === 'status') key = p._meta?.status || p.lastSession?.status || '(unknown)'
    else if (s.group === 'category') key = p._meta?.category || '(No category)'
    else key = ''
    if (!groups[key]) groups[key] = []
    groups[key].push(p)
  }
  const keys = Object.keys(groups).sort()
  return keys.map(k => `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;padding:0 4px">
        ${escHtml(k)} <span style="color:var(--text-muted)">(${groups[k].length})</span>
      </div>
      <div class="${wrapperClass}">${groups[k].map(renderItem).join('')}</div>
    </div>
  `).join('')
}

function renderEmptyState(el) {
  el.innerHTML = `
    <div style="text-align:center;padding:60px 20px;background:var(--card);border:1px dashed var(--border);border-radius:10px">
      <div style="font-size:32px;margin-bottom:12px" aria-hidden="true">📂</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">No projects match</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">Try clearing filters or create a new project.</div>
      <button class="proj-new-btn" onclick="openNewProjectModal()">+ New Project</button>
    </div>
  `
}

function renderProjectsEmptyZero(el) {
  el.innerHTML = `
    <div style="text-align:center;padding:80px 20px;background:var(--card);border:1px dashed var(--border);border-radius:10px">
      <div style="font-size:40px;margin-bottom:14px" aria-hidden="true">🌱</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:6px">No projects yet</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px">Get started in seconds.</div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="proj-new-btn" onclick="openNewProjectModal()">+ New Project</button>
        <button disabled title="Coming in Phase 2" style="padding:7px 14px;border-radius:6px;background:none;border:1px solid var(--border);color:var(--text-muted);font-size:12px;cursor:not-allowed">📂 Import from folder</button>
        <button disabled title="Coming in Phase 2" style="padding:7px 14px;border-radius:6px;background:none;border:1px solid var(--border);color:var(--text-muted);font-size:12px;cursor:not-allowed">📋 Browse templates</button>
      </div>
    </div>
  `
}

// Body dispatcher
function renderProjectsBody() {
  const s = getProjectsState()
  const el = document.getElementById('proj-body')
  if (!el) return
  if (s.merged.length === 0) {
    renderProjectsEmptyZero(el)
    renderProjectsBulk()
    return
  }
  if (s.view === 'list') renderListView()
  else if (s.view === 'kanban') renderKanbanView()
  else if (s.view === 'table') renderTableView()
  else renderGridView() // default + grid
  renderProjectsBulk()
}

function renderProjectsBulk() {
  const s = getProjectsState()
  const el = document.getElementById('proj-bulk')
  if (!el) return
  if (s.selection.size === 0) { el.innerHTML = ''; return }
  el.innerHTML = `
    <div class="proj-bulk-toolbar" role="region" aria-label="Bulk actions">
      <span class="proj-bulk-counter">${s.selection.size} selected</span>
      <select aria-label="Set status for selected" onchange="bulkSetStatus(this.value);this.value=''">
        <option value="">Set status…</option>
        <option value="active">→ Active</option>
        <option value="paused">→ Paused</option>
        <option value="completed">→ Completed</option>
        <option value="archived">→ Archived</option>
      </select>
      <button type="button" onclick="bulkArchive()">📦 Archive</button>
      <button type="button" class="danger" onclick="bulkDelete()">✕ Delete</button>
      <button type="button" class="cancel" onclick="bulkCancel()">Cancel</button>
    </div>
  `
}

function renderListView() {
  const s = getProjectsState()
  const el = document.getElementById('proj-body')
  if (!el) return
  if (s.filtered.length === 0) { renderEmptyState(el); return }
  const main = s.filtered.filter(p => !s.pinned.has(p.name))
  if (main.length === 0) { el.innerHTML = ''; return }
  if (s.group !== 'none') {
    el.innerHTML = renderGroupedView(main, renderListRow, 'proj-list')
  } else {
    el.innerHTML = `<div class="proj-list">${main.map(renderListRow).join('')}</div>`
  }
}

function renderListRow(p) {
  const s = getProjectsState()
  const m = p._meta || {}
  const status = m.status || p.lastSession?.status || 'unknown'
  const statusColor = STATUS_COLORS_V2[status] || 'var(--text-muted)'
  const displayName = m.displayName || p.name
  const isPinned = s.pinned.has(p.name)
  const isSelected = s.selection.has(p.name)
  const stack = (m.stack || []).slice(0, 2)
  const liveUrl = safeUrl(m.liveUrl)
  const onClick = `if(event.target.closest('input,button,a,.proj-menu-pop'))return;openProjectDetail('${escAttr(p.name)}')`
  return `<div class="proj-list-row ${isSelected ? 'selected' : ''}"
    role="button" tabindex="0"
    data-name="${escAttr(p.name)}" onclick="${onClick}"
    onkeydown="if(event.target.closest('input,button,a,.proj-menu-pop'))return;if(event.key==='Enter'){event.preventDefault();this.click()}else if(event.key===' '){event.preventDefault()}">
    <input type="checkbox" ${isSelected ? 'checked' : ''}
      aria-label="Select ${escAttr(displayName)}"
      onclick="event.stopPropagation();toggleProjectSelection('${escAttr(p.name)}',this.checked)">
    <span class="dot" style="background:${statusColor}" aria-hidden="true"></span>
    <span class="name">
      <button class="proj-card-pin ${isPinned ? 'pinned' : ''}" style="margin-right:4px"
        aria-label="${isPinned ? 'Unpin' : 'Pin'} ${escAttr(displayName)}"
        onclick="event.stopPropagation();toggleProjectPin('${escAttr(p.name)}')">${isPinned ? '★' : '☆'}</button>
      ${escHtml(displayName)}
    </span>
    <span class="col client">${escHtml(m.clientName || '')}</span>
    <span class="col cat">${m.category ? `${CATEGORY_ICONS[m.category] || ''} ${escHtml(m.category)}` : ''}</span>
    <span class="col status" style="color:${statusColor}">${escHtml(status)}</span>
    <span class="col">${p.totalSessions || 0} sess</span>
    <span class="col last">${escHtml(timeAgoV2(p.lastSession?.date))}</span>
    <span class="chips">${stack.map(t => `<span class="proj-card-chip">${escHtml(t)}</span>`).join('')}</span>
    <span class="actions">
      ${liveUrl ? `<a href="${escAttr(liveUrl)}" target="_blank" rel="noopener" style="color:var(--text-muted);text-decoration:none;padding:2px 4px" onclick="event.stopPropagation()" aria-label="Open live site">↗</a>` : ''}
      <button class="menu-btn" aria-label="More actions for ${escAttr(displayName)}"
        onclick="event.stopPropagation();toggleCardMenu('${escAttr(p.name)}',this)">⋯</button>
    </span>
  </div>`
}

function renderKanbanView() {
  const s = getProjectsState()
  const el = document.getElementById('proj-body')
  if (!el) return
  if (s.filtered.length === 0) { renderEmptyState(el); return }
  const cols = ['active', 'paused', 'completed', 'archived']
  const grouped = { active: [], paused: [], completed: [], archived: [] }
  for (const p of s.filtered) {
    if (s.pinned.has(p.name)) continue
    const st = p._meta?.status || p.lastSession?.status
    if (grouped[st]) grouped[st].push(p)
    else grouped.active.push(p) // fallback: unknown statuses go into active
  }
  const archivedCollapsed = !s.filters.showArchived
  el.innerHTML = `<div class="proj-kanban">
    ${cols.map(c => `
      <div class="proj-kanban-col ${c === 'archived' && archivedCollapsed ? 'collapsed' : ''}"
        data-status="${escAttr(c)}" ondragover="kanbanDragOver(event,this)" ondragleave="kanbanDragLeave(this)" ondrop="kanbanDrop(event,this)">
        <div class="proj-kanban-col-header">
          <span class="proj-kanban-col-title">
            <span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${STATUS_COLORS_V2[c]}" aria-hidden="true"></span>
            ${escHtml(c)} <span class="proj-kanban-col-count">${grouped[c].length}</span>
          </span>
          ${c === 'archived' ? `<button class="proj-kanban-col-toggle" aria-label="${archivedCollapsed ? 'Expand archived' : 'Collapse archived'}"
            onclick="this.closest('.proj-kanban-col').classList.toggle('collapsed')">${archivedCollapsed ? '▸' : '▾'}</button>` : ''}
        </div>
        ${grouped[c].map(renderKanbanCard).join('')}
      </div>`).join('')}
  </div>`
}

function renderKanbanCard(p) {
  const m = p._meta || {}
  const displayName = m.displayName || p.name
  const catIcon = m.category ? CATEGORY_ICONS[m.category] || '📦' : ''
  return `<div class="proj-kanban-card" draggable="true"
    role="button" tabindex="0"
    data-name="${escAttr(p.name)}"
    ondragstart="kanbanDragStart(event,this)"
    ondragend="kanbanDragEnd(this)"
    onclick="if(event.target.closest('button,a'))return;openProjectDetail('${escAttr(p.name)}')"
    onkeydown="if(event.target.closest('button,a'))return;if(event.key==='Enter'){event.preventDefault();this.click()}else if(event.key===' '){event.preventDefault()}">
    <div class="k-name">
      ${catIcon ? `<span aria-hidden="true">${catIcon}</span>` : ''} ${escHtml(displayName)}
    </div>
    <div class="k-meta">
      ${m.clientName ? escHtml(m.clientName) + ' · ' : ''}${p.totalSessions || 0} sess · ${escHtml(timeAgoV2(p.lastSession?.date))}
    </div>
  </div>`
}
const TABLE_COLS = [
  { key: '_check',       label: '',              sortable: false, width: '30px' },
  { key: 'name',         label: 'Name',          sortable: true },
  { key: 'client',       label: 'Client',        sortable: true },
  { key: 'category',     label: 'Category',      sortable: true },
  { key: 'status',       label: 'Status',        sortable: true },
  { key: 'sessions',     label: 'Sessions',      sortable: true },
  { key: 'memories',     label: 'Memories',      sortable: true },
  { key: 'lastActivity', label: 'Last activity', sortable: true },
  { key: 'stack',        label: 'Stack',         sortable: false },
  { key: 'domain',       label: 'Domain',        sortable: false },
  { key: '_actions',     label: '',              sortable: false },
]

function renderTableView() {
  const s = getProjectsState()
  const el = document.getElementById('proj-body')
  if (!el) return
  if (s.filtered.length === 0) { renderEmptyState(el); return }
  const main = s.filtered.filter(p => !s.pinned.has(p.name))
  if (main.length === 0) { el.innerHTML = ''; return }
  const [sortField, sortDir] = s.sort.split('-')
  el.innerHTML = `
    <div class="proj-table-wrap">
      <table class="proj-table">
        <thead><tr>
          ${TABLE_COLS.map(c => {
            const isSorted = c.sortable && c.key === sortField
            const arrow = isSorted ? (sortDir === 'desc' ? '↓' : '↑') : ''
            const attrs = [
              c.width ? `style="width:${c.width}"` : '',
              c.sortable ? `class="${isSorted ? 'sorted' : ''}" onclick="sortTableByCol('${c.key}')" role="button" tabindex="0"
                onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sortTableByCol('${c.key}')}" aria-sort="${isSorted ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}"` : '',
            ].filter(Boolean).join(' ')
            return `<th ${attrs}>${escHtml(c.label)}${arrow ? `<span class="arrow" aria-hidden="true">${arrow}</span>` : ''}</th>`
          }).join('')}
        </tr></thead>
        <tbody>
          ${main.map(renderTableRow).join('')}
        </tbody>
      </table>
    </div>
  `
}

function renderTableRow(p) {
  const s = getProjectsState()
  const m = p._meta || {}
  const status = m.status || p.lastSession?.status || 'unknown'
  const statusColor = STATUS_COLORS_V2[status] || 'var(--text-muted)'
  const isSelected = s.selection.has(p.name)
  const isPinned = s.pinned.has(p.name)
  const stack = (m.stack || []).slice(0, 3).map(t => `<span class="proj-card-chip">${escHtml(t)}</span>`).join('')
  const liveUrl = safeUrl(m.liveUrl)
  const onClick = `if(event.target.closest('input,button,a'))return;openProjectDetail('${escAttr(p.name)}')`
  return `<tr class="${isSelected ? 'selected' : ''}" data-name="${escAttr(p.name)}" onclick="${onClick}">
    <td><input type="checkbox" ${isSelected ? 'checked' : ''}
      aria-label="Select ${escAttr(m.displayName || p.name)}"
      onclick="event.stopPropagation();toggleProjectSelection('${escAttr(p.name)}',this.checked)"></td>
    <td class="name">
      <button class="proj-card-pin ${isPinned ? 'pinned' : ''}" style="margin-right:4px"
        aria-label="${isPinned ? 'Unpin' : 'Pin'} ${escAttr(m.displayName || p.name)}"
        onclick="event.stopPropagation();toggleProjectPin('${escAttr(p.name)}')">${isPinned ? '★' : '☆'}</button>
      ${escHtml(m.displayName || p.name)}
    </td>
    <td>${escHtml(m.clientName || '')}</td>
    <td>${m.category ? `${CATEGORY_ICONS[m.category] || ''} ${escHtml(m.category)}` : ''}</td>
    <td><span class="dot" style="background:${statusColor}" aria-hidden="true"></span>${escHtml(status)}</td>
    <td>${p.totalSessions || 0}</td>
    <td>${p.totalMemories || 0}</td>
    <td>${escHtml(timeAgoV2(p.lastSession?.date))}</td>
    <td><span style="display:flex;gap:3px">${stack}</span></td>
    <td>${escHtml(m.domainPrimary || '')}</td>
    <td style="text-align:right;white-space:nowrap;position:relative">
      ${liveUrl ? `<a href="${escAttr(liveUrl)}" target="_blank" rel="noopener" style="color:var(--text-muted);text-decoration:none;margin-right:4px" onclick="event.stopPropagation()" aria-label="Open live site">↗</a>` : ''}
      <button class="menu-btn" aria-label="More actions for ${escAttr(m.displayName || p.name)}"
        style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 4px"
        onclick="event.stopPropagation();toggleCardMenu('${escAttr(p.name)}',this)">⋯</button>
    </td>
  </tr>`
}

function getProjectsState() {
  if (!window._projectsState) {
    const def = {
      merged: [],
      filtered: [],
      view: 'grid',
      filters: { status: [], category: [], client: [], stack: [], showArchived: false, search: '' },
      sort: 'lastActivity-desc',
      group: 'none',
      pinned: new Set(),
      selection: new Set(),
      detailIndex: -1,
    }
    // Hydrate from localStorage (per-key isolation: malformed key doesn't break others)
    const v = localStorage.getItem('synapse.projects.view')
    if (v && ALLOWED_VIEWS.has(v)) def.view = v
    // Phase 2: pinned is now sourced from /api/projects?summary=true; this localStorage
    // read is a one-load fallback before the one-time migration in renderProjects fires.
    // Safe to remove once we're confident no production client still has the legacy key.
    try {
      const raw = localStorage.getItem('synapse.projects.pinned')
      if (raw) def.pinned = new Set(JSON.parse(raw))
    } catch {
      localStorage.removeItem('synapse.projects.pinned')
    }
    try {
      const raw = localStorage.getItem('synapse.projects.filters')
      if (raw) {
        const f = JSON.parse(raw)
        if (Array.isArray(f.status))   def.filters.status   = f.status.filter(v => typeof v === 'string')
        if (Array.isArray(f.category)) def.filters.category = f.category.filter(v => typeof v === 'string')
        if (Array.isArray(f.client))   def.filters.client   = f.client.filter(v => typeof v === 'string')
        if (Array.isArray(f.stack))    def.filters.stack    = f.stack.filter(v => typeof v === 'string')
        if (typeof f.showArchived === 'boolean') def.filters.showArchived = f.showArchived
        if (typeof f.search === 'string') def.filters.search = f.search
      }
    } catch {
      localStorage.removeItem('synapse.projects.filters')
    }
    const s = localStorage.getItem('synapse.projects.sort')
    if (s && ALLOWED_SORTS.has(s)) def.sort = s
    const g = localStorage.getItem('synapse.projects.group')
    if (g && ALLOWED_GROUPS.has(g)) def.group = g
    window._projectsState = def
  }
  return window._projectsState
}

function parseProjectsHashParams() {
  const hash = location.hash.slice(1)
  const qIdx = hash.indexOf('?')
  if (qIdx < 0) return {}
  const out = {}
  for (const part of hash.slice(qIdx + 1).split('&')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = decodeURIComponent(part.slice(0, eq))
    const v = part.slice(eq + 1)   // raw, decode per-consumer
    if (k) out[k] = v
  }
  return out
}

function decodeList(v) { return v.split(',').map(decodeURIComponent).filter(Boolean) }

function applyHashOverrides(state) {
  const p = parseProjectsHashParams()
  if (p.view && ALLOWED_VIEWS.has(p.view)) state.view = p.view
  if (p.status)   state.filters.status   = decodeList(p.status).filter(v => ALLOWED_STATUSES.has(v))
  if (p.category) state.filters.category = decodeList(p.category)
  if (p.client)   state.filters.client   = decodeList(p.client)
  if (p.stack)    state.filters.stack    = decodeList(p.stack)
  if (p.sort && ALLOWED_SORTS.has(p.sort)) state.sort = p.sort
  if (p.group && ALLOWED_GROUPS.has(p.group)) state.group = p.group
  if (p.showArchived) state.filters.showArchived = p.showArchived === '1'
}

// Track the last hash we applied so we don't re-import our own writes from syncProjectHash.
// Without this, every renderProjects() reads the URL and reverts state changes that haven't
// been synced to the URL yet (e.g., a fresh view click).
let _lastAppliedHash = null
function applyHashOverridesIfChanged(state) {
  if (location.hash === _lastAppliedHash) return
  _lastAppliedHash = location.hash
  applyHashOverrides(state)
}

export async function renderProjects() {
  // Loading state — show immediately so the user sees feedback while the API calls run
  const page = document.getElementById('page')
  if (page) {
    page.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-muted);font-size:13px">Loading projects…</div>`
  }
  const data = await api.get('/api/projects?summary=true').catch(() => ({ projects: [] }))
  const summary = data.projects || []

  // Reshape summary rows to the legacy shape consumers expect.
  // The card-v2 renderer reads p._meta.{status, displayName, ...} and p.lastSession.{date, status},
  // so we synthesize those wrappers. New server-side flags (pinned/isStale/hasBlockers)
  // live in p._summary.
  const merged = summary.map((s) => ({
    name: s.name,
    totalSessions: s.totalSessions,
    totalMemories: s.totalMemories,
    lastSession: s.lastActivity ? { date: s.lastActivity, status: s.status } : undefined,
    _meta: {
      name: s.name,
      displayName: s.displayName,
      clientName: s.clientName,
      category: s.category,
      status: s.status,
      stack: s.stack || [],
    },
    _summary: {
      pinned: s.pinned,
      hasBlockers: s.hasBlockers,
      isStale: s.isStale,
    },
  }))

  const state = getProjectsState()
  state.merged = merged
  // Sync pinned set from server-authoritative summary (Phase 2)
  state.pinned = new Set(merged.filter(p => p._summary?.pinned).map(p => p.name))

  // Phase 2 one-time migration: if there are legacy localStorage pins not yet on server,
  // POST them to /bulk then clear. Fire-and-forget — UI doesn't block on this.
  const legacy = localStorage.getItem('synapse.projects.pinned')
  if (legacy) {
    try {
      const names = JSON.parse(legacy)
      if (Array.isArray(names) && names.length > 0) {
        // Only migrate names that exist in the current summary AND aren't already pinned server-side
        const serverPinned = new Set([...state.pinned])
        const toMigrate = names.filter(n => merged.some(p => p.name === n) && !serverPinned.has(n))
        if (toMigrate.length > 0) {
          fetch('/api/projects-meta/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ names: toMigrate, action: 'pin' }),
            credentials: 'include',
          }).then(r => {
            if (r.ok) {
              // Also update local state so the next render shows the migrated pins
              for (const n of toMigrate) state.pinned.add(n)
              localStorage.removeItem('synapse.projects.pinned')
              if (typeof window._renderProjectsBody === 'function') window._renderProjectsBody()
              if (typeof window._renderProjectsPinned === 'function') window._renderProjectsPinned()
            }
          }).catch(() => {})
        } else {
          // Nothing to migrate — clean stale key
          localStorage.removeItem('synapse.projects.pinned')
        }
      } else {
        localStorage.removeItem('synapse.projects.pinned')
      }
    } catch {
      localStorage.removeItem('synapse.projects.pinned')
    }
  }

  applyHashOverridesIfChanged(state)
  applyProjectFilters() // computes state.filtered

  document.getElementById('page').innerHTML = `
    <div class="proj-page-wrap">
      <div class="proj-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="section-title" style="margin:0">Projects <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">${merged.length}</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="proj-view-switcher" role="tablist" aria-label="View switcher">
            ${renderViewPill('grid', '▦', 'Grid', state.view)}
            ${renderViewPill('list', '⊟', 'List', state.view)}
            ${renderViewPill('kanban', '☰', 'Kanban', state.view)}
            ${renderViewPill('table', '▭', 'Table', state.view)}
          </div>
          <button class="proj-new-btn" onclick="openNewProjectModal()">+ New Project</button>
        </div>
      </div>

      <div id="proj-toolbar"></div>
      <div id="proj-stats"></div>
      <div id="proj-pinned"></div>
      <div id="proj-body"></div>
      <div id="proj-bulk"></div>
    </div>
  `

  renderProjectsToolbar()
  window._renderProjectsToolbar = renderProjectsToolbar
  window._renderProjectsFiltersOnly = renderProjectsFiltersOnly
  renderProjectsStats()
  window._renderProjectsStats = renderProjectsStats
  renderProjectsPinned()
  window._renderProjectsPinned = renderProjectsPinned
  renderProjectsBody()
  window._renderProjectsBody = renderProjectsBody
  // Expose merged for legacy callers
  window._projectsList = merged
}

function renderViewPill(view, icon, label, current) {
  const active = view === current
  return `<button class="proj-view-pill ${active ? 'active' : ''}" role="tab" aria-selected="${active}" onclick="changeProjectView('${escHtml(view)}')">${icon} <span>${label}</span></button>`
}

function uniqueFromMerged(field) {
  const s = window._projectsState
  if (!s) return []
  const set = new Set()
  for (const p of s.merged) {
    const v = field === 'stack'
      ? (p._meta?.stack || [])
      : [p._meta?.[field] || p[field]]
    for (const x of v) if (x) set.add(x)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

function statusOptions() { return ['active', 'paused', 'completed', 'archived'] }
function categoryOptions() { return uniqueFromMerged('category') }
function clientOptions() { return uniqueFromMerged('clientName') }
function stackOptions() { return uniqueFromMerged('stack') }

function renderFilterPill(key, label, options, selected) {
  const n = selected.length
  return `
    <div class="proj-filter-pill ${n > 0 ? 'has-value' : ''}" data-filter="${key}">
      <span onclick="toggleProjectFilter('${key}')">${label}${n > 0 ? `<span class="badge-n">${n}</span>` : ''} <span class="chev">▾</span></span>
      <div class="proj-filter-menu" onclick="event.stopPropagation()">
        <div class="menu-header">${label}</div>
        ${options.length === 0
          ? `<div class="menu-header" style="color:var(--text-muted)">No options</div>`
          : options.map(o => `
              <label>
                <input type="checkbox" value="${escAttr(o)}" ${selected.includes(o) ? 'checked' : ''}
                  onchange="updateProjectFilter('${key}', this.value, this.checked)">
                <span>${escHtml(o)}</span>
              </label>`).join('')}
        ${n > 0 ? `<div class="menu-footer"><button onclick="clearProjectFilter('${key}')">Clear ${label}</button></div>` : ''}
      </div>
    </div>`
}

function renderProjectsToolbar() {
  const s = getProjectsState()
  const el = document.getElementById('proj-toolbar')
  if (!el) return
  el.className = 'proj-toolbar'
  el.innerHTML = `
    <input type="search" id="proj-search-input" placeholder="Search projects..." aria-label="Search projects"
      value="${escAttr(s.filters.search)}" autocomplete="off">
    <div id="proj-filters-slot" style="display:contents"></div>
  `
  // Wire search separately — listen on the input element, not the inline oninput
  const inp = el.querySelector('#proj-search-input')
  inp.addEventListener('input', debouncedSearch)
  renderProjectsFiltersOnly()
}

function renderProjectsFiltersOnly() {
  const s = getProjectsState()
  const slot = document.getElementById('proj-filters-slot')
  if (!slot) return
  const hasAny = s.filters.status.length || s.filters.category.length ||
                 s.filters.client.length || s.filters.stack.length ||
                 s.filters.search || s.filters.showArchived
  slot.innerHTML = `
    ${renderFilterPill('status', 'Status', statusOptions(), s.filters.status)}
    ${renderFilterPill('category', 'Category', categoryOptions(), s.filters.category)}
    ${renderFilterPill('client', 'Client', clientOptions(), s.filters.client)}
    ${renderFilterPill('stack', 'Stack', stackOptions(), s.filters.stack)}
    <select aria-label="Sort projects" onchange="changeProjectSort(this.value)" title="Sort by">
      <option value="lastActivity-desc" ${s.sort === 'lastActivity-desc' ? 'selected' : ''}>Last activity ↓</option>
      <option value="name-asc" ${s.sort === 'name-asc' ? 'selected' : ''}>Name A→Z</option>
      <option value="status-asc" ${s.sort === 'status-asc' ? 'selected' : ''}>Status</option>
      <option value="sessions-desc" ${s.sort === 'sessions-desc' ? 'selected' : ''}>Sessions ↓</option>
      <option value="created-desc" ${s.sort === 'created-desc' ? 'selected' : ''}>Created ↓</option>
    </select>
    <select aria-label="Group projects" onchange="changeProjectGroup(this.value)" title="Group by">
      <option value="none" ${s.group === 'none' ? 'selected' : ''}>No group</option>
      <option value="client" ${s.group === 'client' ? 'selected' : ''}>Group: Client</option>
      <option value="status" ${s.group === 'status' ? 'selected' : ''}>Group: Status</option>
      <option value="category" ${s.group === 'category' ? 'selected' : ''}>Group: Category</option>
    </select>
    <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);cursor:pointer">
      <input type="checkbox" ${s.filters.showArchived ? 'checked' : ''} onchange="toggleShowArchived(this.checked)">
      Show archived
    </label>
    ${hasAny ? `<button class="proj-toolbar-clear" onclick="clearAllProjectFilters()">✕ Clear filters</button>` : ''}
  `
}

function renderProjectsStats() {
  const s = getProjectsState()
  const el = document.getElementById('proj-stats')
  if (!el) return
  const counts = { active: 0, paused: 0, completed: 0, archived: 0 }
  for (const p of s.merged) {
    const st = p._meta?.status || p.lastSession?.status
    if (counts[st] !== undefined) counts[st]++
  }
  const segs = [
    { key: 'active', label: 'active', icon: '●' },
    { key: 'paused', label: 'paused', icon: '◐' },
    { key: 'completed', label: 'completed', icon: '✓' },
    { key: 'archived', label: 'archived', icon: '⊘' },
  ]
  el.className = 'proj-stats-bar'
  el.innerHTML = segs.map(seg => {
    const isActive = s.filters.status.includes(seg.key)
    return `<button type="button" class="proj-stats-segment stat-${seg.key} ${isActive ? 'active' : ''}"
      aria-pressed="${isActive}"
      onclick="toggleStatusFromStats('${seg.key}')" title="Filter by ${seg.label}">
      <span class="dot" aria-hidden="true"></span>
      <span class="n">${counts[seg.key]}</span>
      <span>${seg.label}</span>
    </button>`
  }).join('')
}

function renderProjectsPinned() {
  const s = getProjectsState()
  const el = document.getElementById('proj-pinned')
  if (!el) return
  const pinnedList = s.filtered.filter(p => s.pinned.has(p.name))
  if (pinnedList.length === 0) { el.innerHTML = ''; return }
  el.innerHTML = `
    <div class="proj-pinned-section">
      <div class="proj-pinned-section-title"><span class="star" aria-hidden="true">★</span> Pinned (${pinnedList.length})</div>
      <div class="proj-grid">${pinnedList.map(renderCardGrid).join('')}</div>
    </div>
  `
}

// Debounced search dispatcher (200 ms) — closure over a single timeout
let _searchDebounceTimer = null
function debouncedSearch(e) {
  const v = e.target.value
  clearTimeout(_searchDebounceTimer)
  _searchDebounceTimer = setTimeout(() => {
    if (typeof window.updateProjectSearch === 'function') window.updateProjectSearch(v)
  }, 200)
}

export function applyProjectFilters() {
  const s = getProjectsState()
  const f = s.filters
  const q = (f.search || '').toLowerCase().trim()

  let out = s.merged.slice()

  // Show archived toggle
  if (!f.showArchived) {
    out = out.filter(p => (p._meta?.status || p.lastSession?.status) !== 'archived')
  }

  // Filter: status
  if (f.status.length) {
    out = out.filter(p => f.status.includes(p._meta?.status || p.lastSession?.status || ''))
  }
  // Filter: category
  if (f.category.length) {
    out = out.filter(p => f.category.includes(p._meta?.category || ''))
  }
  // Filter: client
  if (f.client.length) {
    out = out.filter(p => f.client.includes(p._meta?.clientName || ''))
  }
  // Filter: stack (any-match)
  if (f.stack.length) {
    out = out.filter(p => {
      const stk = p._meta?.stack || []
      return f.stack.some(s => stk.includes(s))
    })
  }
  // Search
  if (q) {
    out = out.filter(p => {
      const hay = `${p._meta?.displayName || ''} ${p.name} ${p._meta?.clientName || ''} ${p._meta?.category || ''} ${(p._meta?.stack || []).join(' ')}`
      return hay.toLowerCase().includes(q)
    })
  }

  // Sort
  const [field, dir] = s.sort.split('-')
  const mul = dir === 'desc' ? -1 : 1
  out.sort((a, b) => {
    let av, bv
    if (field === 'name') { av = (a._meta?.displayName || a.name).toLowerCase(); bv = (b._meta?.displayName || b.name).toLowerCase() }
    else if (field === 'status') {
      const order = { active:0, paused:1, completed:2, archived:3 }
      av = order[a._meta?.status || a.lastSession?.status] ?? 9
      bv = order[b._meta?.status || b.lastSession?.status] ?? 9
    }
    else if (field === 'sessions') { av = a.totalSessions || 0; bv = b.totalSessions || 0 }
    else if (field === 'created') { av = a._meta?.createdAt || ''; bv = b._meta?.createdAt || '' }
    else if (field === 'client')   { av = (a._meta?.clientName || '').toLowerCase(); bv = (b._meta?.clientName || '').toLowerCase() }
    else if (field === 'category') { av = a._meta?.category || ''; bv = b._meta?.category || '' }
    else if (field === 'memories') { av = a.totalMemories || 0; bv = b.totalMemories || 0 }
    else /* lastActivity */ { av = a.lastSession?.date || ''; bv = b.lastSession?.date || '' }
    return av < bv ? -1*mul : av > bv ? 1*mul : 0
  })

  s.filtered = out
  syncProjectHash()
}

function encodeList(arr) { return arr.map(encodeURIComponent).join(',') }

function syncProjectHash() {
  const s = window._projectsState
  if (!s) return
  // Build query string from non-default state
  const parts = []
  if (s.view !== 'grid') parts.push(`view=${s.view}`)
  if (s.filters.status.length)   parts.push(`status=${encodeList(s.filters.status)}`)
  if (s.filters.category.length) parts.push(`category=${encodeList(s.filters.category)}`)
  if (s.filters.client.length)   parts.push(`client=${encodeList(s.filters.client)}`)
  if (s.filters.stack.length)    parts.push(`stack=${encodeList(s.filters.stack)}`)
  if (s.sort !== 'lastActivity-desc') parts.push(`sort=${s.sort}`)
  if (s.group !== 'none') parts.push(`group=${s.group}`)
  if (s.filters.showArchived) parts.push('showArchived=1')
  const q = parts.length ? '?' + parts.join('&') : ''
  const newHash = '#/projects' + q
  if (location.hash !== newHash && location.hash.startsWith('#/projects')) {
    history.replaceState(null, '', newHash)
    _lastAppliedHash = newHash // remember our own write so applyHashOverridesIfChanged skips it
  }
  // Persist filters — guarded against Safari Private mode / quota errors
  try {
    localStorage.setItem('synapse.projects.filters', JSON.stringify(s.filters))
    localStorage.setItem('synapse.projects.sort', s.sort)
    localStorage.setItem('synapse.projects.group', s.group)
  } catch {}
}

export async function checkForDuplicates(name) {
  const container = document.getElementById('proj-tab-content')
  if (!container) return
  let data
  try {
    data = await api.get(`/api/projects-meta/${encodeURIComponent(name)}/similar`)
  } catch { return }
  const similar = data?.similar || []
  if (similar.length === 0) return
  const banner = document.createElement('div')
  banner.id = 'dup-banner'
  banner.style.cssText = 'margin-bottom:12px;padding:10px 14px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.35);border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:12px'
  banner.innerHTML = `
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:600;color:var(--yellow);margin-bottom:3px">Possible duplicates detected</div>
      <div style="font-size:11px;color:var(--text-muted)">Similar projects: ${similar.map(s => `<button onclick="openProjectDetail('${escHtml(s)}')" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:0;text-decoration:underline">${escHtml(s)}</button>`).join(', ')}</div>
    </div>
    <button onclick="showMergeDialog('${escHtml(name)}')" style="padding:4px 10px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);color:var(--yellow);font-size:11px;border-radius:4px;cursor:pointer;white-space:nowrap">Merge</button>
    <button onclick="document.getElementById('dup-banner').remove()" style="padding:4px 8px;background:none;border:1px solid var(--border);color:var(--text-muted);font-size:11px;border-radius:4px;cursor:pointer">Dismiss</button>
  `
  container.insertBefore(banner, container.firstChild)
}

export async function renderProjectDetail(name, openDetailFn) {
  const [activity, meta] = await Promise.all([
    api.get(`/api/projects/${encodeURIComponent(name)}`).catch(() => ({})),
    api.get(`/api/projects-meta/${encodeURIComponent(name)}`).catch(() => null),
  ])

  const sessions = activity.sessions || []
  const memories = activity.memories || []
  const last = sessions[0]

  // Update detail index in state for prev/next navigation
  const s = getProjectsState()
  s.detailIndex = s.filtered.findIndex(p => p.name === name)
  const hasPrev = s.detailIndex > 0
  const hasNext = s.detailIndex >= 0 && s.detailIndex < s.filtered.length - 1

  const html = `
    <div class="proj-detail-header">
      <div class="proj-detail-actions">
        <div class="proj-detail-nav" role="group" aria-label="Detail navigation">
          <button type="button" onclick="projectDetailNav(-1)" ${!hasPrev ? 'disabled' : ''} title="Previous project" aria-label="Previous project">←</button>
          <button type="button" onclick="projectDetailNav(1)" ${!hasNext ? 'disabled' : ''} title="Next project" aria-label="Next project">→</button>
        </div>
        <div class="proj-detail-actions-spacer"></div>
        <button class="proj-action-btn proj-action-board" onclick="openProjectBoard('${escAttr(name)}')" title="Open or create the project's home whiteboard (auto-populated with Memorie + Sessioni + Skills)">🗂 Project board</button>
        <button class="proj-action-btn proj-action-edit" onclick="openEditProjectModal('${escAttr(name)}')">Edit</button>
        <button class="proj-action-btn proj-action-merge" onclick="showMergeDialog('${escAttr(name)}')">Merge</button>
      </div>
      <div id="proj-tabs" class="proj-tabs-row" role="tablist" aria-label="Project sections">
        <button class="proj-tab active" data-tab="overview" role="tab" aria-selected="true" onclick="switchProjectTab('overview','${escAttr(name)}')">Overview</button>
        <button class="proj-tab" data-tab="env" role="tab" aria-selected="false" onclick="switchProjectTab('env','${escAttr(name)}')">Env Vars</button>
        <button class="proj-tab" data-tab="activity" role="tab" aria-selected="false" onclick="switchProjectTab('activity','${escAttr(name)}')">Activity</button>
        <button class="proj-tab" data-tab="insights" role="tab" aria-selected="false" onclick="switchProjectTab('insights','${escAttr(name)}')">Insights</button>
      </div>
    </div>
    <div id="proj-tab-content"></div>
  `
  openDetailFn(name, html)

  // Store data for tab switching (kept for switchProjectTab in app.js)
  const projData = { name, activity, meta, sessions, memories, last }
  window._projData = projData
  // Expose renderProjectTab so the activity filter chips can re-render the active tab.
  window._renderProjectTab = renderProjectTab
  renderProjectTab('overview', name, projData)
  checkForDuplicates(name)
}

export function renderProjectTab(tab, name, data) {
  const resolved = data || window._projData || {}
  const { meta, last, sessions, memories } = resolved
  const container = document.getElementById('proj-tab-content')
  if (!container) return

  const M = meta || {}
  const statusColors = {'in-progress':'var(--blue)','completed':'var(--green)','paused':'var(--yellow)','blocked':'var(--red)','active':'var(--green)','archived':'var(--text-muted)'}

  if (tab === 'overview') {
    const displayName = M.displayName || name
    const sc = statusColors[M.status || (last?.status)] || 'var(--text-muted)'

    // Header card (full width)
    let html = `
      <div class="card">
        <div style="font-size:18px;font-weight:600;margin-bottom:4px">${escHtml(displayName)}</div>
        <div style="color:var(--text-muted);font-size:12px;margin-bottom:12px">
          ${M.clientName ? `Client: <strong>${escHtml(M.clientName)}</strong> &middot; ` : ''}
          ${M.category ? `${escHtml(M.category)} &middot; ` : ''}
          <span style="color:${sc}">${escHtml(M.status || (last?.status || 'unknown'))}</span>
        </div>
        ${M.description ? `<div style="color:var(--text-dim);font-size:13px;margin-bottom:12px">${escHtml(M.description)}</div>` : ''}
        ${M.stack?.length ? `<div class="tags">${M.stack.map((t) => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`

    // Two-column grid: left = Team + Notes, right = Links + Infra + Last Activity
    const leftCol = []
    const rightCol = []

    if (M.teamLead || M.teamMembers?.length) {
      leftCol.push(`<div class="card">
        <div class="card-title">Team</div>
        ${M.teamLead ? `<div class="row"><span class="row-label">Lead</span><span class="row-val"><strong>${escHtml(M.teamLead)}</strong></span></div>` : ''}
        ${(M.teamMembers || []).map((mb) => `
          <div class="row">
            <span class="row-label">${escHtml(mb.name)}</span>
            <span class="row-val" style="font-size:12px;color:var(--text-muted)">${escHtml(mb.role || '')}${mb.email ? ' · ' + escHtml(mb.email) : ''}</span>
          </div>`).join('')}
      </div>`)
    }

    if (M.notes) {
      leftCol.push(`<div class="card">
        <div class="card-title">Notes</div>
        <div style="font-size:13px;color:var(--text-dim);white-space:pre-wrap">${escHtml(M.notes)}</div>
      </div>`)
    }

    if (M.repoUrl || M.liveUrl) {
      // liveUrl gets safeUrl (scheme-validated); other user-pasted external URLs get escAttr.
      // (Scheme validation for repo/admin URLs could be unified under safeUrl as a future polish.)
      const liveSafe = safeUrl(M.liveUrl)
      rightCol.push(`<div class="card">
        <div class="card-title">Links</div>
        ${liveSafe ? `<div class="row"><span class="row-label">Live</span><a href="${escAttr(liveSafe)}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(M.liveUrl)}</a></div>` : ''}
        ${M.repoUrl ? `<div class="row"><span class="row-label">Repo</span><a href="${escAttr(M.repoUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(M.repoUrl)}</a></div>` : ''}
        ${M.mainBranch ? `<div class="row"><span class="row-label">Branch</span><span class="row-val"><code>${escHtml(M.mainBranch)}</code></span></div>` : ''}
      </div>`)
    }

    const hasInfra = M.dbType || M.cmsType || M.deployPlatform || M.domainPrimary
    if (hasInfra) {
      let infraHtml = `<div class="card"><div class="card-title" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">Stack &amp; Infra</div>`
      if (M.dbType || M.dbReference || M.dbAdminUrl) {
        infraHtml += `<div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;margin-top:4px">Database</div>`
        if (M.dbType) infraHtml += `<div class="row"><span class="row-label">Type</span><span class="row-val">${escHtml(M.dbType)}</span></div>`
        if (M.dbReference) infraHtml += `<div class="row"><span class="row-label">Reference</span><span class="row-val">${escHtml(M.dbReference)}</span></div>`
        if (M.dbAdminUrl) infraHtml += `<div class="row"><span class="row-label">Admin</span><a href="${escAttr(M.dbAdminUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(M.dbAdminUrl)}</a></div>`
      }
      if (M.cmsType || M.cmsAdminUrl) {
        infraHtml += `<div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;margin-top:12px">CMS</div>`
        if (M.cmsType) infraHtml += `<div class="row"><span class="row-label">Type</span><span class="row-val">${escHtml(M.cmsType)}</span></div>`
        if (M.cmsAdminUrl) infraHtml += `<div class="row"><span class="row-label">Admin</span><a href="${escAttr(M.cmsAdminUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(M.cmsAdminUrl)}</a></div>`
      }
      if (M.deployPlatform) {
        infraHtml += `<div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;margin-top:12px">Deploy</div>`
        infraHtml += `<div class="row"><span class="row-label">Platform</span><span class="row-val">${escHtml(M.deployPlatform)}</span></div>`
        if (M.hasCi) infraHtml += `<div class="row"><span class="row-label">CI/CD</span><span class="row-val">✅ GitHub Actions</span></div>`
      }
      if (M.domainPrimary) {
        infraHtml += `<div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;margin-top:12px">Domains</div>`
        infraHtml += `<div class="row"><span class="row-label">Primary</span><span class="row-val">${escHtml(M.domainPrimary)}</span></div>`;
        (M.domainsExtra || []).forEach(d => { infraHtml += `<div class="row"><span class="row-label">Extra</span><span class="row-val">${escHtml(d)}</span></div>` })
      }
      infraHtml += `</div>`
      rightCol.push(infraHtml)
    }

    if (last) {
      rightCol.push(`<div class="card">
        <div class="card-title">Last Activity</div>
        <div class="row"><span class="row-label">Date</span><span class="row-val">${escHtml(last.startedAt?.split('T')[0] || '?')}</span></div>
        ${last.taskDescription ? `<div class="row"><span class="row-label">Task</span><span class="row-val">${escHtml(last.taskDescription)}</span></div>` : ''}
        ${last.nextSteps ? `<div style="margin-top:8px;padding:8px;background:rgba(52,211,153,.05);border:1px solid rgba(52,211,153,.2);border-radius:6px;font-size:12px;color:var(--green)">Next: ${escHtml(last.nextSteps)}</div>` : ''}
        ${last.blockers ? `<div style="margin-top:6px;padding:8px;background:rgba(248,113,113,.05);border:1px solid rgba(248,113,113,.2);border-radius:6px;font-size:12px;color:var(--red)">Blocker: ${escHtml(last.blockers)}</div>` : ''}
      </div>`)
    }

    if (leftCol.length || rightCol.length) {
      html += `<div class="proj-detail-grid">
        <div>${leftCol.join('')}</div>
        <div>${rightCol.join('')}</div>
      </div>`
    }

    if (!meta) {
      html += `
      <div class="card" style="border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.03)">
        <div style="color:var(--yellow);font-size:13px;font-weight:600;margin-bottom:6px">No metadata yet</div>
        <div style="color:var(--text-muted);font-size:12px;margin-bottom:12px">Run <code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px">project_scan</code> in Claude Code, or fill manually.</div>
        <button onclick="openEditProjectModal('${escAttr(name)}')" style="padding:6px 14px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer">Edit metadata</button>
      </div>`
    }

    container.innerHTML = html
  }

  if (tab === 'env') {
    container.innerHTML = `<div id="env-content"><p style="color:var(--text-muted);font-size:13px">Loading env vars...</p></div>`
    loadEnvVars(name)
  }

  if (tab === 'activity') {
    const filter = window._activityFilter || 'all'
    const items = []
    if (filter === 'all' || filter === 'sessions') {
      for (const sn of (sessions || [])) {
        items.push({ kind: 'session', date: sn.startedAt || '', data: sn })
      }
    }
    if (filter === 'all' || filter === 'memories') {
      for (const mm of (memories || [])) {
        items.push({ kind: 'memory', date: mm.createdAt || mm.created_at || '', data: mm })
      }
    }
    // Most recent first
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    // Group by day (YYYY-MM-DD) — items with no date go into "—" bucket at the bottom
    const days = {}
    const dayOrder = []
    for (const it of items) {
      const day = (it.date || '').slice(0, 10) || '—'
      if (!(day in days)) { days[day] = []; dayOrder.push(day) }
      days[day].push(it)
    }

    let html = `
      <div class="proj-activity-filter" role="tablist" aria-label="Activity filter">
        <button type="button" role="tab" aria-selected="${filter==='all'}" class="${filter==='all'?'active':''}" onclick="setActivityFilter('all','${escAttr(name)}')">All (${items.length})</button>
        <button type="button" role="tab" aria-selected="${filter==='sessions'}" class="${filter==='sessions'?'active':''}" onclick="setActivityFilter('sessions','${escAttr(name)}')">Sessions (${(sessions || []).length})</button>
        <button type="button" role="tab" aria-selected="${filter==='memories'}" class="${filter==='memories'?'active':''}" onclick="setActivityFilter('memories','${escAttr(name)}')">Memories (${(memories || []).length})</button>
      </div>
    `

    if (items.length === 0) {
      html += `<p style="color:var(--text-muted);font-size:13px">No activity yet.</p>`
    } else {
      for (const day of dayOrder) {
        html += `<div class="proj-activity-day">
          <div class="proj-activity-day-header">${escHtml(day)}</div>
          ${days[day].map(renderActivityItem).join('')}
        </div>`
      }
    }
    container.innerHTML = html
  }

  if (tab === 'insights') {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:13px">Loading insights…</p>`
    loadProjectInsights(name).catch(err => {
      if (container) container.innerHTML = `<p style="color:var(--red);font-size:13px">Failed to load insights: ${escHtml(err.message || String(err))}</p>`
    })
  }
}

// ── Insights SVG chart helpers (Phase 2) ──

const CHART_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#f59e0b', '#f87171', '#ec4899', '#14b8a6', '#facc15']

function svgBarChart(data, opts = {}) {
  // data: [{ label, value }]. Renders SVG bar chart with x-axis labels (last 5 chars of label) + values above bars.
  if (!data || data.length === 0) return `<div class="proj-chart-empty">No data yet</div>`
  const W = 480, H = 160, PADX = 36, PADY = 24
  const max = Math.max(...data.map(d => d.value), 1)
  const barW = (W - PADX * 2) / data.length - 4
  const bars = data.map((d, i) => {
    const x = PADX + i * (barW + 4)
    const h = ((d.value / max) * (H - PADY * 2))
    const y = H - PADY - h
    return `
      <rect class="bar" x="${x}" y="${y}" width="${barW}" height="${h}" rx="2">
        <title>${escAttr(d.label)}: ${d.value}</title>
      </rect>
      <text class="bar-label" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${escHtml(String(d.label).slice(-5))}</text>
      ${d.value > 0 ? `<text class="bar-value" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle">${d.value}</text>` : ''}
    `
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" aria-label="Bar chart">
    <line class="axis" x1="${PADX}" y1="${H - PADY}" x2="${W - PADX}" y2="${H - PADY}" />
    ${bars}
  </svg>`
}

function svgDonutChart(data, opts = {}) {
  // data: [{ label, value }]. Renders SVG donut with side legend.
  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) return `<div class="proj-chart-empty">No data yet</div>`
  const SIZE = 160, R = 60, IR = 38, CX = SIZE / 2, CY = SIZE / 2
  let angle = -Math.PI / 2
  const slices = data.map((d, i) => {
    const sliceAngle = (d.value / total) * Math.PI * 2
    const x1 = CX + R * Math.cos(angle), y1 = CY + R * Math.sin(angle)
    const x2 = CX + R * Math.cos(angle + sliceAngle), y2 = CY + R * Math.sin(angle + sliceAngle)
    const ix1 = CX + IR * Math.cos(angle + sliceAngle), iy1 = CY + IR * Math.sin(angle + sliceAngle)
    const ix2 = CX + IR * Math.cos(angle), iy2 = CY + IR * Math.sin(angle)
    const largeArc = sliceAngle > Math.PI ? 1 : 0
    const color = CHART_COLORS[i % CHART_COLORS.length]
    const path = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${IR} ${IR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`
    angle += sliceAngle
    return `<path d="${path}" fill="${color}"><title>${escAttr(d.label)}: ${d.value} (${Math.round(d.value / total * 100)}%)</title></path>`
  }).join('')
  const legend = data.map((d, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length]
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim)">
      <span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px"></span>
      <span>${escHtml(d.label)}</span>
      <span style="color:var(--text-muted)">${d.value}</span>
    </div>`
  }).join('')
  return `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <svg viewBox="0 0 ${SIZE} ${SIZE}" style="width:160px;height:160px" aria-label="Donut chart">${slices}</svg>
    <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px">${legend}</div>
  </div>`
}

function svgHBarChart(data, opts = {}) {
  // data: [{ label, value }] — caller pre-sorts desc. Renders SVG horizontal bar chart.
  if (!data || data.length === 0) return `<div class="proj-chart-empty">No data yet</div>`
  const W = 480, ROW_H = 22, PAD = 8
  const H = data.length * ROW_H + PAD * 2
  const max = Math.max(...data.map(d => d.value), 1)
  const LABEL_W = 110
  const BAR_AREA = W - LABEL_W - 40
  const rows = data.map((d, i) => {
    const y = PAD + i * ROW_H
    const w = (d.value / max) * BAR_AREA
    return `
      <text class="bar-label" x="${LABEL_W - 4}" y="${y + ROW_H / 2 + 3}" text-anchor="end">${escHtml(d.label)}</text>
      <rect class="bar" x="${LABEL_W}" y="${y + 3}" width="${w}" height="${ROW_H - 6}" rx="2">
        <title>${escAttr(d.label)}: ${d.value}</title>
      </rect>
      <text class="bar-value" x="${LABEL_W + w + 4}" y="${y + ROW_H / 2 + 3}">${d.value}</text>
    `
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" aria-label="Horizontal bar chart">${rows}</svg>`
}

function renderActivityItem(it) {
  if (it.kind === 'session') {
    const s = it.data
    const when = (s.startedAt || '').replace('T', ' ').slice(0, 16)
    return `<div class="proj-activity-item">
      <span class="proj-activity-icon" aria-hidden="true">🗓</span>
      <div class="proj-activity-content">
        <div class="proj-activity-title">${escHtml(s.sessionName || 'Session')} <span style="font-size:10px;color:var(--text-muted)">[${escHtml(s.status || '')}]</span></div>
        <div class="proj-activity-meta">${escHtml(when)} · ${escHtml(s.summary || s.taskDescription || 'No summary')}</div>
      </div>
    </div>`
  }
  // memory
  const m = it.data
  return `<div class="proj-activity-item clickable" role="button" tabindex="0"
    onclick="event.stopPropagation();openMemoryDetail('${escAttr(m.id)}')"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMemoryDetail('${escAttr(m.id)}')}">
    <span class="proj-activity-icon" aria-hidden="true">💭</span>
    <div class="proj-activity-content">
      <div class="proj-activity-title">${badge(m.type)} ${escHtml((m.context || '').slice(0, 80))}</div>
      <div class="proj-activity-meta">${confBar(m.confidence)} · ${escHtml((m.createdAt || m.created_at || '').slice(0,10))}</div>
    </div>
  </div>`
}

async function loadProjectInsights(name) {
  const r = await api.get(`/api/projects/${encodeURIComponent(name)}/insights`)
  const container = document.getElementById('proj-tab-content')
  if (!container) return

  const stats = `
    <div class="proj-insights-summary">
      <div class="proj-insights-stat">
        <div class="label">Sessions</div>
        <div class="value">${r.totalSessions}</div>
      </div>
      <div class="proj-insights-stat">
        <div class="label">Memories</div>
        <div class="value">${r.totalMemories}</div>
      </div>
      <div class="proj-insights-stat">
        <div class="label">Avg confidence</div>
        <div class="value">${r.avgConfidence == null ? '—' : (r.avgConfidence * 100).toFixed(0) + '%'}</div>
      </div>
      <div class="proj-insights-stat">
        <div class="label">Last activity</div>
        <div class="value">${r.daysSinceLastActivity == null ? 'never' : r.daysSinceLastActivity + 'gg fa'}</div>
      </div>
    </div>
  `

  const sessionsChart = svgBarChart(r.sessionsPerWeek || [])

  const memData = Object.entries(r.memoriesByType || {}).map(([label, value]) => ({ label, value }))
  const memChart = svgDonutChart(memData)

  const skillsChart = svgHBarChart(r.topSkills || [])

  container.innerHTML = `
    ${stats}
    <div class="proj-chart">
      <div class="proj-chart-title">Sessions per week (last 12)</div>
      ${sessionsChart}
    </div>
    <div class="proj-chart">
      <div class="proj-chart-title">Memories by type</div>
      ${memChart}
    </div>
    <div class="proj-chart">
      <div class="proj-chart-title">Top skills (max 10)</div>
      ${skillsChart}
    </div>
  `
}

// ── Env Vars ──

// Monotonic request id so a slow response from a stale call can't overwrite
// the result of a newer call (e.g. user clicks Refresh twice quickly).
let _envReqId = 0

export async function loadEnvVars(name) {
  const container = document.getElementById('env-content')
  if (!container) return
  const safeName = escAttr(name)
  const reqId = ++_envReqId
  try {
    const { vars } = await api.get(`/api/projects-meta/${encodeURIComponent(name)}/env`)
    if (reqId !== _envReqId) return // newer call in flight — drop stale result

    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })
    const count = vars?.length || 0

    const addFormHtml = `
      <form id="env-add-form" class="env-add-form" onsubmit="event.preventDefault();addEnvVar('${safeName}')" hidden>
        <input id="env-add-name" type="text" placeholder="VAR_NAME" autocomplete="off" spellcheck="false" pattern="[A-Za-z_][A-Za-z0-9_]*" required>
        <input id="env-add-value" type="text" placeholder="value" autocomplete="off" spellcheck="false" required>
        <label class="env-add-secret">
          <input id="env-add-secret" type="checkbox" checked>
          <span>secret</span>
        </label>
        <button type="submit" class="env-add-save">Save</button>
        <button type="button" class="env-add-cancel" onclick="toggleEnvAddForm(false)">Cancel</button>
      </form>
    `

    container.innerHTML = `
      <div class="env-meta">
        <span class="env-meta-project" title="Project name used to query env vars"><code>${escHtml(name)}</code></span>
        <span class="env-meta-count">${count} var${count === 1 ? '' : 's'}</span>
        <span class="env-meta-ts" title="Last fetched">${ts}</span>
        <button class="env-meta-refresh" onclick="loadEnvVars('${safeName}')" title="Reload list from server">↻</button>
      </div>
      <div class="env-toolbar">
        <button class="env-btn env-btn-add" onclick="toggleEnvAddForm(true)" title="Add a single env var manually">+ Add var</button>
        <button class="env-btn env-btn-import" onclick="importEnv('${safeName}')" title="Paste a full .env block and bulk-save">Import .env</button>
        <button class="env-btn env-btn-export" onclick="exportEnv('${safeName}')" title="Copy all vars as a .env block to clipboard">Copy all as .env</button>
      </div>
      ${addFormHtml}
      ${count ? `
      <div class="card">
        <div class="card-title">Env Vars <span class="count">${count}</span></div>
        ${vars.map(v => `
          <div class="row env-row">
            <span class="row-label"><code style="color:${v.isSecret ? 'var(--yellow)' : 'var(--green)'}">${escHtml(v.varName)}</code>${v.isSecret ? '' : ' <span style="font-size:10px;color:var(--text-muted)">(public)</span>'}</span>
            <span class="env-row-actions">
              <button onclick="revealEnv('${safeName}','${escAttr(v.varName)}')" class="env-row-btn">Reveal</button>
              <button onclick="deleteEnv('${safeName}','${escAttr(v.varName)}')" class="env-row-btn env-row-btn-del">Delete</button>
            </span>
          </div>
        `).join('')}
      </div>
      ` : `
      <div class="card env-empty">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">No env vars saved yet for this project.</div>
        <div style="font-size:12px;color:var(--text-dim);line-height:1.6">
          • Click <strong>+ Add var</strong> to insert one manually<br>
          • Click <strong>Import .env</strong> to paste a full file<br>
          • Or, from Claude Code CLI, use the MCP tool <code>project_set_env</code><br>
          &nbsp;&nbsp;&nbsp;<code style="font-size:11px;color:var(--accent)">project_set_env({ project: "${escHtml(name)}", varName: "MY_VAR", value: "...", isSecret: true })</code>
        </div>
      </div>
      `}
    `
  } catch (e) {
    if (reqId !== _envReqId) return
    const msg = (e && e.message) ? e.message : String(e)
    container.innerHTML = `
      <div class="card" style="border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.04)">
        <div style="color:var(--red);font-size:13px;font-weight:600;margin-bottom:6px">Error loading env vars</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${escHtml(msg)}</div>
        <button class="env-meta-refresh" onclick="loadEnvVars('${safeName}')" style="padding:4px 10px">Retry</button>
      </div>
    `
  }
}

// ── Global search ──

export async function searchGlobal(q, openDetailFn) {
  const [skills, memories] = await Promise.all([
    api.get(`/api/skills?search=${encodeURIComponent(q)}&limit=5`),
    api.get(`/api/memories?search=${encodeURIComponent(q)}&limit=5`),
  ])

  document.getElementById('page').innerHTML = `
    <div class="section-title">Search: "${q}"</div>

    ${(skills.skills || []).length ? `
    <div class="card">
      <div class="card-title">Skills <span class="count">${skills.skills.length}</span></div>
      ${skills.skills.map(s => `
        <div class="row" onclick="location.hash='#/skills'; setTimeout(() => openSkillDetail('${s.name}'), 100)">
          <span class="row-label">${badge(s.type)} ${s.name}</span>
          <span class="row-val" style="font-size:11px">${s.category}</span>
        </div>
      `).join('')}
    </div>` : ''}

    ${(memories.memories || []).length ? `
    <div class="card">
      <div class="card-title">Memories <span class="count">${memories.memories.length}</span></div>
      ${memories.memories.map(m => `
        <div class="row" onclick="location.hash='#/memories'; setTimeout(() => openMemoryDetail('${m.id}'), 100)">
          <span class="row-label">${badge(m.type)} ${(m.context || '').slice(0, 80)}</span>
          <span class="row-val">${confBar(m.confidence)}</span>
        </div>
      `).join('')}
    </div>` : ''}

    ${!(skills.skills || []).length && !(memories.memories || []).length ? '<p style="color:var(--text-muted)">No results found.</p>' : ''}
  `
}

// ── Components ──

const SECTION_TYPE_COLORS = {
  hero: '#6366f1', navbar: '#8b5cf6', footer: '#a78bfa',
  cta: '#f59e0b', pricing: '#10b981', features: '#3b82f6',
  testimonials: '#06b6d4', faq: '#84cc16', comparison: '#f97316',
  process: '#ec4899', gallery: '#14b8a6', demo: '#64748b',
  form: '#ef4444', card: '#8b5cf6', other: '#6b7280',
}

export async function renderComponents(typeFilter) {
  const url = typeFilter ? `/api/components?type=${typeFilter}&limit=200` : `/api/components?limit=200`
  const data = await api.get(url)
  const components = data.components || []

  const types = ['hero','navbar','footer','cta','pricing','features','testimonials','faq','comparison','process','gallery','demo','form','card','other']

  // Group by section_type
  const byType = {}
  for (const c of components) {
    if (!byType[c.sectionType]) byType[c.sectionType] = []
    byType[c.sectionType].push(c)
  }

  document.getElementById('page').innerHTML = `
    <div class="section-title">Component Catalog <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">${components.length} components</span></div>

    <div class="filters">
      <button class="filter-btn ${!typeFilter ? 'active' : ''}" onclick="renderComponents()">All</button>
      ${types.filter(t => byType[t]?.length).map(t => `<button class="filter-btn ${typeFilter === t ? 'active' : ''}" onclick="renderComponents('${t}')">${t} <span style="opacity:.6">${byType[t]?.length || 0}</span></button>`).join('')}
    </div>

    ${components.length === 0 ? `
      <div class="card" style="text-align:center;padding:32px">
        <p style="color:var(--text-muted);font-size:14px;margin-bottom:8px">No components cataloged yet.</p>
        <p style="color:var(--text-muted);font-size:12px">Use <code>component_add</code> from Claude Code to catalog UI components as you build them.</p>
      </div>
    ` : ''}

    ${Object.entries(byType).filter(([t]) => !typeFilter || t === typeFilter).map(([type, comps]) => `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title" style="display:flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${SECTION_TYPE_COLORS[type] || '#6b7280'}"></span>
          ${type.toUpperCase()}
          <span class="count">${comps.length}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px">
          ${comps.map(c => `
            <div style="border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s;overflow:hidden" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'" onclick="openComponentDetail('${c.id}')">
              ${c.codeSnippet ? `
                <div style="width:100%;height:160px;background:var(--surface);overflow:hidden;position:relative;pointer-events:none">
                  <iframe sandbox="allow-scripts" srcdoc="${escHtml(c.codeSnippet)}" style="width:160%;height:160%;border:none;transform:scale(0.625);transform-origin:top left" tabindex="-1"></iframe>
                </div>
              ` : `
                <div style="width:100%;height:80px;background:var(--surface);display:flex;align-items:center;justify-content:center">
                  <span style="font-size:11px;color:var(--text-dim)">No preview</span>
                </div>
              `}
              <div style="padding:10px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
                  <span style="font-weight:600;font-size:13px">${escHtml(c.name)}</span>
                  <span style="font-size:10px;color:var(--text-muted);background:var(--bg);padding:2px 6px;border-radius:4px;white-space:nowrap">${escHtml(c.project)}</span>
                </div>
                ${c.description ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;line-height:1.4">${escHtml(c.description.slice(0, 80))}</div>` : ''}
                ${c.tags?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${c.tags.map(t => `<span class="tag" style="font-size:10px;padding:1px 6px">${escHtml(t)}</span>`).join('')}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `
}

export async function openComponentDetail(id, openDetailFn) {
  const [c, commentsData] = await Promise.all([
    api.get(`/api/components/${encodeURIComponent(id)}`),
    api.get(`/api/components/${encodeURIComponent(id)}/comments`).catch(() => ({ comments: [] })),
  ])
  if (!c || c.error) { openDetailFn?.(id, `<p style="color:var(--red)">Component not found</p>`); return }

  const comments = commentsData?.comments ?? []

  openDetailFn?.(c.name, `
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${SECTION_TYPE_COLORS[c.sectionType] || '#6b7280'}22;color:${SECTION_TYPE_COLORS[c.sectionType] || '#6b7280'};border:1px solid ${SECTION_TYPE_COLORS[c.sectionType] || '#6b7280'}44">${c.sectionType.toUpperCase()}</span>
      <span style="font-size:12px;color:var(--text-muted)">Project: <strong>${escHtml(c.project)}</strong></span>
      <span style="font-size:11px;color:var(--text-dim);margin-left:auto">Added: ${c.createdAt?.split('T')[0] || '?'}</span>
    </div>

    ${c.codeSnippet ? `
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
        <div style="background:var(--surface);border-bottom:1px solid var(--border);padding:8px 12px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;font-weight:600;color:var(--text-muted)">PREVIEW</span>
        </div>
        <div style="height:320px;overflow:hidden;background:#fff">
          <iframe sandbox="allow-scripts" srcdoc="${escHtml(c.codeSnippet)}" style="width:100%;height:100%;border:none" title="${escHtml(c.name)} preview"></iframe>
        </div>
      </div>
    ` : ''}

    ${c.description ? `<div class="card"><div class="card-title">Description</div><p style="font-size:13px">${escHtml(c.description)}</p></div>` : ''}
    ${c.filePath ? `<div class="card"><div class="card-title">File</div><code style="font-size:12px">${escHtml(c.filePath)}</code></div>` : ''}
    ${c.tags?.length ? `<div style="margin-bottom:12px">${c.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
    ${c.propsSchema && Object.keys(c.propsSchema).length ? `<div class="card"><div class="card-title">Props</div><pre style="font-size:11px;overflow:auto;max-height:200px">${escHtml(JSON.stringify(c.propsSchema, null, 2))}</pre></div>` : ''}
    ${c.designTokens && Object.keys(c.designTokens).length ? `<div class="card"><div class="card-title">Design Tokens</div><pre style="font-size:11px;overflow:auto;max-height:200px">${escHtml(JSON.stringify(c.designTokens, null, 2))}</pre></div>` : ''}
    ${c.codeSnippet ? `<div class="card"><div class="card-title">Source</div><pre style="font-size:11px;overflow:auto;max-height:200px">${escHtml(c.codeSnippet)}</pre></div>` : ''}

    <div class="card" style="margin-top:12px">
      <div class="card-title">Comments <span class="count">${comments.length}</span></div>
      <div id="comment-list-${id}" style="margin-bottom:10px">
        ${comments.length === 0 ? `<p style="font-size:12px;color:var(--text-dim)">No comments yet.</p>` : comments.map(cm => `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
            <div>
              <span style="font-size:12px">${escHtml(cm.text)}</span>
              <span style="font-size:10px;color:var(--text-dim);display:block;margin-top:2px">${cm.userEmail ? escHtml(cm.userEmail) + ' · ' : ''}${cm.createdAt?.split('T')[0] || ''}</span>
            </div>
            <button onclick="deleteComponentComment('${id}','${cm.id}')" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;padding:0 4px;flex-shrink:0" title="Delete">×</button>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <input id="comment-input-${id}" placeholder="Add a comment…" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text)" onkeydown="if(event.key==='Enter')addComponentComment('${id}')">
        <button onclick="addComponentComment('${id}')" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap">Add</button>
      </div>
    </div>
  `)
}

// ── Design Systems ──

export async function renderDesignSystems() {
  const [data, pendingData] = await Promise.all([
    api.get('/api/design-systems'),
    api.get('/api/design-systems/pending').catch(() => ({ scans: [] })),
  ])
  const systems = data.designSystems || []
  const pending = pendingData.scans || []

  document.getElementById('page').innerHTML = `
    <div class="section-title">Design Systems <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">${systems.length} projects</span></div>

    ${pending.length > 0 ? `
    <div class="card" style="border-color:rgba(245,158,11,.3);margin-bottom:16px">
      <div class="card-title" style="color:var(--yellow)">
        Pending Review
        <span class="count" style="background:rgba(245,158,11,.15);color:var(--yellow)">${pending.length}</span>
      </div>
      ${pending.map(scan => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
          <strong style="flex:1">${escHtml(scan.project)}</strong>
          <span style="color:var(--text-muted);font-size:11px">
            ${scan.sources.map(s => s.source).join(', ')} &middot;
            ${Object.keys(scan.merged.colors || {}).length} colors
            ${scan.conflicts.length > 0 ? `&middot; <span style="color:var(--yellow)">${scan.conflicts.length} conflicts</span>` : ''}
          </span>
          <button onclick="reviewScan('${escHtml(scan.project)}', '${escHtml(scan.id)}')" style="padding:4px 10px;border-radius:6px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:var(--yellow);font-size:11px;cursor:pointer">Review</button>
          <button onclick="dismissScan('${escHtml(scan.id)}')" style="padding:4px 10px;border-radius:6px;background:transparent;border:1px solid var(--border);color:var(--text-muted);font-size:11px;cursor:pointer">Dismiss</button>
        </div>
      `).join('')}
    </div>` : ''}

    ${systems.length === 0 && pending.length === 0 ? `
      <div class="card" style="text-align:center;padding:32px">
        <p style="color:var(--text-muted);font-size:14px;margin-bottom:8px">No design systems saved yet.</p>
        <p style="color:var(--text-muted);font-size:12px">Use <code>design_system_scan</code> or <code>design_system_set</code> from Claude Code.</p>
      </div>
    ` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
      ${systems.map(ds => {
        const colorEntries = Object.entries(ds.colors || {}).slice(0, 8)
        const fontVals = Object.values(ds.fonts || {}).filter(v => typeof v === 'string').slice(0, 3)
        return `
        <div class="card" style="cursor:pointer" onclick="openDesignSystemDetail('${escHtml(ds.project)}')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-weight:700;font-size:15px">${escHtml(ds.project)}</div>
              ${ds.clientName ? `<div style="font-size:11px;color:var(--text-muted)">${escHtml(ds.clientName)}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${ds.darkMode ? '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:rgba(99,102,241,.15);color:var(--accent)">dark mode</span>' : ''}
              <span style="font-size:10px;color:var(--text-muted)">${ds.colorFormat}</span>
            </div>
          </div>
          ${colorEntries.length ? `
          <div style="margin-bottom:10px">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Colors</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${colorEntries.map(([k, v]) => `
                <div style="display:flex;align-items:center;gap:4px" title="${escHtml(k)}: ${escHtml(v)}">
                  <div style="width:18px;height:18px;border-radius:4px;background:${escHtml(v)};border:1px solid rgba(255,255,255,.1);flex-shrink:0"></div>
                  <span style="font-size:10px;color:var(--text-muted)">${escHtml(k)}</span>
                </div>
              `).join('')}
            </div>
          </div>` : ''}
          ${fontVals.length ? `
          <div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Fonts</div>
            <div style="font-size:12px;color:var(--text-dim)">${fontVals.map(f => escHtml(f)).join(' · ')}</div>
          </div>` : ''}
          <div style="margin-top:10px;font-size:10px;color:var(--text-muted)">Updated: ${ds.updatedAt?.split('T')[0] || '?'}</div>
        </div>`
      }).join('')}
    </div>
  `
}

export async function openDesignSystemDetail(project, openDetailFn) {
  const ds = await api.get(`/api/design-systems/${encodeURIComponent(project)}`)
  if (!ds || ds.error) { openDetailFn?.(project, `<p style="color:var(--red)">Design system not found</p>`); return }

  const colorEntries = Object.entries(ds.colors || {})
  const fontEntries = Object.entries(ds.fonts || {})
  const spacingEntries = Object.entries(ds.spacing || {})
  const radiusEntries = Object.entries(ds.radius || {})

  openDetailFn?.(ds.project, `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:12px;color:var(--text-muted)">
        ${ds.clientName ? `Client: <strong>${escHtml(ds.clientName)}</strong> &middot; ` : ''}
        Format: ${ds.colorFormat} &middot; Dark mode: ${ds.darkMode ? 'yes' : 'no'}
      </div>
      <button onclick="showDsMergeDialog('${escHtml(ds.project)}')" style="padding:6px 12px;border-radius:6px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);color:#f59e0b;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">Merge</button>
    </div>

    ${colorEntries.length ? `
    <div class="card">
      <div class="card-title">Colors <span class="count">${colorEntries.length}</span></div>
      ${colorEntries.map(([k, v]) => `
        <div class="row">
          <span class="row-label" style="display:flex;align-items:center;gap:8px">
            <span style="width:20px;height:20px;border-radius:4px;background:${escHtml(v)};border:1px solid rgba(255,255,255,.1);display:inline-block;flex-shrink:0"></span>
            <code>${escHtml(k)}</code>
          </span>
          <span class="row-val"><code>${escHtml(v)}</code></span>
        </div>
      `).join('')}
    </div>` : ''}

    ${fontEntries.length ? `
    <div class="card">
      <div class="card-title">Fonts</div>
      ${fontEntries.map(([k, v]) => `
        <div class="row"><span class="row-label"><code>${escHtml(k)}</code></span><span class="row-val">${escHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</span></div>
      `).join('')}
    </div>` : ''}

    ${spacingEntries.length ? `
    <div class="card">
      <div class="card-title">Spacing</div>
      ${spacingEntries.map(([k, v]) => `
        <div class="row"><span class="row-label"><code>${escHtml(k)}</code></span><span class="row-val">${escHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</span></div>
      `).join('')}
    </div>` : ''}

    ${radiusEntries.length ? `
    <div class="card">
      <div class="card-title">Border Radius</div>
      ${radiusEntries.map(([k, v]) => `
        <div class="row"><span class="row-label"><code>${escHtml(k)}</code></span><span class="row-val"><code>${escHtml(v)}</code></span></div>
      `).join('')}
    </div>` : ''}

    ${ds.notes ? `<div class="card"><div class="card-title">Notes</div><p style="font-size:13px">${escHtml(ds.notes)}</p></div>` : ''}
    ${ds.tailwindConfig ? `<div class="card"><div class="card-title">Tailwind Config</div><pre style="font-size:11px;overflow:auto;max-height:300px">${escHtml(ds.tailwindConfig)}</pre></div>` : ''}
  `)
}

export async function renderScanReview(project, scanId, openDetailFn) {
  const data = await api.get(`/api/design-systems/scans/${encodeURIComponent(project)}`)
  const scan = (data.scans || []).find(s => s.id === scanId)
  if (!scan) { openDetailFn?.('Scan not found', '<p style="color:var(--red)">Scan not found or already applied.</p>'); return }

  const colorEntries = Object.entries(scan.merged.colors || {})
  const fontEntries = Object.entries(scan.merged.fonts || {})
  const spacingEntries = Object.entries(scan.merged.spacing || {})
  const radiusEntries = Object.entries(scan.merged.radius || {})

  openDetailFn?.(`Review: ${project}`, `
    <div style="margin-bottom:14px;font-size:12px;color:var(--text-muted)">
      Sources: ${scan.sources.map(s => `<code>${s.source}</code>`).join(', ')} &middot;
      Scanned: ${scan.scannedAt?.split('T')[0] || '?'}
    </div>

    ${scan.conflicts.length > 0 ? `
    <div class="card" style="border-color:rgba(245,158,11,.3);margin-bottom:12px">
      <div class="card-title" style="color:var(--yellow)">Conflicts <span class="count" style="background:rgba(245,158,11,.15);color:var(--yellow)">${scan.conflicts.length}</span></div>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px">Same token found in multiple sources with different values. Renamed versions are already included in the merged result.</p>
      ${scan.conflicts.map(c => `
        <div style="margin-bottom:10px;padding:10px;background:rgba(245,158,11,.05);border-radius:6px;border:1px solid rgba(245,158,11,.15)">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px"><code>${escHtml(c.field)}.${escHtml(c.key)}</code></div>
          ${c.values.map(v => `
            <div style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:8px;margin-bottom:3px">
              ${c.field === 'colors' ? `<span style="width:14px;height:14px;border-radius:3px;background:${escHtml(String(v.value))};display:inline-block;flex-shrink:0;border:1px solid rgba(255,255,255,.1)"></span>` : ''}
              <span style="color:var(--text-muted)">${escHtml(v.source)}:</span>
              <code>${escHtml(String(v.value))}</code>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>` : ''}

    ${colorEntries.length ? `
    <div class="card">
      <div class="card-title">Colors <span class="count">${colorEntries.length}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
        ${colorEntries.map(([k, v]) => `
          <div style="display:flex;align-items:center;gap:5px" title="${escHtml(k)}: ${escHtml(v)}">
            <div style="width:20px;height:20px;border-radius:4px;background:${escHtml(v)};border:1px solid rgba(255,255,255,.1);flex-shrink:0"></div>
            <span style="font-size:11px;color:var(--text-dim)">${escHtml(k)}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${fontEntries.length ? `
    <div class="card">
      <div class="card-title">Fonts</div>
      ${fontEntries.map(([k, v]) => `<div class="row"><span class="row-label"><code>${escHtml(k)}</code></span><span class="row-val">${escHtml(String(v))}</span></div>`).join('')}
    </div>` : ''}

    ${spacingEntries.length ? `
    <div class="card">
      <div class="card-title">Spacing</div>
      ${spacingEntries.map(([k, v]) => `<div class="row"><span class="row-label"><code>${escHtml(k)}</code></span><span class="row-val">${escHtml(String(v))}</span></div>`).join('')}
    </div>` : ''}

    ${radiusEntries.length ? `
    <div class="card">
      <div class="card-title">Border Radius</div>
      ${radiusEntries.map(([k, v]) => `<div class="row"><span class="row-label"><code>${escHtml(k)}</code></span><span class="row-val"><code>${escHtml(String(v))}</code></span></div>`).join('')}
    </div>` : ''}

    <div style="display:flex;gap:10px;margin-top:16px">
      <button onclick="applyScan('${escHtml(project)}', '${escHtml(scanId)}')" class="btn-primary">Apply Design System</button>
      <button onclick="dismissScan('${escHtml(scanId)}')" class="btn-ghost">Dismiss</button>
    </div>
  `)
}

// ── Work Log ──

export async function renderWorkLog() {
  const data = await api.get('/api/worklog')
  const projects = data.projects || {}
  const projectNames = Object.keys(projects)

  const typeBadges = {
    feature: 'badge-pattern', fix: 'badge-bugfix', setup: 'badge-fact',
    deploy: 'badge-decision', refactor: 'badge-preference', design: 'badge-goal',
    docs: 'badge-todo', other: 'badge-process'
  }

  const statusDots = {
    'completed': 'var(--green)', 'paused': 'var(--yellow)',
    'blocked': 'var(--red)', 'in-progress': 'var(--blue)'
  }

  let totalEntries = 0
  projectNames.forEach(p => totalEntries += projects[p].totalEntries)

  document.getElementById('page').innerHTML = `
    <div class="section-title">Work Log <span class="count" style="font-size:12px;font-weight:400;color:var(--text-muted)">${totalEntries} entries across ${projectNames.length} projects</span></div>

    ${projectNames.length === 0 ? `
      <div class="card" style="text-align:center;padding:32px">
        <p style="color:var(--text-muted);font-size:14px;margin-bottom:8px">No deliverables recorded yet.</p>
        <p style="color:var(--text-muted);font-size:12px">When sessions are closed with <code>deliverables</code> and <code>workType</code>, they appear here automatically.</p>
      </div>
    ` : ''}

    ${projectNames.map(projName => {
      const proj = projects[projName]
      return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title" style="font-size:16px">${projName} <span class="count">${proj.totalEntries} entries</span></div>

        <div class="timeline">
          ${proj.entries.map(e => {
            const dotColor = statusDots[e.status] || 'var(--text-muted)'
            const badgeCls = typeBadges[e.type] || 'badge-process'
            return `
            <div class="timeline-item">
              <div class="timeline-name">
                <span class="badge ${badgeCls}">${e.type}</span>
                ${escHtml(e.deliverable)}
              </div>
              <div class="timeline-date">
                ${e.date}
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-left:8px;vertical-align:middle"></span>
                <span style="color:var(--text-muted)">${e.status}</span>
              </div>
              <div class="timeline-stats">
                ${e.commits ? e.commits + ' commits' : ''}
                ${e.files ? ' &middot; ' + e.files + ' files' : ''}
                ${e.branch ? ' &middot; ' + e.branch : ''}
              </div>
              ${e.nextSteps ? `<div style="margin-top:4px;font-size:12px;color:var(--green)">Next: ${escHtml(e.nextSteps)}</div>` : ''}
            </div>`
          }).join('')}
        </div>
      </div>`
    }).join('')}
  `
}

// ── Review Queue ──────────────────────────────────────────────────────────────

let _reviewPage = { limit: 100, offset: 0 }

export async function renderReview(opts = {}) {
  const page = document.getElementById('page')
  const silent = opts.silent === true
  if (!silent) {
    page.innerHTML = '<div class="section-title">Review Queue <span class="count">loading...</span></div>'
  }
  if (opts.resetPage) _reviewPage = { limit: 100, offset: 0 }

  let data
  try {
    data = await api.get(`/api/review/pending?limit=${_reviewPage.limit}&offset=${_reviewPage.offset}`)
  } catch {
    page.innerHTML = '<p style="color:var(--red);padding:16px">Failed to load review queue.</p>'
    return
  }

  const t = data.totals || { memories: 0, skills: 0, components: 0, proposals: 0, dsScans: 0 }
  const grandTotal = (t.memories || 0) + (t.skills || 0) + (t.components || 0) + (t.proposals || 0) + (t.dsScans || 0)

  const badge = document.getElementById('review-badge')
  if (badge) {
    badge.textContent = grandTotal
    badge.style.display = grandTotal > 0 ? 'inline' : 'none'
  }

  if (grandTotal === 0) {
    page.innerHTML = `
      <div class="section-title">Review Queue <span class="count">0 pending</span></div>
      <div class="card" style="text-align:center;padding:32px;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:12px">✓</div>
        <div>All caught up — nothing to review.</div>
      </div>`
    return
  }

  const memShown = (data.memories?.length || 0)
  const memMore = (t.memories || 0) > _reviewPage.offset + memShown

  page.innerHTML = `
    <div class="section-title">Review Queue <span class="count">${grandTotal} pending</span></div>
    <div id="review-memories"></div>
    <div id="review-skills"></div>
    <div id="review-components"></div>
    <div id="review-proposals"></div>
    ${memMore ? `<div style="text-align:center;margin:16px 0">
      <button onclick="loadMoreReview()" style="padding:6px 16px;border-radius:6px;background:transparent;border:1px solid var(--border);color:var(--text-muted);font-size:12px;cursor:pointer">Load next ${_reviewPage.limit} memories</button>
    </div>` : ''}
  `

  renderReviewSection('review-memories', 'Memories', data.memories || [], 'memory', t.memories, (item) => ({
    id: item.id,
    entityType: 'memory',
    title: `<span style="opacity:.6;font-size:11px">${item.type}</span> ${escHtml(item.context?.slice(0, 100) || '')}`,
    body: escHtml(item.solution?.slice(0, 200) || ''),
    meta: item.skill ? `skill: ${item.skill}` : '',
    approveUrl: `/api/review/memory/${item.id}/approve`,
    rejectUrl:  `/api/review/memory/${item.id}/reject`,
    rejectLabel: 'Reject',
  }))

  renderReviewSection('review-skills', 'Skills', data.skills || [], 'skill', t.skills, (item) => ({
    id: item.name,
    entityType: 'skill',
    title: `<span style="opacity:.6;font-size:11px">${item.type}</span> ${escHtml(item.name)}`,
    body: escHtml(item.description || ''),
    meta: item.category || '',
    approveUrl: `/api/review/skill/${encodeURIComponent(item.name)}/approve`,
    rejectUrl:  `/api/review/skill/${encodeURIComponent(item.name)}/reject`,
    rejectLabel: 'Deprecate draft',
  }))

  renderReviewSection('review-components', 'Components', data.components || [], 'component', t.components, (item) => ({
    id: item.id,
    entityType: 'component',
    title: `<span style="opacity:.6;font-size:11px">${item.section_type}</span> ${escHtml(item.name)}`,
    body: escHtml(item.description || ''),
    meta: item.project || '',
    approveUrl: `/api/review/component/${item.id}/approve`,
    rejectUrl:  `/api/review/component/${item.id}/reject`,
    rejectLabel: 'Deprecate draft',
  }))

  renderProposalSection('review-proposals', data.proposals || [])
}

window.loadMoreReview = () => {
  _reviewPage.offset += _reviewPage.limit
  renderReview()
}

function renderReviewSection(containerId, label, items, sectionType, totalCount, mapper) {
  const el = document.getElementById(containerId)
  if (!el || !items.length) return

  const sectionPlural = sectionType + 's'
  const total = typeof totalCount === 'number' ? totalCount : items.length
  const showingNote = total > items.length ? `showing ${items.length} of ${total}` : `${items.length}`

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 8px;gap:12px;flex-wrap:wrap">
      <div class="card-title" style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin:0">${label} <span class="count">(${showingNote})</span></div>
      ${items.length > 1 ? `
      <div style="display:flex;gap:6px">
        <button onclick="reviewBulk('approve','${sectionPlural}')" style="padding:3px 10px;border-radius:6px;background:rgba(74,222,128,.08);border:1px solid var(--green);color:var(--green);font-size:11px;cursor:pointer">✓ Approve all visible</button>
        <button onclick="reviewBulk('reject','${sectionPlural}')" style="padding:3px 10px;border-radius:6px;background:rgba(248,113,113,.08);border:1px solid var(--red);color:var(--red);font-size:11px;cursor:pointer">Reject all visible</button>
      </div>` : ''}
    </div>
    <div data-review-section="${sectionPlural}">
    ${items.map(item => {
      const { id, title, body, meta, approveUrl, rejectUrl, rejectLabel, entityType } = mapper(item)
      const auditElId = `audit-${containerId}-${id}`.replace(/[^a-zA-Z0-9-]/g, '-')
      return `
        <div class="card" style="margin-bottom:8px" data-review-id="${escHtml(String(id))}">
          <div style="font-weight:600;margin-bottom:4px">${title}</div>
          ${meta ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${escHtml(meta)}</div>` : ''}
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">${body}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="reviewAction('${approveUrl}', this)" style="padding:4px 14px;border-radius:6px;background:rgba(74,222,128,.12);border:1px solid var(--green);color:var(--green);font-size:12px;cursor:pointer;font-weight:600">✓ Approve</button>
            <button onclick="reviewAction('${rejectUrl}', this)" style="padding:4px 14px;border-radius:6px;background:rgba(248,113,113,.1);border:1px solid var(--red);color:var(--red);font-size:12px;cursor:pointer">${rejectLabel}</button>
            <button onclick="loadAuditLog('${entityType || sectionType}','${id}','${auditElId}')" style="padding:4px 10px;border-radius:6px;background:transparent;border:1px solid var(--border);color:var(--text-muted);font-size:11px;cursor:pointer">Log</button>
          </div>
          <div id="${auditElId}" style="margin-top:8px;font-size:11px;color:var(--text-dim)"></div>
        </div>`
    }).join('')}
    </div>`
}

async function loadAuditLog(entityType, entityId, elId) {
  const el = document.getElementById(elId)
  if (!el) return
  if (el.dataset.loaded) { el.style.display = el.style.display === 'none' ? 'block' : 'none'; return }
  try {
    const data = await api.get(`/api/audit/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`)
    const entries = data.entries || []
    el.innerHTML = entries.length
      ? entries.map(e => `<div style="padding:2px 0;border-top:1px solid var(--border-subtle,#1a1a2a)">${escHtml(e.action)} by <b>${escHtml(e.reviewedBy)}</b> on ${e.createdAt?.slice(0,16).replace('T',' ')}</div>`).join('')
      : '<div style="color:var(--text-dim)">No audit entries yet.</div>'
    el.dataset.loaded = '1'
  } catch { el.textContent = 'Could not load audit log.' }
}

function renderProposalSection(containerId, proposals) {
  const el = document.getElementById(containerId)
  if (!el || !proposals.length) return

  el.innerHTML = `
    <div class="card-title" style="margin:20px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Skill Update Suggestions <span class="count">(${proposals.length})</span></div>
    ${proposals.map(p => {
      const memIds = JSON.parse(p.memory_ids || '[]')
      const hasContent = !!p.proposed_content
      return `
        <div class="card" style="margin-bottom:8px" id="proposal-${p.id}">
          <div style="font-weight:600;margin-bottom:4px">💡 ${escHtml(p.skill_name)}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
            ${memIds.length} memor${memIds.length === 1 ? 'y' : 'ies'} accumulated — skill may need updating
          </div>
          ${hasContent ? `
          <details style="margin-bottom:12px">
            <summary style="font-size:12px;color:var(--text-muted);cursor:pointer;margin-bottom:6px">Preview generated content</summary>
            <pre style="font-size:11px;background:var(--bg-surface,#111);border:1px solid var(--border);border-radius:6px;padding:10px;overflow:auto;max-height:200px;white-space:pre-wrap;color:var(--text-secondary)">${escHtml(p.proposed_content.slice(0, 1500))}${p.proposed_content.length > 1500 ? '\n...' : ''}</pre>
          </details>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${!hasContent ? `
            <button onclick="generateSkillUpdate('${p.id}', this)" style="padding:4px 14px;border-radius:6px;background:rgba(251,191,36,.12);border:1px solid var(--yellow,#f59e0b);color:var(--yellow,#f59e0b);font-size:12px;cursor:pointer;font-weight:600">⚡ Generate Update</button>
            ` : `
            <button onclick="applySkillUpdate('${p.id}', this)" style="padding:4px 14px;border-radius:6px;background:rgba(74,222,128,.12);border:1px solid var(--green);color:var(--green);font-size:12px;cursor:pointer;font-weight:600">✓ Apply to Skill</button>
            <button onclick="generateSkillUpdate('${p.id}', this)" style="padding:4px 14px;border-radius:6px;background:rgba(251,191,36,.08);border:1px solid var(--border);color:var(--text-muted);font-size:12px;cursor:pointer">Regenerate</button>
            `}
            <button onclick="reviewAction('/api/review/proposal/${p.id}/dismiss', this)" style="padding:4px 14px;border-radius:6px;background:transparent;border:1px solid var(--border);color:var(--text-muted);font-size:12px;cursor:pointer">Dismiss</button>
          </div>
        </div>`
    }).join('')}`
}

// ── Whiteboards ──

let _wbSelected = new Set()
let _wbCurrentScope = ''
let _wbCurrentTab = 'all'  // 'all' | 'pinned' | 'trash'
let _wbCurrentSearch = ''
let _wbCurrentTag = ''

export async function renderWhiteboards() {
  const page = document.getElementById('page')
  page.innerHTML = `
    <div class="page-header">
      <h1>Whiteboards</h1>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="wb-search" type="search" placeholder="Search by name/description..." autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-size:13px;min-width:240px">
        <select id="wb-filter-scope" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-size:13px">
          <option value="">All scopes</option>
          <option value="team">Team</option>
          <option value="project">Per-project</option>
        </select>
        <button id="wb-new" style="padding:8px 16px;border-radius:6px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;font-weight:600;cursor:pointer;font-size:13px">+ New Whiteboard</button>
      </div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-top:16px;margin-bottom:14px">
      <button class="wb-tab" data-tab="all"    style="padding:8px 16px;background:none;border:none;color:var(--accent);border-bottom:2px solid var(--accent);font-size:13px;cursor:pointer;font-weight:600">All</button>
      <button class="wb-tab" data-tab="pinned" style="padding:8px 16px;background:none;border:none;color:var(--text-muted);border-bottom:2px solid transparent;font-size:13px;cursor:pointer">📌 Pinned</button>
      <button class="wb-tab" data-tab="trash"  style="padding:8px 16px;background:none;border:none;color:var(--text-muted);border-bottom:2px solid transparent;font-size:13px;cursor:pointer">🗑 Trash</button>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px;padding:0 8px">
        <span id="wb-tag-filter-active" style="font-size:11px;color:var(--text-muted);display:none"></span>
        <span id="wb-bulk-bar" style="display:none;font-size:12px;color:var(--accent)"></span>
      </div>
    </div>

    <!-- Content area: tag sidebar + grid -->
    <div style="display:grid;grid-template-columns:200px 1fr;gap:18px;align-items:start">
      <aside id="wb-tag-cloud" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px">
        <div style="color:var(--text-muted);text-transform:uppercase;font-size:10px;letter-spacing:.5px;margin-bottom:6px">Tags</div>
        <div id="wb-tag-cloud-list" style="display:flex;flex-direction:column;gap:3px"></div>
      </aside>
      <div>
        <div id="wb-recent-section" style="margin-bottom:18px;display:none">
          <h3 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Recent</h3>
          <div id="wb-recent-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px"></div>
        </div>
        <div id="wb-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
          <div style="color:var(--text-muted)">Loading...</div>
        </div>
      </div>
    </div>
  `
  document.getElementById('wb-new').onclick = newWhiteboardPrompt
  document.getElementById('wb-filter-scope').onchange = (e) => { _wbCurrentScope = e.target.value; loadList() }
  let searchTimer
  document.getElementById('wb-search').oninput = (e) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { _wbCurrentSearch = e.target.value.trim(); loadList() }, 250)
  }
  document.querySelectorAll('.wb-tab[data-tab]').forEach(t => {
    t.onclick = () => {
      _wbCurrentTab = t.dataset.tab
      _wbSelected = new Set()
      document.querySelectorAll('.wb-tab[data-tab]').forEach(b => {
        const active = b.dataset.tab === _wbCurrentTab
        b.style.color = active ? 'var(--accent)' : 'var(--text-muted)'
        b.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent'
        b.style.fontWeight = active ? '600' : '400'
      })
      loadList()
    }
  })
  loadTagCloud()
  loadRecent()
  loadList()

  async function loadTagCloud() {
    try {
      const { tags } = await fetch('/api/whiteboards/tags', { credentials: 'include' }).then(r => r.json())
      const list = document.getElementById('wb-tag-cloud-list')
      if (!tags.length) { list.innerHTML = '<div style="color:var(--text-muted)">No tags yet</div>'; return }
      list.innerHTML = `
        <button class="wb-tag-pill" data-tag="" style="padding:4px 8px;background:transparent;border:none;border-radius:4px;color:var(--text);text-align:left;cursor:pointer;font-size:12px">All</button>
        ${tags.map(t => `<button class="wb-tag-pill" data-tag="${escHtml(t.tag)}" style="padding:4px 8px;background:transparent;border:none;border-radius:4px;color:var(--text);text-align:left;cursor:pointer;font-size:12px">${escHtml(t.tag)} <span style="color:var(--text-muted);font-size:10px">${t.count}</span></button>`).join('')}
      `
      list.querySelectorAll('[data-tag]').forEach(b => {
        b.onclick = () => {
          _wbCurrentTag = b.dataset.tag
          list.querySelectorAll('[data-tag]').forEach(x => x.style.background = 'transparent')
          b.style.background = 'rgba(99,102,241,.2)'
          const lbl = document.getElementById('wb-tag-filter-active')
          if (_wbCurrentTag) { lbl.style.display = 'inline'; lbl.textContent = `Tag: ${_wbCurrentTag}` }
          else lbl.style.display = 'none'
          loadList()
        }
      })
    } catch (err) { /* ignore — tag cloud is optional */ }
  }

  async function loadRecent() {
    if (_wbCurrentTab !== 'all' || _wbCurrentSearch || _wbCurrentTag) {
      document.getElementById('wb-recent-section').style.display = 'none'
      return
    }
    try {
      const { boards } = await fetch('/api/whiteboards/recent?limit=5', { credentials: 'include' }).then(r => r.json())
      const sec = document.getElementById('wb-recent-section')
      if (!boards.length) { sec.style.display = 'none'; return }
      sec.style.display = 'block'
      const grid2 = document.getElementById('wb-recent-grid')
      grid2.innerHTML = boards.map(b => `
        <a href="/whiteboard.html?id=${encodeURIComponent(b.id)}" style="text-decoration:none;color:inherit">
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:4px">
            <div style="font-weight:600;font-size:13px;color:var(--text)">${b.pinnedAt ? '📌 ' : ''}${escHtml(b.name)}</div>
            <div style="font-size:10px;color:var(--text-muted)">${b.scope === 'team' ? 'team' : escHtml(b.projectName || 'project')} · ${(b.lastOpenedAt || b.updatedAt).split('T')[0]}</div>
          </div>
        </a>
      `).join('')
    } catch {}
  }

  async function loadList() {
    const grid = document.getElementById('wb-grid')
    grid.innerHTML = `<div style="color:var(--text-muted);grid-column:1/-1;padding:20px">Loading...</div>`
    try {
      const params = new URLSearchParams()
      if (_wbCurrentScope) params.set('scope', _wbCurrentScope)
      if (_wbCurrentSearch) params.set('search', _wbCurrentSearch)
      if (_wbCurrentTag) params.set('tag', _wbCurrentTag)
      if (_wbCurrentTab === 'pinned') params.set('pinned', '1')
      if (_wbCurrentTab === 'trash') params.set('trashed', '1')
      const qs = params.toString() ? `?${params}` : ''
      const data = await api.get('/api/whiteboards' + qs)
      const boards = data.boards || []
      loadRecent()
      if (!boards.length) {
        const emptyMsg = _wbCurrentTab === 'trash' ? 'Trash is empty.'
          : _wbCurrentTab === 'pinned' ? 'No pinned whiteboards. Hover a card and click 📌 to pin.'
          : (_wbCurrentSearch || _wbCurrentTag) ? 'No matches with current filters.'
          : 'No whiteboards yet. Click <strong>+ New Whiteboard</strong> to create one.'
        grid.innerHTML = `<div style="color:var(--text-muted);grid-column:1/-1;padding:20px;text-align:center">${emptyMsg}</div>`
        return
      }
      const isTrash = _wbCurrentTab === 'trash'
      grid.innerHTML = boards.map(b => `
        <div class="wb-list-card" data-id="${escHtml(b.id)}" style="position:relative;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px;transition:border-color .15s">
          <input type="checkbox" class="wb-card-check" data-check="${escHtml(b.id)}" style="position:absolute;top:8px;left:8px;z-index:3;width:16px;height:16px;cursor:pointer;${_wbSelected.has(b.id) ? '' : 'opacity:0;'}transition:opacity .15s">
          <div class="wb-card-actions" style="position:absolute;top:8px;right:8px;display:flex;gap:4px;opacity:0;transition:opacity .15s;z-index:2">
            ${isTrash ? `
              <button class="wb-restore-btn" data-id="${escHtml(b.id)}" title="Restore" style="width:28px;height:28px;background:rgba(34,197,94,.85);border:none;border-radius:50%;color:#fff;cursor:pointer;font-size:14px">↶</button>
              <button class="wb-perm-del-btn" data-id="${escHtml(b.id)}" data-name="${escHtml(b.name)}" title="Delete forever" style="width:28px;height:28px;background:rgba(220,38,38,.95);border:none;border-radius:50%;color:#fff;cursor:pointer;font-size:14px">×</button>
            ` : `
              <button class="wb-pin-btn" data-id="${escHtml(b.id)}" title="${b.pinnedAt ? 'Unpin' : 'Pin'}" style="width:28px;height:28px;background:rgba(99,102,241,.85);border:none;border-radius:50%;color:#fff;cursor:pointer;font-size:14px">${b.pinnedAt ? '📍' : '📌'}</button>
              <button class="wb-dup-btn" data-id="${escHtml(b.id)}" data-name="${escHtml(b.name)}" title="Duplicate" style="width:28px;height:28px;background:rgba(99,102,241,.85);border:none;border-radius:50%;color:#fff;cursor:pointer;font-size:14px">⎘</button>
              <button class="wb-merge-btn" data-merge-id="${escHtml(b.id)}" data-merge-name="${escHtml(b.name)}" title="Merge another board into this one" style="width:28px;height:28px;background:rgba(99,102,241,.85);border:none;border-radius:50%;color:#fff;cursor:pointer;font-size:14px">⇋</button>
              <button class="wb-delete-btn" data-del-id="${escHtml(b.id)}" data-del-name="${escHtml(b.name)}" title="Move to trash" style="width:28px;height:28px;background:rgba(220,38,38,.85);border:none;border-radius:50%;color:#fff;cursor:pointer;font-size:14px">🗑</button>
            `}
          </div>
          <a href="/whiteboard.html?id=${encodeURIComponent(b.id)}" style="text-decoration:none;color:inherit;display:block">
            <div style="aspect-ratio:16/9;background:var(--bg-surface,#0d0d14);border-radius:6px;margin-bottom:10px;overflow:hidden;display:flex;align-items:center;justify-content:center">
              ${b.thumbnailDataUrl ? `<img src="${b.thumbnailDataUrl}" style="width:100%;height:100%;object-fit:cover">` : `<span style="color:var(--text-muted);font-size:12px">No preview</span>`}
            </div>
            <div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:6px">${b.pinnedAt ? '<span style="font-size:11px">📌</span>' : ''}${escHtml(b.name)}</div>
            ${b.description ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${escHtml(b.description)}</div>` : ''}
            ${b.tags && b.tags.length ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px">${b.tags.map(t => `<span style="font-size:9px;background:rgba(99,102,241,.15);color:#a5b4fc;padding:1px 5px;border-radius:3px">${escHtml(t)}</span>`).join('')}</div>` : ''}
            <div style="font-size:11px;color:var(--text-muted);display:flex;gap:8px;align-items:center">
              <span style="padding:1px 7px;border-radius:8px;background:${b.scope === 'team' ? 'rgba(99,102,241,.15)' : 'rgba(168,85,247,.15)'};color:${b.scope === 'team' ? '#a5b4fc' : '#c4b5fd'}">${b.scope === 'team' ? 'team' : escHtml(b.projectName || 'project')}</span>
              <span>${escHtml((b.createdBy || '').split('@')[0])}</span>
              <span style="margin-left:auto">${b.updatedAt.split('T')[0]}</span>
            </div>
          </a>
        </div>
      `).join('')
      wireCardEvents(grid, boards)
      updateBulkBar()
    } catch (err) {
      grid.innerHTML = `<div style="color:#f87171;grid-column:1/-1;padding:20px">Error: ${escHtml(err.message)}</div>`
    }
  }

  function wireCardEvents(grid, boards) {
    const isTrash = _wbCurrentTab === 'trash'
    grid.querySelectorAll('.wb-list-card').forEach(card => {
      const actions = card.querySelector('.wb-card-actions')
      const check = card.querySelector('.wb-card-check')
      card.addEventListener('mouseenter', () => { actions.style.opacity = '1'; if (!check.checked) check.style.opacity = '0.5' })
      card.addEventListener('mouseleave', () => { actions.style.opacity = '0'; if (!check.checked) check.style.opacity = '0' })
      check.addEventListener('change', () => {
        if (check.checked) { _wbSelected.add(card.dataset.id); check.style.opacity = '1' }
        else { _wbSelected.delete(card.dataset.id); check.style.opacity = '0' }
        updateBulkBar()
      })
      check.addEventListener('click', e => e.stopPropagation())
    })
    grid.querySelectorAll('.wb-pin-btn').forEach(btn => btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation()
      try { await api.post('/api/whiteboards/' + encodeURIComponent(btn.dataset.id) + '/pin', {}); loadList() } catch (err) { alert(err.message) }
    })
    grid.querySelectorAll('.wb-dup-btn').forEach(btn => btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation()
      const newName = prompt('New name:', btn.dataset.name + ' (copy)')
      if (!newName) return
      try { await api.post('/api/whiteboards/' + encodeURIComponent(btn.dataset.id) + '/duplicate', { newName }); loadList() } catch (err) { alert(err.message) }
    })
    grid.querySelectorAll('.wb-delete-btn').forEach(btn => btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation()
      if (!confirm(`Move "${btn.dataset.delName}" to trash?`)) return
      try { await api.del('/api/whiteboards/' + encodeURIComponent(btn.dataset.delId)); loadList() } catch (err) { alert(err.message) }
    })
    grid.querySelectorAll('.wb-restore-btn').forEach(btn => btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation()
      try { await api.post('/api/whiteboards/' + encodeURIComponent(btn.dataset.id) + '/restore', {}); loadList() } catch (err) { alert(err.message) }
    })
    grid.querySelectorAll('.wb-perm-del-btn').forEach(btn => btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation()
      if (!confirm(`Permanently delete "${btn.dataset.name}"? This CANNOT be undone.`)) return
      try { await api.del('/api/whiteboards/' + encodeURIComponent(btn.dataset.id) + '?permanent=true'); loadList() } catch (err) { alert(err.message) }
    })
    grid.querySelectorAll('.wb-merge-btn').forEach(btn => btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation()
      const targetId = btn.dataset.mergeId, targetName = btn.dataset.mergeName
      const others = boards.filter(b => b.id !== targetId)
      if (!others.length) { alert('No other whiteboards to merge.'); return }
      const choices = others.map((b, i) => `${i + 1}. ${b.name} (${b.scope})`).join('\n')
      const pick = prompt(`Merge ANOTHER board INTO "${targetName}".\nPick by number:\n\n${choices}`)
      if (!pick) return
      const idx = parseInt(pick, 10) - 1
      if (isNaN(idx) || idx < 0 || idx >= others.length) return
      const source = others[idx]
      const del = confirm(`Merge "${source.name}" → "${targetName}".\n\nDelete source after?\nOK = delete · Cancel = keep`)
      try {
        await mergeBoards(source.id, targetId)
        if (del) await api.del('/api/whiteboards/' + encodeURIComponent(source.id))
        loadList()
      } catch (err) { alert(err.message) }
    })
  }

  function updateBulkBar() {
    const bar = document.getElementById('wb-bulk-bar')
    if (!bar) return
    if (_wbSelected.size === 0) { bar.style.display = 'none'; return }
    const isTrash = _wbCurrentTab === 'trash'
    bar.style.display = 'inline-flex'
    bar.innerHTML = `
      <strong>${_wbSelected.size} selected</strong>
      ${isTrash
        ? `<button onclick="window.wbBulkAction('restore')" style="margin-left:8px;padding:2px 10px;background:rgba(34,197,94,.2);border:1px solid #22c55e;color:#34d399;border-radius:4px;cursor:pointer;font-size:11px">Restore</button>
           <button onclick="window.wbBulkAction('permanent-delete')" style="margin-left:4px;padding:2px 10px;background:rgba(220,38,38,.2);border:1px solid #dc2626;color:#f87171;border-radius:4px;cursor:pointer;font-size:11px">Delete forever</button>`
        : `<button onclick="window.wbBulkAction('pin')" style="margin-left:8px;padding:2px 10px;background:rgba(99,102,241,.2);border:1px solid #6366f1;color:#a5b4fc;border-radius:4px;cursor:pointer;font-size:11px">Pin</button>
           <button onclick="window.wbBulkAction('unpin')" style="margin-left:4px;padding:2px 10px;background:rgba(99,102,241,.1);border:1px solid #6366f1;color:#a5b4fc;border-radius:4px;cursor:pointer;font-size:11px">Unpin</button>
           <button onclick="window.wbBulkAction('delete')" style="margin-left:4px;padding:2px 10px;background:rgba(220,38,38,.2);border:1px solid #dc2626;color:#f87171;border-radius:4px;cursor:pointer;font-size:11px">Trash</button>`
      }
      <button onclick="window.wbBulkClear()" style="margin-left:4px;padding:2px 10px;background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;cursor:pointer;font-size:11px">Clear</button>
    `
  }

  // Expose bulk action handlers globally so the inline onclick attributes work
  window.wbBulkAction = async (action) => {
    if (!_wbSelected.size) return
    try {
      await api.post('/api/whiteboards/bulk', { ids: [..._wbSelected], action })
      _wbSelected = new Set()
      loadList()
    } catch (err) { alert(err.message) }
  }
  window.wbBulkClear = () => {
    _wbSelected = new Set()
    document.querySelectorAll('.wb-card-check').forEach(c => { c.checked = false; c.style.opacity = '0' })
    updateBulkBar()
  }

  /** Merge source board's nodes/connectors into target. Offsets x/y to avoid overlap. */
  async function mergeBoards(sourceId, targetId) {
    const [{ board: src }, { board: tgt }] = await Promise.all([
      api.get('/api/whiteboards/' + encodeURIComponent(sourceId)),
      api.get('/api/whiteboards/' + encodeURIComponent(targetId)),
    ])
    const srcState = JSON.parse(src.stateJson || '{}')
    const tgtState = JSON.parse(tgt.stateJson || '{"nodes":[],"connectors":[],"viewport":{"x":0,"y":0,"zoom":1}}')
    // Offset: place merged content to the right of the target's existing content
    let maxX = 0
    for (const n of (tgtState.nodes || [])) maxX = Math.max(maxX, (n.x || 0) + (n.w || 0))
    const offsetX = maxX > 0 ? maxX + 80 : 0
    // Re-id all source nodes & connectors to avoid collisions
    const idMap = {}
    const newNodes = (srcState.nodes || []).map(n => {
      const newId = (n.type || 'n') + '-' + Math.random().toString(36).slice(2, 8)
      idMap[n.id] = newId
      return { ...n, id: newId, x: (n.x || 0) + offsetX }
    })
    const newConnectors = (srcState.connectors || []).map(c => ({
      ...c,
      id: 'conn-' + Math.random().toString(36).slice(2, 8),
      from: idMap[c.from] || c.from,
      to: idMap[c.to] || c.to,
    }))
    const merged = {
      nodes: [...(tgtState.nodes || []), ...newNodes],
      connectors: [...(tgtState.connectors || []), ...newConnectors],
      viewport: tgtState.viewport || { x: 0, y: 0, zoom: 1 },
    }
    await api.put('/api/whiteboards/' + encodeURIComponent(targetId), {
      stateJson: JSON.stringify(merged),
      expectedVersion: tgt.stateVersion,
    })
  }

  async function newWhiteboardPrompt() {
    const name = prompt('Whiteboard name:')
    if (!name) return
    const scope = confirm('Make this a TEAM-wide whiteboard?\n\nClick OK for "team", Cancel to attach to a project.') ? 'team' : 'project'
    let projectName = null
    if (scope === 'project') {
      projectName = prompt('Project name (must exist in Synapse):')
      if (!projectName) return
    }
    try {
      const { board } = await api.post('/api/whiteboards', { name, scope, projectName })
      location.href = '/whiteboard.html?id=' + encodeURIComponent(board.id)
    } catch (err) {
      alert('Create failed: ' + err.message)
    }
  }
}

export function renderStudio() {
  const page = document.getElementById('page')
  page.innerHTML = `
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin:-20px -28px 0;padding:0 28px">
      <button id="studio-tab-ds" onclick="switchStudioTab('ds')" style="background:none;border:none;border-bottom:2px solid var(--accent);color:var(--text);padding:12px 18px;font-size:13px;font-weight:500;cursor:pointer">Design System</button>
      <button id="studio-tab-proto" onclick="switchStudioTab('proto')" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--text-muted);padding:12px 18px;font-size:13px;font-weight:500;cursor:pointer">Prototype Generator</button>
    </div>
    <div id="studio-content" style="margin:0 -28px;height:calc(100vh - 84px)">
      <iframe id="studio-iframe-ds" src="/ds-studio/" style="display:block;width:100%;height:100%;border:none"></iframe>
      <iframe id="studio-iframe-proto" src="/studio/" style="display:none;width:100%;height:100%;border:none"></iframe>
    </div>
  `
}

window.switchStudioTab = function(tab) {
  const dsTab = document.getElementById('studio-tab-ds')
  const protoTab = document.getElementById('studio-tab-proto')
  const dsFrame = document.getElementById('studio-iframe-ds')
  const protoFrame = document.getElementById('studio-iframe-proto')
  if (tab === 'ds') {
    dsTab.style.borderBottom = '2px solid var(--accent)'
    dsTab.style.color = 'var(--text)'
    protoTab.style.borderBottom = '2px solid transparent'
    protoTab.style.color = 'var(--text-muted)'
    dsFrame.style.display = 'block'
    protoFrame.style.display = 'none'
  } else {
    protoTab.style.borderBottom = '2px solid var(--accent)'
    protoTab.style.color = 'var(--text)'
    dsTab.style.borderBottom = '2px solid transparent'
    dsTab.style.color = 'var(--text-muted)'
    protoFrame.style.display = 'block'
    dsFrame.style.display = 'none'
  }
}
