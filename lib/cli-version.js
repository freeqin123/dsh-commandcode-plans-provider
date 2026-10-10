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
export const FALLBACK_CLI_VERSION = '1.79.2';
/** Per-request budget for the registry read. */
const FETCH_TIMEOUT_MS = 15_000;
/** How long one successful resolution stands before it is re-read. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Read `version` out of an npm registry document.
 * @param payload - the parsed registry JSON.
 * @returns the version, or `undefined` when the document has none.
 */
function registryVersion(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
        return undefined;
    const version = payload.version;
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : undefined;
}
/**
 * Build a resolver for one registry endpoint.
 * @param url - the registry document URL (e.g. `.../command-code/latest`).
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns the resolver.
 */
export function createCliVersionResolver(url, fetchImpl = fetch) {
    let value;
    let fetchedAt = 0;
    let error;
    const status = () => ({
        value: value ?? FALLBACK_CLI_VERSION,
        source: value === undefined ? 'fallback' : fetchedAt === 0 ? 'fallback' : 'cache',
        ...fetchedAt === 0 ? {} : { fetchedAt: new Date(fetchedAt).toISOString() },
        ...error === undefined ? {} : { error },
    });
    return {
        async current() {
            if (value !== undefined && Date.now() - fetchedAt < CACHE_TTL_MS)
                return value;
            try {
                const response = await fetchImpl(url, {
                    headers: { accept: 'application/json' },
                    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                });
                if (!response.ok)
                    throw new Error(`${url} answered HTTP ${response.status}`);
                const resolved = registryVersion(await response.json());
                if (resolved === undefined)
                    throw new Error(`${url} carried no version`);
                value = resolved;
                fetchedAt = Date.now();
                error = undefined;
            }
            catch (failure) {
                error = failure instanceof Error ? failure.message : String(failure);
                // Keep the last good value; a stale header still beats no header.
            }
            return value ?? FALLBACK_CLI_VERSION;
        },
        invalidate() {
            fetchedAt = 0;
        },
        status,
    };
}
