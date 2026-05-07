import { Router } from 'express';
import { authRouter } from './auth';
import { stripeRouter } from './stripe';
import { newsRouter } from './news';
import { playbooksRouter } from './playbooks';
import { calendarRouter } from './calendar';
import { priceRouter } from './price';
import { journalRouter } from './journal';
import { brokerRouter } from './broker';
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

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'tradecontext-server',
    ts: new Date().toISOString(),
    ws_clients: newsClientCount(),
  });
});
