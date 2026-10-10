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
export const PLAN_TIER_OPTIONS = ['go', 'goat', 'pro', 'max'];
/** The tier that hides nothing: the plugin's default. */
export const DEFAULT_PLAN_TIER = 'max';
/**
 * Rank of a catalog `Min plan` value (`Go and above`, `GOAT and above`, `Max`),
 * or `undefined` when the label names no tier this plugin knows.
 *
 * An unrecognized label is treated as "not a plan row" rather than guessed at,
 * because guessing a cheaper tier is what silently hides a model.
 * @param minPlan - the catalog cell, verbatim.
 * @returns the tier's index, or `undefined`.
 */
export function planRank(minPlan) {
    const first = minPlan?.trim().split(/\s+/)[0]?.toLowerCase();
    if (first === undefined || first.length === 0)
        return undefined;
    const index = PLAN_TIER_OPTIONS.indexOf(first);
    return index < 0 ? undefined : index;
}
/**
 * Whether a subscriber on `tier` may call the model a catalog row describes.
 * @param minPlan - the catalog row's `Min plan` cell.
 * @param tier - the tier the user selected.
 * @returns whether the row is inside the tier.
 */
export function withinTier(minPlan, tier) {
    const rank = planRank(minPlan);
    return rank !== undefined && rank <= PLAN_TIER_OPTIONS.indexOf(tier);
}
/**
 * Subscription `planId` to plan tier.
 *
 * The subscription endpoint is the only place the account's plan is disclosed,
 * and the mapping is community knowledge rather than documentation, so an
 * unknown id deliberately maps to nothing: the caller keeps its current
 * selection instead of being narrowed to a tier nobody confirmed.
 */
const PLAN_ID_TIERS = {
    'individual-go': 'go',
    'individual-goat': 'goat',
    'individual-pro': 'pro',
    'individual-pro-v1': 'pro',
    'teams-pro': 'pro',
    'individual-max': 'max',
    'individual-ultra': 'max',
};
/**
 * Map a subscription `planId` onto a tier.
 * @param planId - the id the subscription endpoint reported.
 * @returns the tier, or `undefined` when the id is not one this plugin knows.
 */
export function tierFromPlanId(planId) {
    if (planId === undefined)
        return undefined;
    return PLAN_ID_TIERS[planId.trim().toLowerCase()];
}
