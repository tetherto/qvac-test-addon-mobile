const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

/**
 * Unit tests for the testFilter parsing and 0/0 failure-detection logic.
 * These validate the core behavioral contract without requiring a device.
 */

// --- testFilter parsing (mirrors readTestFilter in app/index.js) ---

function parseTestFilter(content) {
    if (!content || content.trim().length === 0) return null
    const testNames = content.trim().split('|').map(s => s.trim()).filter(Boolean)
    return testNames.length > 0 ? new Set(testNames) : null
}

function getUnmatchedFilterEntries(filter, automatedTests) {
    return [...filter].filter(name => !automatedTests.includes(name))
}

describe('testFilter parsing', () => {
    it('parses single test name', () => {
        const filter = parseTestFilter('runGemma4Test')
        assert.deepEqual([...filter], ['runGemma4Test'])
    })

    it('parses pipe-separated test names', () => {
        const filter = parseTestFilter('runGemma4Test|runToolCallingTest|runReasoningTest')
        assert.equal(filter.size, 3)
        assert.ok(filter.has('runGemma4Test'))
        assert.ok(filter.has('runToolCallingTest'))
        assert.ok(filter.has('runReasoningTest'))
    })

    it('trims whitespace around names', () => {
        const filter = parseTestFilter(' runGemma4Test | runToolCallingTest ')
        assert.ok(filter.has('runGemma4Test'))
        assert.ok(filter.has('runToolCallingTest'))
    })

    it('returns null for empty content', () => {
        assert.equal(parseTestFilter(''), null)
        assert.equal(parseTestFilter('   '), null)
        assert.equal(parseTestFilter(null), null)
        assert.equal(parseTestFilter(undefined), null)
    })

    it('ignores empty segments from trailing/leading pipes', () => {
        const filter = parseTestFilter('|runGemma4Test||runToolCallingTest|')
        assert.equal(filter.size, 2)
    })
})

describe('testFilter matching', () => {
    const automatedTests = [
        'runGemma4Test',
        'runToolCallingTest',
        'runReasoningTest',
        'runLightATest',
        'runLightBTest',
    ]

    it('filters tests to only those in the filter set', () => {
        const filter = new Set(['runGemma4Test', 'runReasoningTest'])
        const testsToRun = automatedTests.filter(name => filter.has(name))
        assert.deepEqual(testsToRun, ['runGemma4Test', 'runReasoningTest'])
    })

    it('runs all tests when filter is null', () => {
        const filter = null
        const testsToRun = filter
            ? automatedTests.filter(name => filter.has(name))
            : automatedTests
        assert.deepEqual(testsToRun, automatedTests)
    })

    it('detects unmatched filter entries (typos/renamed tests)', () => {
        const filter = new Set(['runGemma4Test', 'runNonExistentTest', 'runDeletedTest'])
        const unmatched = getUnmatchedFilterEntries(filter, automatedTests)
        assert.deepEqual(unmatched, ['runNonExistentTest', 'runDeletedTest'])
    })

    it('reports no unmatched when all filter entries exist', () => {
        const filter = new Set(['runGemma4Test', 'runLightATest'])
        const unmatched = getUnmatchedFilterEntries(filter, automatedTests)
        assert.deepEqual(unmatched, [])
    })
})

// --- Backend result evaluation (mirrors handleRunTest in build-test-app.js) ---
// `skipped` is set by loadBundledIntegrationModule only when every registered
// test was an intentional skip (via global.skipMobileTest). A 0/0 with no
// explicit skip is a FAIL.

function evaluateTestResult(result) {
    const { summary } = result
    const allPassed = !!summary && summary.total > 0 && summary.failed === 0
    const skipped = !!result.skipped
    return { success: allPassed, skipped }
}

// Mirrors handleRunTest's async-crash guard: an unhandled async error recorded
// while the test was running is a FAIL, even if the test function resolved
// cleanly (the dlopen-as-async-unhandledRejection scenario from PR #47).
function evaluateRunOutcome(result, asyncCrash) {
    if (asyncCrash) {
        return { success: false, error: `async ${asyncCrash.kind}: ${asyncCrash.message}` }
    }
    return evaluateTestResult(result)
}

describe('async-crash guard (addon-load failure that resolves cleanly)', () => {
    it('FAILS a clean 0/0 when an async unhandledRejection fired during the test', () => {
        const r = evaluateRunOutcome(
            { summary: { total: 0, passed: 0, failed: 0 } },
            { kind: 'unhandledRejection', message: 'dlopen: libtts.so not found' }
        )
        assert.equal(r.success, false)
        assert.match(r.error, /unhandledRejection/)
    })

    it('FAILS even a clean PASS when an async crash fired during the test', () => {
        const r = evaluateRunOutcome(
            { summary: { total: 3, passed: 3, failed: 0 } },
            { kind: 'uncaughtException', message: 'boom' }
        )
        assert.equal(r.success, false)
    })

    it('passes normally when no async crash fired', () => {
        const r = evaluateRunOutcome({ summary: { total: 3, passed: 3, failed: 0 } }, null)
        assert.equal(r.success, true)
    })

    it('still honours an intentional skip when no async crash fired', () => {
        const r = evaluateRunOutcome(
            { summary: { total: 1, passed: 0, failed: 0, skipped: 1 }, skipped: true },
            null
        )
        assert.equal(r.success, true)
        assert.equal(r.skipped, true)
    })
})

describe('zero-subtest detection (0/0 = FAIL, explicit skip = PASS)', () => {
    it('passes when total > 0 and failed === 0', () => {
        const r = evaluateTestResult({ summary: { total: 5, passed: 5, failed: 0 } })
        assert.equal(r.success, true)
        assert.equal(r.skipped, false)
    })

    it('passes with single passing test', () => {
        const r = evaluateTestResult({ summary: { total: 1, passed: 1, failed: 0 } })
        assert.equal(r.success, true)
        assert.equal(r.skipped, false)
    })

    it('FAILS when total === 0 without explicit skip (catches async dlopen crash)', () => {
        const r = evaluateTestResult({ summary: { total: 0, passed: 0, failed: 0 } })
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })

    it('an intentional skip is green AND flagged skipped (registers a real skip → total>0)', () => {
        const r = evaluateTestResult({
            summary: { total: 1, passed: 0, failed: 0, skipped: 1 },
            skipped: true
        })
        assert.equal(r.success, true)
        assert.equal(r.skipped, true)
    })

    it('FAILS when summary is null (crash before any output)', () => {
        const r = evaluateTestResult({ summary: null })
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })

    it('FAILS when summary is undefined', () => {
        const r = evaluateTestResult({})
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })

    it('FAILS when there are failures even with total > 0', () => {
        const r = evaluateTestResult({ summary: { total: 5, passed: 3, failed: 2 } })
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })
})

// --- Per-module counting (mirrors loadBundledIntegrationModule deltas) ---
// brittle records a skip as count++ AND pass++, so real failures are
// (count - pass) and real passes are the pass delta minus the tagged skips.
// A module is a skip ONLY if it registered tests and every one was a skip; a
// module that registered nothing (total 0, incl. no runner) is a 0/0 FAIL.

function computeModuleResult(initial, final, hadRunner = true) {
    if (!hadRunner) {
        return { skipped: false, summary: { total: 0, passed: 0, failed: 0, skipped: 0 } }
    }
    const total = final.count - initial.count
    const skipped = (final.skipped || 0) - (initial.skipped || 0)
    const failed = total - (final.pass - initial.pass)
    const passed = total - skipped - failed
    const isSkip = total > 0 && skipped === total && failed === 0
    return { skipped: isSkip, summary: { total, passed, failed, skipped } }
}

describe('per-module counting + skip-vs-crash distinction', () => {
    const zero = { count: 0, pass: 0, skipped: 0 }

    it('all real passes → PASS, not skipped', () => {
        const r = computeModuleResult(zero, { count: 3, pass: 3, skipped: 0 })
        assert.deepEqual(r.summary, { total: 3, passed: 3, failed: 0, skipped: 0 })
        assert.equal(r.skipped, false)
    })

    it('real failure present → failed > 0, not skipped', () => {
        const r = computeModuleResult(zero, { count: 3, pass: 1, skipped: 0 })
        assert.equal(r.summary.failed, 2)
        assert.equal(r.summary.passed, 1)
        assert.equal(r.skipped, false)
    })

    it('all intentional skips → reported as skipped (total>0)', () => {
        const r = computeModuleResult(zero, { count: 2, pass: 2, skipped: 2 })
        assert.deepEqual(r.summary, { total: 2, passed: 0, failed: 0, skipped: 2 })
        assert.equal(r.skipped, true)
    })

    it('mix of pass + skip → PASS (not a whole-module skip), skip counted', () => {
        const r = computeModuleResult(zero, { count: 3, pass: 3, skipped: 1 })
        assert.deepEqual(r.summary, { total: 3, passed: 2, failed: 0, skipped: 1 })
        assert.equal(r.skipped, false)
    })

    it('mix of fail + skip → failure dominates (not skipped)', () => {
        const r = computeModuleResult(zero, { count: 3, pass: 2, skipped: 1 })
        assert.equal(r.summary.failed, 1)
        assert.equal(r.summary.skipped, 1)
        assert.equal(r.summary.passed, 1)
        assert.equal(r.skipped, false)
    })

    it('SAFETY NET: no brittle runner → 0/0 FAIL (silent addon-load crash)', () => {
        const r = computeModuleResult(zero, zero, false)
        assert.deepEqual(r.summary, { total: 0, passed: 0, failed: 0, skipped: 0 })
        assert.equal(r.skipped, false)
    })

    it('SAFETY NET: runner exists but module registered nothing → 0/0 FAIL', () => {
        const r = computeModuleResult({ count: 5, pass: 5, skipped: 0 }, { count: 5, pass: 5, skipped: 0 })
        assert.equal(r.summary.total, 0)
        assert.equal(r.skipped, false)
    })

    it('handles the shared-singleton runner: a skip in a later module', () => {
        // earlier modules already ran 5 passing tests + 1 skip
        const r = computeModuleResult(
            { count: 6, pass: 6, skipped: 1 },
            { count: 7, pass: 7, skipped: 2 }
        )
        assert.deepEqual(r.summary, { total: 1, passed: 0, failed: 0, skipped: 1 })
        assert.equal(r.skipped, true)
    })

    it('classifies a whole-module skip as SKIP on screen', () => {
        const r = computeModuleResult(zero, { count: 1, pass: 1, skipped: 1 })
        const display = classifyDisplayResult({
            success: r.summary.total > 0 && r.summary.failed === 0,
            skipped: r.skipped,
            summary: r.summary
        })
        assert.equal(display, 'SKIP')
    })

    it('classifies a genuine 0/0 as FAIL_ZERO on screen', () => {
        const r = computeModuleResult(zero, zero, false)
        const display = classifyDisplayResult({
            success: r.summary.total > 0 && r.summary.failed === 0,
            skipped: r.skipped,
            summary: r.summary
        })
        assert.equal(display, 'FAIL_ZERO')
    })
})

// --- App-side result display logic (mirrors app/index.js) ---

function classifyDisplayResult(result) {
    const { summary } = result
    // Skip is checked FIRST: an intentional skip now registers a real (skipped)
    // test, so summary.total > 0 and success is true — the PASS branch would
    // otherwise swallow it.
    if (result.skipped) return 'SKIP'
    if (summary && result.success && summary.total > 0) return 'PASS'
    if (result.error || (summary && (summary.total ?? 0) === 0)) return 'FAIL_ZERO'
    return 'FAIL'
}

describe('app result display classification', () => {
    it('shows PASS for successful tests with subtests', () => {
        assert.equal(classifyDisplayResult({
            success: true, skipped: false,
            summary: { total: 4, passed: 4, failed: 0 }
        }), 'PASS')
    })

    it('shows SKIP for an intentional skip (registers a real skip → total>0, success)', () => {
        assert.equal(classifyDisplayResult({
            success: true, skipped: true,
            summary: { total: 1, passed: 0, failed: 0, skipped: 1 }
        }), 'SKIP')
    })

    it('shows FAIL_ZERO for async dlopen crash (0/0 without explicit skip)', () => {
        assert.equal(classifyDisplayResult({
            success: false, skipped: false,
            summary: { total: 0, passed: 0, failed: 0 }
        }), 'FAIL_ZERO')
    })

    it('shows FAIL_ZERO when function threw an error', () => {
        assert.equal(classifyDisplayResult({
            success: false, skipped: false,
            error: 'dlopen failed: libfoo.so not found',
            summary: undefined
        }), 'FAIL_ZERO')
    })

    it('shows FAIL for tests with actual failures', () => {
        assert.equal(classifyDisplayResult({
            success: false, skipped: false,
            summary: { total: 5, passed: 3, failed: 2 }
        }), 'FAIL')
    })
})

// --- Scenario: sharded CI with filter active ---

describe('sharded CI scenario', () => {
    const allTests = [
        'runGemma4Test',
        'runContinuousBatchingTest',
        'runToolCallingTest',
        'runReasoningTest',
        'runLightATest',
        'runLightBTest',
        'runFinetuningTest',
    ]

    it('shard with single test only runs that test', () => {
        const filter = parseTestFilter('runGemma4Test')
        const testsToRun = allTests.filter(name => filter.has(name))
        assert.deepEqual(testsToRun, ['runGemma4Test'])
    })

    it('shard with multiple tests runs exactly those', () => {
        const filter = parseTestFilter('runLightATest|runLightBTest')
        const testsToRun = allTests.filter(name => filter.has(name))
        assert.deepEqual(testsToRun, ['runLightATest', 'runLightBTest'])
    })

    it('non-selected tests are not in testsToRun (no 0/0 risk)', () => {
        const filter = parseTestFilter('runGemma4Test')
        const testsToRun = allTests.filter(name => filter.has(name))
        assert.ok(!testsToRun.includes('runToolCallingTest'))
        assert.ok(!testsToRun.includes('runReasoningTest'))
    })

    it('selected test that passes with subtests = PASS', () => {
        const r = evaluateTestResult({ summary: { total: 4, passed: 4, failed: 0 } })
        assert.equal(r.success, true)
    })

    it('selected test that crashes (0/0 without explicit skip) = FAIL', () => {
        const r = evaluateTestResult({ summary: { total: 0, passed: 0, failed: 0 } })
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })

    it('selected test that is intentionally skipped = SKIP (green, total>0)', () => {
        const r = evaluateTestResult({
            summary: { total: 1, passed: 0, failed: 0, skipped: 1 },
            skipped: true
        })
        assert.equal(r.success, true)
        assert.equal(r.skipped, true)
    })

    it('crash with error is a real FAIL (not skipped)', () => {
        const result = { success: false, skipped: false, error: 'dlopen failed', summary: undefined }
        assert.equal(classifyDisplayResult(result), 'FAIL_ZERO')
    })
})
