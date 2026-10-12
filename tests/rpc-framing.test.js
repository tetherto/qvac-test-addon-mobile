const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { spawnSync } = require('node:child_process')
const applyIterativeFraming = require('../backend/rpc-framing.cjs')

function loadRPC () {
    delete require.cache[require.resolve('bare-rpc')]
    return require('bare-rpc')
}

function stream (onwrite = () => {}) {
    const s = new EventEmitter()
    s.write = (b) => { onwrite(Buffer.from(b)); return true }
    return s
}

// Encode `count` events the way bare-rpc puts them on the wire
function encodeEvents (RPC, count) {
    const frames = []
    const sender = new RPC(stream((b) => frames.push(b)))
    for (let i = 0; i < count; i++) sender.event(2).send(String(i))
    return Buffer.concat(frames)
}

function receive (RPC, chunks) {
    const received = []
    const s = stream()
    new RPC(s, (req) => received.push(Buffer.from(req.data).toString()))
    for (const chunk of chunks) s.emit('data', chunk)
    return received
}

describe('bare-rpc frame parsing', () => {
    it('unpatched bare-rpc overflows the stack on one chunk of many frames', () => {
        // Sentinel: when this passes, bare-rpc fixed the recursion and rpc-framing.cjs can go.
        // The overflow escapes bare-rpc's async message handler and kills the process, so run it in a child.
        const child = spawnSync(process.execPath, ['-e', `
            const { EventEmitter } = require('node:events')
            const RPC = require('bare-rpc')
            const frames = []
            const out = new EventEmitter()
            out.write = (b) => { frames.push(Buffer.from(b)); return true }
            const sender = new RPC(out)
            for (let i = 0; i < 50000; i++) sender.event(2).send(String(i))
            const s = new EventEmitter()
            s.write = () => true
            new RPC(s, () => {})
            s.emit('data', Buffer.concat(frames))
        `], { encoding: 'utf8' })
        assert.notEqual(child.status, 0)
        assert.match(child.stderr, /RangeError: Maximum call stack size exceeded/)
    })

    it('parses 50000 frames from a single chunk in order', () => {
        const RPC = applyIterativeFraming(loadRPC())
        const received = receive(RPC, [encodeEvents(RPC, 50000)])
        assert.equal(received.length, 50000)
        assert.equal(received[0], '0')
        assert.equal(received[49999], '49999')
    })

    it('parses frames split byte by byte across chunks', () => {
        const RPC = applyIterativeFraming(loadRPC())
        const wire = encodeEvents(RPC, 300)
        const chunks = []
        for (let i = 0; i < wire.length; i++) chunks.push(wire.subarray(i, i + 1))
        const received = receive(RPC, chunks)
        assert.deepEqual(received, Array.from({ length: 300 }, (_, i) => String(i)))
    })

    it('parses frames split at uneven chunk boundaries', () => {
        const RPC = applyIterativeFraming(loadRPC())
        const wire = encodeEvents(RPC, 1000)
        const chunks = []
        for (let i = 0, size = 1; i < wire.length; i += size, size = (size % 97) + 3) chunks.push(wire.subarray(i, i + size))
        const received = receive(RPC, chunks)
        assert.deepEqual(received, Array.from({ length: 1000 }, (_, i) => String(i)))
    })

    it('parses frames larger than 64 KiB split across chunks', () => {
        const RPC = applyIterativeFraming(loadRPC())
        const frames = []
        const sender = new RPC(stream((b) => frames.push(b)))
        const big = 'x'.repeat(5 * 1024 * 1024)
        sender.event(2).send(big)
        sender.event(2).send('after')
        const wire = Buffer.concat(frames)
        const chunks = []
        for (let i = 0; i < wire.length; i += 65536) chunks.push(wire.subarray(i, i + 65536))
        const received = receive(RPC, chunks)
        assert.equal(received.length, 2)
        assert.equal(received[0].length, big.length)
        assert.equal(received[1], 'after')
    })

    it('still answers requests', async () => {
        const RPC = applyIterativeFraming(loadRPC())
        const a = stream()
        const b = stream()
        a.write = (buf) => { process.nextTick(() => b.emit('data', Buffer.from(buf))); return true }
        b.write = (buf) => { process.nextTick(() => a.emit('data', Buffer.from(buf))); return true }
        new RPC(b, (req) => req.reply('pong:' + Buffer.from(req.data).toString()))
        const client = new RPC(a)
        const req = client.request(1)
        req.send('ping')
        assert.equal((await req.reply('utf8')).toString(), 'pong:ping')
    })

    it('rejects a bare-rpc without the parser it replaces', () => {
        assert.throws(() => applyIterativeFraming(class {}), /bare-rpc internals changed/)
    })
})
