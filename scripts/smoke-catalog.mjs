/**
 * Contract checks for the catalog and plan-tier modules.
 *
 * The regression this exists for is the one that produced "only Go models show":
 * the catalog table's column order is upstream data, so a parser pinned to fixed
 * indices mis-assigns plan tiers the moment a column moves. The reordered-header
 * case below fails loudly if that ever comes back.
 *
 * Requires `npm run build` first: the modules under test are the compiled ones.
 */

import { strict as assert } from 'node:assert'

import { contextLabel, countByTier, imageCapable, parseCatalog, visibleModels } from '../lib/catalog.js'
import { PLAN_TIER_OPTIONS, tierFromPlanId, withinTier } from '../lib/plan-tier.js'

/** The catalog shape as published, with its historical column order. */
const CANONICAL = [
  '| Model | Name | Context | Efforts | $/1M | Min plan | Best for |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| `go/model` | Go Model | 128k | low, medium | $1 | Go and above | x |',
  '| `goat/model` | Goat Model | 256k | high, max | $2 | GOAT and above | x |',
  '| `pro/model` | Pro Model | 512k | — | $3 | Pro and above | x |',
  '| `max/model` | Max Model | 1M | low | $4 | Max | x |',
  '| `future/model` | Future | 1M | low | $5 | Some future tier | x |',
].join('\n')

const canonical = parseCatalog(CANONICAL)
assert.equal(canonical.headerDriven, true, 'the canonical catalog must parse through its header')
assert.equal(canonical.entries.size, 4, 'a row naming no known tier is not a plan row')
assert.deepEqual(canonical.entries.get('goat/model'), {
  minPlan: 'GOAT and above',
  efforts: ['high', 'max'],
})
assert.equal(canonical.entries.get('pro/model').efforts, undefined, 'a dash means the model decides')
assert.equal(canonical.entries.has('future/model'), false, 'an unknown tier label is not guessed at')

// The regression case: the same data with the columns moved around.
const REORDERED = [
  '| Model | Name | Min plan | Efforts | Context | $/1M | Best for |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| `go/model` | Go Model | Go and above | low, medium | 128k | $1 | x |',
  '| `goat/model` | Goat Model | GOAT and above | high, max | 256k | $2 | x |',
  '| `pro/model` | Pro Model | Pro and above | — | 512k | $3 | x |',
  '| `max/model` | Max Model | Max | low | 1M | $4 | x |',
].join('\n')

const reordered = parseCatalog(REORDERED)
assert.equal(reordered.headerDriven, true, 'a moved Min plan column is still found by name')
assert.equal(reordered.entries.size, 4)
for (const [id, entry] of canonical.entries) {
  assert.equal(reordered.entries.get(id)?.minPlan, entry.minPlan, `${id} keeps its tier when columns move`)
  assert.deepEqual(reordered.entries.get(id)?.efforts, entry.efforts, `${id} keeps its efforts when columns move`)
}

// No recognizable header: the historical indices answer, and the caller is told.
const HEADERLESS = [
  '| `nohdr/model` | Name | Ctx | low | $1 | Go and above | x |',
].join('\n')

const headerless = parseCatalog(HEADERLESS)
assert.equal(headerless.headerDriven, false, 'a document with no header must report that')
assert.equal(headerless.entries.get('nohdr/model')?.minPlan, 'Go and above')

// Tier policy: selecting a tier shows that tier and every cheaper one.
const models = [
  { id: 'go/model', name: 'Go', contextWindow: 1, minPlan: 'Go and above' },
  { id: 'goat/model', name: 'Goat', contextWindow: 1, minPlan: 'GOAT and above' },
  { id: 'pro/model', name: 'Pro', contextWindow: 1, minPlan: 'Pro and above' },
  { id: 'max/model', name: 'Max', contextWindow: 1, minPlan: 'Max' },
  { id: 'unknown/model', name: 'Unknown', contextWindow: 1 },
]

const showTier = (tier, showUnknown) => visibleModels(models, tier, showUnknown).map(model => model.id)
assert.deepEqual(showTier('go', false), ['go/model'])
assert.deepEqual(showTier('goat', false), ['go/model', 'goat/model'], 'goat must include every Go model')
assert.deepEqual(showTier('pro', false), ['go/model', 'goat/model', 'pro/model'])
assert.deepEqual(showTier('max', false), ['go/model', 'goat/model', 'pro/model', 'max/model'])
assert.deepEqual(showTier('max', true), [
  'go/model', 'goat/model', 'pro/model', 'max/model', 'unknown/model',
], 'a tier-unknown model stays visible when asked for')

for (const tier of PLAN_TIER_OPTIONS) {
  assert.equal(withinTier('Go and above', tier), true, `Go is inside ${tier}`)
}
assert.equal(withinTier('Pro and above', 'goat'), false, 'Pro is outside goat')

assert.deepEqual(countByTier(models), { go: 1, goat: 1, pro: 1, max: 1, unknown: 1 })
assert.equal(tierFromPlanId('individual-goat'), 'goat')
assert.equal(tierFromPlanId('individual-ultra'), 'max')
assert.equal(tierFromPlanId('individual-provider'), undefined, 'an unknown plan id narrows nothing')

// Image capability follows the CLI's denylist direction: unknown ids are
// vision-capable, because under-claiming refuses an image while over-claiming
// leaves a durable message no later request can replay.
assert.equal(imageCapable('deepseek/deepseek-v4-pro'), false, 'a listed text-only model declares text only')
assert.equal(imageCapable('xai/grok-4.5'), true, 'an unlisted model is treated as vision-capable')
assert.equal(
  imageCapable('xai/grok-4.6-20260101'),
  false,
  'a trailing deployment suffix is ignored when matching',
)

// Context labels: the real listing values must survive formatting, and a value
// that is not a round million must not be printed as one.
assert.equal(contextLabel(1_000_000), '1M')
assert.equal(contextLabel(1_048_576), '1.05M', '2^20 is not a round million')
assert.equal(contextLabel(1_050_000), '1.05M')
assert.equal(contextLabel(524_288), '524K')
assert.equal(contextLabel(262_144), '262K')
assert.equal(contextLabel(200_000), '200K')
assert.equal(contextLabel(256_000), '256K')

console.log('smoke-catalog: ok · header-driven parse, reorder regression, tier policy, plan ids, image capability, context labels')
