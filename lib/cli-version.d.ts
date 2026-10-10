/**
 * The gateway's client-version header, resolved from the published CLI.
 *
 * The gateway refuses a request whose `x-command-code-version` is missing or
 * stale with 403 `upgrade_required`, and it reads the client's feature set off
 * that header — so the value has to track the published CLI rather than a
 * release this plugin happened to be built against. Pinning it in code is what
 * makes a plugin stop working on a day nobody changed it.
 *
 * The resolution therefore reads the npm registry, caches the answer, keeps the
 * last known-good value across failures, and only falls back to a constant when
 * nothing has ever resolved.
 *
 * @module commandcode-plans-provider/cli-version
 */
/** Version used only when nothing has ever resolved. */
export declare const FALLBACK_CLI_VERSION = "1.79.2";
/** Where the last value came from. */
export type CliVersionSource = 'registry' | 'cache' | 'fallback';
/** Last resolution outcome, for the plugin's diagnostics. */
export interface CliVersionStatus {
    /** The value currently in use. */
    value: string;
    /** Where that value came from. */
    source: CliVersionSource;
    /** When the registry last answered (ISO). */
    fetchedAt?: string;
    /** The last failure, when the value is not fresh. */
    error?: string;
}
/** The resolver the transport reads the header from. */
export interface CliVersionResolver {
    /**
     * The version to send, resolving on first use.
     * @returns the header value.
     */
    current(): Promise<string>;
    /**
     * Drop the cached value, so the next read re-resolves. Called when the
     * gateway answers `upgrade_required`.
     */
    invalidate(): void;
    /**
     * Last resolution outcome.
     * @returns the status.
     */
    status(): CliVersionStatus;
}
/**
 * Build a resolver for one registry endpoint.
 * @param url - the registry document URL (e.g. `.../command-code/latest`).
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns the resolver.
 */
export declare function createCliVersionResolver(url: string, fetchImpl?: typeof fetch): CliVersionResolver;
