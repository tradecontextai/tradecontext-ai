/**
 * Public broker webhook + EA download — LIVE
 *
 *   POST /api/journal-bridge/fill?token=…    → persists a Trade row for the
 *                                              user the token resolves to.
 *   GET  /api/journal-bridge/ea?token=…      → returns an MT4 .mq4 EA file
 *                                              with that token + webhook
 *                                              URL pre-configured.
 *
 * Authentication is via a per-user opaque token (no session). Generated
 * once per user via POST /api/journal/token (auth required). The EA running
 * on the user's MetaTrader terminal calls the webhook with that token and
 * the resulting Trade rows show up in the same journal the user logs into.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';
import { rateLimit } from '../middleware/rate-limit';
import { log } from '../lib/logger';
import { createTrade } from '../services/journal.service';

export const journalBridgeRouter = Router();

// EAs can hammer this endpoint when many fills happen at once
const bridgeLimit = rateLimit({ ratePerSec: 5, burst: 60 });

const fillSchema = z.object({
  symbol: z.string().min(1).max(40),
  side: z.enum(['long', 'short', 'buy', 'sell']),
  qty: z.number().nullable().optional(),
  entryPrice: z.number(),
  exitPrice: z.number().nullable().optional(),
  stopLoss: z.number().nullable().optional(),
  takeProfit: z.number().nullable().optional(),
  pnl: z.number().nullable().optional(),
  pnlR: z.number().nullable().optional(),
  commission: z.number().nullable().optional(),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date().nullable().optional(),
  broker: z.string().max(80).optional(),
  account: z.string().max(40).optional(),
  comment: z.string().max(200).optional(),
  externalId: z.string().max(80).optional(),  // broker's deal/order id for dedup
  setupType: z.string().max(60).optional(),
});

journalBridgeRouter.post('/fill', bridgeLimit, async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(401).json({ error: { code: 'TOKEN_REQUIRED', message: 'Sync token required in ?token=…' } });
    }

    // Resolve token → user
    const syncToken = await prisma.journalSyncToken.findUnique({ where: { token } });
    if (!syncToken || syncToken.revoked) {
      return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Token revoked or unknown' } });
    }

    const fill = fillSchema.parse(req.body);
    const side = (fill.side === 'buy' || fill.side === 'long') ? 'long' as const : 'short' as const;

    // Persist as a Trade row scoped to the user
    const trade = await createTrade(syncToken.userId, {
      symbol: fill.symbol,
      direction: side,
      size: fill.qty ?? 1,
      entryPrice: fill.entryPrice,
      exitPrice: fill.exitPrice ?? undefined,
      stopLoss: fill.stopLoss ?? undefined,
      takeProfit: fill.takeProfit ?? undefined,
      pnl: fill.pnl ?? undefined,
      pnlR: fill.pnlR ?? undefined,
      setupType: fill.setupType ?? undefined,
      broker: fill.broker || (fill.account ? 'MT · #' + fill.account : 'EA Bridge'),
      notes: fill.comment ?? undefined,
      openedAt: fill.openedAt,
      closedAt: fill.closedAt ?? undefined,
    });

    // Bump usage counters on the token
    await prisma.journalSyncToken.update({
      where: { id: syncToken.id },
      data: { lastUsedAt: new Date(), fillsCount: { increment: 1 } },
    });

    log.info('Bridge fill persisted', {
      tokenPrefix: token.slice(0, 6) + '…',
      tradeId: trade.id, userId: syncToken.userId,
      symbol: fill.symbol, side, externalId: fill.externalId,
    });

    res.json({ ok: true, tradeId: trade.id, externalId: fill.externalId || null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'INVALID_FILL', message: msg } });
    }
    log.warn('Bridge fill error', { err: msg });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'bridge error' } });
  }
});

// ──────── EA download ────────
journalBridgeRouter.get('/ea', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).send('// Need ?token=… in URL');
  const exists = await prisma.journalSyncToken.findUnique({ where: { token } });
  if (!exists || exists.revoked) return res.status(404).send('// Token revoked or unknown');

  const host = req.protocol + '://' + req.get('host');
  const ea = `//+------------------------------------------------------------------+
//| TradeContextBridge.mq4                                           |
//| Streams every MT4 closed fill to your TradeContext.ai journal.   |
//| Generated ${new Date().toISOString()}                          |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property copyright "TradeContext.ai"

input string TC_Endpoint = "${host}/api/journal-bridge/fill?token=${token}";

// Persist last sent deal index between bars
int g_lastIndex = -1;

string EscapeJson(string s){
   StringReplace(s, "\\\\", "\\\\\\\\");
   StringReplace(s, "\\"",  "\\\\\\"");
   return s;
}

// Build JSON for one closed deal and POST it
void PostClosedDeal(int idx){
   if(!OrderSelect(idx, SELECT_BY_POS, MODE_HISTORY)) return;
   if(OrderType() > OP_SELL) return; // only buy/sell (no balance/credit/etc.)
   if(OrderCloseTime() == 0) return; // open

   string sideStr = (OrderType() == OP_BUY) ? "long" : "short";
   string opened = TimeToString(OrderOpenTime(), TIME_DATE|TIME_SECONDS);
   string closed = TimeToString(OrderCloseTime(), TIME_DATE|TIME_SECONDS);
   string body = StringFormat(
      "{\\"symbol\\":\\"%s\\",\\"side\\":\\"%s\\",\\"qty\\":%G,\\"entryPrice\\":%G,\\"exitPrice\\":%G,\\"stopLoss\\":%G,\\"takeProfit\\":%G,\\"pnl\\":%G,\\"commission\\":%G,\\"openedAt\\":\\"%s\\",\\"closedAt\\":\\"%s\\",\\"externalId\\":\\"%d\\",\\"broker\\":\\"%s\\",\\"account\\":\\"%d\\",\\"comment\\":\\"%s\\"}",
      EscapeJson(OrderSymbol()),
      sideStr,
      OrderLots(),
      OrderOpenPrice(),
      OrderClosePrice(),
      OrderStopLoss(),
      OrderTakeProfit(),
      OrderProfit(),
      OrderCommission(),
      opened, closed,
      OrderTicket(),
      EscapeJson(AccountCompany()),
      AccountNumber(),
      EscapeJson(OrderComment())
   );

   string headers = "Content-Type: application/json\\r\\n";
   char data[]; char result[]; string resultHeaders;
   StringToCharArray(body, data, 0, StringLen(body));
   int code = WebRequest("POST", TC_Endpoint, headers, 5000, data, result, resultHeaders);
   if(code != 200) Print("TradeContext bridge HTTP ", code, " ", CharArrayToString(result));
   else            Print("TradeContext bridge ✓ ticket ", OrderTicket());
}

int OnInit(){
   g_lastIndex = OrdersHistoryTotal();
   Print("TradeContext.ai bridge initialised. Watching for new closed deals.");
   Print("Endpoint: ", TC_Endpoint);
   Print("⚠ Tools → Options → Expert Advisors → allow WebRequest for the host above.");
   return INIT_SUCCEEDED;
}

void OnTick(){
   int total = OrdersHistoryTotal();
   if(total <= g_lastIndex) return;
   for(int i = g_lastIndex; i < total; i++){
      PostClosedDeal(i);
   }
   g_lastIndex = total;
}

void OnTrade(){
   // Some brokers fire OnTrade more reliably than ticks — same handler.
   OnTick();
}
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="TradeContextBridge.mq4"');
  res.send(ea);
});
