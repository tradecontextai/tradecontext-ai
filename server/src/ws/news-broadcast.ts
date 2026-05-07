import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { NewsStory } from '@prisma/client';
import { log } from '../lib/logger';

/**
 * WebSocket fan-out for live news. Clients connect to ws://host/ws/news.
 * On every newly scored story, broadcast a JSON envelope.
 *
 * Also sends periodic heartbeat pings so reverse proxies (Vercel/Railway)
 * don't cull idle connections.
 */
let wss: WebSocketServer | null = null;
const HEARTBEAT_MS = 30_000;

export function attachNewsWs(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // Ignore upgrades for other paths — the alert WS handler (or others) handles those.
    // We deliberately don't destroy here because multiple WS handlers share this server.
    const url = new URL(req.url || '', 'http://x');
    if (url.pathname !== '/ws/news') return;
    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    log.info('ws/news client connected', { clients: wss!.clients.size });
    ws.send(JSON.stringify({ type: 'hello', ts: new Date().toISOString() }));

    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });

    const beat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* socket dying — let close handler clean up */
      }
    }, HEARTBEAT_MS);

    ws.on('close', () => {
      clearInterval(beat);
      log.debug('ws/news client disconnected', { clients: wss?.clients.size ?? 0 });
    });
  });

  log.info('WebSocket /ws/news mounted');
}

export function broadcastNews(story: NewsStory) {
  if (!wss) return;
  const payload = JSON.stringify({
    type: 'news',
    story: {
      id: story.id,
      headline: story.headline,
      summary: story.summary,
      source: story.source,
      url: story.url,
      bias: story.bias,
      impact: story.impact,
      isBreaking: story.isBreaking,
      affectedAssets: story.affectedAssets,
      reasoning: story.reasoning,
      publishedAt: story.publishedAt.toISOString(),
    },
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (e) {
        log.warn('ws send failed', { err: e instanceof Error ? e.message : e });
      }
    }
  }
}

export function newsClientCount(): number {
  return wss?.clients.size ?? 0;
}
