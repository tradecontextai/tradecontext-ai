/**
 * Curated directory of regulated retail brokers worldwide.
 *
 * Every entry must have a real, current regulator. We never list unregulated
 * platforms — listing one alongside regulated names is misleading and risks
 * regulatory action against us as a "promoter" of unregulated firms.
 *
 * URLs are the broker's main domain root (not deeplinks to login) so they
 * remain stable if the broker reorganises their site.
 *
 * Regulator abbreviations:
 *   FCA   — Financial Conduct Authority (UK)
 *   SEC   — Securities and Exchange Commission (US)
 *   FINRA — Financial Industry Regulatory Authority (US)
 *   CFTC  — Commodity Futures Trading Commission (US)
 *   NFA   — National Futures Association (US)
 *   ASIC  — Australian Securities and Investments Commission
 *   CySEC — Cyprus Securities and Exchange Commission
 *   BaFin — Federal Financial Supervisory Authority (Germany)
 *   MAS   — Monetary Authority of Singapore
 *   DFSA  — Dubai Financial Services Authority
 *   FSCA  — Financial Sector Conduct Authority (South Africa)
 *   IIROC — Investment Industry Regulatory Organization of Canada
 *   FMA   — Financial Markets Authority (NZ)
 *   FSA   — Financial Services Authority (varies)
 *   AFM   — Authority for Financial Markets (Netherlands)
 *   AUSTRAC — Australian Transaction Reports and Analysis Centre
 */

export interface RegulatedBroker {
  id: string;
  name: string;
  regulator: string;
  url: string;
  icon: string;
  assets: Array<'forex' | 'cfd' | 'stocks' | 'options' | 'futures' | 'bonds' | 'etf' | 'crypto' | 'commodities' | 'indices' | 'spread-betting'>;
  /** True for the broker we have native API integration with (currently OANDA) */
  hasIntegration?: boolean;
  /** Highlight as "popular" — the most well-known + trusted globally */
  featured?: boolean;
  /** Region tag for an optional region filter UI */
  region: 'UK' | 'EU' | 'US' | 'AU' | 'CA' | 'Asia' | 'Global';
}

export const BROKER_DIRECTORY: RegulatedBroker[] = [
  // ════════════════════ FOREX / CFD specialists ════════════════════
  { id:'oanda',        name:'OANDA',                 regulator:'FCA · CFTC · ASIC · MAS · IIROC',      url:'https://www.oanda.com',              icon:'🇬🇧', assets:['forex','commodities','indices','crypto'],     region:'Global', featured:true, hasIntegration:true },
  { id:'ig',           name:'IG',                    regulator:'FCA · ASIC · BaFin · DFSA',            url:'https://www.ig.com',                 icon:'🇬🇧', assets:['forex','cfd','stocks','crypto','options'],    region:'UK',     featured:true },
  { id:'cmc',          name:'CMC Markets',           regulator:'FCA · ASIC · BaFin · MAS',             url:'https://www.cmcmarkets.com',         icon:'🇬🇧', assets:['forex','cfd','stocks','commodities'],         region:'UK' },
  { id:'pepperstone',  name:'Pepperstone',           regulator:'FCA · ASIC · CySEC · DFSA · BaFin',    url:'https://pepperstone.com',            icon:'🇦🇺', assets:['forex','cfd','crypto','commodities'],         region:'AU',     featured:true },
  { id:'icmarkets',    name:'IC Markets',            regulator:'ASIC · CySEC · FSA · SCB',             url:'https://www.icmarkets.com',          icon:'🇦🇺', assets:['forex','cfd','commodities'],                  region:'AU' },
  { id:'vantage',      name:'Vantage Markets',       regulator:'ASIC · FCA · CIMA · FSCA · VFSC',      url:'https://www.vantagemarkets.com',     icon:'🇦🇺', assets:['forex','cfd','commodities','indices'],        region:'AU',     featured:true },
  { id:'fpmarkets',    name:'FP Markets',            regulator:'ASIC · CySEC',                         url:'https://www.fpmarkets.com',          icon:'🇦🇺', assets:['forex','cfd','stocks','commodities'],         region:'AU' },
  { id:'thinkmarkets', name:'ThinkMarkets',          regulator:'FCA · ASIC · CySEC · FSCA · JSC',      url:'https://www.thinkmarkets.com',       icon:'🌐', assets:['forex','cfd','crypto'],                       region:'Global' },
  { id:'tickmill',     name:'Tickmill',              regulator:'FCA · CySEC · FSA · FSCA',             url:'https://www.tickmill.com',           icon:'🌐', assets:['forex','cfd'],                                region:'Global' },
  { id:'admirals',     name:'Admirals',              regulator:'FCA · CySEC · ASIC · EFSA',            url:'https://admirals.com',               icon:'🇪🇪', assets:['forex','cfd','stocks'],                       region:'EU' },
  { id:'activtrades',  name:'ActivTrades',           regulator:'FCA · CMVM · SCB · CSSF',              url:'https://www.activtrades.com',        icon:'🇬🇧', assets:['forex','cfd','commodities'],                  region:'UK' },
  { id:'avatrade',     name:'AvaTrade',              regulator:'CBI · ASIC · FSCA · FSA Japan · ADGM', url:'https://www.avatrade.com',           icon:'🇮🇪', assets:['forex','cfd','crypto','options'],             region:'EU' },
  { id:'fxpro',        name:'FxPro',                 regulator:'FCA · CySEC · FSCA · DFSA',            url:'https://www.fxpro.com',              icon:'🇨🇾', assets:['forex','cfd'],                                region:'EU' },
  { id:'exness',       name:'Exness',                regulator:'CySEC · FCA · FSA · FSCA · CMA',       url:'https://www.exness.com',             icon:'🌐', assets:['forex','cfd','crypto'],                       region:'Global' },
  { id:'hfmarkets',    name:'HF Markets',            regulator:'FCA · CySEC · FSCA · DFSA',            url:'https://www.hfm.com',                icon:'🌐', assets:['forex','cfd'],                                region:'Global' },
  { id:'cityindex',    name:'City Index',            regulator:'FCA · ASIC · MAS',                     url:'https://www.cityindex.com',          icon:'🇬🇧', assets:['forex','cfd','stocks'],                       region:'UK' },
  { id:'spreadex',     name:'Spreadex',              regulator:'FCA',                                  url:'https://www.spreadex.com',           icon:'🇬🇧', assets:['forex','cfd','spread-betting'],               region:'UK' },
  { id:'capitalcom',   name:'Capital.com',           regulator:'FCA · CySEC · ASIC · FSA',             url:'https://capital.com',                icon:'🌐', assets:['forex','cfd','crypto','stocks'],              region:'Global' },
  { id:'forexcom',     name:'Forex.com',             regulator:'FCA · CFTC · NFA · ASIC',              url:'https://www.forex.com',              icon:'🌐', assets:['forex','cfd','commodities'],                  region:'Global' },
  { id:'saxo',         name:'Saxo Bank',             regulator:'FCA · DFSA · ASIC · MAS · FINMA',      url:'https://www.home.saxo',              icon:'🇩🇰', assets:['forex','stocks','bonds','options','futures','etf'], region:'EU' },
  { id:'plus500',      name:'Plus500',               regulator:'FCA · ASIC · CySEC · MAS · FMA',       url:'https://www.plus500.com',            icon:'🌐', assets:['cfd','forex'],                                region:'Global' },
  { id:'xtb',          name:'XTB',                   regulator:'FCA · KNF · CySEC · IFSC',             url:'https://www.xtb.com',                icon:'🇵🇱', assets:['forex','cfd','stocks','etf'],                 region:'EU' },

  // ════════════════════ US Stock + Options + Futures ════════════════════
  { id:'ibkr',         name:'Interactive Brokers',   regulator:'SEC · FINRA · FCA · ASIC · CIRO',      url:'https://www.interactivebrokers.com', icon:'🌐', assets:['stocks','options','futures','forex','bonds','etf'], region:'Global', featured:true },
  { id:'schwab',       name:'Charles Schwab',        regulator:'SEC · FINRA · SIPC',                   url:'https://www.schwab.com',             icon:'🇺🇸', assets:['stocks','options','futures','etf','bonds'],   region:'US' },
  { id:'fidelity',     name:'Fidelity',              regulator:'SEC · FINRA · SIPC',                   url:'https://www.fidelity.com',           icon:'🇺🇸', assets:['stocks','options','etf','bonds'],             region:'US' },
  { id:'etrade',       name:'E*TRADE',               regulator:'SEC · FINRA · SIPC',                   url:'https://us.etrade.com',              icon:'🇺🇸', assets:['stocks','options','futures','etf'],           region:'US' },
  { id:'webull',       name:'Webull',                regulator:'SEC · FINRA · SIPC',                   url:'https://www.webull.com',             icon:'🇺🇸', assets:['stocks','options','etf','crypto'],            region:'US' },
  { id:'tradestation', name:'TradeStation',          regulator:'SEC · FINRA · NFA · CFTC',             url:'https://www.tradestation.com',       icon:'🇺🇸', assets:['stocks','options','futures','crypto'],        region:'US' },
  { id:'tastytrade',   name:'tastytrade',            regulator:'SEC · FINRA · SIPC',                   url:'https://tastytrade.com',             icon:'🇺🇸', assets:['options','stocks','futures'],                 region:'US' },
  { id:'public',       name:'Public',                regulator:'SEC · FINRA · SIPC',                   url:'https://public.com',                 icon:'🇺🇸', assets:['stocks','etf','crypto'],                      region:'US' },
  { id:'moomoo',       name:'Moomoo',                regulator:'SEC · FINRA · SIPC',                   url:'https://www.moomoo.com',             icon:'🇺🇸', assets:['stocks','options','etf'],                     region:'US' },
  { id:'vanguard',     name:'Vanguard',              regulator:'SEC · FINRA · SIPC',                   url:'https://investor.vanguard.com',      icon:'🇺🇸', assets:['stocks','etf','bonds'],                       region:'US' },
  { id:'robinhood',    name:'Robinhood',             regulator:'SEC · FINRA · SIPC',                   url:'https://robinhood.com',              icon:'🇺🇸', assets:['stocks','options','crypto','etf'],            region:'US' },

  // ════════════════════ EU / UK Stock & ETF ════════════════════
  { id:'degiro',       name:'DEGIRO',                regulator:'BaFin · AFM · FCA',                    url:'https://www.degiro.com',             icon:'🇳🇱', assets:['stocks','etf','options','futures','bonds'],   region:'EU' },
  { id:'trading212',   name:'Trading 212',           regulator:'FCA · CySEC · FSC',                    url:'https://www.trading212.com',         icon:'🇬🇧', assets:['stocks','etf','cfd'],                         region:'UK' },
  { id:'freetrade',    name:'Freetrade',             regulator:'FCA',                                  url:'https://freetrade.io',               icon:'🇬🇧', assets:['stocks','etf'],                               region:'UK' },
  { id:'lightyear',    name:'Lightyear',             regulator:'FCA · EFSA',                           url:'https://lightyear.com',              icon:'🇪🇪', assets:['stocks','etf'],                               region:'EU' },
  { id:'hl',           name:'Hargreaves Lansdown',   regulator:'FCA',                                  url:'https://www.hl.co.uk',               icon:'🇬🇧', assets:['stocks','etf','bonds'],                       region:'UK' },
  { id:'ajbell',       name:'AJ Bell',               regulator:'FCA',                                  url:'https://www.ajbell.co.uk',           icon:'🇬🇧', assets:['stocks','etf','bonds'],                       region:'UK' },
  { id:'bitpanda',     name:'Bitpanda',              regulator:'BaFin · MFSA · DPMA',                  url:'https://www.bitpanda.com',           icon:'🇦🇹', assets:['stocks','etf','crypto','commodities'],        region:'EU' },

  // ════════════════════ Canada ════════════════════
  { id:'questrade',    name:'Questrade',             regulator:'IIROC · CIPF',                         url:'https://www.questrade.com',          icon:'🇨🇦', assets:['stocks','options','etf','forex'],             region:'CA' },
  { id:'wealthsimple', name:'Wealthsimple',          regulator:'IIROC · CIPF',                         url:'https://www.wealthsimple.com',       icon:'🇨🇦', assets:['stocks','etf','crypto'],                      region:'CA' },

  // ════════════════════ Australia stock specialists ════════════════════
  { id:'commsec',      name:'CommSec',               regulator:'ASIC',                                 url:'https://www.commsec.com.au',         icon:'🇦🇺', assets:['stocks','etf','options'],                     region:'AU' },
  { id:'selfwealth',   name:'SelfWealth',            regulator:'ASIC',                                 url:'https://www.selfwealth.com.au',      icon:'🇦🇺', assets:['stocks','etf'],                               region:'AU' },
  { id:'stake',        name:'Stake',                 regulator:'ASIC · SEC · FINRA',                   url:'https://hellostake.com',             icon:'🇦🇺', assets:['stocks','etf','options'],                     region:'AU' },

  // ════════════════════ Multi-asset / social ════════════════════
  { id:'etoro',        name:'eToro',                 regulator:'FCA · CySEC · ASIC · ISA',             url:'https://www.etoro.com',              icon:'🌐', assets:['stocks','crypto','cfd','etf'],                region:'Global', featured:true },

  // ════════════════════ Crypto exchanges (regulated) ════════════════════
  { id:'coinbase',     name:'Coinbase',              regulator:'SEC · NYDFS · FCA · BaFin · MFSA',     url:'https://www.coinbase.com',           icon:'🟦', assets:['crypto'],                                     region:'Global', featured:true },
  { id:'kraken',       name:'Kraken',                regulator:'FinCEN · NMLS · FCA · AUSTRAC',        url:'https://www.kraken.com',             icon:'🟣', assets:['crypto'],                                     region:'Global' },
  { id:'gemini',       name:'Gemini',                regulator:'NYDFS · FCA · MFSA',                   url:'https://www.gemini.com',             icon:'♊', assets:['crypto'],                                     region:'US' },
  { id:'bitstamp',     name:'Bitstamp',              regulator:'NYDFS · FCA · BaFin · CSSF',           url:'https://www.bitstamp.net',           icon:'🟧', assets:['crypto'],                                     region:'EU' },
  { id:'cryptocom',    name:'Crypto.com',            regulator:'FCA · MFSA · MAS · ASIC · DFSA',       url:'https://crypto.com',                 icon:'🪙', assets:['crypto'],                                     region:'Global' },
  { id:'binance',      name:'Binance',               regulator:'MAS · DFSA · BaFin · regional',        url:'https://www.binance.com',            icon:'🟡', assets:['crypto'],                                     region:'Global' },
  { id:'okx',          name:'OKX',                   regulator:'CSSF · MFSA · ADGM',                   url:'https://www.okx.com',                icon:'⚪', assets:['crypto'],                                     region:'Global' },
  { id:'bybit',        name:'Bybit',                 regulator:'VASP · MFSA · ADGM',                   url:'https://www.bybit.com',              icon:'🟨', assets:['crypto'],                                     region:'Global' },
  { id:'kucoin',       name:'KuCoin',                regulator:'regional licences',                    url:'https://www.kucoin.com',             icon:'🟢', assets:['crypto'],                                     region:'Asia' },
  { id:'uphold',       name:'Uphold',                regulator:'FinCEN · FCA · BaFin',                 url:'https://uphold.com',                 icon:'🔵', assets:['crypto'],                                     region:'Global' },

  // ════════════════════ Futures specialists (US) ════════════════════
  { id:'ninjatrader',  name:'NinjaTrader',           regulator:'NFA · CFTC',                           url:'https://ninjatrader.com',            icon:'🇺🇸', assets:['futures','forex'],                            region:'US' },
  { id:'amp',          name:'AMP Futures',           regulator:'NFA · CFTC',                           url:'https://www.ampfutures.com',         icon:'🇺🇸', assets:['futures'],                                    region:'US' },
];

/**
 * Filter by asset class. Used optionally — frontend currently shows the full
 * directory regardless of symbol. Kept for future use (e.g. "Show only brokers
 * that offer crypto" filter chip).
 */
export function filterByAssetClass(symbol: string): RegulatedBroker[] {
  const s = symbol.toUpperCase();
  let asset: RegulatedBroker['assets'][number] | null = null;
  if (/^XAU|XAG|WTI|BRENT|GAS|GOLD|SILVER|OIL/.test(s)) asset = 'commodities';
  else if (/BTC|ETH|SOL|XRP|ADA|DOGE|BNB|MATIC|LINK|AVAX/.test(s) || /\/USDT$|^USDC|^USDT/.test(s)) asset = 'crypto';
  else if (/SPX|NDX|FTSE|DAX|NIKKEI|DJ|RUSSELL/.test(s) || /^US30|^US500|^UK100|^GER40/.test(s)) asset = 'indices';
  else if (/\//.test(s)) asset = 'forex';
  if (!asset) return BROKER_DIRECTORY;
  return BROKER_DIRECTORY
    .filter((b) => b.assets.includes(asset!))
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || a.name.localeCompare(b.name));
}
