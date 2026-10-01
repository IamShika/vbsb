// Real-time hub: controller sends state -> saved -> pushed to every display instantly.
const pack = s => JSON.stringify({ ...s, now: Date.now() });

export class Board {
  constructor(ctx, env) { this.c = ctx; this.e = env; }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Durable Object OK v3');
    const [client, server] = Object.values(new WebSocketPair());
    this.c.acceptWebSocket(server);
    const s = await this.c.storage.get('s');
    if (s) server.send(pack(s)); // new viewers get the current state right away
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    let d; try { d = JSON.parse(msg); } catch { return; }
    // 5 wrong PINs = locked for 1 minute
    const lock = (await this.c.storage.get('lock')) || { n: 0, until: 0 };
    if (Date.now() < lock.until) { ws.send('{"err":2}'); return; }
    if (!this.e.ADMIN_KEY || d.key !== this.e.ADMIN_KEY) {
      lock.n++;
      if (lock.n >= 5) { lock.until = Date.now() + 60000; lock.n = 0; }
      await this.c.storage.put('lock', lock);
      ws.send('{"err":1}'); return;
    }
    if (lock.n) await this.c.storage.put('lock', { n: 0, until: 0 });
    if (d.check) { ws.send('{"ok":1}'); return; } // just verifying the PIN
    const old = (await this.c.storage.get('s')) || {};
    const s = d.state;
    // timer times are stamped by the server so every device agrees
    if (s.tid === old.tid) { s.at = old.at; s.fz = old.fz; }
    else {
      const now = Date.now();
      let fz = 0; // how long the rally lasted (shown while paused)
      if (s.ev === 'p' && old.at) {
        const start = old.ev === 'p' ? old.at + (old.dur || 0) : old.at;
        fz = now < start ? (old.fz || 0) : now - start; // scored during a pause: keep the frozen time
      }
      s.at = now; s.fz = fz;
    }
    await this.c.storage.put('s', s);
    const p = pack(s);
    this.c.getWebSockets().forEach(w => w.send(p));
  }
}

export default {
  async fetch(req, env) {
    const ws = req.headers.get('Upgrade') === 'websocket';
    const test = new URL(req.url).searchParams.has('test');
    if (!ws && !test) return new Response('Volley board is running');
    try {
      return await env.BOARD.get(env.BOARD.idFromName('main')).fetch(req);
    } catch (e) {
      return new Response('Error: ' + e.message, { status: 500 });
    }
  }
};
