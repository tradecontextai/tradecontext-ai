/**
 * GET /api/geo-risk — public snapshot for the dashboard's Geopolitical
 * Risk Meter widget. Cached for 30s in the service layer.
 */
import { Router } from 'express';
import { getGeoRiskSnapshot } from '../services/geo-risk.service';

export const geoRiskRouter = Router();

geoRiskRouter.get('/', async (req, res, next) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';
    const snap = await getGeoRiskSnapshot({ force });
    res.json(snap);
  } catch (e) {
    next(e);
  }
});
