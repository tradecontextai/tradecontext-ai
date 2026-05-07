import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { log } from '../lib/logger';

/**
 * WebSocket fan-out for triggered price alerts.
 *
 * Clients connect with `?userId=<id>` to filter only their own alerts.
 * If no userId is passed, the client gets nothing (anonymous = no spam).
 *
 * Public broadcast at `/ws/alerts` — server-side filtering keeps each
 * client's stream private.
 */
let wss: WebSocketServer | null = null;
const HEARTBEAT_MS = 30_000;

export interface AlertBroadcastPayload {
  type: 'alert';
  alertId: string;
  userId: string;
  symbol: string;
  condition: 'above' | 'below';
  target: number;
  currentPrice: number;
  triggeredAt: string;
}

interface AlertClient extends WebSocket {
  _userId?: string;
}

export function attachAlertWs(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', 'http://x');
    if (url.pathname !== '/ws/alerts') return; // not ours, leave to other handlers
    const userId = url.searchParams.get('userId') || undefined;
    wss!.handleUpgrade(req, socket, head, (ws) => {
      (ws as AlertClient)._userId = userId;
      wss!.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: AlertClient) => {
    log.info('ws/alerts client connected', { clients: wss!.clients.size, userId: ws._userId || 'anon' });
    ws.send(JSON.stringify({ type: 'hello', ts: new Date().toISOString() }));

    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      try {
        ws.ping();
      } catch {
        /* socket dying */
      }
    }, HEARTBEAT_MS);
    ws.on('close', () => {
      clearInterval(beat);
      log.debug('ws/alerts client disconnected', { clients: wss?.clients.size ?? 0 });
    });
  });

  log.info('WebSocket /ws/alerts mounted');
}

/** Broadcast an alert — only sent to clients whose userId matches. */
export function broadcastAlert(payload: AlertBroadcastPayload): void {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if ((client as AlertClient)._userId !== payload.userId) continue; // private fan-out
    try {
      client.send(msg);
    } catch (e) {
      log.warn('alert ws send failed', { err: e instanceof Error ? e.message : e });
    }
  }
}

export function alertClientCount(): number {
  return wss?.clients.size ?? 0;
}
