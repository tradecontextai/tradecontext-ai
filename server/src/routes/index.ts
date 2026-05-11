import { Router } from 'express';
import { authRouter } from './auth';
import { stripeRouter } from './stripe';
import { newsRouter } from './news';
import { playbooksRouter } from './playbooks';
import { calendarRouter } from './calendar';
import { priceRouter } from './price';
import { journalRouter } from './journal';
import { brokerRouter } from './broker';
import { watchlistRouter } from './watchlist';
import { alertsRouter } from './alerts';
import { aiBiasRouter } from './ai-bias';
import { aiChatRouter } from './ai-chat';
import { brokersDirectoryRouter } from './brokers-directory';
import { trackRecordRouter } from './track-record';
import { blogRouter } from './blog';
import { profileRouter } from './profile';
import { ideasRouter } from './ideas';
import { tradingviewWebhookRouter } from './tradingview-webhook';
import { geoRiskRouter } from './geo-risk';
import { backtestRouter } from './backtest';
import { newsClientCount } from '../ws/news-broadcast';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/stripe', stripeRouter);
apiRouter.use('/news', newsRouter);
apiRouter.use('/playbooks', playbooksRouter);
apiRouter.use('/calendar', calendarRouter);
apiRouter.use('/price', priceRouter);
apiRouter.use('/journal', journalRouter);
apiRouter.use('/broker', brokerRouter);
apiRouter.use('/watchlist', watchlistRouter);
apiRouter.use('/alerts', alertsRouter);
apiRouter.use('/ai', aiBiasRouter);
apiRouter.use('/ai', aiChatRouter);            // /api/ai/chat
apiRouter.use('/brokers', brokersDirectoryRouter);
apiRouter.use('/track-record', trackRecordRouter);
apiRouter.use('/blog', blogRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/ideas', ideasRouter);
apiRouter.use('/webhook/tradingview', tradingviewWebhookRouter);
apiRouter.use('/geo-risk', geoRiskRouter);
apiRouter.use('/backtest', backtestRouter);

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'tradecontext-server',
    ts: new Date().toISOString(),
    ws_clients: newsClientCount(),
  });
});
