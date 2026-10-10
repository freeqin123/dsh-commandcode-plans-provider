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
import type { PlanTier } from './plan-tier.js';
/** One row of the official CLI catalog (`reference/models.md`). */
export interface CatalogEntry {
    /** Lowest plan that includes the model, verbatim from the catalog. */
    minPlan: string;
    /** Reasoning-effort ids the gateway accepts, in catalog order. */
    efforts?: string[];
}
/** One model the plugin can advertise. */
export interface CcModel {
    /** Wire model id accepted by the gateway. */
    id: string;
    /** Selector label. */
    name: string;
    /** Combined request/response context capacity. */
    contextWindow: number;
    /** Lowest plan that includes the model; absent when the catalog omits the row. */
    minPlan?: string;
    /** Reasoning-effort ids the gateway accepts for this model. */
    efforts?: string[];
    /**
     * Whether the model accepts image input.
     *
     * The catalog carries no modality column, so this follows the official CLI's
     * own classification: vision-capable unless the id is on its text-only list.
     */
    imageInput: boolean;
}
/** Context capacity assumed when the listing discloses none. */
export declare const FALLBACK_CONTEXT_WINDOW = 262144;
/**
 * Official CLI catalog served from npm; `@latest` tracks new releases.
 *
 * unpkg rather than jsDelivr: both serve the same file, but jsDelivr pins its
 * `@latest` resolution for hours, which silently drops models that shipped in
 * the meantime.
 */
export declare const DEFAULT_CATALOG_URL = "https://unpkg.com/command-code@latest/dist/bundled/command-code-knowledge/reference/models.md";
/** Live model listing. */
export declare const DEFAULT_MODELS_URL = "https://api.commandcode.ai/provider/v1/models";
/**
 * Parse `reference/models.md` into model id → catalog entry.
 *
 * The header row names the columns, so a reorder or an inserted column keeps
 * every plan tier correct. Only when no header is found does the parser fall
 * back to the historical indices, and it reports that through {@link CatalogParse}.
 * @param markdown - the catalog document.
 * @returns the parsed rows plus how the columns were located.
 */
export declare function parseCatalog(markdown: string): {
    entries: Map<string, CatalogEntry>;
    headerDriven: boolean;
};
/**
 * Fetch the official CLI catalog.
 * @param url - catalog document URL.
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns the parsed entries.
 * @throws when the document cannot be read or yields no usable row.
 */
export declare function fetchCatalog(url?: string, fetchImpl?: typeof fetch): Promise<Map<string, CatalogEntry>>;
/**
 * The listing reuses one display name across the paid and free tier of the same
 * model. Free tiers carry a `-free` id suffix, so surface that in the label.
 * @param id - wire model id.
 * @param name - listing display name.
 * @returns the label to advertise.
 */
export declare function displayName(id: string, name: string): string;
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
export declare function contextLabel(tokens: number): string;
/**
 * Whether a model id accepts image input under the CLI's classification.
 * @param id - wire model id.
 * @returns whether images may be sent to it.
 */
export declare function imageCapable(id: string): boolean;
/**
 * Fetch the live model listing.
 *
 * Every row is kept, whether or not the catalog describes it: plan membership
 * is attached later, and a row without one is a model the user can still try.
 * @param url - listing endpoint.
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns the models, sorted by id for a deterministic diff.
 */
export declare function fetchModels(url?: string, fetchImpl?: typeof fetch): Promise<CcModel[]>;
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
export declare function mergeCatalog(models: readonly CcModel[], catalog: ReadonlyMap<string, CatalogEntry>): CcModel[];
/**
 * Apply the visible-tier policy.
 * @param models - the merged catalog.
 * @param tier - the tier the user selected.
 * @param showUnknownTier - whether rows with no known plan membership stay visible.
 * @returns the models to advertise, in the input order.
 */
export declare function visibleModels(models: readonly CcModel[], tier: PlanTier, showUnknownTier: boolean): CcModel[];
/**
 * Count models per tier, for the plugin's scan report.
 * @param models - the merged catalog.
 * @returns the counts, including the unknown-tier bucket.
 */
export declare function countByTier(models: readonly CcModel[]): Record<string, number>;
