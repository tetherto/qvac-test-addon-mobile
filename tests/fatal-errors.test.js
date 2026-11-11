const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { execFileSync } = require('node:child_process')

const raw = execFileSync(process.execPath, [path.join(__dirname, 'fixtures/fatal-scenarios.cjs')], { stdio: ['ignore', 'pipe', 'ignore'] })
const r = JSON.parse(raw.toString().split('\n').find((l) => l.startsWith('RESULT ')).slice(7))

describe('fatal errors outside the test tally', () => {
  it('fails a module whose test passes but rejects in the background', () => {
    assert.equal(r.background.failed, 1)
    assert.match(r.background.error.message, /Failed to load vision model/)
  })

  it('leaves a clean module unchanged', () => {
    assert.deepEqual(r.clean, { total: 3, passed: 3, failed: 0 })
  })

  it('does not blame a module for an error raised before it started', () => {
    assert.equal(r.earlier, null)
  })

  it('fails a module with no brittle tests when it raised an error', () => {
    assert.equal(r.noBrittle.total, 1)
    assert.equal(r.noBrittle.failed, 1)
  })

  it('install is idempotent', () => {
    assert.equal(r.idempotent, true)
  })
})

describe('generated backend wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/build-test-app.js'), 'utf8')

  it('loads and installs the tracker', () => {
    assert.match(source, /const fatalErrors = require\('\.\/fatal-errors\.cjs'\)\nfatalErrors\.install\(globalThis\.Bare\)/)
  })

  it('marks before loading the module and applies after its tests finish', () => {
    const fn = source.slice(source.indexOf('async function loadBundledIntegrationModule'), source.indexOf('global.runIntegrationModule = async'))
    const markAt = fn.indexOf('fatalErrors.mark()')
    assert.ok(markAt !== -1 && markAt < fn.indexOf('loader(options)'), 'mark must come before the module loads')
    assert.ok(fn.lastIndexOf('fatalErrors.applyTo(') > fn.indexOf('while (runner.next !== null)'), 'apply must come after the wait for tests')
  })
})
