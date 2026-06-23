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

// --- 0/0 = FAIL logic (mirrors handleRunTest in build-test-app.js backend template) ---

function evaluateTestResult(summary) {
    return !!summary && summary.total > 0 && summary.failed === 0
}

describe('zero-subtest detection (0/0 = FAIL)', () => {
    it('passes when total > 0 and failed === 0', () => {
        assert.equal(evaluateTestResult({ total: 5, passed: 5, failed: 0 }), true)
    })

    it('passes with single passing test', () => {
        assert.equal(evaluateTestResult({ total: 1, passed: 1, failed: 0 }), true)
    })

    it('FAILS when total === 0 (no sub-tests executed)', () => {
        assert.equal(evaluateTestResult({ total: 0, passed: 0, failed: 0 }), false)
    })

    it('FAILS when summary is null (crash before any output)', () => {
        assert.equal(evaluateTestResult(null), false)
    })

    it('FAILS when summary is undefined', () => {
        assert.equal(evaluateTestResult(undefined), false)
    })

    it('FAILS when there are failures even with total > 0', () => {
        assert.equal(evaluateTestResult({ total: 5, passed: 3, failed: 2 }), false)
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
        const summary = { total: 4, passed: 4, failed: 0 }
        assert.equal(evaluateTestResult(summary), true)
    })

    it('selected test that crashes (0/0) = FAIL', () => {
        const summary = { total: 0, passed: 0, failed: 0 }
        assert.equal(evaluateTestResult(summary), false)
    })
})
