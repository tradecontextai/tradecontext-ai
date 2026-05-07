import { Resend } from 'resend';
import { env, isProd } from '../config/env';
import { log } from '../lib/logger';

/**
 * Resend transactional email service.
 *
 * Gracefully no-ops in dev if RESEND_API_KEY is missing — calls are logged
 * but never throw, so the app keeps working before email is configured.
 *
 * All templates are inline HTML strings using the brand palette
 * (#0ea5e9 blue, #03060d bg, Outfit font fallback). Resend renders these
 * in any modern client.
 */

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const FROM = `TradeContext.ai <${env.FROM_EMAIL || 'hello@tradecontext.ai'}>`;
const APP_URL = env.CLIENT_URL || 'https://tradecontext.ai';

export const emailAvailable = (): boolean => resend !== null;

interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text?: string; // optional plaintext fallback
}

async function send(opts: SendOpts): Promise<void> {
  if (!resend) {
    log.warn('Email skipped — RESEND_API_KEY not set', { to: opts.to, subject: opts.subject });
    return;
  }
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (result.error) {
      log.error('Email send failed', { to: opts.to, subject: opts.subject, err: result.error });
    } else {
      log.info('Email sent', { to: opts.to, subject: opts.subject, id: result.data?.id });
    }
  } catch (e) {
    log.error('Email send threw', { to: opts.to, subject: opts.subject, err: e instanceof Error ? e.message : e });
  }
}

// ─────────── Shared HTML wrapper ───────────
function shell(opts: { title: string; preview?: string; body: string; ctaText?: string; ctaUrl?: string }): string {
  const cta = opts.ctaText && opts.ctaUrl
    ? `<table align="center" style="margin:30px auto 6px;"><tr><td bgcolor="#0ea5e9" style="border-radius:8px;"><a href="${opts.ctaUrl}" style="display:inline-block;padding:13px 30px;font-family:'Outfit',Arial,sans-serif;font-size:14px;font-weight:700;color:#000;text-decoration:none;letter-spacing:.04em;">${opts.ctaText}</a></td></tr></table>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:#03060d;font-family:'Outfit',-apple-system,BlinkMacSystemFont,sans-serif;color:#e2eaf4;">
${opts.preview ? `<div style="display:none;max-height:0;overflow:hidden;">${opts.preview}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#03060d">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="560" cellpadding="0" cellspacing="0" border="0" style="background:#060c18;border:1px solid #142035;border-radius:12px;overflow:hidden;max-width:560px;">
      <tr><td style="background:linear-gradient(135deg,#0ea5e9 0%,#8b5cf6 100%);height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:32px 40px 24px;">
        <div style="font-size:18px;font-weight:900;letter-spacing:-.02em;color:#e2eaf4;">TradeContext<span style="color:#0ea5e9;">.ai</span></div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:#7a9ab8;letter-spacing:.16em;text-transform:uppercase;margin-top:4px;">AI-Powered Market Intelligence</div>
      </td></tr>
      <tr><td style="padding:0 40px 28px;">
        <h1 style="font-size:22px;font-weight:800;color:#e2eaf4;letter-spacing:-.02em;margin:0 0 18px;">${opts.title}</h1>
        ${opts.body}
        ${cta}
      </td></tr>
      <tr><td style="padding:18px 40px 28px;border-top:1px solid #142035;background:#03060d;">
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:#3a5570;line-height:1.6;">
          You're receiving this because you have an account at TradeContext.ai.<br>
          Trading involves risk of loss. Not financial advice.<br>
          <a href="${APP_URL}" style="color:#7a9ab8;text-decoration:none;">tradecontext.ai</a> · <a href="mailto:${env.FROM_EMAIL}" style="color:#7a9ab8;text-decoration:none;">${env.FROM_EMAIL}</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ─────────── 1. Welcome email (after signup) ───────────
export async function sendWelcome(opts: { to: string; verifyUrl?: string }): Promise<void> {
  await send({
    to: opts.to,
    subject: '👋 Welcome to TradeContext.ai',
    html: shell({
      title: 'Welcome aboard.',
      preview: 'Your AI-powered trading workstation is live — let\'s get you set up.',
      body: `<p style="font-size:15px;line-height:1.65;color:#e2eaf4;">You just joined the most advanced retail trading dashboard in the world. Here's what's already running for you:</p>
<ul style="font-size:14px;line-height:1.75;color:#7a9ab8;padding-left:18px;">
  <li><strong style="color:#e2eaf4;">Live news bias intelligence</strong> — every breaking headline scored by AI in real time</li>
  <li><strong style="color:#e2eaf4;">AI trade playbooks</strong> — bull/bear cases generated per story</li>
  <li><strong style="color:#e2eaf4;">TradingView charts</strong> with 10 toggleable strategies + autosave</li>
  <li><strong style="color:#e2eaf4;">Macro Pulse</strong> — currency strength, risk thermometer, world map heat</li>
</ul>
<p style="font-size:14px;line-height:1.65;color:#7a9ab8;">Open the dashboard, connect a broker (read-only), and let the news bias feed do the heavy lifting.</p>${opts.verifyUrl ? `<p style="font-size:13px;color:#7a9ab8;margin-top:18px;">First, please verify your email so we can send you breaking-news alerts:</p>` : ''}`,
      ctaText: opts.verifyUrl ? 'Verify Email' : 'Open Dashboard',
      ctaUrl: opts.verifyUrl || `${APP_URL}/dashboard.html`,
    }),
  });
}

// ─────────── 2. Email verification ───────────
export async function sendVerifyEmail(opts: { to: string; token: string }): Promise<void> {
  const url = `${APP_URL}/verify-email?token=${opts.token}`;
  await send({
    to: opts.to,
    subject: '✓ Verify your email — TradeContext.ai',
    html: shell({
      title: 'Verify your email',
      preview: 'One click to confirm your address and unlock alerts.',
      body: `<p style="font-size:15px;line-height:1.65;color:#e2eaf4;">Click below to verify your email so we can send you breaking-news alerts and weekly trade summaries.</p>
<p style="font-size:13px;color:#7a9ab8;">If you didn't sign up at TradeContext.ai, just ignore this email.</p>`,
      ctaText: 'Verify Email',
      ctaUrl: url,
    }),
  });
}

// ─────────── 3. Password reset ───────────
export async function sendPasswordReset(opts: { to: string; token: string }): Promise<void> {
  const url = `${APP_URL}/reset-password?token=${opts.token}`;
  await send({
    to: opts.to,
    subject: '🔐 Reset your TradeContext.ai password',
    html: shell({
      title: 'Reset your password',
      preview: 'A request was made to reset the password on this account.',
      body: `<p style="font-size:15px;line-height:1.65;color:#e2eaf4;">Click below to set a new password. This link expires in 1 hour.</p>
<p style="font-size:13px;color:#7a9ab8;">If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
      ctaText: 'Reset Password',
      ctaUrl: url,
    }),
  });
}

// ─────────── 4. Payment confirmation (Stripe checkout completed) ───────────
export async function sendPaymentConfirmation(opts: { to: string; plan: 'pro' | 'elite'; billing: 'monthly' | 'annual' }): Promise<void> {
  const planLabel = opts.plan.charAt(0).toUpperCase() + opts.plan.slice(1);
  const billLabel = opts.billing === 'annual' ? 'Annual' : 'Monthly';
  await send({
    to: opts.to,
    subject: `🎉 You're on TradeContext.ai ${planLabel}`,
    html: shell({
      title: `Welcome to ${planLabel}.`,
      preview: 'Your subscription is active — every premium feature is unlocked.',
      body: `<p style="font-size:15px;line-height:1.65;color:#e2eaf4;">Payment received. You're now on the <strong>${planLabel} ${billLabel}</strong> plan.</p>
<p style="font-size:14px;line-height:1.65;color:#7a9ab8;">${opts.plan === 'elite' ? 'Elite gives you the full stack — AI Trading Journal with TradeContext Score, funded account tracker, and breaking news email alerts on top of everything in Pro.' : 'Pro unlocks the live news bias feed, AI playbooks, broker hub, alerts, and the economic calendar.'}</p>`,
      ctaText: 'Open Dashboard',
      ctaUrl: `${APP_URL}/dashboard.html`,
    }),
  });
}

// ─────────── 5. Payment failed (Stripe invoice.payment_failed) ───────────
export async function sendPaymentFailed(opts: { to: string; updatePaymentUrl: string }): Promise<void> {
  await send({
    to: opts.to,
    subject: '⚠️ Payment failed — action needed',
    html: shell({
      title: 'Your payment didn\'t go through',
      preview: 'Update your card to keep your subscription active.',
      body: `<p style="font-size:15px;line-height:1.65;color:#e2eaf4;">We weren't able to charge your card for the latest invoice. Your subscription is in <strong style="color:#f59e0b;">past_due</strong> status.</p>
<p style="font-size:14px;line-height:1.65;color:#7a9ab8;">You have a 3-day grace period before features are paused. Update your card now to avoid interruption.</p>`,
      ctaText: 'Update Payment Method',
      ctaUrl: opts.updatePaymentUrl,
    }),
  });
}

// ─────────── 6. Breaking news alert (opt-in, Pro+) ───────────
export async function sendBreakingNewsAlert(opts: {
  to: string;
  headline: string;
  reasoning?: string | null;
  affectedAssets: string[];
}): Promise<void> {
  const assetsHtml = opts.affectedAssets.slice(0, 5).map((s) =>
    `<span style="display:inline-block;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:#34d399;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);padding:3px 9px;border-radius:5px;margin:2px 3px 2px 0;">${s}</span>`
  ).join('');
  await send({
    to: opts.to,
    subject: `⚡ Breaking · ${opts.headline.slice(0, 80)}`,
    html: shell({
      title: '⚡ Breaking news',
      preview: opts.headline,
      body: `<p style="font-size:17px;font-weight:700;line-height:1.4;color:#f87171;border-left:3px solid #f87171;padding-left:12px;margin:0 0 16px;">${opts.headline}</p>
${opts.reasoning ? `<p style="font-size:14px;line-height:1.65;color:#7a9ab8;">${opts.reasoning}</p>` : ''}
<div style="margin:20px 0 8px;">
  <div style="font-family:'DM Mono',monospace;font-size:9px;font-weight:800;color:#7a9ab8;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">📊 Affected markets</div>
  ${assetsHtml || '<span style="color:#7a9ab8;font-size:12px;">—</span>'}
</div>`,
      ctaText: 'View AI Playbook',
      ctaUrl: `${APP_URL}/dashboard.html#news`,
    }),
  });
}

// ─────────── 7. Weekly performance summary (Elite only) ───────────
export async function sendWeeklySummary(opts: {
  to: string;
  weekRange: string;
  totalTrades: number;
  winRate: number;
  pnl: number;
  topInsight?: string;
}): Promise<void> {
  const pnlColor = opts.pnl >= 0 ? '#34d399' : '#f87171';
  const pnlSign = opts.pnl >= 0 ? '+' : '';
  await send({
    to: opts.to,
    subject: `📊 Your trading week — ${opts.weekRange}`,
    html: shell({
      title: `Your week · ${opts.weekRange}`,
      preview: `${opts.totalTrades} trades · ${opts.winRate}% win rate · ${pnlSign}$${opts.pnl}`,
      body: `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 18px;">
  <tr>
    <td align="center" width="33%" style="padding:12px;background:#0a1220;border:1px solid #142035;border-radius:8px;">
      <div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:800;color:#e2eaf4;">${opts.totalTrades}</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:#7a9ab8;text-transform:uppercase;letter-spacing:.1em;margin-top:4px;">Trades</div>
    </td>
    <td width="2"></td>
    <td align="center" width="33%" style="padding:12px;background:#0a1220;border:1px solid #142035;border-radius:8px;">
      <div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:800;color:#0ea5e9;">${opts.winRate}%</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:#7a9ab8;text-transform:uppercase;letter-spacing:.1em;margin-top:4px;">Win rate</div>
    </td>
    <td width="2"></td>
    <td align="center" width="33%" style="padding:12px;background:#0a1220;border:1px solid #142035;border-radius:8px;">
      <div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:800;color:${pnlColor};">${pnlSign}$${Math.abs(opts.pnl).toLocaleString('en-GB')}</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:#7a9ab8;text-transform:uppercase;letter-spacing:.1em;margin-top:4px;">Net P&amp;L</div>
    </td>
  </tr>
</table>
${opts.topInsight ? `<p style="font-size:14px;line-height:1.65;color:#e2eaf4;background:rgba(14,165,233,.06);border-left:3px solid #0ea5e9;padding:14px 16px;border-radius:0 6px 6px 0;margin:20px 0 6px;"><strong>💡 AI Insight:</strong> ${opts.topInsight}</p>` : ''}`,
      ctaText: 'View Full Journal',
      ctaUrl: `${APP_URL}/dashboard.html#journal`,
    }),
  });
}
