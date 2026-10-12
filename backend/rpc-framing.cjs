// bare-rpc parses frames by mutual recursion (_onbeforeframe <-> _onafterframe),
// two stack frames per message. One IPC read carrying a few thousand messages
// overflows the stack and kills the channel. Replace both with a loop.
// Shared by the Bare backend and the React Native app.
const b4a = require('b4a')

function concat (rpc) {
  return rpc._buffer.length === 1 ? rpc._buffer[0] : b4a.concat(rpc._buffer)
}

function drain () {
  while (true) {
    if (this._frame === -1) {
      if (this._buffered < 4) return
      const buffer = concat(this)
      this._buffer = [buffer]
      this._frame = 4 + (buffer[0] | (buffer[1] << 8) | (buffer[2] << 16)) + buffer[3] * 0x1000000
    }
    if (this._buffered < this._frame) return
    const buffer = concat(this)
    const frame = this._frame
    this._buffered -= frame
    this._buffer = this._buffered > 0 ? [buffer.subarray(frame)] : []
    this._frame = -1
    this._onmessage(buffer.subarray(0, frame))
  }
}

module.exports = function applyIterativeFraming (RPC) {
  const proto = RPC.prototype
  if (['_onbeforeframe', '_onafterframe', '_onmessage'].some((name) => typeof proto[name] !== 'function')) {
    throw new Error('bare-rpc internals changed: re-check rpc-framing.cjs against the installed version')
  }
  proto._onbeforeframe = drain
  proto._onafterframe = drain
  return RPC
}
