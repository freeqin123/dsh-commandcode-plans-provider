/**
 * Load the browser half in Node with stubbed host globals.
 *
 * The client bundle runs inside the Harness Web page, where a mistake in it
 * takes the whole app down with `web: 1 entry did not activate` and no page at
 * all. A temporal-dead-zone error, a factory that throws, or an `apply` that
 * throws are all detectable here, so they must fail in CI instead of in the
 * user's browser.
 *
 * This asserts structure, not rendering: the factories are invoked so their
 * bodies evaluate, and `apply` runs against a recording slot registry.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'client', 'index.js'), 'utf8')

/**
 * The package name is the single source of truth for the loader id: dsh resolves
 * the client half by it, so a rename that misses `client/index.js` must fail
 * here rather than in the browser.
 */
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Captures the module specifier the shell hands the loader. */
let spec
const windowStub = {
  __ModuleLoader__: {
    load(next) {
      spec = next
    },
  },
}

/** Minimal document surface: the module only touches it inside effects. */
const documentStub = {
  addEventListener() {},
  removeEventListener() {},
}

// eslint-disable-next-line no-new-func -- the bundle is evaluated as a script, as the shell does
new Function('window', 'document', source)(windowStub, documentStub)

if (spec === undefined) throw new Error('the bundle never called window.__ModuleLoader__.load')
if (spec.id !== pkg.name) {
  throw new Error(
    `the loader id must equal the package name: id=${JSON.stringify(spec.id)}, name=${JSON.stringify(pkg.name)}`,
  )
}

const ReactStub = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props, children }
  },
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
}

const module = spec.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error(`the bundle required an undeclared module: ${name}`)
})

const registrations = []
const mounts = []
const ctx = {
  slots: {
    inject(key, install) {
      install()
    },
    register(options) {
      registrations.push(options)
      return { options }
    },
  },
  remote: {
    $mount(contribution) {
      mounts.push(contribution)
      return Promise.resolve(async () => {})
    },
  },
  get() {
    return undefined
  },
}

module.apply(ctx)

const expectedSlots = ['conversation.composer.dock', 'plugins.bundle.config', 'plugins.row.config']
const missing = expectedSlots.filter(key => !registrations.some(options => options.name === key))
if (missing.length > 0) throw new Error(`slots not registered: ${missing.join(', ')}`)

if (mounts.length !== 1) throw new Error(`expected exactly one $mount, got ${mounts.length}`)
const mount = mounts[0]
if (mount.package !== pkg.name) throw new Error('the mounted contribution must name this package')
if (mount.descriptors.length !== 1) throw new Error('exactly one descriptor is expected')
if (mount.descriptors[0].namespace !== 'commandcodeUsage') {
  throw new Error(`unexpected namespace ${JSON.stringify(mount.descriptors[0].namespace)}`)
}

const injected = Array.isArray(module.inject) ? module.inject : []
for (const required of ['slots', 'remote', 'remote.credentials']) {
  if (!injected.includes(required)) throw new Error(`inject is missing ${required}`)
}

console.log(`smoke-client: ok · slots ${registrations.map(o => o.name).join(', ')}`)
console.log(`smoke-client: ok · mounted ${mount.descriptors[0].namespace}/${mount.descriptors[0].method}`)
