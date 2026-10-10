/**
 * Command Code wire protocol: translate between the harness LLM vocabulary and
 * Command Code's private `/alpha/generate` gateway.
 *
 * A plan without Provider-API access has no other transport: the standard
 * OpenAI-compatible endpoints answer 403 `upgrade_required`, so the CLI gateway
 * is the only endpoint a subscription can call. This module serializes its
 * request envelope and parses its **line-delimited JSON** stream (one bare JSON
 * object per line, no SSE `data:` framing) back into harness `StreamChunk`s.
 *
 * Images are not carried yet: P7 adds them, so an image block refuses loudly
 * instead of being dropped on the floor.
 *
 * @module commandcode-plans-provider/protocol
 */
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
/**
 * Reasoning-effort values the gateway accepts, mapped to their selector labels.
 *
 * There is deliberately no `off`: a request that names no effort is what "let
 * the model decide" means on this gateway, so omitting the field IS the default.
 */
export declare const GATEWAY_EFFORTS: Readonly<Record<string, string>>;
/** Last-resort output cap when a request carries no maxTokens. */
export declare const DEFAULT_MAX_TOKENS = 64000;
/** Line-delimited JSON stream: one JSON object per line. */
export interface CcStreamEvent {
    type: string;
    [key: string]: unknown;
}
/** Tool call inside an assistant message, as the gateway wants it. */
interface CcToolCallContent {
    type: 'tool-call';
    toolCallId: string;
    toolName: string;
    input: unknown;
}
/** Tool result inside a tool-role message. */
interface CcToolResultContent {
    type: 'tool-result';
    toolCallId: string;
    toolName: string;
    output: {
        type: 'text' | 'error-text';
        value: string;
    };
}
/** One user-content part; the gateway carries inline images in user turns only. */
type CcUserPart = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    image: string;
    mimeType: string;
};
/**
 * Request bytes for every retained image of one call, keyed by attachment id,
 * or `undefined` when the call carries none.
 *
 * The gateway is stateless — it stores no images and offers no upload endpoint —
 * so every retained image is re-inlined on every request, exactly as the CLI
 * does. That is why an image costs the same in every turn it appears in.
 */
export type RequestImages = ReadonlyMap<string, RequestImageAttachment>;
type CcMessage = {
    role: 'user';
    content: string | CcUserPart[];
} | {
    role: 'assistant';
    content: Array<{
        type: 'text';
        text: string;
    } | {
        type: 'reasoning';
        text: string;
    } | CcToolCallContent>;
} | {
    role: 'tool';
    content: CcToolResultContent[];
};
interface CcTool {
    name: string;
    description?: string;
    input_schema: unknown;
}
interface CcRequestEnvelope {
    config: {
        workingDir: string;
        date: string;
        environment: string;
        structure: unknown[];
        isGitRepo: boolean;
        currentBranch: string;
        mainBranch: string;
        gitStatus: string;
        recentCommits: unknown[];
    };
    memory: string;
    taste: string;
    skills: null;
    permissionMode: string;
    params: {
        model: string;
        messages: CcMessage[];
        tools: CcTool[];
        system: string;
        max_tokens: number;
        stream: true;
        temperature?: number;
        reasoning_effort?: string;
    };
}
/**
 * One tool's argument schema in the shape the gateway wire expects: every
 * property the declaration leaves optional becomes nullable, at every depth.
 * @param parameters - the harness-declared JSON Schema.
 * @returns the wire schema.
 */
export declare function clientSchema(parameters: unknown): unknown;
/**
 * Drop the nulls {@link clientSchema} invites: a null where an optional property
 * stands means "not passed", so the harness reads the argument as absent and the
 * tool's own default applies.
 * @param value - the model's arguments.
 * @param schema - the harness-declared schema they were produced against.
 * @returns the same arguments with wire-only nulls removed.
 */
export declare function dropNullArguments(value: unknown, schema: unknown): unknown;
/**
 * Sanitize a tool call id for the gateway wire protocol: composite ids encoded
 * by other providers keep only their call-id head, and the result is capped to
 * 64 characters.
 * @param id - the harness tool call id.
 * @returns the wire id.
 */
export declare function sanitizeToolCallId(id: string): string;
/**
 * The ordered, de-duplicated image refs one request needs bytes for, rejecting
 * images in roles the gateway cannot carry.
 *
 * Order matters: the offload decision names the *oldest* occurrences, so the
 * caller must be able to tell which is which. Offloaded occurrences are never
 * returned, so a caller cannot resolve bytes the route must not send.
 * @param messages - the conversation as the route sees it.
 * @returns every retained image ref, oldest first, de-duplicated by id.
 */
export declare function collectRequestImages(messages: readonly RequestMessage[]): ImageAttachmentRef[];
/**
 * Build the gateway request envelope for one harness call.
 * @param options - the assembled harness request.
 * @param images - resolved request bytes for every retained image, when any.
 * @returns the envelope to POST.
 */
export declare function buildRequest(options: GenerateOptions, images?: RequestImages): CcRequestEnvelope;
/**
 * Mutable per-stream translation state, threaded through every
 * {@link eventToChunks} call in arrival order.
 *
 * The harness invariant requires every delta to address an open block of its own
 * type and the stream to finish with no open block, while the gateway's
 * `reasoning-end` / `text-end` events carry neither content nor a block id — so
 * delta text is accumulated here to assemble the closing `block-end`.
 */
export interface ChunkState {
    /** Index of the block currently being written. */
    blockIndex: number;
    /** Accumulated delta text per open block index. */
    texts: Map<number, string>;
    /** Accumulated tool-call identity and raw arguments per open block index. */
    toolCalls: Map<number, {
        id: string;
        name?: string;
        arguments: string;
    }>;
    /** Open textual block type per block index. */
    openTextual: Map<number, 'text' | 'reasoning'>;
    /** Whether a `usage` chunk was already emitted (`finish-step` precedes `finish`). */
    usageSeen: boolean;
    /** The request's declared argument schemas per tool, for {@link dropNullArguments}. */
    toolSchemas?: ReadonlyMap<string, unknown>;
}
/**
 * Fresh translation state for one gateway stream.
 * @param toolSchemas - the request's declared tool schemas, keyed by tool name.
 * @returns empty state.
 */
export declare function chunkState(toolSchemas?: ReadonlyMap<string, unknown>): ChunkState;
/**
 * Translate one gateway stream event into harness chunks.
 * @param event - one parsed stream line.
 * @param state - the per-stream translation state.
 * @returns the chunks this event produces, possibly none.
 */
export declare function eventToChunks(event: CcStreamEvent, state: ChunkState): StreamChunk[];
/**
 * Parse the gateway's line-delimited JSON byte stream into events.
 * @param stream - the response body.
 * @returns the events, in arrival order.
 */
export declare function parseEventStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<CcStreamEvent>;
/**
 * The upstream detail of a gateway error body.
 *
 * The gateway answers `{"success":false,"error":{…}}`, but an edge (Cloudflare)
 * or a proxy can answer HTML or plain text instead. A body carrying no
 * recognizable message is passed through verbatim rather than dropped: an
 * unparsed body still names the failure, while an HTTP status alone names nothing.
 * @param body - the response body text.
 * @returns the detail, or `undefined` for an empty body.
 */
export declare function gatewayErrorDetail(body: string): string | undefined;
/**
 * The upstream detail of an in-stream `error` event.
 *
 * A generation that fails after the response headers are sent carries its only
 * failure text in a `{"type":"error","error":{…}}` line — there is no HTTP
 * status left to report, so dropping the event would end the turn with nothing
 * but "stream ended".
 * @param event - the error event.
 * @returns the detail and the upstream status code, when it named one.
 */
export declare function streamErrorDetail(event: CcStreamEvent): {
    detail: string;
    status?: number;
};
export {};
