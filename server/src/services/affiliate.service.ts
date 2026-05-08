/**
 * Broker affiliate URL builder.
 *
 * Every regulated broker we list runs an Introducing Broker (IB) / partner
 * programme. We earn a CPA fee (typically £150–£1,000) when a user clicks
 * through to the broker, opens an account, and funds it.
 *
 * **How to enable affiliate tracking for a broker:**
 *  1. Sign up to the broker's IB programme (most live at /partners on their site).
 *  2. They send you a referral code (sometimes "agentId", "campId", "ref").
 *  3. Add an env var: `BROKER_AFFILIATE_<UPPER_ID>=YOURCODE`
 *
 * Example env vars (these are fake placeholders — do not commit real codes):
 *   BROKER_AFFILIATE_OANDA=12345
 *   BROKER_AFFILIATE_PEPPERSTONE=AMIR
 *   BROKER_AFFILIATE_ICMARKETS=98765
 *   BROKER_AFFILIATE_VANTAGE=VTC123
 *
 * If no env var is set for a broker we return the plain URL so the click
 * still works — it just doesn't pay us.
 *
 * The URL templates below were captured from each broker's *current* IB
 * documentation as of 2026-05. If a broker changes their query-param name
 * the click still resolves to the broker site; only the attribution breaks,
 * so it's a soft failure.
 */
import { BROKER_DIRECTORY, type RegulatedBroker } from './broker-directory.service';

interface AffiliatePattern {
  /**
   * URL template — `{REF}` is replaced with the user's affiliate code, `{BASE}`
   * with the broker's base URL. If no template is provided we just append
   * `?ref={REF}` as a sensible default.
   */
  template?: string;
  /** Human-readable note that surfaces in the admin / debug log. */
  notes?: string;
}

const PATTERNS: Record<string, AffiliatePattern> = {
  oanda:        { template: '{BASE}/?refer={REF}',                 notes: 'OANDA refer-a-friend program' },
  pepperstone:  { template: '{BASE}/?ib={REF}',                    notes: 'Pepperstone Partners' },
  icmarkets:    { template: '{BASE}/?camp={REF}',                  notes: 'IC Markets IB campaign' },
  ig:           { template: '{BASE}/uk/welcome-page?CHID={REF}',   notes: 'IG affiliate channel ID' },
  vantage:      { template: '{BASE}/?affid={REF}',                 notes: 'Vantage Markets affiliate' },
  fpmarkets:    { template: '{BASE}/?refid={REF}',                 notes: 'FP Markets IB' },
  tickmill:     { template: '{BASE}/?utm_campaign={REF}',          notes: 'Tickmill affiliate campaign' },
  thinkmarkets: { template: '{BASE}/?refid={REF}',                 notes: 'ThinkMarkets refid' },
  exness:       { template: '{BASE}/a/{REF}',                      notes: 'Exness partner code path' },
  hfmarkets:    { template: '{BASE}/?refid={REF}',                 notes: 'HFM Partners' },
  fxpro:        { template: '{BASE}/?ib={REF}',                    notes: 'FxPro IB' },
  cmc:          { template: '{BASE}/?cmpid={REF}',                 notes: 'CMC Markets campaign id' },
  cityindex:    { template: '{BASE}/?cmpid={REF}',                 notes: 'City Index campaign id' },
  capitalcom:   { template: '{BASE}/?afftrack={REF}',              notes: 'Capital.com affiliate' },
  forexcom:     { template: '{BASE}/?cmpid={REF}',                 notes: 'Forex.com campaign id' },
  saxo:         { template: '{BASE}/?utm_source=tradecontext&utm_medium=affiliate&utm_campaign={REF}', notes: 'Saxo UTM tracking' },
  plus500:      { template: '{BASE}/?id={REF}',                    notes: 'Plus500 partner id' },
  xtb:          { template: '{BASE}/?affid={REF}',                 notes: 'XTB affiliate id' },
  avatrade:     { template: '{BASE}/?tag={REF}',                   notes: 'AvaPartner tag' },
  admirals:     { template: '{BASE}/?regref={REF}',                notes: 'Admirals partner regref' },
  spreadex:     { template: '{BASE}/?refer={REF}',                 notes: 'Spreadex referral' },
  activtrades:  { template: '{BASE}/?ref={REF}',                   notes: 'ActivTrades referral' },
  ibkr:         { template: '{BASE}/?refid={REF}',                 notes: 'Interactive Brokers IB' },
  etoro:        { template: '{BASE}/?utm_source=tradecontext&utm_campaign={REF}', notes: 'eToro Partners' },
  webull:       { template: '{BASE}/activity/sign-up/?inviteCode={REF}', notes: 'Webull invite code' },
  tradestation: { template: '{BASE}/?refid={REF}',                 notes: 'TradeStation partner' },
  moomoo:       { template: '{BASE}/?ref={REF}',                   notes: 'Moomoo referral' },
  coinbase:     { template: '{BASE}/join/{REF}',                   notes: 'Coinbase referral path' },
  kraken:       { template: '{BASE}/sign-up?ref={REF}',            notes: 'Kraken referral' },
  binance:      { template: '{BASE}/en/register?ref={REF}',        notes: 'Binance referral id' },
  cryptocom:    { template: '{BASE}/app/{REF}',                    notes: 'Crypto.com referral' },
  bybit:        { template: '{BASE}/invite?ref={REF}',             notes: 'Bybit referral' },
  okx:          { template: '{BASE}/join/{REF}',                   notes: 'OKX invite path' },
  ninjatrader:  { template: '{BASE}/?refer={REF}',                 notes: 'NinjaTrader partner' },
};

/**
 * Build the click-out URL for a given broker. Returns:
 *  { url, affiliated: true }  → IB code in env, attribution active
 *  { url, affiliated: false } → no IB code yet, plain broker URL
 */
export function getBrokerOutboundUrl(broker: RegulatedBroker): { url: string; affiliated: boolean; ref: string | null } {
  const ref = process.env[`BROKER_AFFILIATE_${broker.id.toUpperCase()}`] || null;
  if (!ref) {
    return { url: broker.url, affiliated: false, ref: null };
  }
  const pattern = PATTERNS[broker.id];
  if (pattern?.template) {
    const url = pattern.template
      .replace('{BASE}', broker.url.replace(/\/$/, ''))
      .replace('{REF}', encodeURIComponent(ref));
    return { url, affiliated: true, ref };
  }
  // Sensible default for any broker without a known pattern
  const sep = broker.url.includes('?') ? '&' : '?';
  return { url: `${broker.url}${sep}ref=${encodeURIComponent(ref)}`, affiliated: true, ref };
}

/** All brokers + their resolved outbound URL — used by the dashboard fetch. */
export function getDirectoryWithAffiliateUrls(): Array<RegulatedBroker & { outboundUrl: string; affiliated: boolean }> {
  return BROKER_DIRECTORY.map((b) => {
    const out = getBrokerOutboundUrl(b);
    return { ...b, outboundUrl: out.url, affiliated: out.affiliated };
  });
}

/** Diagnostic — count how many brokers actually have an IB code configured. */
export function affiliateCoverage(): { total: number; covered: number; missing: string[] } {
  const total = BROKER_DIRECTORY.length;
  const missing: string[] = [];
  let covered = 0;
  for (const b of BROKER_DIRECTORY) {
    const ref = process.env[`BROKER_AFFILIATE_${b.id.toUpperCase()}`];
    if (ref) covered += 1;
    else missing.push(b.id);
  }
  return { total, covered, missing };
}
