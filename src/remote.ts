/**
 * Host half of the browser's usage read.
 *
 * One `TypertRemoteService` namespace, mirroring how the shipped `credentials`
 * and `settings` controllers reach the page: the Client calls
 * `ctx.remote.commandcodeUsage.snapshot()` and receives plain JSON. The value
 * crosses one way only — the handler reads, the page renders.
 *
 * @module commandcode-plans-provider/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageSnapshot } from './usage.js'

/** Reads the latest usage snapshot, honoring or bypassing the plugin's cache. */
export type UsageReader = (force: boolean) => Promise<UsageSnapshot>

/** Cordis service key and wire namespace the browser calls. */
export const USAGE_SERVICE_KEY = 'commandcodeUsage'

/**
 * The usage namespace the dock cell reads.
 *
 * Instantiating it inside `apply` ties its lifetime to the plugin's fiber, so
 * unloading the plugin withdraws the namespace with everything else it mounted.
 */
export class CommandCodeUsageController extends TypertRemoteService {
  private readonly read: UsageReader

  /**
   * @param ctx - the plugin's cordis context.
   * @param read - the cached reader owned by the plugin entry.
   */
  constructor(ctx: Context, read: UsageReader) {
    super(ctx, USAGE_SERVICE_KEY, { namespace: USAGE_SERVICE_KEY })
    this.read = read
  }

  /**
   * Latest usage snapshot for the account.
   * @param force - bypass the plugin's cache, for a user-triggered refresh.
   * @returns the snapshot; a failed read reports `ok: false` rather than throwing.
   */
  @Remote snapshot(force?: boolean): Promise<UsageSnapshot> {
    return this.read(force === true)
  }
}
