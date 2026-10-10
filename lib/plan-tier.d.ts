/**
 * Plan tiers and the one piece of policy the catalog scan depends on.
 *
 * The official CLI catalog's `Min plan` column names the *lowest* tier that
 * includes a model, so a subscriber on tier T may call every model whose tier
 * ranks at or below T. Keeping that rule in one pure module is what lets the
 * scan stay a data problem and the tier choice stay a user choice.
 *
 * @module commandcode-plans-provider/plan-tier
 */
/**
 * Plan tiers, cheapest first.
 *
 * `max` is the top of the order, so it is also the tier that hides nothing —
 * which is why it is the default rather than a guess at the user's plan.
 */
export declare const PLAN_TIER_OPTIONS: readonly ["go", "goat", "pro", "max"];
/** One selectable plan tier. */
export type PlanTier = (typeof PLAN_TIER_OPTIONS)[number];
/** The tier that hides nothing: the plugin's default. */
export declare const DEFAULT_PLAN_TIER: PlanTier;
/**
 * Rank of a catalog `Min plan` value (`Go and above`, `GOAT and above`, `Max`),
 * or `undefined` when the label names no tier this plugin knows.
 *
 * An unrecognized label is treated as "not a plan row" rather than guessed at,
 * because guessing a cheaper tier is what silently hides a model.
 * @param minPlan - the catalog cell, verbatim.
 * @returns the tier's index, or `undefined`.
 */
export declare function planRank(minPlan: string | undefined): number | undefined;
/**
 * Whether a subscriber on `tier` may call the model a catalog row describes.
 * @param minPlan - the catalog row's `Min plan` cell.
 * @param tier - the tier the user selected.
 * @returns whether the row is inside the tier.
 */
export declare function withinTier(minPlan: string | undefined, tier: PlanTier): boolean;
/**
 * Map a subscription `planId` onto a tier.
 * @param planId - the id the subscription endpoint reported.
 * @returns the tier, or `undefined` when the id is not one this plugin knows.
 */
export declare function tierFromPlanId(planId: string | undefined): PlanTier | undefined;
