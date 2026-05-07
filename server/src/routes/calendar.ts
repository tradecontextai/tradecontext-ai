import { Router } from 'express';
import { z } from 'zod';
import {
  calendarAvailable,
  fetchCalendar,
  filterCalendar,
  groupByDate,
  type Impact,
} from '../services/calendar.service';

export const calendarRouter = Router();

// ──────── GET /api/calendar ────────
// Public read — used by the dashboard sidebar.
// Query:
//   impact   = comma-separated subset of high,medium,low  (default: all)
//   ccy      = comma-separated currency codes (e.g. USD,GBP) — optional
//   from,to  = ISO dates (default: today → +7 days)
//   group    = 'date' to return { byDate: {YYYY-MM-DD: [...]} }
const querySchema = z.object({
  impact: z.string().optional(),
  ccy: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  group: z.enum(['date', 'flat']).default('flat'),
  force: z.coerce.boolean().default(false),
});

calendarRouter.get('/', async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);

    if (!calendarAvailable()) {
      res.json({ events: [], available: false });
      return;
    }

    const events = await fetchCalendar({ from: q.from, to: q.to, force: q.force });

    const impactFilter = q.impact
      ? (q.impact.split(',').map((s) => s.trim().toLowerCase()) as Impact[]).filter((s) =>
          ['high', 'medium', 'low'].includes(s),
        )
      : undefined;
    const ccyFilter = q.ccy
      ? q.ccy.split(',').map((s) => s.trim().toUpperCase())
      : undefined;

    const filtered = filterCalendar(events, {
      impact: impactFilter as Impact[] | undefined,
      currencies: ccyFilter,
    });

    if (q.group === 'date') {
      res.json({ byDate: groupByDate(filtered), count: filtered.length, available: true });
      return;
    }
    res.json({ events: filtered, count: filtered.length, available: true });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/calendar/today ────────
// Convenience endpoint — events from now through end of UTC day.
calendarRouter.get('/today', async (_req, res, next) => {
  try {
    if (!calendarAvailable()) {
      res.json({ events: [], available: false });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const events = await fetchCalendar({ from: today, to: today });
    res.json({ events, count: events.length, available: true });
  } catch (e) {
    next(e);
  }
});
