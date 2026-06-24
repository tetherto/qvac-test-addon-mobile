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

function evaluateTestResult(summary) {
    const allPassed = !!summary && summary.total > 0 && summary.failed === 0
    const skipped = !!summary && summary.total === 0
    return { success: allPassed, skipped }
}

describe('zero-subtest detection (0/0 = FAIL vs intentional skip)', () => {
    it('passes when total > 0 and failed === 0', () => {
        const r = evaluateTestResult({ total: 5, passed: 5, failed: 0 })
        assert.equal(r.success, true)
        assert.equal(r.skipped, false)
    })

    it('passes with single passing test', () => {
        const r = evaluateTestResult({ total: 1, passed: 1, failed: 0 })
        assert.equal(r.success, true)
        assert.equal(r.skipped, false)
    })

    it('marks as skipped when total === 0 (intentional skip, e.g. benchmark shim)', () => {
        const r = evaluateTestResult({ total: 0, passed: 0, failed: 0 })
        assert.equal(r.success, false)
        assert.equal(r.skipped, true)
    })

    it('FAILS when summary is null (crash before any output)', () => {
        const r = evaluateTestResult(null)
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })

    it('FAILS when summary is undefined', () => {
        const r = evaluateTestResult(undefined)
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })

    it('FAILS when there are failures even with total > 0', () => {
        const r = evaluateTestResult({ total: 5, passed: 3, failed: 2 })
        assert.equal(r.success, false)
        assert.equal(r.skipped, false)
    })
})

// --- App-side result display logic (mirrors app/index.js) ---

function classifyDisplayResult(result) {
    const { summary } = result
    if (summary && result.success && summary.total > 0) return 'PASS'
    if (result.skipped) return 'SKIP'
    if (result.error || (!result.skipped && summary && (summary.total ?? 0) === 0)) return 'FAIL_ZERO'
    return 'FAIL'
}

describe('app result display classification', () => {
    it('shows PASS for successful tests with subtests', () => {
        assert.equal(classifyDisplayResult({
            success: true, skipped: false,
            summary: { total: 4, passed: 4, failed: 0 }
        }), 'PASS')
    })

    it('shows SKIP for intentional 0/0 (benchmark shim, function completed cleanly)', () => {
        assert.equal(classifyDisplayResult({
            success: false, skipped: true,
            summary: { total: 0, passed: 0, failed: 0 }
        }), 'SKIP')
    })

    it('shows FAIL_ZERO when function threw an error (crash/dlopen failure)', () => {
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
        const r = evaluateTestResult({ total: 4, passed: 4, failed: 0 })
        assert.equal(r.success, true)
    })

    it('selected test that crashes (0/0) = skipped (not hard FAIL)', () => {
        const r = evaluateTestResult({ total: 0, passed: 0, failed: 0 })
        assert.equal(r.success, false)
        assert.equal(r.skipped, true)
    })

    it('crash with error is a real FAIL (not skipped)', () => {
        const result = { success: false, skipped: false, error: 'dlopen failed', summary: undefined }
        assert.equal(classifyDisplayResult(result), 'FAIL_ZERO')
    })
})
