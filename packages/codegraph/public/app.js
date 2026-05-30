// Synapse — SPA orchestrator
// Routing, event listeners, and init only. All rendering is in js/render.js.
// All modal logic is in js/modal.js. All fetch logic is in js/api.js.

import { api } from './js/api.js'
import { openCommandPalette, toggleCommandPalette } from './js/command-palette.js'
import {
  openEditProjectModal, closeEditModal, saveProject, switchEditTab,
  editField, editSelect, memberRow,
  showMergeDialog, closeMergeModal, confirmMerge,
  showDsMergeDialog, closeDsMergeModal, confirmDsMerge,
  removeStackTag,
} from './js/modal.js'
import {
  renderHome, renderSkills, renderSkillsHealth, searchSkills, openSkillDetail,
  openSkillEditModal, saveSkillEdit, deleteSkill,
  renderMemories, searchMemories, openMemoryDetail,
  renderSessions, renderProjects, renderProjectDetail,
  renderProjectTab, applyProjectFilters, loadEnvVars, searchGlobal, renderWorkLog,
  renderComponents, openComponentDetail as renderOpenComponentDetail,
  renderDesignSystems, openDesignSystemDetail, renderScanReview,
  renderReview,
  renderWhiteboards,
  renderStudio,
  escHtml,
} from './js/render.js'

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]

// ── State ──
let currentPage = 'home'

// ── Router ──
function route() {
  const raw = location.hash.slice(1) || '/'
  const [path] = raw.split('?')           // strip query
  const parts = path.split('/')
  const page = parts[1] || 'home'
  const arg = parts[2] ? decodeURIComponent(parts[2]) : null
  currentPage = page

  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page))

  const searchBar = document.getElementById('search-bar')
  if (searchBar) searchBar.style.display = page === 'studio' ? 'none' : ''

  const searchEl = $('#global-search')
  searchEl.value = ''
  searchEl.placeholder = page === 'skills' ? 'Search skills...'
    : page === 'memories' ? 'Search memories...'
    : 'Search skills and memories...'

  switch (page) {
    case 'projects': renderProjects(); break
    case 'worklog': renderWorkLog(); break
    case 'skills': renderSkills(arg); break
    case 'memories': renderMemories(arg); break
    case 'sessions': renderSessions(); break
    case 'whiteboards': renderWhiteboards(); break
    case 'components': renderComponents(); break
    case 'design-systems': renderDesignSystems(); break
    case 'team': renderTeam(); break
    case 'review': renderReview(); break
    case 'profile': renderProfile(); break
    case 'my-env': renderMyEnv(); break
    case 'studio': renderStudio(); break
    default: renderHome()
  }
}

window.addEventListener('hashchange', route)

// Re-render when clicking the already-active nav item (hash doesn't change → no hashchange event)
document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', (e) => {
  if (n.dataset.page === currentPage) {
    e.preventDefault()
    route()
  }
}))

// ── Search ──
let searchTimeout
$('#global-search')?.addEventListener('input', (e) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    const q = e.target.value.trim()
    if (!q) { route(); return }
    if (currentPage === 'skills') searchSkills(q)
    else if (currentPage === 'memories') searchMemories(q)
    else searchGlobal(q)
  }, 300)
})

// ── Command Palette (⌘K / Ctrl+K) ──
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    toggleCommandPalette()  // open if closed, close if open (spec: toggle)
  }
})
window.openCommandPalette = openCommandPalette

// ── Detail Panel ──
$('#detail-close')?.addEventListener('click', closeDetail)

function openDetail(title, html) {
  $('#detail-title').textContent = title
  $('#detail-content').innerHTML = html
  $('#detail-panel').classList.remove('hidden')
}

function closeDetail() {
  $('#detail-panel').classList.add('hidden')
}

// ── Component detail ──
async function openComponentDetail(id) {
  await renderOpenComponentDetail(id, openDetail)
}
window.openComponentDetail = openComponentDetail

async function addComponentComment(componentId) {
  const input = document.getElementById(`comment-input-${componentId}`)
  const text = input?.value?.trim()
  if (!text) return
  const r = await fetch(`/api/components/${encodeURIComponent(componentId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) { alert('Failed to add comment'); return }
  if (input) input.value = ''
  await openComponentDetail(componentId)
}
window.addComponentComment = addComponentComment

async function deleteComponentComment(componentId, commentId) {
  if (!confirm('Delete this comment?')) return
  const r = await fetch(`/api/components/${encodeURIComponent(componentId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' })
  if (!r.ok) { alert('Delete failed'); return }
  await openComponentDetail(componentId)
}
window.deleteComponentComment = deleteComponentComment

// ── Project detail ──
async function openProjectDetail(name) {
  await renderProjectDetail(name, openDetail)
}

function switchProjectTab(tab, name) {
  document.querySelectorAll('.proj-tab').forEach(b => {
    const active = b.dataset.tab === tab
    b.classList.toggle('active', active)
    b.setAttribute('aria-selected', active ? 'true' : 'false')
  })
  renderProjectTab(tab, name)
}

function setActivityFilter(filter, name) {
  window._activityFilter = filter
  if (typeof window._renderProjectTab === 'function') {
    window._renderProjectTab('activity', name)
  }
}
window.setActivityFilter = setActivityFilter

// ── Memory actions ──
async function deleteMemory(id) {
  if (!confirm('Delete this memory permanently?')) return
  const r = await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (r.ok) { closeDetail(); route() }
  else alert('Delete failed')
}

async function deprecateMemory(id) {
  const r = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'deprecated' }),
  })
  if (r.ok) { closeDetail(); route() }
  else alert('Update failed')
}

// ── Session actions ──
async function cleanupDuplicates() {
  if (!confirm('Delete duplicate in-progress sessions (keeps most recent per project)?')) return
  const r = await fetch('/api/sessions/cleanup-duplicates', { method: 'POST' })
  const d = await r.json()
  alert(`Deleted ${d.deleted || 0} duplicate sessions`)
  renderSessions()
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (r.ok) renderSessions()
  else alert('Delete failed')
}

// ── Env Var actions ──
async function revealEnv(project, varName) {
  const r = await fetch(`/api/projects-meta/${encodeURIComponent(project)}/env/reveal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ varName }),
  })
  if (!r.ok) { alert('Failed'); return }
  const { value } = await r.json()
  prompt(`${varName} (copy below):`, value)
}

async function exportEnv(project) {
  const r = await fetch(`/api/projects-meta/${encodeURIComponent(project)}/env/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  if (!r.ok) { alert('Failed'); return }
  const { content, count } = await r.json()
  try {
    await navigator.clipboard.writeText(content)
    alert(`Copied ${count} env vars to clipboard`)
  } catch {
    prompt(`.env content (${count} vars):`, content)
  }
}

async function importEnv(project) {
  const content = prompt('Paste .env content:')
  if (!content) return
  const r = await fetch(`/api/projects-meta/${encodeURIComponent(project)}/env/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envContent: content }),
  })
  const { saved } = await r.json()
  alert(`Saved ${saved} env vars`)
  loadEnvVars(project)
}

function toggleEnvAddForm(show) {
  const form = document.getElementById('env-add-form')
  if (!form) return
  const willShow = show === undefined ? form.hasAttribute('hidden') : !!show
  if (willShow) {
    form.removeAttribute('hidden')
    const nameInput = document.getElementById('env-add-name')
    if (nameInput) {
      // Default secret toggle based on var name as user types
      nameInput.oninput = () => {
        const secret = document.getElementById('env-add-secret')
        if (!secret) return
        const v = nameInput.value || ''
        secret.checked = !(v.startsWith('NEXT_PUBLIC_') || v.startsWith('PUBLIC_'))
      }
      nameInput.focus()
    }
  } else {
    form.setAttribute('hidden', '')
    const nameInput = document.getElementById('env-add-name')
    const valueInput = document.getElementById('env-add-value')
    if (nameInput) nameInput.value = ''
    if (valueInput) valueInput.value = ''
  }
}

async function addEnvVar(project) {
  const nameInput = document.getElementById('env-add-name')
  const valueInput = document.getElementById('env-add-value')
  const secretInput = document.getElementById('env-add-secret')
  if (!nameInput || !valueInput) return
  const varName = nameInput.value.trim()
  const value = valueInput.value
  if (!varName) { nameInput.focus(); return }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
    alert('Variable name must match [A-Za-z_][A-Za-z0-9_]*')
    nameInput.focus()
    return
  }
  const isSecret = secretInput ? !!secretInput.checked : !(varName.startsWith('NEXT_PUBLIC_') || varName.startsWith('PUBLIC_'))
  const r = await fetch(`/api/projects-meta/${encodeURIComponent(project)}/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ varName, value, isSecret, source: 'manual-ui' }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }))
    alert('Failed to save: ' + (err.error || r.statusText))
    return
  }
  toggleEnvAddForm(false)
  loadEnvVars(project)
}

async function deleteEnv(project, varName) {
  if (!confirm(`Delete ${varName}?`)) return
  await fetch(`/api/projects-meta/${encodeURIComponent(project)}/env/${encodeURIComponent(varName)}`, { method: 'DELETE' })
  loadEnvVars(project)
}

// ── Team member helper (used by modal.js — exposed globally for onclick) ──
function addMemberRow() {
  const list = document.getElementById('team-members-list')
  const div = document.createElement('div')
  div.innerHTML = memberRow({}, list.children.length)
  list.appendChild(div.firstElementChild)
}

// ── Expose globals needed by inline onclick handlers ──
window.renderSkills = renderSkills
window.renderSkillsHealth = renderSkillsHealth
window.openSkillEditModal = openSkillEditModal
window.saveSkillEdit = saveSkillEdit
window.deleteSkill = deleteSkill
window.renderMemories = renderMemories
window.openSkillDetail = (name) => openSkillDetail(name, openDetail)
window.openMemoryDetail = (id) => openMemoryDetail(id, openDetail)
window.openProjectDetail = openProjectDetail
window.openProjectBoard = async function(projectName) {
  try {
    const r = await fetch(`/api/whiteboards/projects/${encodeURIComponent(projectName)}/home`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!r.ok) throw new Error((await r.text()) || r.statusText)
    const { board, created } = await r.json()
    if (created) console.log(`Created new home board for ${projectName}`)
    location.href = '/whiteboard.html?id=' + encodeURIComponent(board.id)
  } catch (err) {
    alert('Open project board failed: ' + err.message)
  }
}
window.renderProjects = renderProjects
window.switchProjectTab = switchProjectTab
window.openEditProjectModal = openEditProjectModal
window.closeEditModal = closeEditModal
window.saveProject = saveProject
window.switchEditTab = switchEditTab
window.showMergeDialog = showMergeDialog
window.closeMergeModal = closeMergeModal
window.confirmMerge = confirmMerge
window.showDsMergeDialog = showDsMergeDialog
window.closeDsMergeModal = closeDsMergeModal
window.confirmDsMerge = confirmDsMerge
window.removeStackTag = removeStackTag
window.addMemberRow = addMemberRow
window.deleteMemory = deleteMemory
window.deprecateMemory = deprecateMemory
window.cleanupDuplicates = cleanupDuplicates
window.deleteSession = deleteSession
window.loadEnvVars = loadEnvVars
window.revealEnv = revealEnv
window.exportEnv = exportEnv
window.importEnv = importEnv
window.deleteEnv = deleteEnv
window.addEnvVar = addEnvVar
window.toggleEnvAddForm = toggleEnvAddForm
window.renderComponents = renderComponents
window.openComponentDetail = (id) => openComponentDetail(id, openDetail)
window.renderDesignSystems = renderDesignSystems
window.openDesignSystemDetail = (project) => openDesignSystemDetail(project, openDetail)
window.reviewScan = (project, scanId) => renderScanReview(project, scanId, openDetail)
window.applyScan = async (project, scanId) => {
  const res = await fetch(`/api/design-systems/${encodeURIComponent(project)}/apply-scan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanId, resolved: {} }),
  })
  if (res.ok) { closeDetail(); renderDesignSystems() }
  else alert('Apply failed')
}
window.dismissScan = async (scanId) => {
  if (!confirm('Dismiss this scan? The tokens won\'t be saved.')) return
  await fetch(`/api/design-systems/scans/${scanId}`, { method: 'DELETE' })
  renderDesignSystems()
}

// ── Review Queue ──
window.reviewAction = async (url, btn) => {
  if (btn) btn.disabled = true
  const card = btn?.closest('.card')
  try {
    await api.post(url, {})
    if (card) {
      card.style.transition = 'opacity 180ms, transform 180ms, max-height 220ms'
      card.style.opacity = '0'
      card.style.transform = 'translateX(8px)'
      card.style.maxHeight = card.offsetHeight + 'px'
      requestAnimationFrame(() => { card.style.maxHeight = '0'; card.style.marginBottom = '0'; card.style.paddingTop = '0'; card.style.paddingBottom = '0' })
      setTimeout(() => card.remove(), 240)
    }
    updateReviewBadge()
    // background refresh so totals + next page items stay in sync
    setTimeout(() => { if (location.hash === '#/review') renderReview({ silent: true }) }, 350)
  } catch {
    if (btn) btn.disabled = false
    alert('Action failed — check console.')
  }
}

window.reviewBulk = async (action, entityType) => {
  const cards = document.querySelectorAll(`[data-review-section="${entityType}"] .card`)
  if (!cards.length) return
  if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} all ${cards.length} visible ${entityType}?`)) return
  const ids = Array.from(cards).map(c => c.dataset.reviewId).filter(Boolean)
  for (const id of ids) {
    const url = `/api/review/${entityType.slice(0, -1)}/${encodeURIComponent(id)}/${action}`
    try { await api.post(url, {}) } catch { /* continue */ }
  }
  renderReview()
}

window.generateSkillUpdate = async (proposalId, btn) => {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating...' }
  try {
    await api.post(`/api/review/proposal/${proposalId}/generate`, {})
    renderReview()
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate Update' }
    alert('Generation failed. Check that ANTHROPIC_API_KEY is set.')
  }
}

window.applySkillUpdate = async (proposalId, btn) => {
  if (!confirm('Apply this generated content to the live skill?')) return
  if (btn) btn.disabled = true
  try {
    const result = await api.post(`/api/review/proposal/${proposalId}/apply`, {})
    alert(`Skill "${result.skillName}" updated successfully.`)
    renderReview()
  } catch {
    if (btn) btn.disabled = false
    alert('Apply failed — check console.')
  }
}

async function updateReviewBadge() {
  try {
    const data = await api.get('/api/review/pending')
    const total = (data.memories?.length || 0) + (data.skills?.length || 0) +
      (data.components?.length || 0) + (data.proposals?.length || 0) + (data.dsScans?.length || 0)
    const badge = document.getElementById('review-badge')
    if (badge) {
      badge.textContent = total
      badge.style.display = total > 0 ? 'inline' : 'none'
    }
  } catch { /* non-blocking */ }
}

// ── Projects v2 — handlers ──

function changeProjectView(view) {
  const s = window._projectsState
  if (!s) return
  s.view = view
  try { localStorage.setItem('synapse.projects.view', view) } catch {}
  renderProjects()
}
window.changeProjectView = changeProjectView
window.applyProjectFilters = applyProjectFilters

function toggleProjectFilter(key) {
  // Close all other menus first
  document.querySelectorAll('.proj-filter-pill.open').forEach(p => {
    if (p.dataset.filter !== key) p.classList.remove('open')
  })
  const el = document.querySelector(`.proj-filter-pill[data-filter="${key}"]`)
  if (el) el.classList.toggle('open')
}

function updateProjectFilter(key, value, checked) {
  const s = window._projectsState
  if (!s) return
  const arr = s.filters[key]
  if (checked) { if (!arr.includes(value)) arr.push(value) }
  else { s.filters[key] = arr.filter(v => v !== value) }
  applyProjectFiltersAndRender()
}

function clearProjectFilter(key) {
  const s = window._projectsState
  if (!s) return
  s.filters[key] = []
  applyProjectFiltersAndRender()
  document.querySelector(`.proj-filter-pill[data-filter="${key}"]`)?.classList.remove('open')
}

function clearAllProjectFilters() {
  const s = window._projectsState
  if (!s) return
  s.filters = { status: [], category: [], client: [], stack: [], showArchived: false, search: '' }
  applyProjectFiltersAndRender()
}

function updateProjectSearch(q) {
  const s = window._projectsState
  if (!s) return
  s.filters.search = q
  applyProjectFiltersAndRender()
}

function changeProjectSort(v) {
  const s = window._projectsState
  if (!s) return
  s.sort = v
  applyProjectFiltersAndRender()
}

function sortTableByCol(field) {
  const s = window._projectsState
  if (!s) return
  const [curField, curDir] = s.sort.split('-')
  // Toggle direction if same field; else default: text fields asc, numeric/date fields desc.
  let dir
  if (curField === field) dir = curDir === 'desc' ? 'asc' : 'desc'
  else dir = (field === 'name' || field === 'client' || field === 'category' || field === 'status') ? 'asc' : 'desc'
  s.sort = `${field}-${dir}`
  applyProjectFiltersAndRender()
}
window.sortTableByCol = sortTableByCol

function changeProjectGroup(v) {
  const s = window._projectsState
  if (!s) return
  s.group = v
  applyProjectFiltersAndRender()
}

function toggleShowArchived(v) {
  const s = window._projectsState
  if (!s) return
  s.filters.showArchived = v
  applyProjectFiltersAndRender()
}

// Apply filters then re-render only the filters slot + body.
// We deliberately avoid rebuilding the full toolbar so the search <input> keeps focus.
function applyProjectFiltersAndRender() {
  window.applyProjectFilters()
  if (typeof window._renderProjectsFiltersOnly === 'function') window._renderProjectsFiltersOnly()
  if (typeof window._renderProjectsStats === 'function') window._renderProjectsStats()
  if (typeof window._renderProjectsPinned === 'function') window._renderProjectsPinned()
  if (typeof window._renderProjectsBody === 'function') window._renderProjectsBody()
}

function toggleStatusFromStats(status) {
  const s = window._projectsState
  if (!s) return
  const idx = s.filters.status.indexOf(status)
  if (idx >= 0) s.filters.status.splice(idx, 1)
  else s.filters.status.push(status)
  applyProjectFiltersAndRender()
}
window.toggleStatusFromStats = toggleStatusFromStats

async function toggleProjectPin(name) {
  const s = window._projectsState
  if (!s) return
  // Optimistic UI
  const wasPinned = s.pinned.has(name)
  if (wasPinned) s.pinned.delete(name); else s.pinned.add(name)
  applyProjectFiltersAndRender()
  // Persist via backend
  try {
    const r = await fetch(`/api/projects-meta/${encodeURIComponent(name)}/pin`, {
      method: 'PATCH',
      credentials: 'include',
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const { pinned } = await r.json()
    // Server is authoritative — reconcile if optimistic guess was wrong (rare but possible)
    if (pinned && !s.pinned.has(name)) s.pinned.add(name)
    else if (!pinned && s.pinned.has(name)) s.pinned.delete(name)
    applyProjectFiltersAndRender()
  } catch (err) {
    // Rollback
    if (wasPinned) s.pinned.add(name); else s.pinned.delete(name)
    applyProjectFiltersAndRender()
    alert('Pin failed: ' + (err.message || err))
  }
}
window.toggleProjectPin = toggleProjectPin

function projectDetailNav(delta) {
  const s = window._projectsState
  if (!s) return
  const next = s.detailIndex + delta
  if (next < 0 || next >= s.filtered.length) return
  s.detailIndex = next
  const name = s.filtered[next].name
  if (typeof window.openProjectDetail === 'function') window.openProjectDetail(name)
}
window.projectDetailNav = projectDetailNav

function toggleCardMenu(name, btn) {
  // Close any existing menu first
  document.querySelectorAll('.proj-menu-pop').forEach(m => m.remove())
  const wrap = btn.parentElement
  if (!wrap) return
  const menu = document.createElement('div')
  menu.className = 'proj-menu-pop'
  menu.setAttribute('role', 'menu')
  menu.innerHTML = `
    <button type="button" role="menuitem" data-action="archive">📦 Archive</button>
    <button type="button" role="menuitem" data-action="duplicate">📑 Duplicate</button>
    <button type="button" role="menuitem" data-action="export">⬇ Export JSON</button>
    <div class="sep" role="separator"></div>
    <button type="button" role="menuitem" data-action="delete" class="danger">✕ Delete</button>
  `
  // Attach handlers via closure — no string-interpolation of name into JS source
  menu.querySelectorAll('button[data-action]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      cardAction(b.dataset.action, name)
    })
  })
  wrap.appendChild(menu)
  setTimeout(() => document.addEventListener('click', closeMenuOnClick, { once: true }), 0)
}

function closeMenuOnClick(e) {
  if (!e.target.closest('.proj-menu-pop') && !e.target.closest('.menu-btn')) {
    document.querySelectorAll('.proj-menu-pop').forEach(m => m.remove())
  } else {
    // Re-arm if click was inside a menu/menu-btn but didn't trigger an action
    setTimeout(() => document.addEventListener('click', closeMenuOnClick, { once: true }), 0)
  }
}

async function cardAction(action, name) {
  document.querySelectorAll('.proj-menu-pop').forEach(m => m.remove())
  if (action === 'archive') return archiveProject(name)
  if (action === 'duplicate') return duplicateProject(name)
  if (action === 'export') return exportProject(name)
  if (action === 'delete') return deleteProject(name)
}

async function archiveProject(name) {
  if (!confirm(`Archive "${name}"?`)) return
  try {
    const r = await fetch(`/api/projects-meta/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    renderProjects()
  } catch (err) { alert('Archive failed: ' + (err.message || err)) }
}

async function duplicateProject(name) {
  const suggested = name + '-copy'
  const newName = prompt(`Duplicate "${name}"\n\nNew project name (kebab-case):`, suggested)
  if (!newName || !newName.trim()) return
  const target = newName.trim()
  if (target === name) { alert('New name must differ from the original.'); return }

  // Pre-check target existence — PUT is upsert and would silently overwrite
  try {
    const check = await fetch(`/api/projects-meta/${encodeURIComponent(target)}`)
    if (check.ok) {
      const body = await check.json().catch(() => null)
      // Some endpoints return 200 with empty/error body — only block if we got a real project
      if (body && (body.name || body.displayName || body.status)) {
        if (!confirm(`A project named "${target}" already exists. Overwrite its metadata?`)) return
      }
    }
  } catch { /* network glitch — proceed; the PUT will retry */ }

  try {
    const r = await fetch(`/api/projects-meta/${encodeURIComponent(name)}`)
    if (!r.ok) throw new Error('Source project not found')
    const meta = await r.json()
    const body = { ...meta }
    delete body.name; delete body.id; delete body.createdAt; delete body.updatedAt
    body.status = 'active'
    if (body.displayName) body.displayName = body.displayName + ' (copy)'
    const r2 = await fetch(`/api/projects-meta/${encodeURIComponent(target)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r2.ok) throw new Error(`HTTP ${r2.status}`)
    renderProjects()
  } catch (err) { alert('Duplicate failed: ' + (err.message || err)) }
}

async function exportProject(name) {
  try {
    const r = await fetch(`/api/projects-meta/${encodeURIComponent(name)}`)
    if (!r.ok) throw new Error('Project not found')
    const meta = await r.json()
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Sanitize filename — only allow safe chars
    const safeName = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'project'
    a.download = `${safeName}.meta.json`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  } catch (err) { alert('Export failed: ' + (err.message || err)) }
}

window.toggleCardMenu = toggleCardMenu
window.cardAction = cardAction
window.archiveProject = archiveProject
window.duplicateProject = duplicateProject
window.exportProject = exportProject

function toggleProjectSelection(name, checked) {
  const s = window._projectsState
  if (!s) return
  if (checked) s.selection.add(name); else s.selection.delete(name)
  if (typeof window._renderProjectsBody === 'function') window._renderProjectsBody()
}

async function bulkSetStatus(status) {
  if (!status) return
  const s = window._projectsState
  if (!s) return
  const names = [...s.selection]
  if (names.length === 0) return
  if (!confirm(`Set status "${status}" on ${names.length} project${names.length>1?'s':''}?`)) return
  try {
    const r = await fetch('/api/projects-meta/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names, action: 'setStatus', value: status }),
      credentials: 'include',
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const { ok, failed } = await r.json()
    s.selection.clear()
    if (failed?.length > 0) alert(`${failed.length} of ${names.length} updates failed; refreshing list.`)
    renderProjects()
  } catch (err) {
    alert('Bulk update failed: ' + (err.message || err))
  }
}

async function bulkArchive() {
  const s = window._projectsState
  if (!s) return
  const names = [...s.selection]
  if (names.length === 0) return
  if (!confirm(`Archive ${names.length} project${names.length>1?'s':''}?`)) return
  try {
    const r = await fetch('/api/projects-meta/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names, action: 'archive' }),
      credentials: 'include',
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const { ok, failed } = await r.json()
    s.selection.clear()
    if (failed?.length > 0) alert(`${failed.length} of ${names.length} archives failed; refreshing list.`)
    renderProjects()
  } catch (err) {
    alert('Bulk archive failed: ' + (err.message || err))
  }
}

async function bulkDelete() {
  const s = window._projectsState
  if (!s) return
  const names = [...s.selection]
  if (names.length === 0) return
  if (!confirm(`Delete ${names.length} project${names.length>1?'s':''}? This removes their metadata records.`)) return
  try {
    const r = await fetch('/api/projects-meta/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names, action: 'delete' }),
      credentials: 'include',
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const { ok, failed } = await r.json()
    s.selection.clear()
    if (failed?.length > 0) alert(`${failed.length} of ${names.length} deletes failed; refreshing list.`)
    renderProjects()
  } catch (err) {
    alert('Bulk delete failed: ' + (err.message || err))
  }
}

function bulkCancel() {
  const s = window._projectsState
  if (!s) return
  s.selection.clear()
  if (typeof window._renderProjectsBody === 'function') window._renderProjectsBody()
}

window.toggleProjectSelection = toggleProjectSelection
window.bulkSetStatus = bulkSetStatus
window.bulkArchive = bulkArchive
window.bulkDelete = bulkDelete
window.bulkCancel = bulkCancel

// ── Kanban DnD ──

function kanbanDragStart(e, el) {
  const name = el.dataset.name
  if (!name) return
  e.dataTransfer.setData('text/plain', name)
  e.dataTransfer.effectAllowed = 'move'
  el.classList.add('dragging')
}
function kanbanDragEnd(el) { el.classList.remove('dragging') }
function kanbanDragOver(e, col) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  col.classList.add('drop-target')
}
function kanbanDragLeave(col) { col.classList.remove('drop-target') }

async function kanbanDrop(e, col) {
  e.preventDefault()
  col.classList.remove('drop-target')
  const name = e.dataTransfer.getData('text/plain')
  const newStatus = col.dataset.status
  if (!name || !newStatus) return
  const s = window._projectsState
  if (!s) return
  const proj = s.merged.find(p => p.name === name)
  if (!proj) return
  proj._meta = proj._meta || {}
  const prevStatus = proj._meta.status
  if (prevStatus === newStatus) return
  proj._meta.status = newStatus
  // Optimistic re-render
  applyProjectFiltersAndRender()
  // Persist
  try {
    const r = await fetch(`/api/projects-meta/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
  } catch (err) {
    // Rollback
    proj._meta.status = prevStatus
    applyProjectFiltersAndRender()
    alert('Failed to update status: ' + (err.message || err))
  }
}

window.kanbanDragStart = kanbanDragStart
window.kanbanDragEnd = kanbanDragEnd
window.kanbanDragOver = kanbanDragOver
window.kanbanDragLeave = kanbanDragLeave
window.kanbanDrop = kanbanDrop

// Close filter menus on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.proj-filter-pill')) {
    document.querySelectorAll('.proj-filter-pill.open').forEach(p => p.classList.remove('open'))
  }
})

window.toggleProjectFilter = toggleProjectFilter
window.updateProjectFilter = updateProjectFilter
window.clearProjectFilter = clearProjectFilter
window.clearAllProjectFilters = clearAllProjectFilters
window.updateProjectSearch = updateProjectSearch
window.changeProjectSort = changeProjectSort
window.changeProjectGroup = changeProjectGroup
window.toggleShowArchived = toggleShowArchived

async function deleteProject(name) {
  if (!confirm(`Delete project "${name}"?\n\nThis removes the metadata record. Sessions and memories are kept but the project won't appear in the list until a new session is started.\n\nContinue?`)) return
  const r = await fetch(`/api/projects-meta/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (r.ok) renderProjects()
  else alert('Delete failed')
}
window.deleteProject = deleteProject

function openNewProjectModal() {
  const name = prompt('Project name (will be the internal key, use kebab-case):')
  if (!name || !name.trim()) return
  openEditProjectModal(name.trim())
}
window.openNewProjectModal = openNewProjectModal

// ── Team page ──
async function renderTeam() {
  const page = $('#page')
  page.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div class="section-title" style="margin:0">Team</div>
      <button id="btn-add-member" class="btn-primary">+ Add Member</button>
    </div>
    <div id="team-list"></div>`

  document.getElementById('btn-add-member').addEventListener('click', () => {
    document.getElementById('input-member-name').value = ''
    document.getElementById('input-member-email').value = ''
    document.getElementById('input-key-label').value = ''
    document.getElementById('modal-add-member').showModal()
  })

  await loadTeamList()
}

async function loadTeamList() {
  const res = await fetch('/api/admin/team')
  if (res.status === 403) {
    const el = document.getElementById('team-list')
    if (el) el.innerHTML = '<p style="color:#f87171;font-size:13px">Access denied — admin role required.</p>'
    const btn = document.getElementById('btn-add-member')
    if (btn) btn.style.display = 'none'
    return
  }
  const { users } = await res.json()
  const el = document.getElementById('team-list')
  if (!el) return

  if (!users || users.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No team members yet. Click "+ Add Member" to invite someone.</p>'
    return
  }

  el.innerHTML = users.map(u => {
    const keys = JSON.parse(u.keys || '[]').filter(k => k.id)
    const initials = u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    const roleBadge = u.role === 'admin' ? 'badge-decision' : 'badge-pattern'
    return `<div class="card member-card">
      <div class="member-header">
        <div class="member-avatar">${initials}</div>
        <div style="flex:1">
          <div class="member-name">${escHtml(u.name)}</div>
          ${u.email ? `<div class="member-email">${escHtml(u.email)}</div>` : ''}
        </div>
        <span class="badge ${roleBadge}">${u.role}</span>
        <div style="display:flex;gap:4px;margin-left:8px">
          <button class="btn-ghost" style="font-size:11px;padding:2px 8px" onclick="editUser('${u.id}','${escHtml(u.name)}','${escHtml(u.email||'')}','${u.role}')">Edit</button>
          <button class="btn-danger" style="font-size:11px;padding:2px 8px" onclick="deleteUser('${u.id}','${escHtml(u.name)}')">Delete</button>
        </div>
      </div>
      ${keys.length === 0
        ? '<p style="color:var(--text-muted);font-size:12px;margin:0">No active keys</p>'
        : keys.map(k => `
          <div class="key-row${k.revoked ? ' revoked' : ''}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.4;flex-shrink:0"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <span class="key-label">${escHtml(k.label)}</span>
            <span class="key-meta">last used: ${k.last_used_at ? k.last_used_at.slice(0, 10) : 'never'}</span>
            ${!k.revoked
              ? `<button class="btn-danger" onclick="revokeKey('${k.id}')">Revoke</button>`
              : '<span style="font-size:11px;color:var(--text-muted)">(revoked)</span>'}
          </div>`).join('')}
    </div>`
  }).join('')
}

async function revokeKey(id) {
  if (!confirm('Revoke this key? This cannot be undone.')) return
  await fetch(`/api/admin/team/keys/${id}`, { method: 'DELETE' })
  await loadTeamList()
}

function editUser(id, name, email, role) {
  document.getElementById('edit-member-id').value = id
  document.getElementById('edit-member-name').value = name
  document.getElementById('edit-member-email').value = email
  document.getElementById('edit-member-role').value = role
  document.getElementById('modal-edit-member').showModal()
}

async function deleteUser(id, name) {
  if (!confirm(`Delete ${name}? This will also remove all their API keys.`)) return
  const res = await fetch(`/api/admin/team/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (res.ok) await loadTeamList()
  else alert('Delete failed')
}

document.getElementById('btn-cancel-edit-member')?.addEventListener('click', () => {
  document.getElementById('modal-edit-member').close()
})

document.getElementById('btn-save-edit-member')?.addEventListener('click', async () => {
  const id = document.getElementById('edit-member-id').value
  const name = document.getElementById('edit-member-name').value.trim()
  const email = document.getElementById('edit-member-email').value.trim()
  const role = document.getElementById('edit-member-role').value
  if (!name) { alert('Name is required'); return }
  const res = await fetch(`/api/admin/team/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: email || undefined, role }),
  })
  if (res.ok) {
    document.getElementById('modal-edit-member').close()
    await loadTeamList()
  } else {
    const { error } = await res.json()
    alert(`Error: ${error}`)
  }
})

document.getElementById('btn-cancel-member')?.addEventListener('click', () => {
  document.getElementById('modal-add-member').close()
})

document.getElementById('btn-create-member')?.addEventListener('click', async () => {
  const name = document.getElementById('input-member-name').value.trim()
  const email = document.getElementById('input-member-email').value.trim()
  const label = document.getElementById('input-key-label').value.trim()
  if (!name) { alert('Name is required'); return }

  const res = await fetch('/api/admin/team/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: email || undefined, label: label || undefined }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Request failed' }))
    alert(`Error: ${error}`)
    return
  }
  const { key, password, emailSent } = await res.json()

  document.getElementById('modal-add-member').close()
  document.getElementById('new-password-value').textContent = password
  document.getElementById('new-key-value').textContent = key
  document.getElementById('connection-snippet').textContent =
    `SKILLBRAIN_MCP_URL=https://memory.fl1.it/mcp\nCODEGRAPH_AUTH_TOKEN=${key}`

  const banner = document.getElementById('email-status-banner')
  if (email) {
    if (emailSent) {
      banner.textContent = `Invite email sent to ${email}`
      banner.style.cssText = 'display:block;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px;background:rgba(74,222,128,.15);color:#4ade80;border:1px solid rgba(74,222,128,.3)'
    } else {
      banner.textContent = `Email NOT sent (SMTP not configured) — share credentials manually`
      banner.style.cssText = 'display:block;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px;background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.3)'
    }
  } else {
    banner.style.display = 'none'
  }

  document.getElementById('modal-show-key').showModal()
  await loadTeamList()
})

document.getElementById('btn-copy-key')?.addEventListener('click', async () => {
  const pw = document.getElementById('new-password-value').textContent
  const key = document.getElementById('new-key-value').textContent
  const text = `Password: ${pw}\nAPI Key: ${key}`
  try { await navigator.clipboard.writeText(text) } catch { prompt('Copy these credentials:', text) }
})

document.getElementById('btn-close-key-modal')?.addEventListener('click', () => {
  document.getElementById('modal-show-key').close()
})

window.revokeKey = revokeKey
window.editUser = editUser
window.deleteUser = deleteUser

// ── Change Password ──
document.getElementById('btn-change-password')?.addEventListener('click', () => {
  document.getElementById('cp-current').value = ''
  document.getElementById('cp-new').value = ''
  document.getElementById('cp-confirm').value = ''
  document.getElementById('cp-error').style.display = 'none'
  document.getElementById('modal-change-password').showModal()
})

document.getElementById('btn-cancel-cp')?.addEventListener('click', () => {
  document.getElementById('modal-change-password').close()
})

document.getElementById('btn-save-cp')?.addEventListener('click', async () => {
  const current = document.getElementById('cp-current').value
  const newPw = document.getElementById('cp-new').value
  const confirm = document.getElementById('cp-confirm').value
  const errEl = document.getElementById('cp-error')

  if (!current || !newPw) { errEl.textContent = 'All fields are required'; errEl.style.display = 'block'; return }
  if (newPw.length < 8) { errEl.textContent = 'New password must be at least 8 characters'; errEl.style.display = 'block'; return }
  if (newPw !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return }

  const res = await fetch('/api/auth/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, newPassword: newPw }),
  })
  if (res.ok) {
    document.getElementById('modal-change-password').close()
    alert('Password changed successfully')
  } else {
    const { error } = await res.json()
    errEl.textContent = error || 'Failed to change password'
    errEl.style.display = 'block'
  }
})

// ── Skill History ──
window.viewSkillHistory = async (name) => {
  const data = await api.get(`/api/skills/${encodeURIComponent(name)}/versions`)
  const versions = data.versions || []
  const html = versions.length === 0
    ? '<p style="color:var(--text-muted)">No version history yet.</p>'
    : `<div style="display:flex;flex-direction:column;gap:8px">
        ${versions.map(v => `
          <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-weight:600">v${v.versionNumber}</span>
              <span style="font-size:11px;color:var(--text-muted)">${v.createdAt?.slice(0,16).replace('T',' ')} &middot; ${escHtml(v.changeReason)}</span>
            </div>
            <details>
              <summary style="font-size:12px;color:var(--text-muted);cursor:pointer">Preview content</summary>
              <pre style="font-size:11px;background:var(--bg-surface,#111);border:1px solid var(--border);border-radius:6px;padding:8px;overflow:auto;max-height:150px;white-space:pre-wrap;color:var(--text-secondary);margin-top:6px">${escHtml((v.content||'').slice(0,1000))}${(v.content||'').length>1000?'\n...':''}</pre>
            </details>
            <button onclick="rollbackSkill('${escHtml(name)}','${escHtml(v.id)}')" style="margin-top:8px;padding:3px 10px;border-radius:6px;background:rgba(99,102,241,.12);border:1px solid var(--purple,#6366f1);color:var(--purple,#6366f1);font-size:11px;cursor:pointer">Rollback to this</button>
          </div>
        `).join('')}
      </div>`
  openDetail(`History: ${name}`, html)
}

window.rollbackSkill = async (name, versionId) => {
  if (!confirm(`Rollback "${name}" to version ${versionId}? This will create a new version entry.`)) return
  const res = await fetch(`/api/skills/${encodeURIComponent(name)}/rollback/${encodeURIComponent(versionId)}`, { method: 'POST' })
  if (res.ok) { alert('Rollback successful'); viewSkillHistory(name) }
  else { const d = await res.json(); alert(`Error: ${d.error}`) }
}

window.filterMemoriesScope = (scope) => renderMemories('', scope)

// ── Profile page ──
async function renderProfile() {
  const page = $('#page')
  page.innerHTML = `
    <div class="section-title">Profile &amp; API Keys</div>
    <div id="profile-info" style="margin-bottom:24px"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div style="font-weight:600;font-size:14px">API Keys</div>
      <button id="btn-new-key" class="btn-primary" style="font-size:12px;padding:4px 12px">+ Generate Key</button>
    </div>
    <div id="profile-keys-list"></div>
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border)">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px">Password</div>
      <button id="btn-profile-change-password" class="btn-ghost" style="font-size:12px;padding:4px 12px">Change Password</button>
    </div>`

  document.getElementById('btn-profile-change-password')?.addEventListener('click', () => {
    document.getElementById('cp-current').value = ''
    document.getElementById('cp-new').value = ''
    document.getElementById('cp-confirm').value = ''
    document.getElementById('cp-error').style.display = 'none'
    document.getElementById('modal-change-password').showModal()
  })

  document.getElementById('btn-new-key')?.addEventListener('click', () => {
    document.getElementById('generate-key-label').value = ''
    document.getElementById('modal-generate-key').showModal()
  })

  await loadProfileInfo()
  await loadProfileKeys()
}

async function loadProfileInfo() {
  try {
    const { user } = await api.get('/api/me')
    const el = document.getElementById('profile-info')
    if (!el || !user) return
    const initials = (user.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    el.innerHTML = `
      <div class="card" style="display:flex;align-items:center;gap:14px;padding:14px 16px">
        <div class="member-avatar">${escHtml(initials)}</div>
        <div>
          <div style="font-weight:600">${escHtml(user.name || '')}</div>
          ${user.email ? `<div style="font-size:12px;color:var(--text-muted)">${escHtml(user.email)}</div>` : ''}
          <span class="badge ${user.role === 'admin' ? 'badge-decision' : 'badge-pattern'}" style="margin-top:4px">${user.role}</span>
        </div>
      </div>`
  } catch { /* ignore */ }
}

async function loadProfileKeys() {
  try {
    const { keys } = await api.get('/api/me/api-keys')
    const el = document.getElementById('profile-keys-list')
    if (!el) return
    if (!keys || keys.length === 0) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No API keys yet. Generate one to connect Claude Code.</p>'
      return
    }
    el.innerHTML = keys.map(k => `
      <div class="card key-row${k.revoked ? ' revoked' : ''}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:8px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.4;flex-shrink:0"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        <span class="key-label" style="flex:1">${escHtml(k.label)}</span>
        <span class="key-meta" style="font-size:11px;color:var(--text-muted)">
          ${k.revoked ? '<span style="color:#f87171">revoked</span>' : `last used: ${k.last_used_at ? k.last_used_at.slice(0, 10) : 'never'}`}
        </span>
        <span class="key-meta" style="font-size:11px;color:var(--text-muted)">created ${k.created_at?.slice(0, 10)}</span>
        ${!k.revoked
          ? `<button class="btn-danger" style="font-size:11px;padding:2px 8px" onclick="revokeMyKey('${k.id}')">Revoke</button>`
          : ''}
      </div>`).join('')
  } catch { /* ignore */ }
}

window.revokeMyKey = async (id) => {
  if (!confirm('Revoke this key? It will stop working immediately.')) return
  const res = await fetch(`/api/me/api-keys/${id}`, { method: 'DELETE' })
  if (res.ok) await loadProfileKeys()
  else alert('Revoke failed')
}

document.getElementById('btn-cancel-generate-key')?.addEventListener('click', () => {
  document.getElementById('modal-generate-key').close()
})

document.getElementById('btn-confirm-generate-key')?.addEventListener('click', async () => {
  const label = document.getElementById('generate-key-label').value.trim()
  const res = await fetch('/api/me/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label || undefined }),
  })
  if (!res.ok) { alert('Failed to generate key'); return }
  const { key } = await res.json()
  document.getElementById('modal-generate-key').close()
  document.getElementById('new-key-value').textContent = key
  document.getElementById('connection-snippet').textContent =
    `SKILLBRAIN_MCP_URL=https://memory.fl1.it/mcp\nCODEGRAPH_AUTH_TOKEN=${key}`
  document.getElementById('modal-show-key').showModal()
  await loadProfileKeys()
})

// ── My master.env page ──
let envTemplatesCache = null

async function renderMyEnv() {
  const page = $('#page')
  page.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <div class="section-title" style="margin:0">My master.env</div>
      <div style="flex:1"></div>
      <button id="btn-add-env" class="btn-primary">+ Add credential</button>
      <button id="btn-import-env" class="btn-ghost">Import .env</button>
      <button id="btn-export-env" class="btn-ghost">Export</button>
    </div>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px;max-width:680px">
      Personal credentials, MCP configs, integrations and preferences. Encrypted at rest, only you can see them.
      Claude Code reads this profile via <code>session_resume</code> + <code>user_env_get</code> so it knows what
      tools you have available.
    </p>
    <div id="my-env-summary" style="margin-bottom:16px"></div>
    <div id="my-env-list">Loading…</div>`

  document.getElementById('btn-add-env').addEventListener('click', () => openAddEnvModal())
  document.getElementById('btn-import-env').addEventListener('click', () => openImportEnvModal())
  document.getElementById('btn-export-env').addEventListener('click', () => exportMyEnv())

  await loadEnvTemplates()
  await loadMyEnv()
}

async function loadEnvTemplates() {
  if (envTemplatesCache) return envTemplatesCache
  try {
    const { templates } = await api.get('/api/me/env/templates')
    envTemplatesCache = templates
    return templates
  } catch { envTemplatesCache = []; return [] }
}

async function loadMyEnv() {
  try {
    const { vars, capability } = await api.get('/api/me/env')

    const summary = document.getElementById('my-env-summary')
    if (summary) {
      const cats = capability.categories
      summary.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${capability.totalVars === 0
            ? '<span style="color:var(--text-muted);font-size:12px">No credentials saved yet — start with a template.</span>'
            : `<span class="badge badge-pattern">${capability.totalVars} total</span>
               <span class="badge">${cats.api_key} api_key</span>
               <span class="badge">${cats.mcp_config} mcp_config</span>
               <span class="badge">${cats.integration} integration</span>
               <span class="badge">${cats.preference} preference</span>
               ${capability.services.length ? `<span class="badge badge-fact">services: ${capability.services.map(escHtml).join(', ')}</span>` : ''}`}
        </div>`
    }

    const el = document.getElementById('my-env-list')
    if (!el) return
    if (!vars || vars.length === 0) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No credentials yet. Click "+ Add credential" to start, or "Import .env" to bulk-paste.</p>'
      return
    }

    // Group by service first, then by category
    const groups = {}
    for (const v of vars) {
      const key = v.service || `(${v.category})`
      if (!groups[key]) groups[key] = []
      groups[key].push(v)
    }

    el.innerHTML = Object.entries(groups).map(([groupKey, items]) => `
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">${escHtml(groupKey)} <span class="count">${items.length}</span></div>
        ${items.map(v => `
          <div class="row">
            <span class="row-label">
              <code style="color:${v.isSecret ? 'var(--yellow)' : 'var(--green)'}">${escHtml(v.varName)}</code>
              <span class="badge" style="margin-left:6px;font-size:10px">${v.category}</span>
              ${v.lastUsedAt ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px">used ${v.lastUsedAt.slice(0,10)}</span>` : ''}
              ${v.description ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(v.description)}</div>` : ''}
            </span>
            <span>
              <button onclick="revealMyEnv('${escHtml(v.varName)}')" style="padding:2px 8px;border-radius:4px;background:none;border:1px solid var(--border);color:var(--text-muted);font-size:11px;cursor:pointer;margin-right:4px">Reveal</button>
              <button onclick="editMyEnv('${escHtml(v.varName)}','${escHtml(v.category)}','${escHtml(v.service||'')}','${escHtml(v.description||'')}')" style="padding:2px 8px;border-radius:4px;background:none;border:1px solid var(--border);color:var(--text-muted);font-size:11px;cursor:pointer;margin-right:4px">Edit</button>
              <button onclick="deleteMyEnv('${escHtml(v.varName)}')" style="padding:2px 8px;border-radius:4px;background:none;border:1px solid rgba(248,113,113,.3);color:var(--red);font-size:11px;cursor:pointer">Delete</button>
            </span>
          </div>`).join('')}
      </div>`).join('')
  } catch (e) {
    document.getElementById('my-env-list').innerHTML = '<p style="color:var(--red)">Error loading your master.env</p>'
  }
}

let _envEditMode = null // null = add, { varName } = editing single var

function renderCustomFields() {
  const container = document.getElementById('env-fields-container')
  container.innerHTML = `
    <div id="env-custom-fields">
      <div class="env-field-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:end">
        <div style="flex:1">
          <label style="font-size:12px">Variable name</label>
          <input type="text" class="env-cf-name" placeholder="MY_API_KEY" autocomplete="off" style="width:100%">
        </div>
        <div style="flex:1">
          <label style="font-size:12px">Value</label>
          <input type="password" class="env-cf-value" placeholder="value..." autocomplete="off" style="width:100%">
        </div>
        <div style="flex:0 0 auto">
          <label style="font-size:12px">Description</label>
          <input type="text" class="env-cf-desc" placeholder="optional" autocomplete="off" style="width:100%">
        </div>
      </div>
    </div>
    <button type="button" id="btn-add-custom-field" class="btn-ghost" style="font-size:11px;padding:4px 10px;margin-top:4px">+ Add field</button>`
  document.getElementById('btn-add-custom-field').addEventListener('click', () => {
    const rows = document.getElementById('env-custom-fields')
    const row = document.createElement('div')
    row.className = 'env-field-row'
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:end'
    row.innerHTML = `
      <div style="flex:1">
        <input type="text" class="env-cf-name" placeholder="ANOTHER_KEY" autocomplete="off" style="width:100%">
      </div>
      <div style="flex:1">
        <input type="password" class="env-cf-value" placeholder="value..." autocomplete="off" style="width:100%">
      </div>
      <div style="flex:0 0 auto">
        <input type="text" class="env-cf-desc" placeholder="optional" autocomplete="off" style="width:100%">
      </div>
      <button type="button" class="btn-ghost" onclick="this.closest('.env-field-row').remove()" style="font-size:11px;padding:4px 6px;color:var(--red)" title="Remove field">&times;</button>`
    rows.appendChild(row)
  })
}

function renderTemplateFields(template) {
  const container = document.getElementById('env-fields-container')
  const requiredFields = template.fields.filter(f => f.required)
  const optionalFields = template.fields.filter(f => !f.required)

  let html = ''
  for (const f of requiredFields) {
    html += `
      <div class="form-field" style="margin-bottom:8px">
        <label style="font-size:12px">${escHtml(f.label)} <span style="color:var(--red)">*</span></label>
        <input type="password" class="env-tf-value" data-var="${escHtml(f.varName)}" data-required="true"
               placeholder="${escHtml(f.placeholder || '')}" autocomplete="off" style="width:100%">
        ${f.description ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${escHtml(f.description)}</div>` : ''}
      </div>`
  }
  if (optionalFields.length) {
    html += `<div style="font-size:11px;color:var(--text-muted);margin:8px 0 4px;border-top:1px solid var(--border);padding-top:8px">Optional fields</div>`
    for (const f of optionalFields) {
      html += `
        <div class="form-field" style="margin-bottom:8px">
          <label style="font-size:12px">${escHtml(f.label)}</label>
          <input type="password" class="env-tf-value" data-var="${escHtml(f.varName)}" data-required="false"
                 placeholder="${escHtml(f.placeholder || '')}" autocomplete="off" style="width:100%">
          ${f.description ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${escHtml(f.description)}</div>` : ''}
        </div>`
    }
  }
  container.innerHTML = html
}

async function openAddEnvModal(prefill) {
  const templates = await loadEnvTemplates()
  const sel = document.getElementById('env-template-select')
  const hint = document.getElementById('env-template-hint')
  const desc = document.getElementById('env-template-desc')
  const errEl = document.getElementById('env-error')
  const meta = document.getElementById('env-meta-fields')

  _envEditMode = prefill || null

  // Build template dropdown — group labels include field count
  sel.innerHTML = '<option value="">— Custom (manual fields) —</option>' +
    templates.map((t, i) => {
      const n = t.fields ? t.fields.length : 1
      return `<option value="${i}">${escHtml(t.label)}${n > 1 ? ` (${n} fields)` : ''}</option>`
    }).join('')

  document.getElementById('modal-add-env-title').textContent = prefill ? `Edit ${prefill.varName}` : 'Add credential'
  document.getElementById('env-var-category').value = prefill?.category || 'api_key'
  document.getElementById('env-var-service').value = prefill?.service || ''
  hint.style.display = 'none'
  desc.style.display = 'none'
  errEl.style.display = 'none'

  if (prefill) {
    // Edit mode — single field, no template
    sel.style.display = 'none'
    sel.closest('.form-field').style.display = 'none'
    const container = document.getElementById('env-fields-container')
    container.innerHTML = `
      <div class="form-field" style="margin-bottom:8px">
        <label style="font-size:12px">Variable name</label>
        <input type="text" id="env-edit-name" value="${escHtml(prefill.varName)}" readonly
               style="width:100%;opacity:.7;cursor:not-allowed" autocomplete="off">
      </div>
      <div class="form-field" style="margin-bottom:8px">
        <label style="font-size:12px">New value</label>
        <input type="password" id="env-edit-value" placeholder="paste new value..." autocomplete="off" style="width:100%">
      </div>
      <div class="form-field" style="margin-bottom:8px">
        <label style="font-size:12px">Description <span style="opacity:.5">(optional)</span></label>
        <input type="text" id="env-edit-desc" value="${escHtml(prefill.description || '')}" autocomplete="off" style="width:100%">
      </div>`
    meta.style.display = 'flex'
  } else {
    // Add mode — show template selector
    sel.style.display = ''
    sel.closest('.form-field').style.display = ''
    renderCustomFields()
    meta.style.display = 'flex'
  }

  sel.onchange = () => {
    const idx = parseInt(sel.value, 10)
    const t = templates[idx]
    if (!t) {
      // Custom mode
      renderCustomFields()
      hint.style.display = 'none'
      desc.style.display = 'none'
      meta.style.display = 'flex'
      document.getElementById('env-var-category').value = 'api_key'
      document.getElementById('env-var-service').value = ''
      return
    }
    // Template mode — render multi-field form
    renderTemplateFields(t)
    document.getElementById('env-var-category').value = t.category
    document.getElementById('env-var-service').value = t.service
    // Hide meta in template mode (auto-filled)
    meta.style.display = 'none'
    hint.innerHTML = t.helpUrl ? `Get your keys at <a href="${t.helpUrl}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(t.helpUrl)}</a>` : ''
    hint.style.display = t.helpUrl ? 'block' : 'none'
    desc.textContent = t.description || ''
    desc.style.display = t.description ? 'block' : 'none'
  }

  document.getElementById('modal-add-env').showModal()
}

function openImportEnvModal() {
  document.getElementById('env-import-content').value = ''
  document.getElementById('env-import-category').value = 'api_key'
  document.getElementById('modal-import-env').showModal()
}

async function exportMyEnv() {
  try {
    const { content, count } = await api.post('/api/me/env/export', {})
    if (count === 0) { alert('Nothing to export — your master.env is empty.'); return }
    try {
      await navigator.clipboard.writeText(content)
      alert(`Copied ${count} env vars to clipboard`)
    } catch {
      prompt(`.env content (${count} vars):`, content)
    }
  } catch (err) { alert(`Export failed: ${err.message}`) }
}

async function revealMyEnv(varName) {
  try {
    const { value } = await api.post('/api/me/env/reveal', { varName })
    prompt(`${varName} (copy below):`, value)
  } catch (err) { alert(`Reveal failed: ${err.message}`) }
}

function editMyEnv(varName, category, service, description) {
  openAddEnvModal({ varName, category, service, description })
}

async function deleteMyEnv(varName) {
  if (!confirm(`Delete ${varName} from your master.env?`)) return
  try {
    await api.del(`/api/me/env/${encodeURIComponent(varName)}`)
    await loadMyEnv()
  } catch (err) { alert(`Delete failed: ${err.message}`) }
}

document.getElementById('btn-cancel-add-env')?.addEventListener('click', () => {
  document.getElementById('modal-add-env').close()
})

document.getElementById('btn-save-add-env')?.addEventListener('click', async () => {
  const errEl = document.getElementById('env-error')
  errEl.style.display = 'none'
  const category = document.getElementById('env-var-category').value
  const service = document.getElementById('env-var-service').value.trim()

  try {
    if (_envEditMode) {
      // Edit mode — single var update
      const varName = document.getElementById('env-edit-name').value.trim()
      const value = document.getElementById('env-edit-value').value
      const description = document.getElementById('env-edit-desc').value.trim()
      if (!value) { errEl.textContent = 'Value is required'; errEl.style.display = 'block'; return }
      await api.put(`/api/me/env/${encodeURIComponent(varName)}`, {
        value, category, service: service || undefined, description: description || undefined,
      })
    } else {
      // Check if template mode or custom mode
      const templateInputs = document.querySelectorAll('.env-tf-value')
      if (templateInputs.length > 0) {
        // Template mode — save each field with a value
        const saves = []
        for (const input of templateInputs) {
          const val = input.value.trim()
          const vn = input.dataset.var
          const req = input.dataset.required === 'true'
          if (req && !val) {
            errEl.textContent = `${vn} is required`
            errEl.style.display = 'block'
            input.focus()
            return
          }
          if (val) {
            const labelEl = input.closest('.form-field')?.querySelector('label')
            const descEl = input.closest('.form-field')?.querySelector('div[style*="font-size:10px"]')
            saves.push({
              varName: vn,
              value: val,
              category,
              service: service || undefined,
              description: descEl?.textContent || labelEl?.textContent?.replace(/\s*\*\s*$/, '').trim() || undefined,
            })
          }
        }
        if (saves.length === 0) {
          errEl.textContent = 'Fill in at least one field'
          errEl.style.display = 'block'
          return
        }
        for (const s of saves) {
          await api.put(`/api/me/env/${encodeURIComponent(s.varName)}`, s)
        }
      } else {
        // Custom mode — save each row
        const rows = document.querySelectorAll('#env-custom-fields .env-field-row')
        const saves = []
        for (const row of rows) {
          const vn = row.querySelector('.env-cf-name')?.value?.trim()
          const val = row.querySelector('.env-cf-value')?.value?.trim()
          const desc = row.querySelector('.env-cf-desc')?.value?.trim()
          if (vn && val) {
            saves.push({ varName: vn, value: val, category, service: service || undefined, description: desc || undefined })
          } else if (vn && !val) {
            errEl.textContent = `Value is required for ${vn}`
            errEl.style.display = 'block'
            return
          }
        }
        if (saves.length === 0) {
          errEl.textContent = 'Fill in at least one variable name and value'
          errEl.style.display = 'block'
          return
        }
        for (const s of saves) {
          await api.put(`/api/me/env/${encodeURIComponent(s.varName)}`, s)
        }
      }
    }
    document.getElementById('modal-add-env').close()
    await loadMyEnv()
  } catch (err) {
    errEl.textContent = err.message || 'Save failed'
    errEl.style.display = 'block'
  }
})

document.getElementById('btn-cancel-import-env')?.addEventListener('click', () => {
  document.getElementById('modal-import-env').close()
})

document.getElementById('btn-confirm-import-env')?.addEventListener('click', async () => {
  const envContent = document.getElementById('env-import-content').value.trim()
  const category = document.getElementById('env-import-category').value
  if (!envContent) { alert('Paste some .env content first.'); return }
  try {
    const { saved, errors } = await api.post('/api/me/env/import', { envContent, category })
    document.getElementById('modal-import-env').close()
    let msg = `Imported ${saved} variables.`
    if (errors && errors.length) msg += `\n${errors.length} skipped:\n${errors.slice(0, 5).join('\n')}`
    alert(msg)
    await loadMyEnv()
  } catch (err) { alert(`Import failed: ${err.message}`) }
})

window.revealMyEnv = revealMyEnv
window.editMyEnv = editMyEnv
window.deleteMyEnv = deleteMyEnv

// ── Quick Capture Memory (Hub modal) ──
function openQuickMemoryModal() {
  const m = document.getElementById('modal-quick-memory')
  if (!m) return
  for (const id of ['qm-context', 'qm-problem', 'qm-solution', 'qm-reason', 'qm-tags', 'qm-project']) {
    const el = document.getElementById(id); if (el) el.value = ''
  }
  document.getElementById('qm-type').value = 'Pattern'
  document.getElementById('qm-error').style.display = 'none'
  m.showModal()
  setTimeout(() => document.getElementById('qm-context')?.focus(), 50)
}
window.openQuickMemoryModal = openQuickMemoryModal

document.getElementById('btn-cancel-qm')?.addEventListener('click', () => {
  document.getElementById('modal-quick-memory').close()
})

document.getElementById('btn-save-qm')?.addEventListener('click', async () => {
  const errEl = document.getElementById('qm-error')
  errEl.style.display = 'none'

  const body = {
    type: document.getElementById('qm-type').value,
    context: document.getElementById('qm-context').value.trim(),
    problem: document.getElementById('qm-problem').value.trim(),
    solution: document.getElementById('qm-solution').value.trim(),
    reason: document.getElementById('qm-reason').value.trim(),
    tags: document.getElementById('qm-tags').value.trim(),
    project: document.getElementById('qm-project').value.trim() || undefined,
  }

  if (!body.context || !body.problem || !body.solution || !body.reason) {
    errEl.textContent = 'Context, problem, solution and reason are required'
    errEl.style.display = 'block'
    return
  }
  const tagCount = body.tags.split(',').map(t => t.trim()).filter(Boolean).length
  if (tagCount < 2 || tagCount > 5) {
    errEl.textContent = 'Tags must be 2-5 comma-separated values'
    errEl.style.display = 'block'
    return
  }

  try {
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Save failed' }))
      throw new Error(error)
    }
    document.getElementById('modal-quick-memory').close()
    if (currentPage === 'home') route()
  } catch (err) {
    errEl.textContent = err.message || 'Save failed'
    errEl.style.display = 'block'
  }
})

// ── Logout ──
document.getElementById('btn-logout')?.addEventListener('click', () => {
  document.cookie = 'sb_session=; path=/; max-age=0'
  location.href = '/'
})

// ── Init ──
;(async () => {
  try {
    const { user } = await api.get('/api/me')
    if (user?.role === 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = '')
    }
  } catch {}
})()
route()
updateReviewBadge()

// Chrome ignores autocomplete="off" when password fields exist on the page.
// Force-clear the search input after autofill has a chance to run.
setTimeout(() => {
  const s = document.getElementById('global-search')
  if (s) s.value = ''
}, 50)
