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
    used: number;
    /** Ceiling of the window. */
    cap: number;
    /** `used / cap` as whole percent, clamped to 0..100. */
    percent: number;
    /** When the window resets (ISO), when the endpoint discloses it. */
    resetAt?: string;
    /** Whether the server itself reports this window as blocking. */
    exceeded: boolean;
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
    ok: boolean;
    /** Failure reason when {@link ok} is false. */
    error?: string;
    /** When this snapshot was read (ISO). */
    fetchedAt: string;
    /** The 5-hour rolling window. */
    fiveHour?: WindowUsage;
    /** The weekly rolling window. */
    weekly?: WindowUsage;
    /** Plan id from the subscription endpoint, e.g. `individual-goat`. */
    planId?: string;
    /**
     * Masked identification of the key this read used.
     *
     * The credential seam never returns a stored secret, so a masked hint
     * derived while the key is in hand is the only identification a
     * configuration surface can honestly offer.
     */
    keyHint?: string;
    /**
     * Whether the account is subject to window limits at all.
     *
     * A static account property, NOT a statement about the current moment: the
     * blocking flag is {@link exceeded}.
     */
    limited?: boolean;
    /** Whether the server reports the account as currently blocking. */
    exceeded?: boolean;
}
/** Endpoints and credential one usage read needs. */
export interface UsageRequestOptions {
    /** Gateway base URL; the `/alpha/billing/*` paths are appended. */
    baseURL: string;
    /** Bearer token for the subscription. */
    apiKey: string;
    /** Cancellation for this read. */
    signal?: AbortSignal;
}
export declare function fetchUsageSnapshot(options: UsageRequestOptions): Promise<UsageSnapshot>;
