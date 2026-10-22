// Records errors raised outside any awaited test chain. brittle never counts them,
// so without this a module that loses sub-tests to one still reports PASS.
const errors = []
let installed = false

function install (host) {
  if (installed || !host || typeof host.on !== 'function') return
  installed = true
  host.on('unhandledRejection', (reason) => {
    errors.push(reason || new Error('unhandledRejection'))
    console.error('[fatal-errors] Unhandled rejection:', reason instanceof Error ? reason.stack : reason)
  })
  host.on('uncaughtException', (err) => {
    errors.push(err || new Error('uncaughtException'))
    console.error('[fatal-errors] Uncaught exception:', err instanceof Error ? err.stack : err)
  })
}

function mark () {
  return errors.length
}

// First error recorded since `from`, or null.
function since (from) {
  return errors.length > from ? errors[from] : null
}

// Fails a module summary when an error was recorded while it ran.
function applyTo (summary, from) {
  const err = since(from)
  if (!err) return summary
  return {
    ...summary,
    total: Math.max(summary.total, 1),
    failed: Math.max(summary.failed, 1),
    error: {
      message: (err && err.message) || String(err),
      stack: err && err.stack
    }
  }
}

module.exports = { install, mark, since, applyTo }
