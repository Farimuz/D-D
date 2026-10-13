import { once } from 'node:events'
import WebSocket from 'ws'
import type { Action, Join, ServerMessage, Snapshot } from '../../src/online/protocol.ts'

export class OnlinePeer {
  readonly socket: WebSocket
  readonly frames: string[] = []
  latest: Snapshot | null = null
  private readonly queue: ServerMessage[] = []
  private readonly waiters: Array<{ match(v: ServerMessage): boolean; accept(v: ServerMessage): void }> = []
  private sequence = 0
  constructor(url: string) {
    this.socket = new WebSocket(url); this.socket.on('error', () => {})
    this.socket.on('message', bytes => {
      const text = bytes.toString(); this.frames.push(text)
      const message = JSON.parse(text) as ServerMessage
      if (message.type === 'state') this.latest = message
      const index = this.waiters.findIndex(w => w.match(message))
      if (index < 0) this.queue.push(message)
      else this.waiters.splice(index, 1)[0].accept(message)
    })
  }
  wait(match: (v: ServerMessage) => boolean): Promise<ServerMessage> {
    const index = this.queue.findIndex(match)
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0])
    return new Promise((accept, reject) => {
      const waiter = { match, accept: (v: ServerMessage) => { clearTimeout(timer); accept(v) } }
      const timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('No server response')) }, 5000)
      this.waiters.push(waiter)
    })
  }
  async join(join: Join) {
    await once(this.socket, 'open'); this.socket.send(JSON.stringify(join)); await this.wait(v => v.type === 'state'); return this
  }
  async action(action: Action) {
    const requestId = String(++this.sequence)
    this.socket.send(JSON.stringify({ type: 'action', requestId, action }))
    return await this.wait(v => v.type === 'result' && v.requestId === requestId) as Extract<ServerMessage, { type: 'result' }>
  }
}
