import { Router } from 'express';
import { z } from 'zod';
import { BROKER_DIRECTORY, filterByAssetClass } from '../services/broker-directory.service';

export const brokersDirectoryRouter = Router();

// ──────── GET /api/brokers/directory ────────
// Public — lists all regulated brokers we surface for the "Open in Broker"
// dropdown. Optional ?symbol filter returns only brokers that trade that
// asset class (e.g. ?symbol=BTC/USD → crypto exchanges).
const querySchema = z.object({
  symbol: z.string().min(1).max(40).optional(),
});

brokersDirectoryRouter.get('/directory', (req, res, next) => {
  try {
    const { symbol } = querySchema.parse(req.query);
    const brokers = symbol ? filterByAssetClass(symbol) : BROKER_DIRECTORY;
    res.json({
      brokers,
      count: brokers.length,
      symbol: symbol ? symbol.toUpperCase() : null,
    });
  } catch (e) {
    next(e);
  }
});
