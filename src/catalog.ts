/**
 * Model catalog: merge the live listing with the official CLI catalog.
 *
 * The listing endpoint (`/provider/v1/models`) is open and discloses
 * `id` / `name` / `context_length` — never plan membership, never reasoning
 * support. Both come from the model catalog the official `command-code` CLI
 * ships, fetched live from the published package so it tracks the published
 * release instead of a checked-in snapshot.
 *
 * Two rules drive every choice here:
 *
 * 1. **Nothing is hidden for a data reason.** A row the catalog does not
 *    describe stays visible and is marked as an unknown tier; a failed fetch
 *    keeps the previous catalog rather than emptying the list.
 * 2. **Column positions are read, not assumed.** The markdown table is parsed
 *    through its header row, so an upstream column reorder degrades into a
 *    warning instead of silently mis-assigning plan tiers.
 *
 * @module commandcode-plans-provider/catalog
 */

import { planRank, withinTier } from './plan-tier.js'
import type { PlanTier } from './plan-tier.js'

/** One row of the official CLI catalog (`reference/models.md`). */
export interface CatalogEntry {
  /** Lowest plan that includes the model, verbatim from the catalog. */
  minPlan: string
  /** Reasoning-effort ids the gateway accepts, in catalog order. */
  efforts?: string[]
}

/** One model the plugin can advertise. */
export interface CcModel {
  /** Wire model id accepted by the gateway. */
  id: string
  /** Selector label. */
  name: string
  /** Combined request/response context capacity. */
  contextWindow: number
  /** Lowest plan that includes the model; absent when the catalog omits the row. */
  minPlan?: string
  /** Reasoning-effort ids the gateway accepts for this model. */
  efforts?: string[]
  /**
   * Whether the model accepts image input.
   *
   * The catalog carries no modality column, so this follows the official CLI's
   * own classification: vision-capable unless the id is on its text-only list.
   */
  imageInput: boolean
}

/** Context capacity assumed when the listing discloses none. */
export const FALLBACK_CONTEXT_WINDOW = 262_144

/** Per-request fetch budget for both catalog endpoints. */
const FETCH_TIMEOUT_MS = 30_000

/**
 * Official CLI catalog served from npm; `@latest` tracks new releases.
 *
 * unpkg rather than jsDelivr: both serve the same file, but jsDelivr pins its
 * `@latest` resolution for hours, which silently drops models that shipped in
 * the meantime.
 */
export const DEFAULT_CATALOG_URL
  = 'https://unpkg.com/command-code@latest/dist/bundled/command-code-knowledge/reference/models.md'

/** Live model listing. */
export const DEFAULT_MODELS_URL = 'https://api.commandcode.ai/provider/v1/models'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Split one markdown table row into trimmed cells.
 * @param line - a table line.
 * @returns the cell values between the outer pipes.
 */
function cells(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutTrailing = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return withoutTrailing.split('|').map(cell => cell.trim())
}

/** Column names the parser needs, matched case-insensitively. */
const MIN_PLAN_COLUMN = 'min plan'
const EFFORTS_COLUMN = 'efforts'

/**
 * Indices the catalog used before the parser became header-driven.
 *
 * {@link cells} drops the pipes themselves, so the first real column is index 0
 * — one lower than the historical `line.split('|')` numbering this mirrors.
 */
const FALLBACK_MIN_PLAN_INDEX = 5
const FALLBACK_EFFORTS_INDEX = 3

/**
 * Parse the effort cell: a comma-separated list, a dash meaning "the model
 * decides its own reasoning depth".
 * @param raw - the cell value.
 * @returns the effort ids, or `undefined` when the model exposes none.
 */
function parseEfforts(raw: string): string[] | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed === '—' || trimmed === '-') return undefined
  const parts = trimmed.split(',').map(part => part.trim()).filter(part => part.length > 0)
  return parts.length === 0 ? undefined : parts
}

/**
 * Parse `reference/models.md` into model id → catalog entry.
 *
 * The header row names the columns, so a reorder or an inserted column keeps
 * every plan tier correct. Only when no header is found does the parser fall
 * back to the historical indices, and it reports that through {@link CatalogParse}.
 * @param markdown - the catalog document.
 * @returns the parsed rows plus how the columns were located.
 */
export function parseCatalog(markdown: string): { entries: Map<string, CatalogEntry>, headerDriven: boolean } {
  const entries = new Map<string, CatalogEntry>()
  let minPlanIndex = FALLBACK_MIN_PLAN_INDEX
  let effortsIndex = FALLBACK_EFFORTS_INDEX
  let headerDriven = false

  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const row = cells(line)

    if (!headerDriven) {
      const header = row.map(cell => cell.toLowerCase())
      const planAt = header.indexOf(MIN_PLAN_COLUMN)
      if (planAt >= 0) {
        minPlanIndex = planAt
        const effortsAt = header.indexOf(EFFORTS_COLUMN)
        if (effortsAt >= 0) effortsIndex = effortsAt
        headerDriven = true
        continue
      }
    }

    // Only data rows quote their model id, which skips the separator row.
    const id = row[0]?.startsWith('`') === true ? row[0].replace(/`/g, '') : undefined
    const minPlan = nonEmptyString(row[minPlanIndex])
    if (id === undefined || minPlan === undefined) continue
    if (planRank(minPlan) === undefined) continue
    const efforts = parseEfforts(row[effortsIndex] ?? '')
    entries.set(id, { minPlan, ...efforts === undefined ? {} : { efforts } })
  }

  return { entries, headerDriven }
}

/**
 * Fetch the official CLI catalog.
 * @param url - catalog document URL.
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns the parsed entries.
 * @throws when the document cannot be read or yields no usable row.
 */
export async function fetchCatalog(
  url: string = DEFAULT_CATALOG_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, CatalogEntry>> {
  const response = await fetchImpl(url, {
    headers: { accept: 'text/markdown' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Command Code catalog answered HTTP ${response.status}`)
  const parsed = parseCatalog(await response.text())
  if (parsed.entries.size === 0) throw new Error('Command Code catalog carried no plan row')
  if (!parsed.headerDriven) {
    throw new Error('Command Code catalog has no recognizable header row; columns may have moved')
  }
  return parsed.entries
}

/**
 * The listing reuses one display name across the paid and free tier of the same
 * model. Free tiers carry a `-free` id suffix, so surface that in the label.
 * @param id - wire model id.
 * @param name - listing display name.
 * @returns the label to advertise.
 */
export function displayName(id: string, name: string): string {
  return id.endsWith('-free') && !/free/i.test(name) ? `${name} (free)` : name
}

/**
 * Compact context label for the picker: `1M` / `1.05M` / `524K`.
 *
 * The picker is the only place a model's capacity is visible before a session
 * starts, and the harness model metadata carries no separate capacity field, so
 * it rides the model name. Rounding is to at most two decimals, which keeps
 * 1,048,576 and 1,050,000 from both pretending to be a round million.
 * @param tokens - the model's combined context capacity.
 * @returns the label, without brackets.
 */
export function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 10_000) / 100}M`
  return `${Math.round(tokens / 1000)}K`
}

/**
 * Model ids the official `command-code` CLI classifies as text-only.
 *
 * The CLI's own bundled registry is a denylist, not an allowlist: a model its
 * registry does not mention is treated as vision-capable. Mirroring that
 * direction matters because the two wrong answers are not equally bad —
 * over-claiming leaves a durable message that no later request can replay,
 * while under-claiming refuses an image while it is still cheap to drop.
 */
const TEXT_ONLY_MODELS: ReadonlySet<string> = new Set([
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-flash-fast',
  'zai-org/glm-5.3',
  'zai-org/glm-5.2',
  'zai-org/glm-5.2-fast',
  'zai-org/glm-5.1',
  'zai-org/glm-5',
  'minimaxai/minimax-m2.7',
  'minimax/minimax-m2.7-free',
  'minimaxai/minimax-m2.5',
  'xiaomi/mimo-v2.5-pro',
  'qwen/qwen3.6-max-preview',
  'qwen/qwen3.7-max',
  'stepfun/step-3.5-flash',
  'tencent/hy4-preview',
  'tencent/hy3',
  'tencent/hy3-paid',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-free',
  'xai/grok-4.6',
])

/**
 * Normalize a model id for the denylist lookup: the CLI also ignores a trailing
 * `-YYYYMMDD` deployment suffix.
 * @param id - wire model id.
 * @returns the canonical id.
 */
function canonicalModelId(id: string): string {
  return id.toLowerCase().replace(/-\d{8}$/, '')
}

/**
 * Whether a model id accepts image input under the CLI's classification.
 * @param id - wire model id.
 * @returns whether images may be sent to it.
 */
export function imageCapable(id: string): boolean {
  return !TEXT_ONLY_MODELS.has(canonicalModelId(id))
}

/**
 * Fetch the live model listing.
 *
 * Every row is kept, whether or not the catalog describes it: plan membership
 * is attached later, and a row without one is a model the user can still try.
 * @param url - listing endpoint.
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns the models, sorted by id for a deterministic diff.
 */
export async function fetchModels(
  url: string = DEFAULT_MODELS_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<CcModel[]> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Command Code models endpoint answered HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Command Code models endpoint returned an unexpected shape')
  }
  const models: CcModel[] = []
  for (const raw of payload.data) {
    if (!isRecord(raw)) continue
    const id = nonEmptyString(raw.id)
    if (id === undefined) continue
    models.push({
      id,
      name: displayName(id, nonEmptyString(raw.name) ?? id.split('/').pop() ?? id),
      contextWindow: positiveNumber(raw.context_length)
        ?? positiveNumber(raw.context_window)
        ?? FALLBACK_CONTEXT_WINDOW,
      imageInput: imageCapable(id),
    })
  }
  models.sort((left, right) => left.id.localeCompare(right.id))
  return models
}

/**
 * Attach plan membership and reasoning support from the catalog.
 *
 * A model the catalog does not describe keeps no `minPlan`, which is what marks
 * it as an unknown tier: the caller decides whether such rows stay visible, and
 * the default is that they do.
 * @param models - the live listing.
 * @param catalog - the parsed CLI catalog.
 * @returns the merged rows.
 */
export function mergeCatalog(
  models: readonly CcModel[],
  catalog: ReadonlyMap<string, CatalogEntry>,
): CcModel[] {
  return models.map((model) => {
    const entry = catalog.get(model.id)
    if (entry === undefined) return model
    return {
      ...model,
      minPlan: entry.minPlan,
      ...entry.efforts === undefined ? {} : { efforts: entry.efforts },
    }
  })
}

/**
 * Apply the visible-tier policy.
 * @param models - the merged catalog.
 * @param tier - the tier the user selected.
 * @param showUnknownTier - whether rows with no known plan membership stay visible.
 * @returns the models to advertise, in the input order.
 */
export function visibleModels(
  models: readonly CcModel[],
  tier: PlanTier,
  showUnknownTier: boolean,
): CcModel[] {
  return models.filter((model) => model.minPlan === undefined
    ? showUnknownTier
    : withinTier(model.minPlan, tier))
}

/**
 * Count models per tier, for the plugin's scan report.
 * @param models - the merged catalog.
 * @returns the counts, including the unknown-tier bucket.
 */
export function countByTier(models: readonly CcModel[]): Record<string, number> {
  const counts: Record<string, number> = { unknown: 0 }
  for (const model of models) {
    const key = model.minPlan?.trim().split(/\s+/)[0]?.toLowerCase() ?? 'unknown'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}
