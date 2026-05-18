/*
 * Synapse — recategorize all skills in DB to match current CATEGORY_MAP.
 *
 * Idempotent: only UPDATEs `skills.category` rows where the resolved category
 * differs from the stored one. Pulls the canonical mapping from import-skills.ts
 * (single source of truth), so this stays in sync as the map evolves.
 *
 * Run on prod:
 *   SKILLBRAIN_ROOT=/data tsx packages/storage/scripts/recategorize-skills.ts [--dry]
 *
 * Run locally:
 *   SKILLBRAIN_ROOT="$PWD" pnpm --filter @skillbrain/storage exec tsx scripts/recategorize-skills.ts [--dry]
 */

import { openDb } from '../src/db.js'
import { detectCategory } from '../src/import-skills.js'

const root = process.env.SKILLBRAIN_ROOT
if (!root) {
  console.error('SKILLBRAIN_ROOT env var is required (e.g. /data on prod, $PWD locally)')
  process.exit(1)
}

const dryRun = process.argv.includes('--dry')
const db = openDb(root)

const rows = db.prepare('SELECT name, category FROM skills').all() as { name: string; category: string }[]
console.log(`[recategorize] scanning ${rows.length} skills (dryRun=${dryRun})\n`)

const updates: { name: string; from: string; to: string }[] = []
for (const row of rows) {
  const newCat = detectCategory(row.name)
  if (newCat !== row.category) updates.push({ name: row.name, from: row.category, to: newCat })
}

console.log(`→ ${updates.length} skills to recategorize\n`)

if (updates.length > 0 && !dryRun) {
  const stmt = db.prepare('UPDATE skills SET category = ?, updated_at = ? WHERE name = ?')
  const now = new Date().toISOString()
  const tx = db.transaction((items: typeof updates) => {
    for (const u of items) stmt.run(u.to, now, u.name)
  })
  tx(updates)
  console.log(`✅ Applied ${updates.length} updates\n`)
} else if (dryRun && updates.length > 0) {
  console.log('(dry run — no DB writes)\n')
  for (const u of updates.slice(0, 30)) console.log(`  ${u.name.padEnd(40)} ${u.from} → ${u.to}`)
  if (updates.length > 30) console.log(`  ... and ${updates.length - 30} more`)
}

const finalStats = db
  .prepare('SELECT category, COUNT(*) as count FROM skills GROUP BY category ORDER BY count DESC')
  .all() as { category: string; count: number }[]
console.log('\n=== Final category distribution ===')
for (const s of finalStats) console.log(`  ${s.category.padEnd(15)} ${s.count}`)

db.close()
