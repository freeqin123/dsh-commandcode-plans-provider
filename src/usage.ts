/**
 * Command Code subscription usage: the endpoints behind the official `/usage`
 * command, normalized into one snapshot the Web UI can render.
 *
 * These endpoints are undocumented, so every read is defensive: a renamed
 * field, a missing object or an unexpected time format degrades to "unknown"
 * instead of throwing. The dock ring is a side channel — a failed read must
 * never affect a conversation.
 *
 * @module commandcode-plans-provider/usage
 */

/** One rolling usage window as the billing endpoint discloses it. */
export interface WindowUsage {
  /** Amount consumed inside the window. */
  used: number
  /** Ceiling of the window. */
  cap: number
  /** `used / cap` as whole percent, clamped to 0..100. */
  percent: number
  /** When the window resets (ISO), when the endpoint discloses it. */
  resetAt?: string
  /** Whether the server itself reports this window as blocking. */
  exceeded: boolean
}

/**
 * One usage read.
 *
 * A failure still travels as a snapshot (`ok: false` plus `error`), so the UI
 * can show "stale/failed" instead of disappearing — the silent-empty behaviour
 * this plugin exists to replace.
 */
export interface UsageSnapshot {
  /** Whether the read succeeded. */
  ok: boolean
  /** Failure reason when {@link ok} is false. */
  error?: string
  /** When this snapshot was read (ISO). */
  fetchedAt: string
  /** The 5-hour rolling window. */
  fiveHour?: WindowUsage
  /** The weekly rolling window. */
  weekly?: WindowUsage
  /** Plan id from the subscription endpoint, e.g. `individual-goat`. */
  planId?: string
  /**
   * Masked identification of the key this read used.
   *
   * The credential seam never returns a stored secret, so a masked hint
   * derived while the key is in hand is the only identification a
   * configuration surface can honestly offer.
   */
  keyHint?: string
  /**
   * Whether the account is subject to window limits at all.
   *
   * A static account property, NOT a statement about the current moment: the
   * blocking flag is {@link exceeded}.
   */
  limited?: boolean
  /** Whether the server reports the account as currently blocking. */
  exceeded?: boolean
}

/** Endpoints and credential one usage read needs. */
export interface UsageRequestOptions {
  /** Gateway base URL; the `/alpha/billing/*` paths are appended. */
  baseURL: string
  /** Bearer token for the subscription. */
  apiKey: string
  /** Cancellation for this read. */
  signal?: AbortSignal
}

/** Per-request budget for one billing read. */
const READ_TIMEOUT_MS = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * First finite non-negative number among several candidate member names.
 *
 * The endpoints have been observed with camelCase and snake_case spellings and
 * with values nested one level down, so each lookup tries both.
 * @param source - record to read from.
 * @param names - candidate member names, in preference order.
 * @returns the first usable number, or `undefined`.
 */
function pickNumber(source: Record<string, unknown>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const value = source[name]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}

/**
 * First object among several candidate member names.
 * @param source - record to read from.
 * @param names - candidate member names, in preference order.
 * @returns the first usable record, or `undefined`.
 */
function pickRecord(
  source: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> | undefined {
  for (const name of names) {
    const value = source[name]
    if (isRecord(value)) return value
  }
  return undefined
}

/**
 * Normalize one timestamp that may be epoch milliseconds, epoch seconds, or an
 * ISO string.
 * @param value - the raw member value.
 * @returns an ISO string, or `undefined` when it cannot be read.
 */
function toIso(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Anything under ~1e12 is seconds; above it, milliseconds.
    const millis = value < 1e12 ? value * 1000 : value
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value === 'string' && value.length > 0) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return undefined
}

/**
 * Read one window object (`{ used, cap, exceeded, resetAt }`) into a percentage.
 * @param raw - the window member, when the endpoint disclosed one.
 * @returns the normalized window, or `undefined` when it carries no numbers.
 */
function parseWindow(raw: unknown): WindowUsage | undefined {
  if (!isRecord(raw)) return undefined
  const used = pickNumber(raw, ['used', 'usedAmount', 'consumed'])
  const cap = pickNumber(raw, ['cap', 'limit', 'maximum', 'max'])
  if (used === undefined || cap === undefined || cap <= 0) return undefined
  const percent = Math.min(100, Math.max(0, Math.round(used / cap * 100)))
  const resetAt = toIso(raw.resetAt ?? raw.reset_at ?? raw.resetsAt ?? raw.resets_at)
  return {
    used,
    cap,
    percent,
    exceeded: raw.exceeded === true,
    ...resetAt === undefined ? {} : { resetAt },
  }
}

/**
 * Read a usage snapshot from the undocumented billing endpoints.
 *
 * Credits and subscriptions are fetched together but isolated: whichever one
 * answers still yields a usable snapshot, because a plan id is a convenience
 * while the 5-hour window is the point of the read.
 * @param options - gateway address, credential, and cancellation.
 * @returns the normalized snapshot; never throws.
 */
/**
 * Mask a key for display: enough to tell two keys apart, not enough to use.
 * @param key - the resolved bearer token.
 * @returns the masked hint, or `undefined` for an unusably short value.
 */
function maskKey(key: string): string | undefined {
  const trimmed = key.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length <= 12) return '••••'
  return `${trimmed.slice(0, 9)}…${trimmed.slice(-4)}`
}

export async function fetchUsageSnapshot(options: UsageRequestOptions): Promise<UsageSnapshot> {
  const fetchedAt = new Date().toISOString()
  const keyHint = maskKey(options.apiKey)
  const base = options.baseURL.replace(/\/+$/, '')
  const headers = { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' }

  const read = async (path: string): Promise<unknown> => {
    const timeout = AbortSignal.timeout(READ_TIMEOUT_MS)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const response = await fetch(`${base}${path}`, { method: 'GET', headers, signal })
    if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`)
    return await response.json()
  }

  const errors: string[] = []
  let credits: Record<string, unknown> | undefined
  try {
    const payload = await read('/alpha/billing/credits')
    if (isRecord(payload)) credits = payload
    else errors.push('/alpha/billing/credits returned an unexpected shape')
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  let planId: string | undefined
  try {
    const whoami = await read('/alpha/whoami')
    const orgId = isRecord(whoami)
      ? (typeof whoami.orgId === 'string' ? whoami.orgId : undefined)
      : undefined
    const query = orgId === undefined ? '' : `?orgId=${encodeURIComponent(orgId)}`
    const subscriptions = await read(`/alpha/billing/subscriptions${query}`)
    if (isRecord(subscriptions) && typeof subscriptions.planId === 'string') {
      planId = subscriptions.planId
    }
  } catch (error: unknown) {
    // A missing plan id only costs the tier hint, so it stays non-fatal.
    errors.push(error instanceof Error ? error.message : String(error))
  }

  if (credits === undefined) {
    return {
      ok: false,
      error: errors.join('; ') || 'usage read failed',
      fetchedAt,
      ...keyHint === undefined ? {} : { keyHint },
    }
  }

  const windowLimits = pickRecord(credits, ['windowLimits', 'window_limits']) ?? credits
  const fiveHour = parseWindow(pickRecord(windowLimits, ['fiveHour', 'five_hour', 'fiveHourWindow']))
  const weekly = parseWindow(pickRecord(windowLimits, ['weekly', 'week', 'weeklyWindow']))
  const limited = windowLimits.limited === true
  const exceeded = windowLimits.exceeded === true
    || fiveHour?.exceeded === true
    || weekly?.exceeded === true

  return {
    ok: true,
    fetchedAt,
    limited,
    exceeded,
    ...fiveHour === undefined ? {} : { fiveHour },
    ...weekly === undefined ? {} : { weekly },
    ...planId === undefined ? {} : { planId },
    ...keyHint === undefined ? {} : { keyHint },
    ...errors.length === 0 ? {} : { error: `partial read: ${errors.join('; ')}` },
  }
}
