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
import { IMAGE_OFFLOAD_REQUIRED_CODE, LlmAdapter, LlmError, ReasoningEffortId, attributionHeaders, offloadedImageText, projectOffloadedImages, requiredImageOffload, } from '@deepseek-ai/dsh-llm';
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment';
import { contextLabel } from './catalog.js';
import { GATEWAY_EFFORTS, buildRequest, chunkState, collectRequestImages, eventToChunks, gatewayErrorDetail, parseEventStream, streamErrorDetail, } from './protocol.js';
export { GATEWAY_EFFORTS };
/** Maximum idle interval while a gateway stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;
/**
 * Per-image request budget: the full 2048px normalized attachment re-encoded to
 * fit 1 MiB, the same per-image bound the official provider routes use.
 */
const REQUEST_IMAGE_POLICY = { maxPixels: 4_194_304, maxBytes: 1_048_576 };
/**
 * Deterministic request target for one source image under the route budget.
 *
 * Both spellings of the same budget ride along on purpose: newer releases read
 * `width`/`height`, earlier ones read `maxPixels`, and each validates only the
 * fields it knows — so one target serves either runtime.
 * @param ref - the stored attachment.
 * @returns the request target.
 */
function requestImageTarget(ref) {
    return {
        ...requestImageDimensions(ref.width, ref.height, REQUEST_IMAGE_POLICY.maxPixels),
        maxPixels: REQUEST_IMAGE_POLICY.maxPixels,
        maxBytes: REQUEST_IMAGE_POLICY.maxBytes,
    };
}
/**
 * The exact base64 length of one image, which is the representation the gateway
 * carries.
 * @param bytes - encoded byte length of the request version.
 * @returns the base64 character count.
 */
function base64Length(bytes) {
    return 4 * Math.ceil(bytes / 3);
}
/**
 * Measure each image occurrence against its resolved request version.
 *
 * Every occurrence of a shared attachment counts again, because the gateway
 * receives those bytes once per occurrence.
 * @param versions - the resolved request versions.
 * @returns a sizer for one image block.
 */
function requestImageVersions(versions) {
    const lengths = new Map(versions.map(version => [version.attachment.attachmentId, version.bytes]));
    return (block) => {
        const bytes = lengths.get(block.attachment.attachmentId);
        if (bytes === undefined) {
            throw new LlmError(`no request bytes resolved for image attachment ${block.attachment.attachmentId}`, 'MISSING_ATTACHMENT');
        }
        return base64Length(bytes);
    };
}
/**
 * One advertised model.
 *
 * The name is the catalog's own label plus its context capacity: a plan suffix
 * (`· GOAT`) was tried and reads as noise, so tier suitability is expressed by
 * the tier filter instead — pick a tier and only the models it covers remain.
 *
 * Capability is declared explicitly rather than left absent: the harness gates
 * image input on `inputModalities`, and an absent field reads as "unknown"
 * rather than "text only", which would let a user attach an image the gateway
 * then refuses.
 * @param provider - the owning route.
 * @param model - one catalog row.
 * @returns the harness model metadata.
 */
function modelInfo(provider, model) {
    return {
        provider,
        id: model.id,
        name: `${model.name} [${contextLabel(model.contextWindow)}]`,
        inputModalities: model.imageInput ? ['text', 'image'] : ['text'],
    };
}
/**
 * The reasoning selector for one model, or nothing at all.
 *
 * The gateway cannot express "off", so `Off` is offered as an explicit "do not
 * send `reasoning_effort`" entry — the same wire shape as leaving it unset, but
 * with the user's intent recorded. A model the catalog leaves blank exposes no
 * selector, and no default effort is pinned either: absence preserves the
 * gateway's own choice.
 * @param model - one catalog row, when the model is known.
 * @returns the reasoning metadata, or `undefined` for no selector.
 */
function reasoningFor(model) {
    const levels = (model?.efforts ?? []).filter(effort => effort in GATEWAY_EFFORTS);
    if (levels.length === 0)
        return undefined;
    return {
        efforts: [
            { id: ReasoningEffortId('off'), name: 'Off' },
            ...levels.map(effort => ({ id: ReasoningEffortId(effort), name: GATEWAY_EFFORTS[effort] ?? effort })),
        ],
    };
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
export function upstreamErrorCode(status, detail) {
    if (detail.includes('MODEL_NOT_IN_PLAN'))
        return 'PERMISSION';
    if (detail.includes('PREMIUM_CREDITS_EXHAUSTED') || detail.includes('CREDITS_EXHAUSTED'))
        return 'QUOTA_EXCEEDED';
    if (detail.includes('QUOTA'))
        return 'QUOTA_EXCEEDED';
    if (status === 429 || detail.includes('RATE_LIMITED'))
        return 'RATE_LIMIT';
    if (status === 401 || status === 403)
        return 'AUTH';
    if (status === 400) {
        return /context|token limit|too long/i.test(detail) ? 'CONTEXT_WINDOW_EXCEEDED' : 'INVALID_REQUEST';
    }
    if (status >= 500)
        return 'SERVER';
    return `HTTP_${status}`;
}
/** Command Code adapter. One instance serves every configured route. */
export class CommandCodeAdapter extends LlmAdapter {
    config;
    /**
     * @param config - route facts, credential resolution, and the version header.
     */
    constructor(config) {
        super();
        this.config = config;
    }
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
    async prepareRequestImages(messages, signal, maxRequestImageBytes) {
        const refs = collectRequestImages(messages);
        if (refs.length === 0)
            return undefined;
        const attachments = this.config.resolveAttachments?.();
        if (attachments === undefined) {
            throw new LlmError('image input requires the durable attachment service', 'UNSUPPORTED_CONTENT');
        }
        const versions = await Promise.all(refs.map(async (ref) => await attachments.readImageRequest(ref, requestImageTarget(ref), signal)));
        const offloadImages = requiredImageOffload(messages, {
            representation: 'base64',
            maxBytes: maxRequestImageBytes,
        }, requestImageVersions(versions));
        if (offloadImages > 0) {
            throw new LlmError(`commandcode request images exceed the ${maxRequestImageBytes}-byte base64 budget;`
                + ` ${offloadImages} more oldest occurrence(s) must be offloaded.`, IMAGE_OFFLOAD_REQUIRED_CODE, { offloadImages });
        }
        return new Map(versions.map(version => [version.attachment.attachmentId, version]));
    }
    /**
     * Project the conversation onto what this route can actually send: an already
     * offloaded image reaches the gateway as placeholder text, and only retained
     * occurrences are resolved, encoded, and inlined.
     * @param messages - the conversation as the harness holds it.
     * @returns the messages this route will serialize.
     */
    requestMessages(messages) {
        const attachments = this.config.resolveAttachments?.();
        const resolveImageAccess = this.config.resolveImageAccess;
        const projected = projectOffloadedImages(messages, ref => offloadedImageText(ref, attachments === undefined || resolveImageAccess === undefined
            ? undefined
            : resolveImageAccess(attachments, ref)));
        return projected === messages ? [...messages] : [...projected];
    }
    providerInfo(provider) {
        return { id: provider, name: this.config.connection(provider).displayName };
    }
    listModels(provider) {
        return Promise.resolve(this.config.connection(provider).models.map(model => modelInfo(provider, model)));
    }
    resolveModel(provider, model, _signal) {
        const connection = this.config.connection(provider);
        const configured = connection.models.find(entry => entry.id === model);
        // A model the scan has never seen still gets a label, and it names the same
        // capacity the request will actually be measured against.
        const info = configured === undefined
            ? { provider, id: model, name: `${model} [${contextLabel(connection.defaultContextWindow)}]` }
            : modelInfo(provider, configured);
        const reasoning = reasoningFor(configured);
        return Promise.resolve({
            ...info,
            context: { contextWindow: configured?.contextWindow ?? connection.defaultContextWindow },
            // The catalog discloses no per-model output cap, so the route's own
            // default answers for every model it advertises.
            defaultMaxTokens: connection.maxTokens,
            ...reasoning === undefined ? {} : { reasoning },
        });
    }
    /**
     * Stream one model call over the gateway.
     *
     * Only `finish` terminates the stream: a body that closes without one is
     * reported as truncated rather than as a completed turn.
     * @param options - the assembled harness request.
     * @returns the harness chunks, in arrival order.
     */
    async *stream(options) {
        const connection = this.config.connection(options.provider);
        const apiKey = await this.config.resolveApiKey(options.provider);
        const url = `${connection.baseURL.replace(/\/+$/, '')}/alpha/generate`;
        // Project offloaded occurrences first, then resolve bytes: an offloaded
        // image must never be read, encoded, or sent.
        const messages = this.requestMessages(options.messages);
        const images = await this.prepareRequestImages(messages, options.signal, connection.maxRequestImageBytes);
        const payload = JSON.stringify(buildRequest({ ...options, messages }, images));
        // The consumer controller owns termination: a caller abort, an idle
        // timeout, and normal completion all stop the reader through it.
        const consumer = new AbortController();
        const signal = options.signal === undefined
            ? consumer.signal
            : AbortSignal.any([options.signal, consumer.signal]);
        const headers = (version) => ({
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            // The gateway reads the client's feature set off this header and refuses a
            // request whose version is missing or stale.
            'x-command-code-version': version,
            'x-cli-environment': 'production',
            'x-co-flag': 'false',
            ...attributionHeaders(),
        });
        const post = async (version) => fetch(url, {
            method: 'POST',
            headers: headers(version),
            body: payload,
            signal,
        });
        let response;
        try {
            response = await post(await this.config.cliVersion());
            if (response.status === 403) {
                const raw = await response.text().catch(() => '');
                const detail = gatewayErrorDetail(raw) ?? raw;
                if (detail.includes('upgrade_required')) {
                    // A stale version header is the one failure worth one silent retry.
                    this.config.invalidateCliVersion();
                    response = await post(await this.config.cliVersion());
                }
                else {
                    throw new LlmError(`${detail} [model=${options.model}]`, 'AUTH', { status: 403 });
                }
            }
        }
        catch (error) {
            if (error instanceof LlmError)
                throw error;
            if (signal.aborted)
                throw new LlmError('request aborted by caller', 'ABORTED', { cause: error });
            throw new LlmError(error instanceof Error ? error.message : String(error), 'TRANSPORT', { cause: error });
        }
        if (!response.ok) {
            const raw = await response.text().catch(() => '');
            const detail = gatewayErrorDetail(raw) ?? raw;
            throw new LlmError(`${detail} [model=${options.model}]`, upstreamErrorCode(response.status, detail), { status: response.status });
        }
        if (response.body === null)
            throw new LlmError('returned no response body', 'EMPTY_RESPONSE');
        const state = chunkState(new Map((options.tools ?? []).map(tool => [tool.name, tool.parameters])));
        const iterator = parseEventStream(response.body)[Symbol.asyncIterator]();
        /** One read, guarded by the idle budget. */
        const nextWithIdle = async () => {
            let timer;
            const idle = new Promise((_resolve, reject) => {
                timer = setTimeout(() => {
                    consumer.abort('idle');
                    reject(new LlmError(`stream idle timeout after ${DEFAULT_STREAM_IDLE_TIMEOUT_MS}ms`, 'TIMEOUT'));
                }, DEFAULT_STREAM_IDLE_TIMEOUT_MS);
            });
            try {
                return await Promise.race([iterator.next(), idle]);
            }
            finally {
                if (timer !== undefined)
                    clearTimeout(timer);
            }
        };
        let exhausted = false;
        try {
            while (true) {
                const step = await nextWithIdle();
                if (step.done === true) {
                    exhausted = true;
                    break;
                }
                const event = step.value;
                // A mid-stream failure arrives as an event, not an HTTP status; its
                // message is the only account of what went wrong.
                if (event.type === 'error') {
                    const { detail, status } = streamErrorDetail(event);
                    throw new LlmError(`${detail} [model=${options.model}]`, upstreamErrorCode(status ?? 500, detail), status === undefined ? undefined : { status });
                }
                // Each distinct content stream (text / reasoning / tool-call) opens its
                // own block index in arrival order.
                if (event.type === 'text-start' || event.type === 'reasoning-start' || event.type === 'tool-call') {
                    state.blockIndex += 1;
                }
                yield* eventToChunks(event, state);
                if (event.type === 'finish')
                    return;
            }
        }
        catch (error) {
            if (error instanceof LlmError)
                throw error;
            if (options.signal?.aborted === true) {
                throw new LlmError('request aborted by caller', 'ABORTED', { cause: error });
            }
            throw new LlmError(error instanceof Error ? error.message : String(error), 'TRANSPORT', { cause: error });
        }
        finally {
            consumer.abort('Command Code stream consumer stopped');
            if (!exhausted && iterator.return !== undefined) {
                try {
                    await iterator.return(undefined);
                }
                catch (abortedTeardown) {
                    // The consumer controller already owns termination; a return-time
                    // abort cannot add a second outcome.
                }
            }
        }
        throw new LlmError('stream ended without a finish event', 'STREAM_CLOSED');
    }
}
