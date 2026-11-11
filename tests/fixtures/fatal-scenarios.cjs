// Runs outside node:test, which would otherwise claim the rejections itself.
const fatalErrors = require('../../backend/fatal-errors.cjs')
fatalErrors.install(process)

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const out = {}

async function main () {
  // Shape of run 34533640427: the test body completes, a model load rejects unawaited later.
  let from = fatalErrors.mark()
  setTimeout(() => { Promise.reject(new Error('Failed to load vision model')) }, 20)
  await tick(50)
  out.background = fatalErrors.applyTo({ total: 1, passed: 1, failed: 0 }, from)

  from = fatalErrors.mark()
  await tick(10)
  out.clean = fatalErrors.applyTo({ total: 3, passed: 3, failed: 0 }, from)

  Promise.reject(new Error('earlier module'))
  await tick(10)
  from = fatalErrors.mark()
  await tick(10)
  out.earlier = fatalErrors.since(from)

  from = fatalErrors.mark()
  Promise.reject(new Error('top-level'))
  await tick(10)
  out.noBrittle = fatalErrors.applyTo({ total: 0, passed: 0, failed: 0 }, from)

  const before = process.listenerCount('unhandledRejection')
  fatalErrors.install(process)
  out.idempotent = process.listenerCount('unhandledRejection') === before

  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n')
}

main()
