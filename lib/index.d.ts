/**
 * commandcode-plans-provider — Command Code subscription provider for the dsh harness.
 *
 * A Go / GOAT / Pro / Max subscription has no Provider-API access: the
 * OpenAI-compatible endpoints answer 403 `upgrade_required`, so every request
 * must go through Command Code's private CLI gateway at `/alpha/generate`.
 * This plugin:
 *
 * 1. Scans the live model listing and merges it with the official CLI catalog,
 *    then advertises the models the selected tier covers. The default tier is
 *    `max`, and a row the catalog does not describe stays visible as a
 *    tier-unknown model, so no model is ever hidden for a data reason.
 * 2. Serves the route through the harness `LlmAdapter` seam — model metadata and
 *    per-model reasoning levels today, the `/alpha/generate` transport in P6.
 * 3. Reads the subscription's 5-hour / weekly limits into the Web UI, and lets
 *    the API key be configured there through the credential service.
 *
 * @module commandcode-plans-provider
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { PlanTier } from './plan-tier.js';
export { CommandCodeAdapter, GATEWAY_EFFORTS } from './adapter.js';
export type { CommandCodeAdapterOptions, CommandCodeConnectionOptions } from './adapter.js';
export { DEFAULT_CATALOG_URL, DEFAULT_MODELS_URL, FALLBACK_CONTEXT_WINDOW, countByTier, displayName, fetchCatalog, fetchModels, mergeCatalog, parseCatalog, visibleModels, } from './catalog.js';
export type { CatalogEntry, CcModel } from './catalog.js';
export { DEFAULT_PLAN_TIER, PLAN_TIER_OPTIONS, planRank, tierFromPlanId, withinTier } from './plan-tier.js';
export type { PlanTier } from './plan-tier.js';
/** The plugin name; also the fallback settings namespace. */
export declare const name = "commandcode-plans-provider";
/** The plugin needs the LLM seam; every other service is read lazily. */
export declare const inject: string[];
/** Default provider route id; a rename is a config change, not a release. */
export declare const DEFAULT_PROVIDER_ID = "commandcode";
/** Directory and picker label for the single configured account. */
export declare const DEFAULT_DISPLAY_NAME = "Command Code";
/** Default gateway base; `/alpha/generate` is appended by the transport. */
export declare const DEFAULT_BASE_URL = "https://api.commandcode.ai";
/** Default credential reference resolved per request. */
export declare const DEFAULT_API_KEY_ENV = "COMMANDCODE_API_KEY";
/** Default per-request output cap. */
export declare const DEFAULT_MAX_TOKENS = 64000;
/** Default combined request/response context capacity. */
export declare const DEFAULT_CONTEXT_WINDOW = 1000000;
/** Default inline image budget for one request, in base64 bytes. */
export declare const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 2097152;
/**
 * npm registry endpoint the gateway-version header is resolved from.
 *
 * `x-command-code-version` must track the published CLI: the gateway refuses a
 * request whose version is missing or stale with 403 `upgrade_required`, so the
 * value is resolved at runtime instead of pinned in code.
 */
export declare const DEFAULT_CLI_VERSION_URL = "https://registry.npmjs.org/command-code/latest";
/** What the last catalog scan did, so a failure is inspectable rather than silent. */
export interface ScanStatus {
    /** When the last attempt started (ISO). */
    lastAttemptAt?: string;
    /** When a scan last produced a catalog (ISO). */
    lastSuccessAt?: string;
    /** The model listing read. */
    models?: {
        url: string;
        count?: number;
        error?: string;
    };
    /** The official CLI catalog read. */
    catalog?: {
        url: string;
        count?: number;
        error?: string;
    };
    /** Merged catalog totals. */
    merged?: {
        total: number;
        perTier: Record<string, number>;
        unknownTier: number;
    };
    /** What the selected tier currently shows. */
    visible?: {
        tier: PlanTier;
        count: number;
    };
    /** The last failure worth surfacing, if any. */
    error?: string;
}
/**
 * Plugin configuration, validated by the same-named schemastery schema.
 *
 * Every field is volatile, so a settings write reaches the running plugin as a
 * committed reference instead of remounting it.
 */
export interface Config {
    /**
     * The API key itself, written through the plugin's settings card and stored
     * write-only: a read reports only whether one is configured. It wins over
     * `apiKeyEnv`, so the visual path needs no credential-file edit.
     */
    apiKey?: string;
    /** Plan tier whose models are advertised; every cheaper tier is included too. */
    planTier?: PlanTier;
    /** Provider route id registered with the LLM seam. */
    providerId?: string;
    /** Credential reference resolved per request. */
    apiKeyEnv?: string;
    /** Gateway base URL. */
    baseURL?: string;
    /** Live model listing endpoint. */
    modelsUrl?: string;
    /** Official CLI catalog endpoint. */
    catalogUrl?: string;
    /** npm registry endpoint the CLI version is read from. */
    cliVersionUrl?: string;
    /** Default per-request output cap. */
    maxTokens?: number;
    /** Context capacity used when a model declares no exact value. */
    defaultContextWindow?: number;
    /** Inline base64 image bytes one request accepts before it must be offloaded. */
    maxRequestImageBytes?: number;
    /** Whether models whose plan membership is unknown stay visible. */
    showUnknownTierModels?: boolean;
    /** Minutes between catalog rescans; `0` scans only at startup. */
    scanIntervalMinutes?: number;
    /** Seconds between usage-limit polls. */
    usageIntervalSeconds?: number;
    /**
     * Send gateway traffic over HTTP/1.1 (default: the runtime's own protocol).
     * The gateway's edge resets multiplexed HTTP/2 streams under concurrent load;
     * HTTP/1.1 turns the same limit into a readable 429.
     */
    http1?: boolean;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    apiKey: z<string, string, "volatile">;
    planTier: z<"go" | "goat" | "pro" | "max", "go" | "goat" | "pro" | "max", "volatile-defined">;
    providerId: z<string, string, "volatile-defined">;
    apiKeyEnv: z<string, string, "volatile-defined">;
    baseURL: z<string, string, "volatile-defined">;
    modelsUrl: z<string, string, "volatile-defined">;
    catalogUrl: z<string, string, "volatile-defined">;
    cliVersionUrl: z<string, string, "volatile-defined">;
    maxTokens: z<number, number, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    maxRequestImageBytes: z<number, number, "volatile-defined">;
    showUnknownTierModels: z<boolean, boolean, "volatile-defined">;
    scanIntervalMinutes: z<number, number, "volatile-defined">;
    usageIntervalSeconds: z<number, number, "volatile-defined">;
    http1: z<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    apiKey: z<string, string, "volatile">;
    planTier: z<"go" | "goat" | "pro" | "max", "go" | "goat" | "pro" | "max", "volatile-defined">;
    providerId: z<string, string, "volatile-defined">;
    apiKeyEnv: z<string, string, "volatile-defined">;
    baseURL: z<string, string, "volatile-defined">;
    modelsUrl: z<string, string, "volatile-defined">;
    catalogUrl: z<string, string, "volatile-defined">;
    cliVersionUrl: z<string, string, "volatile-defined">;
    maxTokens: z<number, number, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    maxRequestImageBytes: z<number, number, "volatile-defined">;
    showUnknownTierModels: z<boolean, boolean, "volatile-defined">;
    scanIntervalMinutes: z<number, number, "volatile-defined">;
    usageIntervalSeconds: z<number, number, "volatile-defined">;
    http1: z<boolean, boolean, "volatile-defined">;
}>>, "plain">;
/** {@link Config} as the Loader holds it: every field is a committed reference. */
type LiveConfig = Schemastery.TypeT<typeof Config>;
/**
 * Unwrap the live configuration into plain mutable values.
 * @param config - the loader-held configuration.
 * @returns the same settings as plain values.
 */
export declare function liveConfig(config: LiveConfig): Config;
/**
 * Resolve the bearer token one gateway call needs.
 *
 * A key typed into this plugin's own settings wins, because it is the value the
 * user just wrote; then the credential service (what the Web UI writes through),
 * then the launching environment. Every miss names all three paths.
 * @param ctx - the plugin's cordis context.
 * @param config - the resolved configuration.
 * @returns the token to send as `Authorization: Bearer`.
 * @throws when no source has one.
 */
export declare function resolveApiKey(ctx: Context, config: Config): Promise<string>;
/**
 * Mount the plugin.
 *
 * A configuration mistake must be visible rather than silent: the resolved route
 * id, tier and endpoints are reported at load time, and every scan reports what
 * it read, so "the plugin is loaded but shows nothing" always has a log line.
 * @param ctx - the plugin's cordis context.
 * @param config - the loader-held configuration.
 */
export declare function apply(ctx: Context, config: LiveConfig): void;
