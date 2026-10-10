# dsh-commandcode-plans-provider

[中文](README.md) · [Third-party notices](THIRD-PARTY-NOTICES.md)

Use the models in your **Command Code subscription** (Go / GOAT / Pro / Max) directly from **DeepSeek Harness (dsh)** — **no Command Code CLI required**, and no Provider API either.

- **Live model catalog**: fetched at startup, filtered by plan tier, **hides no model by default**
- **Context capacity in the model name**: `Claude Sonnet 5.5 [1M]`, `GPT-5.5 [400K]`, `Kimi K2.7 Code [256K]`
- **Per-model reasoning levels**: only the efforts that model actually accepts
- **Visual API key setup**: paste and save in the plugin card, no config file editing
- **Usage ring in the composer dock**: 5-hour window plus reset countdown (turns red at ≥90%), click to expand the weekly window and balance
- **Image input, tool calls, streaming**

---

## Why this plugin exists

Command Code sells two different things:

| Kind | How you call it |
| --- | --- |
| **Provider API** plans | A standard OpenAI-compatible endpoint, which dsh already supports — **this plugin is not needed** |
| **Go / GOAT / Pro / Max subscriptions** | The OpenAI-compatible endpoints answer `403 upgrade_required`; the only usable endpoint is the **private CLI gateway** `POST /alpha/generate` |

This plugin speaks that gateway's protocol — request envelope, line-delimited JSON stream, event mapping — and exposes the subscription as a native dsh provider.

**So nothing extra has to be installed**: the gateway is plain HTTP + JSON, and the official CLI is merely one of its clients.

---

## Install

```sh
dsh plugin --profile web add github:freeqin123/dsh-commandcode-plans-provider
```

> If you get `ERR_PNPM_ADDING_TO_ROOT`, your profile directory is a pnpm workspace — add `-w`:
>
> ```sh
> dsh plugin --profile web add -w github:freeqin123/dsh-commandcode-plans-provider
> ```

**Restart dsh** afterwards. The plugin appears in the plugin list (bundle id `commandcode-plans-provider`).

---

## Configure the API key

In dsh, go to **Plugins → this plugin → Configure**:

```
API Key    [paste your key]                   [Save] [Clear]
           ● stored (source: file) · user_xxxx…ABCD

Plan tier  ( Go ) ( GOAT ) ( Pro ) ( ●Max )
           shows this tier and every cheaper one

           [Test connection]   gateway reachable · 5h 0%
```

Worth knowing:

- The key goes into dsh's **credential store** (reference name `COMMANDCODE_API_KEY`), not into a settings document.
- **No read path returns the secret** — that is by design in dsh's credential service (*"Secret values cross in one direction only"*). The card therefore shows a **masked hint** (`user_xxxx…ABCD`) so you can tell *which* key is in use, without the key itself ever being displayed.
- **Test connection** really calls the billing endpoint with your key, and reports the upstream text on failure (for example `401` for a revoked key).
- You can skip the UI entirely: put `COMMANDCODE_API_KEY` into `~/.dsh/.credentials.yaml`, or export it as an environment variable.

---

## Usage

### 1. Pick a model

**Settings → Models → Command Code**, then choose one. The `[1M]` suffix is that model's real context capacity, taken from the listing endpoint's `context_length` (a genuine per-model value, not a constant).

### 2. Pick a plan tier

Use the tier buttons in the plugin card. The meaning is "**show this tier and every cheaper one**":

| Tier | Shows |
| --- | --- |
| Go | all Go models |
| GOAT | all Go + GOAT models |
| Pro | all Go + GOAT + Pro models |
| **Max (default)** | everything the catalog credits with a known tier |

**Default `max` plus "unknown-tier models stay visible" together mean nothing is hidden out of the box.**

This is deliberate: several similar plugins default to `go`, which leaves a GOAT subscriber unable to see models they paid for.

### 3. Reasoning levels

The "Reasoning effort" control in the model picker is filled in **per model** by this plugin, listing the efforts that model actually accepts (from the official CLI catalog's `Efforts` column, e.g. `Low / Medium / High / X-High / Max`).

There is also `Off`, which means **do not send** `reasoning_effort` at all — let the model decide.

A model the catalog leaves blank shows "no reasoning levels for this model", which is the truthful answer.

### 4. Usage

A ring appears in the composer dock:

```
Command Code ◯ 34%  2h13m
```

- The ring is the **5-hour window** utilisation.
- It **turns red at ≥90%**, so you see a nearly-exhausted window early.
- The trailing value is the **reset countdown**.
- **Click it** to expand: 5-hour window, weekly window, balance, each with used value and cap.

> Note: when the 5-hour window is at 0% the ring is an empty circle. That is correct, not broken.

### 5. Images

Vision-capable models accept pasted images directly.

Per the official CLI's own classification, **DeepSeek / GLM / Qwen / MiniMax / Grok 4.6 and others are text-only**; sending them an image is **refused explicitly** rather than dropped silently — a silently dropped image makes you think the model is being dumb. Switch to a model like Claude or Grok 4.5 instead.

Two design facts about images:

1. **The gateway is stateless**: it stores no images and offers no upload endpoint, so **every retained image is re-inlined on every request** (the official CLI behaves the same way). The same image therefore costs again on turn 3.
2. **There is a total budget**: when the inlined base64 for one request exceeds `maxRequestImageBytes` (2 MiB by default) the plugin **does not send the request**; it asks dsh to offload the **oldest** images first and then retries. No image is ever dropped without a durable decision.

---

## Known limitations

- **Undocumented endpoint**: `/alpha/generate` is Command Code's private gateway and may change or be blocked at any time. This project is not affiliated with Command Code.
- **A subscription is required**: without one, the Provider API path already covers you and this plugin is pointless.
- **Single account**: multiple accounts in parallel are not supported.
- **No automatic retry yet**: `RATE_LIMIT` is surfaced as an error rather than retried with backoff (Cloudflare rate-limits concurrent traffic in front of the gateway, so several sessions can hit it).
- **Images are re-inlined every turn**: see above; image-heavy long conversations cost noticeably more.

---

## Troubleshooting

| Symptom | Look first at |
| --- | --- |
| The dock ring stays `—` | host log lines starting with `[commandcode-plans-provider]` |
| Empty model list | the scan result in the log. A failed listing **keeps the previous catalog** instead of emptying it |
| `401` | the key was revoked — paste a new one |
| `403 upgrade_required` | a stale version header. The plugin invalidates its cache and retries once; if it still fails, please open an issue |
| `RATE_LIMIT` | gateway rate limiting — try again later |
| Image refused | that model is text-only per the official classification; pick a vision-capable one |
| `Command Code 对话接入尚未完成` | dsh was not restarted — host-side changes only take effect on a process restart |

Logs live in `~/.dsh/logs/`, or simply watch the terminal you started dsh from.

---

## Development

```sh
npm install
npm run verify   # typecheck + build + three smoke suites
```

```
src/                host half
  index.ts            config, catalog scan, rescan timer, provider/adapter/usage registration
  catalog.ts          dual-source catalog, tier policy, image capability, context labels
  plan-tier.ts        tier definitions and planId mapping
  protocol.ts         /alpha/generate envelope, line-delimited JSON, event → StreamChunk
  adapter.ts          the LlmAdapter (listModels / resolveModel / stream)
  cli-version.ts      dynamic x-command-code-version (cache, fallback, stale retry)
  usage.ts            usage and limits endpoints
  remote.ts           the Remote service controller
  typert.ts           registers the namespace with the Typert registry
client/index.js     browser half: the usage ring and the configuration card
scripts/            three offline smoke suites (client load / catalog parse / protocol mapping)
```

**`lib/` is committed on purpose** — dsh loads `lib/index.js` directly and a `github:` install does not run a build. Run `npm run build` before committing source changes.

The three smoke suites need no network, and they cover contracts that really do break: whether the browser half loads at all (one bad commit once took the whole Web UI down), whether plan tiers survive a reordered catalog table, and the block/usage invariants of the stream mapping.

---

## Credit

The protocol layer derives from **[brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider)** (MIT, Copyright © 2026 Brent Weatherall), a project that implements the same capability for opencode.

This project is a rewrite of it for dsh: the request envelope shape, the line-delimited JSON event mapping, the tool-call and image conversion rules, and the text-only model list all follow its contract. As MIT requires, the upstream notice is preserved in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## License

[MIT](LICENSE)
