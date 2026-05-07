/**
 * Curated directory of regulated retail brokers.
 *
 * Every entry must have a real, current regulator. We never list unregulated
 * platforms — listing one alongside regulated names is misleading and risks
 * regulatory action against us as a "promoter" of unregulated firms.
 *
 * URLs are the broker's main domain root (not deeplinks to login) so they
 * remain stable if the broker reorganises their site.
 */

export interface RegulatedBroker {
  id: string;
  name: string;
  /** Comma-separated list of major regulators (FCA, SEC, ASIC, etc.) */
  regulator: string;
  /** Primary domain — opens in a new tab */
  url: string;
  /** Short flag/icon for the dropdown row */
  icon: string;
  /** Asset classes supported — for category-aware sorting */
  assets: Array<'forex' | 'cfd' | 'stocks' | 'options' | 'futures' | 'bonds' | 'etf' | 'crypto' | 'commodities' | 'indices'>;
  /** True for the broker we have native API integration with (currently OANDA) */
  hasIntegration?: boolean;
  /** Optional: set true to highlight as a "popular" pick */
  featured?: boolean;
}

export const BROKER_DIRECTORY: RegulatedBroker[] = [
  // ───── Multi-asset / forex-specialist (FCA & multi-jurisdiction) ─────
  {
    id: 'oanda',
    name: 'OANDA',
    regulator: 'FCA · CFTC · ASIC · MAS',
    url: 'https://www.oanda.com',
    icon: '🇬🇧',
    assets: ['forex', 'commodities', 'indices', 'crypto'],
    hasIntegration: true,
    featured: true,
  },
  {
    id: 'ig',
    name: 'IG',
    regulator: 'FCA · ASIC · BaFin',
    url: 'https://www.ig.com',
    icon: '🇬🇧',
    assets: ['forex', 'cfd', 'stocks', 'crypto', 'options'],
    featured: true,
  },
  {
    id: 'cmc',
    name: 'CMC Markets',
    regulator: 'FCA · ASIC · BaFin',
    url: 'https://www.cmcmarkets.com',
    icon: '🇬🇧',
    assets: ['forex', 'cfd', 'stocks', 'commodities'],
  },
  {
    id: 'pepperstone',
    name: 'Pepperstone',
    regulator: 'FCA · ASIC · CySEC · DFSA',
    url: 'https://pepperstone.com',
    icon: '🇦🇺',
    assets: ['forex', 'cfd', 'crypto', 'commodities'],
    featured: true,
  },
  {
    id: 'icmarkets',
    name: 'IC Markets',
    regulator: 'ASIC · CySEC · SCB',
    url: 'https://www.icmarkets.com',
    icon: '🇦🇺',
    assets: ['forex', 'cfd', 'commodities'],
  },
  {
    id: 'saxo',
    name: 'Saxo Bank',
    regulator: 'FCA · DFSA · ASIC · MAS',
    url: 'https://www.home.saxo',
    icon: '🇩🇰',
    assets: ['forex', 'stocks', 'bonds', 'options', 'futures', 'etf'],
  },
  {
    id: 'forexcom',
    name: 'Forex.com',
    regulator: 'FCA · CFTC · NFA',
    url: 'https://www.forex.com',
    icon: '🌐',
    assets: ['forex', 'cfd', 'commodities'],
  },
  {
    id: 'plus500',
    name: 'Plus500',
    regulator: 'FCA · ASIC · CySEC · MAS',
    url: 'https://www.plus500.com',
    icon: '🌐',
    assets: ['cfd', 'forex'],
  },
  {
    id: 'xtb',
    name: 'XTB',
    regulator: 'FCA · KNF · CySEC',
    url: 'https://www.xtb.com',
    icon: '🇵🇱',
    assets: ['forex', 'cfd', 'stocks', 'etf'],
  },

  // ───── US / Multi-asset (SEC, FINRA, CFTC) ─────
  {
    id: 'ibkr',
    name: 'Interactive Brokers',
    regulator: 'SEC · FINRA · FCA · ASIC',
    url: 'https://www.interactivebrokers.com',
    icon: '🌐',
    assets: ['stocks', 'options', 'futures', 'forex', 'bonds', 'etf'],
    featured: true,
  },
  {
    id: 'schwab',
    name: 'Charles Schwab',
    regulator: 'SEC · FINRA · SIPC',
    url: 'https://www.schwab.com',
    icon: '🇺🇸',
    assets: ['stocks', 'options', 'futures', 'etf', 'bonds'],
  },
  {
    id: 'tradestation',
    name: 'TradeStation',
    regulator: 'SEC · FINRA · NFA',
    url: 'https://www.tradestation.com',
    icon: '🇺🇸',
    assets: ['stocks', 'options', 'futures', 'crypto'],
  },
  {
    id: 'tastytrade',
    name: 'tastytrade',
    regulator: 'SEC · FINRA · SIPC',
    url: 'https://tastytrade.com',
    icon: '🇺🇸',
    assets: ['options', 'stocks', 'futures'],
  },

  // ───── Social / commission-free / multi-asset ─────
  {
    id: 'etoro',
    name: 'eToro',
    regulator: 'FCA · CySEC · ASIC',
    url: 'https://www.etoro.com',
    icon: '🌐',
    assets: ['stocks', 'crypto', 'cfd', 'etf'],
  },
  {
    id: 'trading212',
    name: 'Trading 212',
    regulator: 'FCA · CySEC',
    url: 'https://www.trading212.com',
    icon: '🇬🇧',
    assets: ['stocks', 'etf', 'cfd'],
  },
  {
    id: 'robinhood',
    name: 'Robinhood',
    regulator: 'SEC · FINRA · SIPC',
    url: 'https://robinhood.com',
    icon: '🇺🇸',
    assets: ['stocks', 'options', 'crypto', 'etf'],
  },

  // ───── Crypto exchanges (where regulated) ─────
  {
    id: 'coinbase',
    name: 'Coinbase',
    regulator: 'SEC · NYDFS · FCA',
    url: 'https://www.coinbase.com',
    icon: '🟦',
    assets: ['crypto'],
  },
  {
    id: 'kraken',
    name: 'Kraken',
    regulator: 'FinCEN · NMLS · FCA',
    url: 'https://www.kraken.com',
    icon: '🟣',
    assets: ['crypto'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    regulator: 'NYDFS · FCA',
    url: 'https://www.gemini.com',
    icon: '♊',
    assets: ['crypto'],
  },
  {
    id: 'binance',
    name: 'Binance',
    regulator: 'MAS · DFSA · regional',
    url: 'https://www.binance.com',
    icon: '🟡',
    assets: ['crypto'],
  },
];

/**
 * Filter the directory by asset class — used by the dashboard to show
 * brokers that actually trade the symbol the user is viewing.
 *
 * Symbol → asset class mapping:
 *   XAU/XAG/WTI/Brent     → commodities
 *   EUR/GBP/JPY pairs etc → forex
 *   BTC/ETH/SOL etc       → crypto
 *   AAPL/NVDA/etc         → stocks
 *   SPX/NDX/FTSE/DAX      → indices
 */
export function filterByAssetClass(symbol: string): RegulatedBroker[] {
  const s = symbol.toUpperCase();
  let asset: RegulatedBroker['assets'][number] | null = null;

  if (/^XAU|XAG|WTI|BRENT|GAS|GOLD|SILVER|OIL/.test(s)) asset = 'commodities';
  else if (/BTC|ETH|SOL|XRP|ADA|DOGE|BNB|MATIC|LINK|AVAX/.test(s) || /\/USDT$|^USDC|^USDT/.test(s)) asset = 'crypto';
  else if (/SPX|NDX|FTSE|DAX|NIKKEI|DJ|RUSSELL/.test(s) || /^US30|^US500|^UK100|^GER40/.test(s)) asset = 'indices';
  else if (/\//.test(s)) asset = 'forex'; // pair like EUR/USD

  // No mapping → return everything (let the user pick)
  if (!asset) return BROKER_DIRECTORY;

  // Featured first, then alphabetical
  return BROKER_DIRECTORY
    .filter((b) => b.assets.includes(asset!))
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || a.name.localeCompare(b.name));
}
