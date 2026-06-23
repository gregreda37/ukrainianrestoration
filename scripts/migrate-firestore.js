/**
 * Firestore Migration Script
 * Copies all collections (and nested subcollections) from an old Firebase
 * project into the new ukrainianrestoration-50993 project.
 *
 * Setup:
 *   1. Place service account keys in this folder:
 *        scripts/old-service-account.json  ← from the old (insure_analyst) project
 *        scripts/new-service-account.json  ← from ukrainianrestoration-50993
 *   2. npm install firebase-admin   (run once from project root)
 *   3. node scripts/migrate-firestore.js
 *
 *   Optional — migrate only specific collections:
 *      node scripts/migrate-firestore.js users client_phones organization_data
 */

const admin = require('firebase-admin')

// ── Config ────────────────────────────────────────────────────────────────────
const OLD_PROJECT_ID = 'YOUR_OLD_PROJECT_ID'   // ← replace with insure_analyst project ID
const NEW_PROJECT_ID = 'ukrainianrestoration-50993'

const BATCH_SIZE = 400   // Firestore max is 500; keep headroom for nested writes
// ─────────────────────────────────────────────────────────────────────────────

const oldApp = admin.initializeApp({
  credential: admin.credential.cert(require('./old-service-account.json')),
  projectId: OLD_PROJECT_ID,
}, 'old')

const newApp = admin.initializeApp({
  credential: admin.credential.cert(require('./new-service-account.json')),
  projectId: NEW_PROJECT_ID,
}, 'new')

const oldDb = admin.firestore(oldApp)
const newDb = admin.firestore(newApp)

// Collections to migrate. Pass names as CLI args to restrict, or leave empty for all.
const ONLY_COLLECTIONS = process.argv.slice(2)  // e.g. ['users', 'client_phones']

let totalDocs  = 0
let totalCols  = 0

// ── Core migration ────────────────────────────────────────────────────────────

async function migrateCollection(oldColRef, newColRef, depth = 0) {
  const indent = '  '.repeat(depth)
  const snap   = await oldColRef.get()

  if (snap.empty) {
    console.log(`${indent}${oldColRef.path} — empty, skipping`)
    return
  }

  console.log(`${indent}${oldColRef.path} — ${snap.size} docs`)
  totalCols++

  // Write in batches
  const docs    = snap.docs
  let   batchOp = newDb.batch()
  let   count   = 0

  for (const docSnap of docs) {
    const data   = docSnap.data()
    const newRef = newColRef.doc(docSnap.id)

    batchOp.set(newRef, data, { merge: false })
    count++
    totalDocs++

    if (count >= BATCH_SIZE) {
      await batchOp.commit()
      batchOp = newDb.batch()
      count   = 0
    }
  }

  if (count > 0) await batchOp.commit()

  // Recurse into subcollections
  for (const docSnap of docs) {
    const subcols = await docSnap.ref.listCollections()
    for (const subcol of subcols) {
      await migrateCollection(
        subcol,
        newColRef.doc(docSnap.id).collection(subcol.id),
        depth + 1,
      )
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nMigrating Firestore: ${OLD_PROJECT_ID} → ${NEW_PROJECT_ID}`)
  if (ONLY_COLLECTIONS.length) {
    console.log(`Collections: ${ONLY_COLLECTIONS.join(', ')}\n`)
  } else {
    console.log('Collections: ALL\n')
  }

  const rootCols = await oldDb.listCollections()

  for (const col of rootCols) {
    if (ONLY_COLLECTIONS.length && !ONLY_COLLECTIONS.includes(col.id)) {
      console.log(`Skipping  ${col.id}`)
      continue
    }
    await migrateCollection(col, newDb.collection(col.id))
  }

  console.log(`\n✓ Done — ${totalDocs} documents across ${totalCols} collections migrated.`)
  process.exit(0)
}

main().catch(err => {
  console.error('\n✗ Migration failed:', err.message)
  process.exit(1)
})
