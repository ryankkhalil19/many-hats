/**
 * What an account's .claude.json says about it:
 *  - who it is: oauthAccount (email, organization, plan);
 *  - its usage windows: cachedUsageUtilization, Claude Code's last answer from Anthropic's usage
 *    endpoint for that login. Claude Code refreshes it while the account is in use. Many Hats never
 *    calls the endpoint itself: that would mean using the login's token outside Claude Code.
 */
import type { Compat } from './compat';
import type { LimitLevel, Usage, UsageLimit } from '../shared/protocol';
import { isRecord, nonEmptyString as str } from '../infra/fsx';

const ORG_TYPES: Record<string, string> = {
  claude_team: 'Team',
  claude_enterprise: 'Enterprise',
  claude_max: 'Max',
  claude_pro: 'Pro',
  claude_free: 'Free',
};
const KIND_LABELS: Record<string, string> = { session: 'Session (5hr)', weekly_all: 'Weekly (7 day)' };

export interface Profile {
  email?: string;
  org?: string;
  accountUuid?: string;
  plan?: string;
  tier?: string;
  role?: string;
}

/** The login a config holds, if it holds one. */
export function profileFromConfig(config: unknown, compat?: Compat): Profile {
  const a = isRecord(config) ? config.oauthAccount : undefined;
  if (!isRecord(a)) return {};
  const email = str(a.emailAddress);
  compat?.observe('identity', email ? 1 : 0, email ? 0 : 1, 'oauthAccount has no emailAddress');
  const tier = /claude_max_(\d+)x/.exec(str(a.userRateLimitTier) ?? '')?.[1];
  const profile: Profile = {};
  if (email) profile.email = email;
  const org = str(a.organizationName);
  if (org) profile.org = org;
  const uuid = str(a.accountUuid);
  if (uuid) profile.accountUuid = uuid.toLowerCase();
  const plan = ORG_TYPES[str(a.organizationType) ?? ''];
  if (plan) profile.plan = plan;
  if (tier) profile.tier = `Max ${tier}x`;
  const role = str(a.organizationRole);
  if (role) profile.role = role;
  return profile;
}

/**
 * The usage windows a config caches for its login.
 * @param accountUuid the login it should belong to: a cache left by another login (the account
 *   was signed in again as someone else) is ignored.
 */
export function usageFromConfig(
  config: unknown,
  accountUuid: string | undefined,
  now = Date.now(),
  compat?: Compat,
): Usage | undefined {
  const cached = isRecord(config) ? config.cachedUsageUtilization : undefined;
  if (!isRecord(cached)) return undefined;
  const cachedUuid = str(cached.accountUuid)?.toLowerCase();
  if (accountUuid && cachedUuid && cachedUuid !== accountUuid) return undefined;
  const u = isRecord(cached.utilization) ? cached.utilization : undefined;
  if (!u) {
    compat?.observe('usage', 0, 1, 'cachedUsageUtilization has no utilization');
    return undefined;
  }
  const limits: UsageLimit[] = [];
  if (Array.isArray(u.limits) && u.limits.length) {
    for (const l of u.limits as unknown[]) {
      if (!isRecord(l) || typeof l.percent !== 'number' || !Number.isFinite(l.percent)) continue;
      const scope = isRecord(l.scope) && isRecord(l.scope.model) ? l.scope.model : undefined;
      const model = str(scope?.display_name);
      const rawKind = str(l.kind);
      const label =
        (rawKind && KIND_LABELS[rawKind]) ?? (model ? `${model} limit` : humanize(rawKind ?? 'Limit'));
      const kind = rawKind ?? (model ? 'weekly_scoped' : 'other');
      limits.push(limit(label, kind, l.percent, l.resets_at, str(l.severity), l.is_active === true, now));
    }
  } else {
    const window = (key: string): Record<string, unknown> | undefined =>
      isRecord(u[key]) ? u[key] : undefined;
    const five = window('five_hour');
    const seven = window('seven_day');
    const opus = window('seven_day_opus');
    const sonnet = window('seven_day_sonnet');
    if (five)
      limits.push(limit('Session (5hr)', 'session', five.utilization, five.resets_at, undefined, false, now));
    if (seven)
      limits.push(
        limit('Weekly (7 day)', 'weekly_all', seven.utilization, seven.resets_at, undefined, false, now),
      );
    if (opus)
      limits.push(
        limit('Opus limit', 'weekly_scoped', opus.utilization, opus.resets_at, undefined, false, now),
      );
    if (sonnet)
      limits.push(
        limit('Sonnet limit', 'weekly_scoped', sonnet.utilization, sonnet.resets_at, undefined, false, now),
      );
  }
  compat?.observe('usage', limits.length ? 1 : 0, limits.length ? 0 : 1, 'no usage windows in the cache');
  const usage: Usage = { limits };
  if (typeof cached.fetchedAtMs === 'number' && Number.isFinite(cached.fetchedAtMs))
    usage.fetchedAtMs = cached.fetchedAtMs;
  const spend = isRecord(u.spend) ? u.spend : undefined;
  if (spend && spend.enabled === true)
    usage.credits = { used: money(spend.used), percent: clamp(spend.percent) };
  return usage;
}

function limit(
  label: string,
  kind: string,
  percent: unknown,
  resetsAt: unknown,
  severity: string | undefined,
  active: boolean,
  now: number,
): UsageLimit {
  const at = typeof resetsAt === 'string' ? Date.parse(resetsAt) : NaN;
  // Past its reset time, the cached figure is from the previous window.
  const reset = Number.isFinite(at) && at <= now;
  const p = reset ? 0 : clamp(percent);
  const level: LimitLevel =
    severity === 'critical' || severity === 'exceeded' || p >= 90
      ? 'critical'
      : severity === 'warning' || p >= 70
        ? 'warning'
        : 'normal';
  const out: UsageLimit = { label, kind, percent: p, reset, level, active };
  if (Number.isFinite(at) && !reset) out.resetsAt = at;
  return out;
}

export function clamp(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

/** {amount_minor, currency, exponent} as money text. */
export function money(m: unknown): string {
  if (!isRecord(m) || typeof m.amount_minor !== 'number' || !Number.isFinite(m.amount_minor)) return '';
  const exp = typeof m.exponent === 'number' && Number.isFinite(m.exponent) ? m.exponent : 2;
  const value = m.amount_minor / 10 ** exp;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: str(m.currency) ?? 'USD' }).format(
      value,
    );
  } catch {
    return value.toFixed(exp);
  }
}

function humanize(kind: string): string {
  const s = kind.replace(/[_-]+/g, ' ').trim();
  return s ? (s[0] ?? '').toUpperCase() + s.slice(1) : 'Limit';
}
