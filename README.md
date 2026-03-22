# Ramatra (Comfy Bridge)

Local-first chat + image generation app built around:

- Next.js (App Router UI + API routes)
- LM Studio native REST chat (`/api/v1/chat`)
- ComfyUI (generation backend)
- MCP tool integrations
- SQLite persistence for threads, tasks, and generations

This project is optimized for:

- persistent threaded chat with `previous_response_id`
- queued task-group orchestration
- streaming chat + streaming image progress
- prompt modes and mood overlays
- chained utility-task workflows for image generation

## Table of Contents

- Architecture Overview
- Project Structure
- Task System
- Chat Pipeline
- Critique Pipeline
- Utility Task Chaining
- Image Generation Pipeline
- Integrations and MCP
- Data Model
- Environment Variables
- Setup and Run
- API Surface
- Troubleshooting

## Architecture Overview

High-level layers:

1. **UI + API layer** (`app/`, `components/`)
2. **Domain/application orchestration** (`lib/tasks/`, `lib/tasks/chat/`)
3. **Infrastructure adapters** (`lib/tasks/chat/adapters/`, `lib/lmstudio/`, `lib/comfy/`)
4. **Persistence** (`lib/db.ts`, task/thread stores)

Execution model:

1. API route enqueues a **task group** (`chat` or `comfy`).
2. Task processor pulls next runnable group/task based on scheduler state.
3. Runner executes each task kind.
4. SSE streams events back to UI (`/api/chat/task/:taskId/events`, `/api/comfy/task/:taskId/events`).
5. Results persist into SQLite-backed stores.

## Project Structure

Top-level:

- `app/`
  - Next.js pages and API routes (`/api/chat`, `/api/chat/critique`, `/api/comfy/*`, `/api/threads/*`, `/api/system/*`)
- `components/`
  - Chat UI, image blocks, stream-bound components
- `lib/`
  - All runtime logic
- `mcp/`
  - Local MCP servers/wrappers

Core `lib/` domains:

- `lib/lmstudio/`
  - model loading/routing, prompt modes, moods, summaries, title generation, util-task settings
- `lib/comfy/`
  - workflow builders, LoRA listing/selection helpers, generation persistence, Comfy client/runner glue
- `lib/tasks/`
  - scheduler, queue processor, GPU mode manager, event bus, task runners
- `lib/tasks/chat/`
  - refactored chat runtime with layered handlers, policies, util command chain logic, adapters
- `lib/chat/`
  - message content normalization and chat markers (context compaction / critique markers)

### `lib/tasks/chat/` map

- `execute.ts`
  - chat runner entrypoint used by `lib/tasks/chat-runner.ts`
- `adapters/`
  - thin boundaries around task store/thread store/lmstudio request paths
- `handlers/`
  - task-kind and pipeline handlers (conversation, critique, intent, stream stages)
- `input/`
  - LM Studio input builders (conversation + critique)
- `prompt/`
  - prompt composition and mode-specific system prompt building
- `policies/`
  - stop conditions, context budget checks, sampling/request shaping rules
- `util/`
  - util command parsing, normalization, chain continuation and policy checks
- `stream/`
  - stream event helpers/reducers
- `contracts/`
  - lightweight contract tests for key pure behaviors

## Task System

Task groups (`lib/tasks/types.ts`):

- `chat`
- `comfy`

Task kinds:

- chat:
  - `chat.generate`
  - `chat.stream`
  - `chat.intent`
  - `chat.unbiased_critique`
  - `chat.biased_critique`
  - `chat.compact`
  - `chat.title`
- image:
  - `image.generate`
  - `image.stream`

Chat payload kinds:

- `conversation`
- `critique`
- `update_intent`
- `generate_title`
- `collapse_context`

Default group task composition is injected by scheduler:

- `conversation` -> `chat.generate` + `chat.stream`
- `critique` -> `chat.unbiased_critique` + `chat.biased_critique` + `chat.stream`
- `update_intent` -> `chat.intent`
- `generate_title` -> `chat.title`
- `collapse_context` -> `chat.compact`

## Chat Pipeline

Primary request route: `POST /api/chat`

Flow:

1. Validate request and ensure thread exists.
2. Persist latest user message (server-owned).
3. Enqueue `conversation` chat task group.
4. Optionally enqueue `update_intent` (non-regenerate path).
5. Task processor runs:
   - `chat.generate` prepares LM request and opens stream
   - `chat.stream` consumes stream deltas and forwards SSE events
6. Final assistant text/reasoning persisted.
7. `lmstudioResponseId`/model instance metadata updated on thread.

Overflow/near-limit handling:

- projection and stop-policy detect near-context-limit
- compaction tasks can be enqueued
- continuation groups are delegated with carry-over text/reasoning markers

## Critique Pipeline

Route: `POST /api/chat/critique`

Flow:

1. Enqueue `critique` chat group.
2. Execute `chat.unbiased_critique`.
3. Execute `chat.biased_critique`.
4. Execute `chat.stream` as stream bridge/output channel.
5. If biased output emits util command block, same task group continues with util chain tasks.

Important:

- critique tasks run through chat stream channel for live UI updates
- critique task MCP exposure is controlled per-task/mode integration policy

## Utility Task Chaining

Command protocol supported by parser:

- bracket block form:
  - `[[util_task]] ... [[/util_task]]`
  - tags supported: `@persistent`, `@stateless`
- inline form:
  - `[[util_task:stage|context_text=...]]`
- legacy JSON signal form is still parseable where present

Chain behavior:

1. `chat.stream` parser extracts command.
2. policy checks enforce depth/nonce/enqueue constraints.
3. util-task setting is loaded from DB-configured util tasks.
4. system prompt extension and (optionally) compact history snapshot are composed.
5. group tasks are transitioned and continued in the same chat task group.

Flags:

- `@persistent`
  - util execution behaves as persistent conversation result
- `@stateless`
  - util execution omits snapshot/user-message seed injection for that stage

## Image Generation Pipeline

Comfy task flow:

1. `image.generate` creates/queues Comfy job with selected workflow params.
2. `image.stream` watches progress and emits updates.
3. Completed images persisted to `.data/comfy-results/`.
4. generation metadata and image references stored in SQLite tables.

Workflow support:

- `base`
- `illustration`
- `edit`

LoRA listing:

- exposed through tooling and filtered by workflow mapping
- uses configured Comfy LoRA root directory

## Integrations and MCP

Per-mode integration policy (`lib/tasks/chat/integrations.ts`):

- `Fast`: none
- `Regular`: web search (if enabled)
- `Writer`: web search (if enabled)
- `Artist`: Comfy + optional Civitai

Util tasks can override MCP availability per util stage (`utilMcpServers`).

Comfy MCP:

- local server in repo (`mcp/comfy/`)
- supports generation/listing helpers used by artist pipeline

External wrappers:

- `mcp/external/web-search.ts`
- `mcp/external/civitai.ts`
- `mcp/memory/server.ts`

## Data Model

SQLite schema is initialized in `lib/db.ts`.

Main tables:

- `threads`
- `messages`
- `tasks`
- `comfy_generations`
- `comfy_generation_images`

Thread state stores:

- `lmstudio_response_id`
- `lmstudio_model_instance_id`
- `last_prompt_mode`
- conversation summary counters
- context usage counters
- `user_intent`

## Environment Variables

Minimum:

```env
LM_STUDIO_BASE_URL=http://127.0.0.1:1234
LM_STUDIO_MODEL=your-loaded-model-id

COMFY_BASE_URL=http://127.0.0.1:8188
COMFY_MCP_PORT=4000
COMFY_LORA_DIR=E:\path\to\ComfyUI\models\loras
```

Mode context lengths:

```env
LM_STUDIO_CONTEXT_LENGTH_FAST=4096
LM_STUDIO_CONTEXT_LENGTH_REGULAR=16384
LM_STUDIO_CONTEXT_LENGTH_ARTIST=16384
LM_STUDIO_CONTEXT_LENGTH_WRITER=65536
```

Optional:

- `LM_STUDIO_TOKEN`
- `LM_STUDIO_AUTO_SUMMARY`
- `LM_STUDIO_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT`
- `LM_STUDIO_REDUNDANT_MODELS`
- `LM_STUDIO_KEEP_MODELS`
- `LM_STUDIO_DEBUG_MODEL_ROUTING`
- MCP wrapper envs for web search / Civitai
- MCP wrapper envs for memory server:
  - `MEMORY_MCP_ENABLED=true`
  - `MEMORY_MCP_URL=http://127.0.0.1:9558/mcp`
  - `MEMORY_MCP_PORT=9558`
  - `MEMORY_FILE_PATH=.data/memory/memory.jsonl`

## Setup and Run

Install:

```bash
pnpm install
```

Run app:

```bash
pnpm dev
```

Run app + MCP wrappers:

```bash
pnpm run dev:all
```

Individual MCP:

```bash
pnpm run mcp:comfy
pnpm run mcp:web-search
pnpm run mcp:civitai
pnpm run mcp:memory
```

## API Surface

Chat:

- `POST /api/chat`
- `GET /api/chat/task/:taskId/events`
- `POST /api/chat/critique`

Threads:

- `GET /api/threads`
- `GET /api/threads/:threadId`
- `PATCH /api/threads/:threadId`
- `POST /api/threads/:threadId/collapse-context`
- `POST /api/threads/:threadId/title`

Comfy:

- `GET /api/comfy/task/:taskId`
- `GET /api/comfy/task/:taskId/events`
- `GET /api/comfy/result/:jobId`

System:

- `GET /api/system/state`
- `POST /api/system/unpause`

## Troubleshooting

If you see repeated `chat.intent`:

- ensure dispatch registry maps `chat.intent` to intent handler only
- clear stale queued tasks created before recent fixes

If util chains stop unexpectedly:

- check command parser logs (`util-command:*`)
- check depth/enqueue policy limits
- confirm util task name exists/enabled in DB settings

If chat stream ends too early:

- verify stream task remains pending/running during util chain continuation
- check `chat.stream` event output in task logs

If image progress is missing:

- verify Comfy websocket reachability
- verify `/api/comfy/task/:taskId/events` stream

## Scripts

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "mcp:comfy": "tsx mcp/comfy/index.ts",
  "mcp:web-search": "tsx mcp/external/web-search.ts",
  "mcp:civitai": "tsx mcp/external/civitai.ts",
  "mcp:memory": "tsx mcp/memory/index.ts",
  "dev:all": "concurrently \"pnpm run mcp:comfy\" \"pnpm run mcp:web-search\" \"pnpm run mcp:civitai\" \"pnpm run mcp:memory\" \"pnpm run dev\""
}
```


