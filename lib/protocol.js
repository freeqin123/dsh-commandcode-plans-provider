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
import { arch, platform } from 'node:os';
import { LlmError, ToolCallId, contentHasImage } from '@deepseek-ai/dsh-llm';
/**
 * Reasoning-effort values the gateway accepts, mapped to their selector labels.
 *
 * There is deliberately no `off`: a request that names no effort is what "let
 * the model decide" means on this gateway, so omitting the field IS the default.
 */
export const GATEWAY_EFFORTS = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'X-High',
    max: 'Max',
};
/** Last-resort output cap when a request carries no maxTokens. */
export const DEFAULT_MAX_TOKENS = 64_000;
/** Gateway permission mode; the CLI's own default. */
const GATEWAY_PERMISSION_MODE = 'standard';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * How the gateway wire spells an argument the model does not need to send.
 *
 * The gateway forwards every tool upstream without filling in that API's
 * `strict` field, which then defaults to true and makes every declared property
 * look required — so an optional argument comes back invented or filled with
 * its own description text. Optionality therefore has to be spelled as
 * nullability on the wire; {@link dropNullArguments} drops those nulls again on
 * the way back.
 */
const NULL_ARGUMENT_HINT = 'Leave this out by passing null unless you need a value other than the default.';
/** Whether a schema node already accepts an explicit `null`. */
function allowsNull(schema) {
    if (!isRecord(schema))
        return false;
    if (schema.type === 'null')
        return true;
    if (Array.isArray(schema.type) && schema.type.includes('null'))
        return true;
    if (schema.const === null)
        return true;
    if (Array.isArray(schema.enum) && schema.enum.includes(null))
        return true;
    return Array.isArray(schema.anyOf) && schema.anyOf.some(allowsNull);
}
/** Carry the schema's description onto the nullable branch, so the hint is readable. */
function withHint(property) {
    const description = typeof property.description === 'string' && property.description.length > 0
        ? `${property.description} ${NULL_ARGUMENT_HINT}`
        : NULL_ARGUMENT_HINT;
    return { ...property, description };
}
/** One optional property in the wire's nullable shape, hinting at the null. */
function optionalAsNull(property) {
    return {
        anyOf: [
            withHint(property),
            { type: 'null', description: 'Use null when you do not need this argument.' },
        ],
    };
}
/**
 * One tool's argument schema in the shape the gateway wire expects: every
 * property the declaration leaves optional becomes nullable, at every depth.
 * @param parameters - the harness-declared JSON Schema.
 * @returns the wire schema.
 */
export function clientSchema(parameters) {
    if (!isRecord(parameters))
        return parameters;
    const schema = { ...parameters };
    if (isRecord(parameters.properties)) {
        const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);
        const properties = {};
        for (const [name, property] of Object.entries(parameters.properties)) {
            const declared = clientSchema(property);
            properties[name] = !required.has(name) && isRecord(declared) && !allowsNull(declared)
                ? optionalAsNull(declared)
                : declared;
        }
        schema.properties = properties;
    }
    if (parameters.items !== undefined)
        schema.items = clientSchema(parameters.items);
    if (Array.isArray(parameters.anyOf))
        schema.anyOf = parameters.anyOf.map(clientSchema);
    return schema;
}
/**
 * Drop the nulls {@link clientSchema} invites: a null where an optional property
 * stands means "not passed", so the harness reads the argument as absent and the
 * tool's own default applies.
 * @param value - the model's arguments.
 * @param schema - the harness-declared schema they were produced against.
 * @returns the same arguments with wire-only nulls removed.
 */
export function dropNullArguments(value, schema) {
    if (Array.isArray(value)) {
        const items = isRecord(schema) ? schema.items : undefined;
        return value.map(entry => dropNullArguments(entry, items));
    }
    if (!isRecord(value))
        return value;
    const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : undefined;
    const required = new Set(isRecord(schema) && Array.isArray(schema.required) ? schema.required : []);
    const dropped = {};
    for (const [name, entry] of Object.entries(value)) {
        if (entry === null) {
            const declared = properties?.[name];
            if (declared !== undefined && !required.has(name) && !allowsNull(declared))
                continue;
        }
        dropped[name] = dropNullArguments(entry, properties?.[name]);
    }
    return dropped;
}
/** The flattened text of a message's content blocks. */
function flattenText(blocks) {
    return blocks
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
}
/**
 * Sanitize a tool call id for the gateway wire protocol: composite ids encoded
 * by other providers keep only their call-id head, and the result is capped to
 * 64 characters.
 * @param id - the harness tool call id.
 * @returns the wire id.
 */
export function sanitizeToolCallId(id) {
    const head = id.includes('|') ? id.split('|')[0] ?? id : id;
    return head.length > 64 ? head.slice(0, 64) : head;
}
function safeParseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return raw;
    }
}
/**
 * Refuse an image the gateway cannot replay.
 *
 * Inline images ride user turns only, so an image in assistant or developer
 * history is unrepresentable — and a history that cannot be replayed is worse
 * than a request refused while it is still cheap.
 * @param where - the role that carried the image.
 */
function refuseImage(where) {
    throw new LlmError(`the gateway cannot carry an image in ${where}`, 'UNSUPPORTED_CONTENT');
}
/**
 * The attachment refs of the image blocks in one content list that still need
 * request bytes. An occurrence already offloaded is deliberately absent: it
 * reaches the gateway as placeholder text, never as bytes.
 * @param blocks - one message's content.
 * @returns the refs still needing bytes.
 */
function imageRefs(blocks) {
    return blocks
        .filter((block) => block.type === 'image' && block.offloaded !== true)
        .map(block => block.attachment);
}
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
export function collectRequestImages(messages) {
    const refs = new Map();
    for (const message of messages) {
        if (message.role !== 'user' && message.role !== 'tool' && contentHasImage(message.content)) {
            refuseImage(`${message.role} history`);
        }
        for (const ref of imageRefs(message.content))
            refs.set(ref.attachmentId, ref);
    }
    return [...refs.values()];
}
/**
 * One inline image part in the exact shape the CLI's own writer emits.
 * @param ref - the attachment to inline.
 * @param images - the resolved request bytes.
 * @returns the wire part.
 */
function imagePart(ref, images) {
    const version = images?.get(ref.attachmentId);
    if (version === undefined) {
        throw new LlmError(`no request bytes resolved for image attachment ${ref.attachmentId}`, 'MISSING_ATTACHMENT');
    }
    return {
        type: 'image',
        image: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`,
        mimeType: version.mediaType,
    };
}
/**
 * Whether a wire turn is a textless image-only user turn. Only the nested image
 * fallout of tool results is ever deferred past a tool run; turns carrying text
 * keep their position.
 * @param turn - one serialized turn.
 * @returns whether it carries images and nothing else.
 */
function isImageOnlyUserTurn(turn) {
    return turn.role === 'user'
        && Array.isArray(turn.content)
        && turn.content.length > 0
        && turn.content.every(part => part.type === 'image');
}
/** One assistant message as a gateway turn. */
function serializeAssistant(message) {
    const parts = [];
    for (const block of message.content) {
        switch (block.type) {
            case 'text':
                parts.push({ type: 'text', text: block.text });
                break;
            case 'reasoning':
                parts.push({ type: 'reasoning', text: block.text });
                break;
            case 'tool-call':
                parts.push({
                    type: 'tool-call',
                    toolCallId: sanitizeToolCallId(block.id),
                    toolName: block.name,
                    input: safeParseJson(block.arguments),
                });
                break;
            case 'image':
                refuseImage('assistant history');
                break;
            default:
                break;
        }
    }
    return { role: 'assistant', content: parts };
}
/** The text value of one tool result. */
function toolResultOutput(message) {
    const value = flattenText(message.content);
    return message.isError === true
        ? { type: 'error-text', value: value || 'Execution denied' }
        : { type: 'text', value: value || '(no output)' };
}
/**
 * One tool-result message as gateway turns: its own `tool` turn, plus the user
 * turn carrying any images the tool returned.
 *
 * The `tool` turn always comes first: dropping or reordering it leaves its
 * assistant tool-call unmatched, and the gateway answers "Tool result is
 * missing for tool call …". Images cannot ride the gateway's text-only tool
 * output, so they follow as a plain user turn — the only role that carries
 * inline images — and {@link buildRequest} holds that turn past the tool run
 * so it cannot split a call from its result. `toolName` is resolved from the
 * assistant tool-call that produced the result, because the wire needs the name
 * and the harness keeps only the id.
 * @param message - the harness tool-result message.
 * @param images - the resolved request bytes.
 * @param toolNames - wire id → tool name, collected from assistant history.
 * @returns the gateway turns, in order.
 */
function serializeTool(message, images, toolNames) {
    const toolCallId = sanitizeToolCallId(message.toolCallId);
    const wire = [{
            role: 'tool',
            content: [{
                    type: 'tool-result',
                    toolCallId,
                    toolName: toolNames.get(toolCallId) ?? 'unknown',
                    output: toolResultOutput(message),
                }],
        }];
    const refs = imageRefs(message.content);
    if (refs.length > 0) {
        wire.push({ role: 'user', content: refs.map(ref => imagePart(ref, images)) });
    }
    return wire;
}
/**
 * One user message as a gateway turn: a flat string when the turn is text-only
 * (the shape the harness usually carries), and ordered parts otherwise.
 * @param message - the harness user message or one-shot input.
 * @param images - the resolved request bytes.
 * @returns the gateway turn, or an empty list for a contentless turn.
 */
function serializeUser(message, images) {
    const parts = [];
    for (const block of message.content) {
        if (block.type === 'text')
            parts.push({ type: 'text', text: block.text });
        else if (block.type === 'image')
            parts.push(imagePart(block.attachment, images));
    }
    if (parts.length === 0)
        return [];
    return [parts.every(part => part.type === 'text')
            ? { role: 'user', content: parts.map(part => part.text).join('') }
            : { role: 'user', content: parts }];
}
/**
 * Build the gateway request envelope for one harness call.
 * @param options - the assembled harness request.
 * @param images - resolved request bytes for every retained image, when any.
 * @returns the envelope to POST.
 */
export function buildRequest(options, images) {
    let system = options.system ?? '';
    const messages = [];
    // Image-only user turns split from tool results must not land between tool
    // turns: the gateway ends tool collection at the first user turn, then rejects
    // any later result with "Tool result is missing for tool call …". A tool run
    // spans the assistant tool-calling turns, so these are held until the run is
    // over — the next real user turn, or the end of the request.
    const deferred = [];
    const flushDeferred = () => {
        if (deferred.length > 0)
            messages.push(...deferred.splice(0));
    };
    const pushTurn = (turn) => {
        if (isImageOnlyUserTurn(turn)
            && (messages[messages.length - 1]?.role === 'tool' || deferred.length > 0)) {
            deferred.push(turn);
            return;
        }
        if (turn.role === 'user')
            flushDeferred();
        messages.push(turn);
    };
    // A tool result's `toolName` names the tool whose schema produced the call, so
    // it is read off the assistant tool-call the result answers rather than
    // stamped with a constant.
    const toolNames = new Map();
    for (const message of options.messages) {
        if (message.role !== 'assistant')
            continue;
        for (const block of message.content) {
            if (block.type === 'tool-call')
                toolNames.set(sanitizeToolCallId(block.id), block.name);
        }
    }
    for (const message of options.messages) {
        switch (message.role) {
            case 'system':
                // The gateway has one static system slot, so every system-role message
                // is folded into it.
                system += (system.length > 0 ? '\n\n' : '') + flattenText(message.content);
                break;
            case 'developer':
                // The gateway has one static tool list per request and no tool-update
                // channel, so a mid-conversation declaration change cannot be honoured.
                // Refusing loud beats silently serving a stale tool list.
                throw new LlmError('the gateway cannot represent a developer tool-change message', 'UNSUPPORTED_CONTENT');
            case 'assistant':
                pushTurn(serializeAssistant(message));
                break;
            case 'tool':
                for (const turn of serializeTool(message, images, toolNames))
                    pushTurn(turn);
                break;
            default:
                for (const turn of serializeUser(message, images))
                    pushTurn(turn);
        }
    }
    flushDeferred();
    const tools = (options.tools ?? []).map(tool => ({
        name: tool.name,
        ...tool.description.length === 0 ? {} : { description: tool.description },
        input_schema: clientSchema(tool.parameters),
    }));
    const params = {
        model: options.model,
        messages,
        tools,
        system,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
    };
    if (options.temperature !== undefined)
        params.temperature = options.temperature;
    // An effort the gateway has no value for (a stale `off` from the selector) is
    // dropped rather than rejected upstream.
    if (options.reasoningEffort !== undefined && options.reasoningEffort in GATEWAY_EFFORTS) {
        params.reasoning_effort = options.reasoningEffort;
    }
    return {
        config: {
            workingDir: process.cwd(),
            date: new Date().toISOString().split('T')[0] ?? '',
            // A plain string, not an object: the CLI's own envelope spells it so.
            environment: `${platform()}-${arch()}`,
            structure: [],
            isGitRepo: false,
            currentBranch: '',
            mainBranch: '',
            gitStatus: '',
            recentCommits: [],
        },
        memory: '',
        taste: '',
        skills: null,
        permissionMode: GATEWAY_PERMISSION_MODE,
        params,
    };
}
/**
 * Fresh translation state for one gateway stream.
 * @param toolSchemas - the request's declared tool schemas, keyed by tool name.
 * @returns empty state.
 */
export function chunkState(toolSchemas) {
    return { blockIndex: 0, texts: new Map(), toolCalls: new Map(), openTextual: new Map(), usageSeen: false, toolSchemas };
}
function closeTextual(state, index, type) {
    state.openTextual.delete(index);
    return [{ type: 'block-end', index, block: { type, text: state.texts.get(index) ?? '' } }];
}
/**
 * Close the most recently opened block of one textual type.
 *
 * The gateway's `reasoning-end` / `text-end` events carry no block id, and
 * `reasoning-end` arrives after `text-start` (the reasoning stream closes once
 * the text stream opens), so the current block index is the wrong block to close.
 */
function closeLatest(state, type) {
    let latest;
    for (const [index, open] of state.openTextual) {
        if (open === type && (latest === undefined || index > latest))
            latest = index;
    }
    return latest === undefined ? [] : closeTextual(state, latest, type);
}
/** The harness usage of a gateway step/finish usage payload, when recognizable. */
function finishUsage(raw) {
    if (!isRecord(raw))
        return undefined;
    const usage = raw;
    const inputDetails = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : undefined;
    const outputDetails = isRecord(usage.outputTokenDetails) ? usage.outputTokenDetails : undefined;
    const cacheRead = inputDetails?.cacheReadTokens;
    const noCache = inputDetails?.noCacheTokens;
    const totalInput = usage.inputTokens;
    const inputTokens = noCache ?? (totalInput !== undefined && cacheRead !== undefined
        ? Math.max(0, totalInput - cacheRead)
        : totalInput) ?? 0;
    const outputTokens = usage.outputTokens ?? outputDetails?.textTokens ?? 0;
    return {
        inputTokens,
        outputTokens,
        ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
        ...outputDetails?.reasoningTokens === undefined ? {} : { reasoningTokens: outputDetails.reasoningTokens },
    };
}
/** Map the gateway finish-reason vocabulary onto the harness `FinishReason`. */
function mapFinishReason(raw) {
    const reason = typeof raw === 'string' ? raw : 'stop';
    switch (reason) {
        case 'stop':
        case 'end_turn':
            return { kind: 'stop' };
        case 'tool_calls':
        case 'tool-calls':
            return { kind: 'tool-calls' };
        case 'length':
        case 'max_tokens':
        case 'max-output-tokens':
            return { kind: 'max-tokens' };
        default:
            return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } };
    }
}
/**
 * Translate one gateway stream event into harness chunks.
 * @param event - one parsed stream line.
 * @param state - the per-stream translation state.
 * @returns the chunks this event produces, possibly none.
 */
export function eventToChunks(event, state) {
    const chunks = [];
    switch (event.type) {
        case 'text-start': {
            state.openTextual.set(state.blockIndex, 'text');
            chunks.push({ type: 'block-start', index: state.blockIndex, blockType: 'text' });
            break;
        }
        case 'text-end': {
            chunks.push(...closeLatest(state, 'text'));
            break;
        }
        case 'text-delta': {
            const text = typeof event.text === 'string' ? event.text : '';
            if (text.length > 0) {
                state.texts.set(state.blockIndex, (state.texts.get(state.blockIndex) ?? '') + text);
                chunks.push({ type: 'text-delta', index: state.blockIndex, text });
            }
            break;
        }
        case 'reasoning-start': {
            state.openTextual.set(state.blockIndex, 'reasoning');
            chunks.push({ type: 'block-start', index: state.blockIndex, blockType: 'reasoning' });
            break;
        }
        case 'reasoning-end': {
            chunks.push(...closeLatest(state, 'reasoning'));
            break;
        }
        case 'reasoning-delta': {
            const text = typeof event.text === 'string' ? event.text : '';
            if (text.length > 0) {
                state.texts.set(state.blockIndex, (state.texts.get(state.blockIndex) ?? '') + text);
                chunks.push({ type: 'reasoning-delta', index: state.blockIndex, text });
            }
            break;
        }
        case 'tool-call': {
            // The gateway emits each tool call as one complete event, so the block
            // opens and closes here — the harness forbids finishing with it open.
            const callId = typeof event.toolCallId === 'string' ? event.toolCallId
                : typeof event.id === 'string' ? event.id : '';
            const name = typeof event.toolName === 'string' ? event.toolName : undefined;
            const raw = event.input ?? event.args ?? event.arguments;
            const declared = name === undefined ? undefined : state.toolSchemas?.get(name);
            const input = declared === undefined ? raw : dropNullArguments(raw, declared);
            const argumentsDelta = JSON.stringify(input ?? {});
            chunks.push({ type: 'block-start', index: state.blockIndex, blockType: 'tool-call' });
            state.toolCalls.set(state.blockIndex, { id: callId, name, arguments: argumentsDelta });
            chunks.push({
                type: 'tool-call-delta',
                index: state.blockIndex,
                id: ToolCallId(callId),
                ...name === undefined ? {} : { name },
                argumentsDelta,
            });
            chunks.push({
                type: 'block-end',
                index: state.blockIndex,
                block: {
                    type: 'tool-call',
                    id: ToolCallId(callId),
                    name: name ?? '',
                    arguments: argumentsDelta,
                },
            });
            state.toolCalls.delete(state.blockIndex);
            break;
        }
        // A step ends with `finish-step` carrying the step usage; the turn closes
        // with a bare `finish` carrying the total. Only `finish` terminates, and
        // usage is emitted once.
        case 'finish-step':
        case 'finish': {
            if (!state.usageSeen) {
                const usage = finishUsage(event.usage ?? event.totalUsage);
                if (usage !== undefined) {
                    state.usageSeen = true;
                    chunks.push({ type: 'usage', usage });
                }
            }
            if (event.type === 'finish') {
                // A truncated stream may skip `reasoning-end` / `text-end`; the harness
                // forbids finishing with a block open.
                for (const [index, type] of [...state.openTextual]) {
                    chunks.push(...closeTextual(state, index, type));
                }
                state.toolCalls.clear();
                chunks.push({ type: 'finish', reason: mapFinishReason(event.finishReason ?? event.rawFinishReason) });
            }
            break;
        }
        default:
            break;
    }
    return chunks;
}
function parseEventLine(line) {
    if (line.length === 0 || line.startsWith(':'))
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return undefined;
    }
    return isRecord(parsed) && typeof parsed.type === 'string' ? parsed : undefined;
}
/**
 * Parse the gateway's line-delimited JSON byte stream into events.
 * @param stream - the response body.
 * @returns the events, in arrival order.
 */
export async function* parseEventStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (!done && value !== undefined)
                buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                const event = parseEventLine(line);
                if (event !== undefined)
                    yield event;
                newline = buffer.indexOf('\n');
            }
            if (done) {
                const event = parseEventLine(buffer.trim());
                if (event !== undefined)
                    yield event;
                return;
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
/** Upstream body budget carried into one error message. */
const MAX_ERROR_BODY_CHARS = 4000;
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
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
export function gatewayErrorDetail(body) {
    const trimmed = body.trim();
    if (trimmed.length === 0)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return trimmed.slice(0, MAX_ERROR_BODY_CHARS);
    }
    const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed;
    const message = isRecord(envelope)
        ? nonEmptyString(envelope.message) ?? nonEmptyString(envelope.detail) ?? nonEmptyString(envelope.code)
        : undefined;
    return (message ?? trimmed).slice(0, MAX_ERROR_BODY_CHARS);
}
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
export function streamErrorDetail(event) {
    const error = isRecord(event.error) ? event.error : event;
    const body = nonEmptyString(error.responseBody);
    const message = nonEmptyString(error.message)
        ?? (body === undefined ? undefined : gatewayErrorDetail(body))
        ?? JSON.stringify(event);
    const status = typeof error.statusCode === 'number' && Number.isInteger(error.statusCode)
        ? error.statusCode
        : undefined;
    const detail = body === undefined || message.includes(body) ? message : `${message}: ${body}`;
    return {
        detail: detail.slice(0, MAX_ERROR_BODY_CHARS),
        ...status === undefined ? {} : { status },
    };
}
