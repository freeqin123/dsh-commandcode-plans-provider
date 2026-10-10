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

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
// Augments Context with `fiber.entry` and the `loader/volatile-update` event.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { CommandCodeAdapter } from './adapter.js'
import {
  DEFAULT_CATALOG_URL,
  DEFAULT_MODELS_URL,
  countByTier,
  fetchCatalog,
  fetchModels,
  mergeCatalog,
  visibleModels,
} from './catalog.js'
import type { CatalogEntry, CcModel } from './catalog.js'
import { createCliVersionResolver } from './cli-version.js'
import { DEFAULT_PLAN_TIER, PLAN_TIER_OPTIONS } from './plan-tier.js'
import type { PlanTier } from './plan-tier.js'
import { CommandCodeUsageController } from './remote.js'
import { registerUsageNamespace } from './typert.js'
import { fetchUsageSnapshot } from './usage.js'
import type { UsageSnapshot } from './usage.js'

export { CommandCodeAdapter, GATEWAY_EFFORTS } from './adapter.js'
export type { CommandCodeAdapterOptions, CommandCodeConnectionOptions } from './adapter.js'
export {
  DEFAULT_CATALOG_URL,
  DEFAULT_MODELS_URL,
  FALLBACK_CONTEXT_WINDOW,
  countByTier,
  displayName,
  fetchCatalog,
  fetchModels,
  mergeCatalog,
  parseCatalog,
  visibleModels,
} from './catalog.js'
export type { CatalogEntry, CcModel } from './catalog.js'
export { DEFAULT_PLAN_TIER, PLAN_TIER_OPTIONS, planRank, tierFromPlanId, withinTier } from './plan-tier.js'
export type { PlanTier } from './plan-tier.js'

/** The plugin name; also the fallback settings namespace. */
export const name = 'commandcode-plans-provider'

/** The plugin needs the LLM seam; every other service is read lazily. */
export const inject = ['llm']

/** Default provider route id; a rename is a config change, not a release. */
export const DEFAULT_PROVIDER_ID = 'commandcode'

/** Directory and picker label for the single configured account. */
export const DEFAULT_DISPLAY_NAME = 'Command Code'

/** Default gateway base; `/alpha/generate` is appended by the transport. */
export const DEFAULT_BASE_URL = 'https://api.commandcode.ai'

/** Default credential reference resolved per request. */
export const DEFAULT_API_KEY_ENV = 'COMMANDCODE_API_KEY'

/** Default per-request output cap. */
export const DEFAULT_MAX_TOKENS = 64_000

/** Default combined request/response context capacity. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000

/** Default inline image budget for one request, in base64 bytes. */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 2_097_152

/**
 * npm registry endpoint the gateway-version header is resolved from.
 *
 * `x-command-code-version` must track the published CLI: the gateway refuses a
 * request whose version is missing or stale with 403 `upgrade_required`, so the
 * value is resolved at runtime instead of pinned in code.
 */
export const DEFAULT_CLI_VERSION_URL = 'https://registry.npmjs.org/command-code/latest'

/** What the last catalog scan did, so a failure is inspectable rather than silent. */
export interface ScanStatus {
  /** When the last attempt started (ISO). */
  lastAttemptAt?: string
  /** When a scan last produced a catalog (ISO). */
  lastSuccessAt?: string
  /** The model listing read. */
  models?: { url: string, count?: number, error?: string }
  /** The official CLI catalog read. */
  catalog?: { url: string, count?: number, error?: string }
  /** Merged catalog totals. */
  merged?: { total: number, perTier: Record<string, number>, unknownTier: number }
  /** What the selected tier currently shows. */
  visible?: { tier: PlanTier, count: number }
  /** The last failure worth surfacing, if any. */
  error?: string
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
  apiKey?: string
  /** Plan tier whose models are advertised; every cheaper tier is included too. */
  planTier?: PlanTier
  /** Provider route id registered with the LLM seam. */
  providerId?: string
  /** Credential reference resolved per request. */
  apiKeyEnv?: string
  /** Gateway base URL. */
  baseURL?: string
  /** Live model listing endpoint. */
  modelsUrl?: string
  /** Official CLI catalog endpoint. */
  catalogUrl?: string
  /** npm registry endpoint the CLI version is read from. */
  cliVersionUrl?: string
  /** Default per-request output cap. */
  maxTokens?: number
  /** Context capacity used when a model declares no exact value. */
  defaultContextWindow?: number
  /** Inline base64 image bytes one request accepts before it must be offloaded. */
  maxRequestImageBytes?: number
  /** Whether models whose plan membership is unknown stay visible. */
  showUnknownTierModels?: boolean
  /** Minutes between catalog rescans; `0` scans only at startup. */
  scanIntervalMinutes?: number
  /** Seconds between usage-limit polls. */
  usageIntervalSeconds?: number
  /**
   * Send gateway traffic over HTTP/1.1 (default: the runtime's own protocol).
   * The gateway's edge resets multiplexed HTTP/2 streams under concurrent load;
   * HTTP/1.1 turns the same limit into a readable 429.
   */
  http1?: boolean
}

export const Config = z.object({
  // Write-only secret: the settings page renders it as a password control that
  // reports only whether a key is configured, so the value never returns on a
  // read and a blank draft keeps the stored key instead of clearing it.
  apiKey: z.string().role('secret').volatile(),
  planTier: z.union(PLAN_TIER_OPTIONS.map(tier => z.const(tier))).default(DEFAULT_PLAN_TIER).volatile(),
  providerId: z.string().default(DEFAULT_PROVIDER_ID).volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
  modelsUrl: z.string().default(DEFAULT_MODELS_URL).volatile(),
  catalogUrl: z.string().default(DEFAULT_CATALOG_URL).volatile(),
  cliVersionUrl: z.string().default(DEFAULT_CLI_VERSION_URL).volatile(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS).volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  maxRequestImageBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_MAX_REQUEST_IMAGE_BYTES).volatile(),
  showUnknownTierModels: z.boolean().default(true).volatile(),
  scanIntervalMinutes: z.number().step(1).min(0).default(60).volatile(),
  usageIntervalSeconds: z.number().step(1).min(15).default(90).volatile(),
  http1: z.boolean().default(false).volatile(),
})

/** {@link Config} as the Loader holds it: every field is a committed reference. */
type LiveConfig = Schemastery.TypeT<typeof Config>

/**
 * Unwrap the live configuration into plain mutable values.
 * @param config - the loader-held configuration.
 * @returns the same settings as plain values.
 */
export function liveConfig(config: LiveConfig): Config {
  return structuredClone({
    apiKey: config.apiKey.get(),
    planTier: config.planTier.get(),
    providerId: config.providerId.get(),
    apiKeyEnv: config.apiKeyEnv.get(),
    baseURL: config.baseURL.get(),
    modelsUrl: config.modelsUrl.get(),
    catalogUrl: config.catalogUrl.get(),
    cliVersionUrl: config.cliVersionUrl.get(),
    maxTokens: config.maxTokens.get(),
    defaultContextWindow: config.defaultContextWindow.get(),
    maxRequestImageBytes: config.maxRequestImageBytes.get(),
    showUnknownTierModels: config.showUnknownTierModels.get(),
    scanIntervalMinutes: config.scanIntervalMinutes.get(),
    usageIntervalSeconds: config.usageIntervalSeconds.get(),
    http1: config.http1.get(),
  }) as Config
}

/**
 * The route id to register, normalized.
 * @param config - the resolved configuration.
 * @returns a non-empty provider id.
 */
function routeOf(config: Config): string {
  const configured = config.providerId?.trim()
  return configured === undefined || configured.length === 0 ? DEFAULT_PROVIDER_ID : configured
}

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
export async function resolveApiKey(ctx: Context, config: Config): Promise<string> {
  const typed = config.apiKey?.trim()
  if (typed !== undefined && typed.length > 0) return typed
  const ref = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined && hit.value.length > 0) return hit.value
  } else {
    const ambient = launchEnvironmentOf(ctx).get(ref)
    if (ambient !== undefined && ambient.value.length > 0) return ambient.value
  }
  throw new Error(
    `commandcode-plans-provider: no API key; type one into this plugin's settings card,`
    + ` store ${ref} through the credentials service, or export ${ref} in the launching environment`,
  )
}

/**
 * Mount the plugin.
 *
 * A configuration mistake must be visible rather than silent: the resolved route
 * id, tier and endpoints are reported at load time, and every scan reports what
 * it read, so "the plugin is loaded but shows nothing" always has a log line.
 * @param ctx - the plugin's cordis context.
 * @param config - the loader-held configuration.
 */
export function apply(ctx: Context, config: LiveConfig): void {
  // The Loader owns this namespace, so the configuration form is addressed by
  // the profile entry id that mounted this plugin.
  const settingsNs = ctx.fiber.entry?.options.id ?? name

  // The scanned catalog lives OUTSIDE the settings-backed config: a scan must
  // never be clobbered by a settings snapshot, and a settings write must never
  // discard a scan.
  let scanned: CcModel[] = []
  let status: ScanStatus = {}

  const modelsFor = (current: Config): CcModel[] => visibleModels(
    scanned,
    current.planTier ?? DEFAULT_PLAN_TIER,
    current.showUnknownTierModels ?? true,
  )

  // The gateway refuses a request whose version header is missing or stale, so
  // the value is resolved from the published CLI and cached, never pinned.
  const cliVersion = createCliVersionResolver(
    liveConfig(config).cliVersionUrl ?? DEFAULT_CLI_VERSION_URL,
  )

  const adapter = new CommandCodeAdapter({
    connection: () => {
      const current = liveConfig(config)
      return {
        displayName: DEFAULT_DISPLAY_NAME,
        baseURL: current.baseURL ?? DEFAULT_BASE_URL,
        defaultContextWindow: current.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: current.maxTokens ?? DEFAULT_MAX_TOKENS,
        maxRequestImageBytes: current.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES,
        models: modelsFor(current),
      }
    },
    resolveApiKey: async () => await resolveApiKey(ctx, liveConfig(config)),
    cliVersion: () => cliVersion.current(),
    invalidateCliVersion: () => cliVersion.invalidate(),
    // Resolved lazily at request time: the service is present in every web
    // deployment, and a context without one degrades to the adapter's clear
    // image error instead of a raw cordis trap message.
    resolveAttachments: () => {
      try {
        return ctx.get('attachments')
      } catch {
        return undefined
      }
    },
    // Bridges the stored image into the current tool execution world, so an
    // offloaded occurrence still names a path the model can read.
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
  })

  const report = (): void => {
    const current = liveConfig(config)
    ctx.logger.info(
      '[commandcode-plans-provider] loaded: provider=%s planTier=%s baseURL=%s settingsNs=%s',
      routeOf(current),
      current.planTier ?? DEFAULT_PLAN_TIER,
      current.baseURL ?? DEFAULT_BASE_URL,
      settingsNs,
    )
  }

  /**
   * Read both catalog sources and swap the result in.
   *
   * The listing and the CLI catalog are read independently: the catalog is the
   * only source of plan membership and reasoning support, so losing it degrades
   * every row to a tier-unknown model rather than emptying the list, and losing
   * the listing keeps the previous catalog instead of advertising nothing.
   */
  const scan = async (): Promise<void> => {
    const current = liveConfig(config)
    const modelsUrl = current.modelsUrl ?? DEFAULT_MODELS_URL
    const catalogUrl = current.catalogUrl ?? DEFAULT_CATALOG_URL
    status = { ...status, lastAttemptAt: new Date().toISOString() }
    ctx.logger.info('[commandcode-plans-provider] scanning: %s + %s', modelsUrl, catalogUrl)

    let listing: CcModel[]
    try {
      listing = await fetchModels(modelsUrl)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      status = { ...status, models: { url: modelsUrl, error: message }, error: message }
      ctx.logger.warn(
        '[commandcode-plans-provider] model listing failed, keeping the previous catalog: %s',
        message,
      )
      return
    }

    let entries: Map<string, CatalogEntry> = new Map()
    let catalogError: string | undefined
    try {
      entries = await fetchCatalog(catalogUrl)
    } catch (error: unknown) {
      catalogError = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(
        '[commandcode-plans-provider] catalog fetch failed, models stay tier-unknown: %s',
        catalogError,
      )
    }

    scanned = mergeCatalog(listing, entries)
    const perTier = countByTier(scanned)
    const visible = modelsFor(current)
    status = {
      lastAttemptAt: status.lastAttemptAt,
      lastSuccessAt: new Date().toISOString(),
      models: { url: modelsUrl, count: listing.length },
      catalog: {
        url: catalogUrl,
        count: entries.size,
        ...catalogError === undefined ? {} : { error: catalogError },
      },
      merged: { total: scanned.length, perTier, unknownTier: perTier.unknown ?? 0 },
      visible: { tier: current.planTier ?? DEFAULT_PLAN_TIER, count: visible.length },
      ...catalogError === undefined ? {} : { error: catalogError },
    }
    ctx.logger.info(
      '[commandcode-plans-provider] catalog ready: %d model(s) from %d listing row(s), tier %s shows %d (%s)',
      status.merged?.total ?? 0,
      status.models?.count ?? 0,
      status.visible?.tier ?? DEFAULT_PLAN_TIER,
      status.visible?.count ?? 0,
      Object.entries(perTier).map(([tier, count]) => `${tier}:${count}`).join(' '),
    )
  }

  // Routes: one configurable-provider directory entry plus the adapter that
  // answers for it. Both are owned by this fiber and withdrawn with the plugin.
  let registeredRoute = routeOf(liveConfig(config))
  const directoryEntry = (provider: string): {
    provider: string,
    displayName: string,
    settingsNs: string,
    settingsPath: string[],
  } => ({ provider, displayName: DEFAULT_DISPLAY_NAME, settingsNs, settingsPath: [] })

  const directory = ctx.llm.registerConfigurableProviders([directoryEntry(registeredRoute)])
  const registration = ctx.llm.registerAdapter([registeredRoute], adapter)

  /** Re-register only when the route id actually changed. */
  const reconcileRoute = (): void => {
    const next = routeOf(liveConfig(config))
    if (next === registeredRoute) return
    directory.replace([directoryEntry(next)])
    registration.replace([next])
    ctx.logger.info('[commandcode-plans-provider] provider route is now %s', next)
    registeredRoute = next
  }

  report()
  void cliVersion.current().then((version) => {
    const versionStatus = cliVersion.status()
    ctx.logger.info(
      '[commandcode-plans-provider] x-command-code-version=%s (source: %s%s)',
      version,
      versionStatus.source,
      versionStatus.error === undefined ? '' : `, last error: ${versionStatus.error}`,
    )
  }).catch((error: unknown) => {
    ctx.logger.warn('[commandcode-plans-provider] CLI version resolution failed: %s', error)
  })
  void scan().catch((error: unknown) => {
    ctx.logger.warn('[commandcode-plans-provider] initial scan failed: %s', error)
  })

  const minutes = liveConfig(config).scanIntervalMinutes ?? 60
  if (minutes > 0) {
    ctx.effect(() => {
      const timer = setInterval(() => {
        void scan().catch((error: unknown) => {
          ctx.logger.warn('[commandcode-plans-provider] scheduled scan failed: %s', error)
        })
      }, minutes * 60_000)
      return () => clearInterval(timer)
    })
  } else {
    ctx.logger.info('[commandcode-plans-provider] scanIntervalMinutes=0: scanning only at startup')
  }

  // Usage is account-level, not per-session, so one cache serves every reader.
  // A failed read travels back as a failed snapshot instead of an exception: the
  // dock cell must be able to say "cannot read right now" rather than vanish.
  let cached: UsageSnapshot | undefined
  let cachedAt = 0
  let pending: Promise<UsageSnapshot> | undefined
  const readUsage = (force: boolean): Promise<UsageSnapshot> => {
    const current = liveConfig(config)
    const ttl = Math.max(15, current.usageIntervalSeconds ?? 90) * 1000
    if (force) {
      cached = undefined
    } else if (cached !== undefined && Date.now() - cachedAt < ttl) {
      return Promise.resolve(cached)
    }
    if (pending !== undefined) return pending
    pending = (async (): Promise<UsageSnapshot> => {
      try {
        const snapshot = await fetchUsageSnapshot({
          baseURL: current.baseURL ?? DEFAULT_BASE_URL,
          apiKey: await resolveApiKey(ctx, current),
        })
        cached = snapshot
        cachedAt = Date.now()
        if (!snapshot.ok) {
          ctx.logger.warn('[commandcode-plans-provider] usage read failed: %s', snapshot.error ?? 'unknown')
        }
        return snapshot
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn('[commandcode-plans-provider] usage read failed: %s', message)
        // A credential miss must not discard the last good reading.
        if (cached !== undefined) return cached
        const failed: UsageSnapshot = { ok: false, error: message, fetchedAt: new Date().toISOString() }
        cached = failed
        cachedAt = Date.now()
        return failed
      } finally {
        pending = undefined
      }
    })()
    return pending
  }
  // Constructing the controller registers the `commandcodeUsage` service on this
  // fiber; the Typert contribution is what puts it on the wire, because dsh
  // discovers exposed namespaces from a registered manifest rather than from the
  // service instance alone.
  new CommandCodeUsageController(ctx, readUsage)
  registerUsageNamespace(ctx, message => ctx.logger.warn('[commandcode-plans-provider] %s', message))

  // Every field is volatile, so a settings write is committed into this fiber
  // and announced here instead of remounting the entry.
  ctx.on('loader/volatile-update', () => {
    try {
      report()
      reconcileRoute()
    } catch (error: unknown) {
      ctx.logger.error('[commandcode-plans-provider] refused settings update: %s', error)
    }
  })
}
