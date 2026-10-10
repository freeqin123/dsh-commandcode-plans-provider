/**
 * Command Code adapter: model metadata plus the `/alpha/generate` transport.
 *
 * A plan subscription has no Provider-API access, so every request goes through
 * Command Code's private CLI gateway. This class owns the wire call, its abort
 * and idle-timeout discipline, and the mapping from upstream sentinels onto
 * stable harness error codes; the request envelope and the stream vocabulary
 * live in `./protocol.ts`, and credentials and the version header are handed in
 * by the registering plugin so the adapter stays free of that policy.
 *
 * @module commandcode-plans-provider/adapter
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, ImageAttachmentAccess, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { CcModel } from './catalog.js';
import { GATEWAY_EFFORTS } from './protocol.js';
export { GATEWAY_EFFORTS };
/** Maximum idle interval while a gateway stream read is outstanding. */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Validated connection facts of one provider route. */
export interface CommandCodeConnectionOptions {
    /** Picker and directory label. */
    displayName: string;
    /** Gateway base URL; `/alpha/generate` is appended. */
    baseURL: string;
    /** Context capacity used when the selected model declares no exact value. */
    defaultContextWindow: number;
    /** Default per-request output cap. */
    maxTokens: number;
    /** Inline base64 image budget one request accepts before it must offload. */
    maxRequestImageBytes: number;
    /** The already plan-filtered catalog this route advertises. */
    models: readonly CcModel[];
}
/** Constructor options for {@link CommandCodeAdapter}. */
export interface CommandCodeAdapterOptions {
    /** Current connection facts for one route; called once per operation. */
    connection: (provider: string) => CommandCodeConnectionOptions;
    /** Resolve the bearer token for one route; throws when none is available. */
    resolveApiKey: (provider: string) => Promise<string>;
    /** The `x-command-code-version` value to send. */
    cliVersion: () => Promise<string>;
    /** Drop the cached version after the gateway calls it stale. */
    invalidateCliVersion: () => void;
    /**
     * The durable attachment service, resolved lazily. A deployment without one
     * keeps serving text-only traffic and fails loud only when an image arrives.
     */
    resolveAttachments?: () => AttachmentStore | undefined;
    /**
     * Bridge a stored image into the current tool execution world, so an
     * offloaded occurrence still names a path the model can read.
     */
    resolveImageAccess?: (attachments: AttachmentStore, ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined;
}
/**
 * Map a gateway status and error text onto a stable harness `LlmError` code.
 *
 * The upstream sentinels come first because the gateway attaches them to
 * several statuses, and each names a failure the status alone gets wrong: the
 * key is fine when the plan is not, and an exhausted balance is terminal where
 * a rate limit is not.
 * @param status - the HTTP status, when there was one.
 * @param detail - the upstream detail text.
 * @returns the harness error code.
 */
export declare function upstreamErrorCode(status: number, detail: string): string;
/** Command Code adapter. One instance serves every configured route. */
export declare class CommandCodeAdapter extends LlmAdapter {
    private readonly config;
    /**
     * @param config - route facts, credential resolution, and the version header.
     */
    constructor(config: CommandCodeAdapterOptions);
    /**
     * Resolve request bytes for every retained image in the conversation.
     *
     * A request that exceeds the route's image budget fails with
     * `IMAGE_OFFLOAD_REQUIRED` naming how many oldest occurrences must be
     * offloaded; the harness records that selection and retries, so no image is
     * ever dropped without a durable decision.
     * @param messages - the conversation as this route sees it.
     * @param signal - caller lifetime, threaded into the attachment read.
     * @param maxRequestImageBytes - the route's inline base64 budget.
     * @returns bytes by attachment id, or `undefined` for a text-only call.
     */
    private prepareRequestImages;
    /**
     * Project the conversation onto what this route can actually send: an already
     * offloaded image reaches the gateway as placeholder text, and only retained
     * occurrences are resolved, encoded, and inlined.
     * @param messages - the conversation as the harness holds it.
     * @returns the messages this route will serialize.
     */
    private requestMessages;
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /**
     * Stream one model call over the gateway.
     *
     * Only `finish` terminates the stream: a body that closes without one is
     * reported as truncated rather than as a completed turn.
     * @param options - the assembled harness request.
     * @returns the harness chunks, in arrival order.
     */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
