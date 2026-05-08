//+------------------------------------------------------------------+
//|                                       TradeContext_AI.mq5        |
//|                            TradeContext.ai signal-receiver EA     |
//|                                                                  |
//| Polls the TradeContext.ai webhook bridge every PollSeconds and    |
//| executes any pending signals on the user's broker account. The    |
//| EA never sees TradeContext credentials; auth is via a long-lived  |
//| token (set in the Inputs tab) that scopes to one user account.    |
//|                                                                  |
//| Compliance: TradeContext.ai never places trades — this EA does,   |
//| running on the user's local MetaTrader against their regulated    |
//| broker. All risk + sizing is configured here.                     |
//+------------------------------------------------------------------+
#property copyright "TradeContext.ai"
#property link      "https://tradecontext.ai"
#property version   "1.00"
#property strict
#include <Trade\Trade.mqh>

//--- Inputs (visible in EA properties dialog)
input string ApiBase     = "https://tradecontext.ai";   // backend base URL
input string Token       = "";                          // copy from Dashboard → EA token
input int    PollSeconds = 5;                            // poll cadence
input double MaxRiskPct  = 1.0;                          // max % of equity per trade
input bool   DryRun      = true;                         // log only, don't trade
input int    MagicNumber = 7715;                         // tag orders so we don't touch others

CTrade trade;
datetime _lastPoll = 0;

int OnInit()
{
   trade.SetExpertMagicNumber(MagicNumber);
   if(StringLen(Token) < 4) {
      Print("TradeContext_AI: Token is empty. Paste your token from the dashboard.");
      return(INIT_PARAMETERS_INCORRECT);
   }
   Print("TradeContext_AI initialised. Polling ", ApiBase, " every ", PollSeconds, "s. DryRun=", DryRun);
   EventSetTimer(PollSeconds);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if(StringLen(Token) < 4) return;
   string url = ApiBase + "/api/webhook/tradingview/poll?token=" + Token;
   string headers = "Content-Type: application/json\r\n";
   char post[];
   char result[];
   string resHeaders;
   int code = WebRequest("GET", url, headers, 10000, post, result, resHeaders);
   if(code != 200) {
      Print("Poll failed: HTTP ", code);
      return;
   }
   string body = CharArrayToString(result);
   ProcessSignals(body);
}

//+------------------------------------------------------------------+
//| Crude JSON parsing — extracts each signal object and submits it.  |
//| For production, swap to JAson.mqh or a real JSON parser.          |
//+------------------------------------------------------------------+
void ProcessSignals(string json)
{
   int from = StringFind(json, "{\"id\"");
   while(from >= 0) {
      int to = StringFind(json, "}", from);
      if(to < 0) break;
      string s = StringSubstr(json, from, to - from + 1);
      ExecuteOne(s);
      from = StringFind(json, "{\"id\"", to);
   }
}

string GetField(string s, string key)
{
   string needle = "\"" + key + "\":";
   int i = StringFind(s, needle);
   if(i < 0) return "";
   i += StringLen(needle);
   while(i < StringLen(s) && (StringGetCharacter(s, i) == ' ' || StringGetCharacter(s, i) == '"')) i++;
   int j = i;
   while(j < StringLen(s)) {
      ushort ch = StringGetCharacter(s, j);
      if(ch == ',' || ch == '}' || ch == '"') break;
      j++;
   }
   return StringSubstr(s, i, j - i);
}

void ExecuteOne(string sig)
{
   string id     = GetField(sig, "id");
   string symbol = GetField(sig, "symbol");
   string side   = GetField(sig, "side");
   double entry  = StringToDouble(GetField(sig, "entry"));
   double sl     = StringToDouble(GetField(sig, "sl"));
   double tp     = StringToDouble(GetField(sig, "tp"));
   double size   = StringToDouble(GetField(sig, "size"));

   PrintFormat("Signal %s: %s %s %.5f SL %.5f TP %.5f size %.2f", id, side, symbol, entry, sl, tp, size);

   // Risk guard — refuse if SL distance implies > MaxRiskPct
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskCash = MathAbs(entry - sl) * size * 100000.0;  // crude — broker tick value not factored
   double riskPct = (equity > 0) ? (riskCash / equity) * 100.0 : 100.0;
   if(riskPct > MaxRiskPct) {
      PrintFormat("Signal %s rejected — risk %.2f%% exceeds MaxRiskPct %.2f%%", id, riskPct, MaxRiskPct);
      Ack(id, "rejected_risk");
      return;
   }

   if(DryRun) {
      PrintFormat("DryRun ON — would execute %s %s @ %.5f", side, symbol, entry);
      Ack(id, "dryrun");
      return;
   }

   bool ok = false;
   if(side == "buy")  ok = trade.Buy(size, symbol, 0, sl, tp, "TradeContext.ai signal " + id);
   if(side == "sell") ok = trade.Sell(size, symbol, 0, sl, tp, "TradeContext.ai signal " + id);
   PrintFormat("Order %s: %s", id, ok ? "FILLED" : "FAILED");
   Ack(id, ok ? "filled" : "failed");
}

void Ack(string id, string status)
{
   string url = ApiBase + "/api/webhook/tradingview/ack";
   string headers = "Content-Type: application/json\r\n";
   string body = "{\"token\":\"" + Token + "\",\"id\":\"" + id + "\",\"status\":\"" + status + "\"}";
   char post[];
   StringToCharArray(body, post, 0, StringLen(body));
   ArrayResize(post, StringLen(body));
   char result[];
   string resHeaders;
   WebRequest("POST", url, headers, 5000, post, result, resHeaders);
}

void OnTick() {}
