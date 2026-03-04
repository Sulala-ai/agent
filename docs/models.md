# AI model IDs reference

Use these `model` values when calling the orchestrator `complete({ provider, model, messages })` or set defaults via env (e.g. `AI_CLAUDE_DEFAULT_MODEL`, `AI_OPENAI_DEFAULT_MODEL`, `AI_GEMINI_DEFAULT_MODEL`).

---

## Claude (Anthropic)

| Description | Use for |
|-------------|--------|
| **Claude Opus 4.6** | Most capable; coding, agents, complex reasoning |
| **Claude Sonnet 4.6** | Best speed/intelligence balance |
| **Claude Haiku 4.5** | Fastest; near-frontier at lower cost |

Set `provider: 'claude'` and pass one of the model IDs below. Default (when no model given) is set by `AI_CLAUDE_DEFAULT_MODEL` or the adapter default.

- **Opus 4.6** — `claude-opus-4-6` (Claude API ID / alias).
- **Sonnet 4.6** — `claude-sonnet-4-6` (default).
- **Haiku 4.5** — `claude-haiku-4-5` (alias) or `claude-haiku-4-5-20251001` (full API ID).

Legacy (see [Anthropic model deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations)): older snapshot IDs may be retired; prefer the aliases above.

---

## OpenAI

| Model ID | Description |
|----------|-------------|
| `gpt-5.2` | Best for coding and agentic tasks |
| `gpt-5-mini` | Faster, cost-efficient |
| `gpt-5-nano` | Fastest, most cost-efficient |
| `gpt-5.2-pro` | Smarter, more precise GPT-5.2 |
| `gpt-4o-mini` | Fast, affordable small model |
| `gpt-4.1` | Smart non-reasoning model |

Set `provider: 'openai'`. Default when no model given: `AI_OPENAI_DEFAULT_MODEL` or `gpt-4o-mini`.

---

## OpenRouter

Unified API for many models (OpenAI, Anthropic, Google, etc.) via one key and endpoint. Set `provider: 'openrouter'` and use model IDs like `openai/gpt-5.2`, `anthropic/claude-sonnet-4`, `google/gemini-2.5-flash`. Env: `OPENROUTER_API_KEY`. Default: `AI_OPENROUTER_DEFAULT_MODEL` or `openai/gpt-4o-mini`. See [OpenRouter models](https://openrouter.ai/docs/features/model-ids) and [quickstart](https://openrouter.ai/docs/quickstart). Streaming and tool calls are supported.

---

## Gemini (Google)

| Model ID | Description |
|----------|-------------|
| `gemini-3.1-pro-preview` | Advanced intelligence, agentic & coding (preview) |
| `gemini-3-flash-preview` | Frontier performance, lower cost (preview) |
| `gemini-2.5-flash` | Best price/performance, reasoning |
| `gemini-2.5-pro` | Most advanced, deep reasoning & coding |
| `gemini-2.5-flash-lite` | Fastest, budget-friendly in 2.5 family |

Set `provider: 'gemini'`. Env: `GOOGLE_GEMINI_API_KEY` or `GEMINI_API_KEY`. Default model: `AI_GEMINI_DEFAULT_MODEL` or `gemini-2.5-flash`.

---

## Ollama (local)

Use `provider: 'ollama'` or `'llama'`. Model IDs depend on what you run locally (e.g. `llama3.2`, `mistral`, `codellama`). Default: `AI_OLLAMA_DEFAULT_MODEL` or `llama3.2`.

---

## Env summary

| Env | Purpose |
|-----|---------|
| `AI_DEFAULT_PROVIDER` | Default provider: `ollama` (local, no API key). Or `openai`, `openrouter`, `claude`, `gemini` |
| `AI_OPENAI_DEFAULT_MODEL` | Default OpenAI model ID |
| `AI_OPENROUTER_DEFAULT_MODEL` | Default OpenRouter model ID (e.g. `openai/gpt-4o-mini`) |
| `AI_CLAUDE_DEFAULT_MODEL` | Default Claude model ID |
| `AI_GEMINI_DEFAULT_MODEL` | Default Gemini model ID |
| `AI_OLLAMA_DEFAULT_MODEL` | Default Ollama model name |
