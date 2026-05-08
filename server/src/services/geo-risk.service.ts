/**
 * Geopolitical Risk Meter — scans the last 24 hours of scored news for
 * conflict-related keywords and aggregates them into a 0-100 risk score.
 *
 * The score is built from three weighted components:
 *   • Hit count  — how many recent stories mention any conflict keyword
 *   • Recency    — newer stories weight more heavily (exponential decay, 6h half-life)
 *   • Severity   — breaking + high-impact stories weight heavier
 *
 * Output is bucketed into hotspot regions (Middle East / Eastern Europe /
 * Asia-Pacific / Other) so the frontend can show a quick mini-bar per region.
 *
 * Cached for 30 seconds — re-aggregating from DB on every poll is cheap but
 * pointless. Frontend polls every 30s anyway.
 */
import { prisma } from '../config/db';

export interface HotspotBucket {
  id: string;
  name: string;
  flag: string;
  intensity: number;          // 0-100
  topKeywords: string[];
  hits: number;
}

export interface GeoRiskSnapshot {
  score: number;              // 0-100
  level: 'low' | 'elevated' | 'high' | 'severe';
  context: string;            // one-line plain-English summary
  hotspots: HotspotBucket[];
  drivers: Array<{ keyword: string; hits: number; bucket: string }>;
  latestHeadline: { headline: string; bias: string | null; ageMinutes: number; impactDelta: number } | null;
  windowHours: number;
  totalStories: number;
  generatedAt: number;
}

interface KeywordDef {
  word: string;
  bucket: 'middle_east' | 'eastern_europe' | 'asia_pacific' | 'other';
  weight: number; // 1 = standard, 2 = strong escalator (war, missile)
}

// Order matters for the driver list — we count case-insensitively, but the
// `word` here is what surfaces in the chip.
const KEYWORDS: KeywordDef[] = [
  // Middle East
  { word: 'Iran',          bucket: 'middle_east',    weight: 2 },
  { word: 'Israel',        bucket: 'middle_east',    weight: 2 },
  { word: 'Hormuz',        bucket: 'middle_east',    weight: 2 },
  { word: 'Strait',        bucket: 'middle_east',    weight: 1 },
  { word: 'Hezbollah',     bucket: 'middle_east',    weight: 2 },
  { word: 'Hamas',         bucket: 'middle_east',    weight: 2 },
  { word: 'Houthi',        bucket: 'middle_east',    weight: 2 },
  { word: 'Lebanon',       bucket: 'middle_east',    weight: 1 },
  { word: 'Syria',         bucket: 'middle_east',    weight: 1 },
  { word: 'Yemen',         bucket: 'middle_east',    weight: 1 },
  { word: 'Gaza',          bucket: 'middle_east',    weight: 2 },
  { word: 'Tehran',        bucket: 'middle_east',    weight: 1 },
  // Eastern Europe
  { word: 'Russia',        bucket: 'eastern_europe', weight: 2 },
  { word: 'Ukraine',       bucket: 'eastern_europe', weight: 2 },
  { word: 'Putin',         bucket: 'eastern_europe', weight: 1 },
  { word: 'Kyiv',          bucket: 'eastern_europe', weight: 1 },
  { word: 'Moscow',        bucket: 'eastern_europe', weight: 1 },
  { word: 'NATO',          bucket: 'eastern_europe', weight: 2 },
  { word: 'Belarus',       bucket: 'eastern_europe', weight: 1 },
  // Asia-Pacific
  { word: 'Taiwan',        bucket: 'asia_pacific',   weight: 2 },
  { word: 'China',         bucket: 'asia_pacific',   weight: 1 }, // weight low — too many earnings stories mention China
  { word: 'Beijing',       bucket: 'asia_pacific',   weight: 1 },
  { word: 'South China Sea',bucket: 'asia_pacific',  weight: 2 },
  { word: 'North Korea',   bucket: 'asia_pacific',   weight: 2 },
  { word: 'DPRK',          bucket: 'asia_pacific',   weight: 2 },
  { word: 'Pyongyang',     bucket: 'asia_pacific',   weight: 2 },
  // Generic conflict escalators (any region)
  { word: 'missile',       bucket: 'other',          weight: 2 },
  { word: 'strike',        bucket: 'other',          weight: 1 },
  { word: 'airstrike',     bucket: 'other',          weight: 2 },
  { word: 'drone',         bucket: 'other',          weight: 1 },
  { word: 'sanctions',     bucket: 'other',          weight: 1 },
  { word: 'war',           bucket: 'other',          weight: 1 },
  { word: 'ceasefire',     bucket: 'other',          weight: 1 },
  { word: 'invasion',      bucket: 'other',          weight: 2 },
  { word: 'troops',        bucket: 'other',          weight: 1 },
  { word: 'conflict',      bucket: 'other',          weight: 1 },
  { word: 'escalation',    bucket: 'other',          weight: 1 },
  { word: 'embassy',       bucket: 'other',          weight: 1 },
  { word: 'nuclear',       bucket: 'other',          weight: 2 },
  { word: 'terror',        bucket: 'other',          weight: 1 },
];

const BUCKET_META: Record<HotspotBucket['id'], { name: string; flag: string }> = {
  middle_east:    { name: 'Middle East',    flag: '🇮🇷' },
  eastern_europe: { name: 'Eastern Europe', flag: '🇺🇦' },
  asia_pacific:   { name: 'Asia-Pacific',   flag: '🇨🇳' },
  other:          { name: 'Other',          flag: '🌐' },
};

function levelFor(score: number): GeoRiskSnapshot['level'] {
  if (score < 25) return 'low';
  if (score < 50) return 'elevated';
  if (score < 75) return 'high';
  return 'severe';
}

let _cache: GeoRiskSnapshot | null = null;
const CACHE_TTL_MS = 30_000;

export async function getGeoRiskSnapshot(opts?: { force?: boolean }): Promise<GeoRiskSnapshot> {
  if (!opts?.force && _cache && Date.now() - _cache.generatedAt < CACHE_TTL_MS) return _cache;

  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 3600_000);
  const stories = await prisma.newsStory.findMany({
    where: { publishedAt: { gte: since } },
    select: {
      id: true, headline: true, summary: true, reasoning: true,
      bias: true, impact: true, isBreaking: true, publishedAt: true,
    },
    orderBy: { publishedAt: 'desc' },
    take: 500,
  });

  const now = Date.now();
  const HALF_LIFE_H = 6;

  // Per-keyword weighted hit accumulator + per-bucket aggregator
  const kwHits: Record<string, { hits: number; weighted: number; bucket: string }> = {};
  const bucketHits: Record<string, { hits: number; weighted: number; topKwsCount: Record<string, number> }> = {
    middle_east:    { hits: 0, weighted: 0, topKwsCount: {} },
    eastern_europe: { hits: 0, weighted: 0, topKwsCount: {} },
    asia_pacific:   { hits: 0, weighted: 0, topKwsCount: {} },
    other:          { hits: 0, weighted: 0, topKwsCount: {} },
  };
  let latestKeywordedStory: typeof stories[number] | null = null;
  let latestKeywordedDelta = 0;
  let totalContributingStories = 0;
  let aggregateWeighted = 0;

  for (const s of stories) {
    const blob = `${s.headline} ${s.summary ?? ''} ${s.reasoning ?? ''}`.toLowerCase();
    const ageH = (now - s.publishedAt.getTime()) / 3600_000;
    const recency = Math.pow(0.5, ageH / HALF_LIFE_H);
    const severity = (s.impact === 'high' ? 2.5 : s.impact === 'medium' ? 1.5 : 1) * (s.isBreaking ? 1.5 : 1);
    let storyScore = 0;
    let storyHit = false;
    for (const k of KEYWORDS) {
      // Word-boundary match — avoids "Iranian" matching "Iran" twice etc.
      const re = new RegExp(`\\b${k.word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const matches = blob.match(re);
      if (!matches || !matches.length) continue;
      const hits = matches.length;
      const weighted = hits * k.weight * recency * severity;
      kwHits[k.word] ??= { hits: 0, weighted: 0, bucket: k.bucket };
      kwHits[k.word].hits += hits;
      kwHits[k.word].weighted += weighted;
      bucketHits[k.bucket].hits += hits;
      bucketHits[k.bucket].weighted += weighted;
      bucketHits[k.bucket].topKwsCount[k.word] = (bucketHits[k.bucket].topKwsCount[k.word] ?? 0) + hits;
      storyScore += weighted;
      storyHit = true;
    }
    if (storyHit) {
      totalContributingStories += 1;
      aggregateWeighted += storyScore;
      if (!latestKeywordedStory || s.publishedAt > latestKeywordedStory.publishedAt) {
        latestKeywordedStory = s;
        latestKeywordedDelta = Math.min(15, Math.round(storyScore * 2));
      }
    }
  }

  // Map raw weighted aggregate → 0-100 with a soft saturation curve
  // (so 60+ contributing stories pegs near the top without going over).
  const SATURATION = 60;
  const score = Math.min(100, Math.round(100 * (1 - Math.exp(-aggregateWeighted / SATURATION))));
  const level = levelFor(score);

  // Hotspot bars — normalise each bucket's weighted hits relative to the loudest bucket.
  // Excludes 'other' from hotspot list (it's a catch-all for generic escalators).
  const visibleBuckets: Array<HotspotBucket['id']> = ['middle_east', 'eastern_europe', 'asia_pacific'];
  const maxBucket = Math.max(1e-6, ...visibleBuckets.map((b) => bucketHits[b].weighted));
  const hotspots: HotspotBucket[] = visibleBuckets.map((id) => {
    const meta = BUCKET_META[id];
    const b = bucketHits[id];
    const intensity = Math.round((b.weighted / maxBucket) * 100);
    const topKeywords = Object.entries(b.topKwsCount)
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    return { id, name: meta.name, flag: meta.flag, intensity, topKeywords, hits: b.hits };
  }).sort((a, b) => b.intensity - a.intensity);

  // Drivers — top 5 keywords by weighted contribution
  const drivers = Object.entries(kwHits)
    .sort((a, b) => b[1].weighted - a[1].weighted)
    .slice(0, 5)
    .map(([keyword, v]) => ({ keyword, hits: v.hits, bucket: v.bucket }));

  // Plain-English context line — built from the loudest hotspot
  const top = hotspots[0];
  let context: string;
  if (totalContributingStories === 0) {
    context = 'Calm baseline — no major conflict-related stories in the last 24h.';
  } else if (level === 'severe') {
    context = `${top.name} dominating flow (${top.topKeywords.join(', ')}). Expect safe-haven bid in gold + JPY + CHF; oil sensitive to Hormuz headlines.`;
  } else if (level === 'high') {
    context = `${top.name} escalation risks elevated (${top.topKeywords.slice(0, 2).join(', ')}). Watch oil + gold for breakouts on next headline.`;
  } else if (level === 'elevated') {
    context = `Background tension across ${hotspots.filter((h) => h.intensity >= 30).map((h) => h.name).join(' & ') || top.name}. Moderate gold bid likely.`;
  } else {
    context = 'Limited geopolitical chatter — risk-on assets in clear air.';
  }

  const latestHeadline = latestKeywordedStory
    ? {
        headline: latestKeywordedStory.headline,
        bias: latestKeywordedStory.bias,
        ageMinutes: Math.max(0, Math.round((now - latestKeywordedStory.publishedAt.getTime()) / 60_000)),
        impactDelta: latestKeywordedDelta,
      }
    : null;

  const snap: GeoRiskSnapshot = {
    score,
    level,
    context,
    hotspots,
    drivers,
    latestHeadline,
    windowHours,
    totalStories: totalContributingStories,
    generatedAt: now,
  };
  _cache = snap;
  return snap;
}
