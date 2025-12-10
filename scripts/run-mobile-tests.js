#!/usr/bin/env node

'use strict'

const fs = require('bare-fs')
const path = require('bare-path')
const process = require('bare-process')

const projectRoot = path.resolve(__dirname, '..')
const backendPath = path.join(projectRoot, 'backend', 'backend.cjs')
const documentsDir = path.join(projectRoot, 'Documents')
const assetDir = path.join(projectRoot, 'testAssets')

if (!fs.existsSync(backendPath)) {
  console.error('[mobile-tests] Missing backend bundle. Run `npm run build` first.')
  process.exit(1)
}

fs.mkdirSync(documentsDir, { recursive: true })
if (!fs.existsSync(assetDir)) {
  console.warn(`[mobile-tests] Asset directory not found at ${assetDir}. Continuing with empty asset map.`)
}

process.env.QVAC_BACKEND_CLI = '1'
process.env.QVAC_BACKEND_DIR = documentsDir
process.env.QVAC_BACKEND_ASSETS = assetDir
// Provide an absolute model root to integration tests that expect test/model
process.env.QVAC_MODEL_ROOT = documentsDir

const argv = process.argv.slice(2)
let testsDirOverride = process.env.QVAC_TESTS_DIR || ''
const selected = []

for (const arg of argv) {
  if (arg.startsWith('--tests-dir=')) {
    testsDirOverride = arg.replace('--tests-dir=', '')
  } else {
    selected.push(arg)
  }
}

if (selected.length > 0) {
  console.log(`[mobile-tests] Running selected tests: ${selected.join(', ')}`)
} else {
  console.log('[mobile-tests] Running all available backend tests')
}
if (testsDirOverride) {
  console.log(`[mobile-tests] Test source: ${testsDirOverride}`)
}

try {
  require(backendPath)
} catch (err) {
  console.error('[mobile-tests] Failed to execute backend CLI:', err && err.stack ? err.stack : err)
  process.exit(1)
}

