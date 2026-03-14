# Ramatra

Local chat + image generation app built on:

- Next.js
- LM Studio native `/api/v1/chat`
- ComfyUI
- MCP integrations
- SQLite thread persistence

It supports:

- stateful LM Studio chat via `previous_response_id`
- server-owned thread/message persistence
- queued chat and image tasks
- streamed chat responses
- streamed Comfy progress
- prompt modes (`Fast`, `Regular`, `Writer`, `Artist`)
- Comfy image generation through MCP
- optional web search MCP
- optional Civitai MCP

## Architecture

Main pieces:

- `app/`
  Next.js routes and UI
- `components/chat/`
  chat UI, runtime wiring, history provider
- `lib/tasks/`
  scheduler, task store, runners, GPU manager
- `lib/comfy/`
  Comfy client, workflow builders, generation persistence
- `lib/lmstudio/`
  prompts, summaries, thread persistence helpers
- `mcp/comfy/`
  local MCP server exposing Comfy-related tools
- `mcp/external/`
  wrappers for external MCP servers such as web search and Civitai

Execution model:

- chat requests go to `/api/chat`
- server ensures a thread exists and persists the user message
- a `chat` task group is enqueued
- chat task group executes ordered tasks (`chat.generate` then `chat.stream`)
- `chat.generate` opens LM Studio stream, `chat.stream` forwards events to client
- on overflow/near-limit, scheduler delegates to follow-up task groups:
  - `chat.compact`
  - continuation `chat.generate` + transferred `chat.stream`
- assistant reply and `lmstudioResponseId` are persisted on the same thread
- image generation uses queued `comfy` task groups (`image.generate` + `image.stream`)
- Comfy progress is pushed to the client through SSE

## Required Components

Minimum required services:

1. LM Studio
2. ComfyUI
3. This Next.js app
4. Local Comfy MCP server from this repo

Optional services:

1. Web search MCP
2. Civitai MCP

## Requirements

- Node.js 20+
- pnpm
- LM Studio running locally
- ComfyUI running locally

Optional:

- local web-search MCP repo with HTTP support
- local `civitai-mcp-server`

## Installation

```bash
pnpm install
```

## Environment

Create `.env.local`.

Minimum useful configuration:

```env
LM_STUDIO_BASE_URL=http://127.0.0.1:1234
LM_STUDIO_MODEL=your-loaded-model-id

COMFY_BASE_URL=http://127.0.0.1:8188
COMFY_MCP_PORT=4000
COMFY_LORA_DIR=E:\path\to\ComfyUI\models\loras
```

Optional LM Studio auth:

```env
LM_STUDIO_TOKEN=
```

Optional per-mode context lengths:

```env
LM_STUDIO_CONTEXT_LENGTH_FAST=4096
LM_STUDIO_CONTEXT_LENGTH_REGULAR=16384
LM_STUDIO_CONTEXT_LENGTH_ARTIST=16384
LM_STUDIO_CONTEXT_LENGTH_WRITER=65536
```

Optional auto-summary:

```env
LM_STUDIO_AUTO_SUMMARY=false
```

Optional context projection tuning (useful with image-heavy threads):

```env
LM_STUDIO_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT=1024
```

Optional redundant-model cleanup after each chat task:

```env
LM_STUDIO_REDUNDANT_MODELS=
LM_STUDIO_KEEP_MODELS=
LM_STUDIO_DEBUG_MODEL_ROUTING=false
```

Notes:

- cleanup runs automatically after every chat task
- extra loaded instances of `LM_STUDIO_MODEL` are automatically unloaded, so the active chat model is reduced to one instance by default
- `LM_STUDIO_REDUNDANT_MODELS` is a comma-separated list of model keys or instance ids to unload.
- `*` wildcards are supported, for example `qwen2.5-vl-*`.
- `LM_STUDIO_KEEP_MODELS` is a comma-separated allowlist checked before unload.
- one instance of `LM_STUDIO_MODEL` is always protected automatically, so the active chat model stays loaded.
- for future speculative decoding, keep the draft model out of `LM_STUDIO_REDUNDANT_MODELS` or add it to `LM_STUDIO_KEEP_MODELS`.
- set `LM_STUDIO_DEBUG_MODEL_ROUTING=true` to log loaded instances, selected target, LM Studio `model_instance_id`, and cleanup results to the server console.

Optional web search MCP:

```env
WEB_SEARCH_MCP_ENABLED=true
WEB_SEARCH_MCP_URL=http://127.0.0.1:9556/mcp
WEB_SEARCH_MCP_WORKDIR=E:\development\ai\web-search-mcp
WEB_SEARCH_MCP_START_CMD=pnpm
WEB_SEARCH_MCP_START_ARGS=start:http
```

Optional Civitai MCP:

```env
CIVITAI_MCP_ENABLED=true
CIVITAI_MCP_URL=http://127.0.0.1:9557/mcp
CIVITAI_MCP_WORKDIR=E:\development\ai\civitai-mcp-server
CIVITAI_MCP_START_CMD=pnpm
CIVITAI_MCP_START_ARGS=start:http
CIVITAI_API_KEY=your_civitai_api_key
```

## Running

Run only the app:

```bash
pnpm dev
```

Run app + local MCP wrappers:

```bash
pnpm run dev:all
```

Individual MCP processes:

```bash
pnpm run mcp:comfy
pnpm run mcp:web-search
pnpm run mcp:civitai
```

Open:

```text
http://localhost:3000
```

## LM Studio Setup

This app uses LM Studio native REST chat, not the OpenAI-compatible endpoint.

Requirements:

- LM Studio server must be running
- your chat model must be loaded in LM Studio
- `LM_STUDIO_BASE_URL` must point at the LM Studio server root

The app calls:

- `/api/v1/chat`

It relies on:

- `previous_response_id`
- `integrations` for MCP tools
- SSE chat streaming

## ComfyUI Setup

Requirements:

- ComfyUI must be reachable at `COMFY_BASE_URL`
- your workflows must exist in the repo under `lib/comfy/workflows/`
- LoRAs must live in `COMFY_LORA_DIR`
- LoRA discovery scans only statically configured subfolders under `COMFY_LORA_DIR` (currently: `illustr_style`)

Current workflow support includes:

- `base`
- `illustration`

The app persists completed generations under:

- `.data/comfy-results/`

and generation metadata in SQLite.

## MCP Setup

### Comfy MCP

Provided by this repo:

- `pnpm run mcp:comfy`

Used by LM Studio through:

- `COMFY_MCP_URL`
or
- `COMFY_MCP_PORT`

### Web Search MCP

Managed through:

- `pnpm run mcp:web-search`

This wrapper only starts the external MCP process. You need a separate local repo with HTTP MCP support.

### Civitai MCP

Managed through:

- `pnpm run mcp:civitai`

This wrapper forwards `CIVITAI_API_KEY` to the child process.

## Prompt Modes

Available modes:

- `Fast`
- `Regular`
- `Writer`
- `Artist`

Notes:

- MCP mapping by mode:
  - `Fast`: no MCP integrations
  - `Regular`: web search MCP only (if enabled)
  - `Writer`: web search MCP only (if enabled)
  - `Artist`: Comfy MCP + optional Civitai MCP

## Thread Persistence

Threads are stored in SQLite.

Each thread can store:

- messages
- `lmstudioResponseId`
- `lastPromptMode`
- optional conversation summary state

Important detail:

- thread creation and chat persistence are server-owned through `/api/chat`
- assistant messages are persisted by the chat runner

## Task System

The app uses a shared task runtime.

Task group types:

- `chat`
- `comfy`

Features:

- queued task-group execution
- ordered execution of tasks inside a group
- streamed progress updates
- scheduler-owned model/GPU transitions at task-group level
- SSE task event routes

Chat task kinds:

- `chat.generate`
- `chat.stream`
- `chat.compact`
- `chat.title`

Image task kinds:

- `image.generate`
- `image.stream`

## Useful Routes

Chat:

- `POST /api/chat`
- `GET /api/chat/task/:taskId/events`

Threads:

- `GET /api/threads`
- `GET /api/threads/:threadId`
- `PATCH /api/threads/:threadId`
- `POST /api/threads/:threadId/collapse-context`

Comfy tasks:

- `GET /api/comfy/task/:taskId`
- `GET /api/comfy/task/:taskId/events`
- `GET /api/comfy/result/:jobId`

System:

- `GET /api/system/state`
- `POST /api/system/unpause`

## Development Notes

- markdown rendering is handled through assistant-ui markdown support
- chat and image updates are streamed to the UI with SSE
- summaries are currently intended for manual collapse first; auto-summary can be enabled with env later

## Troubleshooting

If chat responses lose context:

- check `/api/chat` payload includes the expected `threadId`
- check the thread row in `/api/threads/:threadId`
- confirm `lmstudioResponseId` is non-null after the first assistant reply

If image progress does not update:

- confirm ComfyUI websocket connectivity
- confirm `/api/comfy/task/:taskId/events` is streaming

If an external MCP wrapper exits immediately:

- verify the relevant `*_MCP_ENABLED=true`
- verify `*_MCP_WORKDIR`
- verify the start command works directly in that external repo

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
  "dev:all": "concurrently \"pnpm run mcp:comfy\" \"pnpm run mcp:web-search\" \"pnpm run mcp:civitai\" \"pnpm run dev\""
}
```
