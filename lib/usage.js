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
/** Per-request budget for one billing read. */
const READ_TIMEOUT_MS = 20_000;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
function pickNumber(source, names) {
    for (const name of names) {
        const value = source[name];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
            return value;
    }
    return undefined;
}
/**
 * First object among several candidate member names.
 * @param source - record to read from.
 * @param names - candidate member names, in preference order.
 * @returns the first usable record, or `undefined`.
 */
function pickRecord(source, names) {
    for (const name of names) {
        const value = source[name];
        if (isRecord(value))
            return value;
    }
    return undefined;
}
/**
 * Normalize one timestamp that may be epoch milliseconds, epoch seconds, or an
 * ISO string.
 * @param value - the raw member value.
 * @returns an ISO string, or `undefined` when it cannot be read.
 */
function toIso(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        // Anything under ~1e12 is seconds; above it, milliseconds.
        const millis = value < 1e12 ? value * 1000 : value;
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    if (typeof value === 'string' && value.length > 0) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    return undefined;
}
/**
 * Read one window object (`{ used, cap, exceeded, resetAt }`) into a percentage.
 * @param raw - the window member, when the endpoint disclosed one.
 * @returns the normalized window, or `undefined` when it carries no numbers.
 */
function parseWindow(raw) {
    if (!isRecord(raw))
        return undefined;
    const used = pickNumber(raw, ['used', 'usedAmount', 'consumed']);
    const cap = pickNumber(raw, ['cap', 'limit', 'maximum', 'max']);
    if (used === undefined || cap === undefined || cap <= 0)
        return undefined;
    const percent = Math.min(100, Math.max(0, Math.round(used / cap * 100)));
    const resetAt = toIso(raw.resetAt ?? raw.reset_at ?? raw.resetsAt ?? raw.resets_at);
    return {
        used,
        cap,
        percent,
        exceeded: raw.exceeded === true,
        ...resetAt === undefined ? {} : { resetAt },
    };
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
function maskKey(key) {
    const trimmed = key.trim();
    if (trimmed.length === 0)
        return undefined;
    if (trimmed.length <= 12)
        return '••••';
    return `${trimmed.slice(0, 9)}…${trimmed.slice(-4)}`;
}
export async function fetchUsageSnapshot(options) {
    const fetchedAt = new Date().toISOString();
    const keyHint = maskKey(options.apiKey);
    const base = options.baseURL.replace(/\/+$/, '');
    const headers = { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' };
    const read = async (path) => {
        const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
        const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
        const response = await fetch(`${base}${path}`, { method: 'GET', headers, signal });
        if (!response.ok)
            throw new Error(`${path} answered HTTP ${response.status}`);
        return await response.json();
    };
    const errors = [];
    let credits;
    try {
        const payload = await read('/alpha/billing/credits');
        if (isRecord(payload))
            credits = payload;
        else
            errors.push('/alpha/billing/credits returned an unexpected shape');
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    let planId;
    try {
        const whoami = await read('/alpha/whoami');
        const orgId = isRecord(whoami)
            ? (typeof whoami.orgId === 'string' ? whoami.orgId : undefined)
            : undefined;
        const query = orgId === undefined ? '' : `?orgId=${encodeURIComponent(orgId)}`;
        const subscriptions = await read(`/alpha/billing/subscriptions${query}`);
        if (isRecord(subscriptions) && typeof subscriptions.planId === 'string') {
            planId = subscriptions.planId;
        }
    }
    catch (error) {
        // A missing plan id only costs the tier hint, so it stays non-fatal.
        errors.push(error instanceof Error ? error.message : String(error));
    }
    if (credits === undefined) {
        return {
            ok: false,
            error: errors.join('; ') || 'usage read failed',
            fetchedAt,
            ...keyHint === undefined ? {} : { keyHint },
        };
    }
    const windowLimits = pickRecord(credits, ['windowLimits', 'window_limits']) ?? credits;
    const fiveHour = parseWindow(pickRecord(windowLimits, ['fiveHour', 'five_hour', 'fiveHourWindow']));
    const weekly = parseWindow(pickRecord(windowLimits, ['weekly', 'week', 'weeklyWindow']));
    const limited = windowLimits.limited === true;
    const exceeded = windowLimits.exceeded === true
        || fiveHour?.exceeded === true
        || weekly?.exceeded === true;
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
    };
}
