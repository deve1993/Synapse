// Synapse — ⌘K Command Palette module
// Self-contained: overlay, search, keyboard nav, a11y, focus management.
// Exports: openCommandPalette(), closeCommandPalette(), toggleCommandPalette()

import { api } from './api.js'

// ── Config ───────────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 180

// ── Local helpers ────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Static nav commands ───────────────────────────────────────────────────────

const NAV_COMMANDS = [
  { label: 'Hub',           hash: '#/',                icon: '⌂' },
  { label: 'Skills',        hash: '#/skills',          icon: '⚡' },
  { label: 'Memories',      hash: '#/memories',        icon: '🧠' },
  { label: 'Sessions',      hash: '#/sessions',        icon: '📋' },
  { label: 'Projects',      hash: '#/projects',        icon: '📁' },
  { label: 'Components',    hash: '#/components',      icon: '🧩' },
  { label: 'Design systems',hash: '#/design-systems',  icon: '🎨' },
  { label: 'Review',        hash: '#/review',          icon: '✅' },
  { label: 'Whiteboards',   hash: '#/whiteboards',     icon: '📐' },
  { label: 'Studio',        hash: '#/studio',          icon: '🎬' },
  { label: 'Team',          hash: '#/team',            icon: '👥' },
]

// ── Module state ──────────────────────────────────────────────────────────────

let _overlay = null         // the backdrop element
let _previousFocus = null   // element focused before palette opened
let _searchSeq = 0          // incrementing counter to guard stale responses
let _debounceTimer = null
let _items = []             // flat list of selectable row objects { el, activate }
let _activeIdx = -1         // currently highlighted row index
let _paletteKeydown = null  // in-palette keydown handler reference (for cleanup)
let _rowIdCounter = 0       // monotonic counter for unique row ids (aria-activedescendant)

// Close the palette on any route change so a background nav doesn't leave it
// stuck open over the new page. Registered once at module load.
window.addEventListener('hashchange', () => { if (_overlay) closeCommandPalette() })

// ── Open / Close ─────────────────────────────────────────────────────────────

// Toggle: close if currently open, otherwise open. Used by the ⌘K/Ctrl+K shortcut.
export function toggleCommandPalette() {
  if (_overlay) closeCommandPalette()
  else openCommandPalette()
}

export function openCommandPalette() {
  // Single-instance guard
  if (_overlay) {
    // Already open — re-focus the input
    _overlay.querySelector('.cmdk-input')?.focus()
    return
  }

  _previousFocus = document.activeElement

  // Build overlay backdrop
  _overlay = document.createElement('div')
  _overlay.className = 'cmdk-overlay'
  _overlay.setAttribute('role', 'presentation')

  // Build panel
  const panel = document.createElement('div')
  panel.className = 'cmdk-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', 'Command palette')

  // Search input
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'cmdk-input'
  input.placeholder = 'Search skills, memories, or go to…'
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('aria-label', 'Command palette search')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', 'cmdk-listbox')

  // Results listbox
  const listbox = document.createElement('div')
  listbox.id = 'cmdk-listbox'
  listbox.className = 'cmdk-listbox'
  listbox.setAttribute('role', 'listbox')
  listbox.setAttribute('aria-label', 'Results')

  panel.appendChild(input)
  panel.appendChild(listbox)
  _overlay.appendChild(panel)
  document.body.appendChild(_overlay)

  // Render initial state (empty query → only nav commands)
  _renderResults('', [], [], NAV_COMMANDS)

  // Auto-focus input
  requestAnimationFrame(() => input.focus())

  // Click-outside to close
  _overlay.addEventListener('click', (e) => {
    if (e.target === _overlay) closeCommandPalette()
  })

  // In-palette keyboard navigation
  _paletteKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeCommandPalette()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      _moveHighlight(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      _moveHighlight(-1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (_activeIdx >= 0 && _activeIdx < _items.length) {
        _items[_activeIdx].activate()
      }
      return
    }
    if (e.key === 'Tab') {
      // Focus trap: the panel's only focusable element is the input, so keep
      // focus there (aria-modal=true promises containment).
      e.preventDefault()
      _overlay?.querySelector('.cmdk-input')?.focus()
      return
    }
  }
  document.addEventListener('keydown', _paletteKeydown)

  // Input change → debounced search
  input.addEventListener('input', () => {
    clearTimeout(_debounceTimer)
    _debounceTimer = setTimeout(() => {
      _runSearch(input.value.trim())
    }, SEARCH_DEBOUNCE_MS)
  })
}

export function closeCommandPalette() {
  if (!_overlay) return
  _overlay.remove()
  _overlay = null
  clearTimeout(_debounceTimer)
  if (_paletteKeydown) {
    document.removeEventListener('keydown', _paletteKeydown)
    _paletteKeydown = null
  }
  _items = []
  _activeIdx = -1
  _searchSeq = 0  // hygiene: reset stale-response guard between sessions
  // Restore focus
  if (_previousFocus && typeof _previousFocus.focus === 'function') {
    _previousFocus.focus()
  }
  _previousFocus = null
}

// ── Search ───────────────────────────────────────────────────────────────────

async function _runSearch(q) {
  const listbox = _overlay?.querySelector('.cmdk-listbox')
  if (!listbox) return

  // Filter nav commands
  const navMatches = q
    ? NAV_COMMANDS.filter(n => n.label.toLowerCase().includes(q.toLowerCase()))
    : NAV_COMMANDS

  if (!q) {
    _renderResults(q, [], [], navMatches)
    return
  }

  // Show loading state while awaiting API
  _renderLoading(listbox)

  // Race-condition guard
  const seq = ++_searchSeq

  // allSettled so a single failing endpoint still renders the other's results.
  const [skillsRes, memoriesRes] = await Promise.allSettled([
    api.get('/api/skills?search=' + encodeURIComponent(q) + '&limit=6'),
    api.get('/api/memories?search=' + encodeURIComponent(q) + '&limit=6'),
  ])

  // Stale response — a newer query is in-flight; discard
  if (seq !== _searchSeq) return

  const skills = skillsRes.status === 'fulfilled' ? (skillsRes.value?.skills || []) : []
  const memories = memoriesRes.status === 'fulfilled' ? (memoriesRes.value?.memories || []) : []

  _renderResults(q, memories, skills, navMatches)
}

// ── Rendering ────────────────────────────────────────────────────────────────

function _renderLoading(listbox) {
  listbox.innerHTML = '<div class="cmdk-empty">Searching…</div>'
  _items = []
  _activeIdx = -1
}

function _renderResults(q, memories, skills, navMatches) {
  const listbox = _overlay?.querySelector('.cmdk-listbox')
  if (!listbox) return

  _items = []
  _activeIdx = -1

  const hasMemories = memories.length > 0
  const hasSkills = skills.length > 0
  const hasNav = navMatches.length > 0
  const hasAny = hasMemories || hasSkills || hasNav

  if (!hasAny) {
    listbox.innerHTML = '<div class="cmdk-empty">No results found</div>'
    return
  }

  const frag = document.createDocumentFragment()

  // ── Memories section ──
  if (hasMemories) {
    frag.appendChild(_groupHeader('Memories'))
    for (const mem of memories) {
      const text = (mem.context || mem.solution || '').slice(0, 70)
      const label = escHtml(mem.type || 'Memory')
      const preview = escHtml(text) + (text.length >= 70 ? '…' : '')
      const row = _makeRow(
        `<span class="cmdk-row-badge cmdk-badge-memory">${label}</span>
         <span class="cmdk-row-text">${preview}</span>`,
        () => {
          closeCommandPalette()
          location.hash = '#/memories'
          setTimeout(() => {
            if (typeof window.openMemoryDetail === 'function') window.openMemoryDetail(mem.id)
          }, 100)
        }
      )
      frag.appendChild(row.el)
      _items.push(row)
    }
  }

  // ── Skills section ──
  if (hasSkills) {
    frag.appendChild(_groupHeader('Skills'))
    for (const sk of skills) {
      const name = escHtml(sk.name || '')
      const cat = escHtml(sk.category || sk.type || '')
      const row = _makeRow(
        `<span class="cmdk-row-badge cmdk-badge-skill">skill</span>
         <span class="cmdk-row-text">${name}</span>
         ${cat ? `<span class="cmdk-row-meta">${cat}</span>` : ''}`,
        () => {
          closeCommandPalette()
          location.hash = '#/skills'
          setTimeout(() => {
            if (typeof window.openSkillDetail === 'function') window.openSkillDetail(sk.name)
          }, 100)
        }
      )
      frag.appendChild(row.el)
      _items.push(row)
    }
  }

  // ── Nav / Go to section ──
  if (hasNav) {
    frag.appendChild(_groupHeader('Go to…'))
    for (const nav of navMatches) {
      const row = _makeRow(
        `<span class="cmdk-row-badge cmdk-badge-nav">nav</span>
         <span class="cmdk-row-icon">${escHtml(nav.icon)}</span>
         <span class="cmdk-row-text">${escHtml(nav.label)}</span>`,
        () => {
          closeCommandPalette()
          location.hash = nav.hash
        }
      )
      frag.appendChild(row.el)
      _items.push(row)
    }
  }

  listbox.innerHTML = ''
  listbox.appendChild(frag)

  // Highlight first item automatically when query is non-empty
  if (q && _items.length > 0) {
    _setHighlight(0)
  }
}

function _groupHeader(label) {
  const el = document.createElement('div')
  el.className = 'cmdk-group-header'
  el.setAttribute('role', 'presentation')
  el.textContent = label
  return el
}

function _makeRow(innerHtml, activate) {
  const el = document.createElement('div')
  el.id = 'cmdk-row-' + (_rowIdCounter++)  // unique id so aria-activedescendant resolves
  el.className = 'cmdk-row'
  el.setAttribute('role', 'option')
  el.setAttribute('aria-selected', 'false')
  el.innerHTML = innerHtml

  const rowObj = { el, activate }

  el.addEventListener('mouseenter', () => {
    const idx = _items.indexOf(rowObj)
    if (idx >= 0) _setHighlight(idx)
  })

  el.addEventListener('click', () => {
    activate()
  })

  return rowObj
}

// ── Keyboard navigation ───────────────────────────────────────────────────────

function _moveHighlight(delta) {
  if (_items.length === 0) return
  let next = _activeIdx + delta
  // Wrap around
  if (next < 0) next = _items.length - 1
  if (next >= _items.length) next = 0
  _setHighlight(next)
}

function _setHighlight(idx) {
  // Remove previous
  if (_activeIdx >= 0 && _activeIdx < _items.length) {
    _items[_activeIdx].el.classList.remove('cmdk-row--active')
    _items[_activeIdx].el.setAttribute('aria-selected', 'false')
  }
  _activeIdx = idx
  if (idx < 0 || idx >= _items.length) return
  const el = _items[idx].el
  el.classList.add('cmdk-row--active')
  el.setAttribute('aria-selected', 'true')
  // Scroll into view without jarring jump
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  // Update aria-activedescendant on input
  const input = _overlay?.querySelector('.cmdk-input')
  if (input) input.setAttribute('aria-activedescendant', el.id || '')
}
