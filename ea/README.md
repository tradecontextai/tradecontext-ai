# TradeContext.ai Expert Advisor

The companion EA for MetaTrader 4/5 that automatically executes signals from your TradeContext.ai dashboard onto your broker account.

## What it does

1. Polls `https://tradecontext.ai/api/webhook/tradingview/poll?token=<YOUR_TOKEN>` every 5 seconds.
2. For each pending signal it receives, validates that the position size fits within your `MaxRiskPct` cap.
3. If `DryRun=false` it places the order via the broker's standard MT4/5 trade context.
4. Acknowledges the signal back to TradeContext.ai so it doesn't fire twice.

**TradeContext.ai never touches your broker account.** The EA runs on _your_ MetaTrader, with _your_ broker credentials (which we never see). Compliance-clean.

## Install

1. Open MetaTrader 5 → `File → Open Data Folder` → `MQL5/Experts/`.
2. Copy `TradeContext_AI.mq5` into that folder.
3. In MetaEditor: open the file, hit `F7` to compile.
4. Back in MetaTrader: drag the EA onto any chart.
5. In the Inputs tab paste your **EA Token** (Dashboard → Settings → MetaTrader EA → Copy token).
6. Tick the **AutoTrading** button at the top of the platform. Done.

## Inputs

| Input         | Default                        | Notes                                         |
|---------------|--------------------------------|-----------------------------------------------|
| ApiBase       | `https://tradecontext.ai`      | Backend base URL                              |
| Token         | (paste from dashboard)         | Long-lived per-user token                     |
| PollSeconds   | `5`                            | How often to poll the queue                   |
| MaxRiskPct    | `1.0`                          | Reject any signal whose SL > this % of equity |
| DryRun        | `true`                         | Set to `false` to actually place orders       |
| MagicNumber   | `7715`                         | Tags orders so the EA only manages its own    |

## URLs to allow

MetaTrader blocks `WebRequest` by default. Add `https://tradecontext.ai` to:

`Tools → Options → Expert Advisors → Allow WebRequest for listed URL`

## Disclaimer

The EA executes orders based on TradeContext.ai signals. **Past performance does not predict future results.** Always start with `DryRun=true` and monitor a paper account before going live. See [risk warning](https://tradecontext.ai/risk.html).

An MT4 build (`TradeContext_AI.mq4`) follows the same logic — coming next release.
