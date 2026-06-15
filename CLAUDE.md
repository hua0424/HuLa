# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> A near-identical copy of the project conventions also lives in `.rules` and `AGENTS.md` (consumed by other agents). Do **not** edit `.rules` unless explicitly asked. If you change conventions here, keep those two in sync.

## Overview

HuLa is a modern, cross-platform Instant Messaging (IM) client. The application container is **Tauri v2** (Rust backend), the UI is **Vue 3 + TypeScript** built with **Vite 7**. It is a git submodule of the `aichatoverview` umbrella repo and talks to HuLa-Server (`/server`) over HTTP + WebSocket.

Targets: **Desktop** (Windows, macOS, Linux), **Mobile** (Android, iOS), and **Web** (browser build via `TAURI_ENV_PLATFORM=web`).

## Tech Stack

**Frontend:** Vue 3 (Composition API, `<script setup>`), TypeScript, Vite 7, Pinia (with persistence), Vue Router, UnoCSS + Sass, Naive UI (desktop) / Vant (mobile), vue-i18n.

**Backend (Rust / Tauri v2):** Tokio async runtime, Reqwest (HTTP to HuLa-Server), `tokio-tungstenite` (WebSocket), Rodio (audio), and **SeaORM over SQLite** for the local store (`tauri-plugin-sql` + `libsqlite3-sys` bundled). Note: the local SQLite DB is **not** currently encrypted — there is no SQLCipher / `PRAGMA key` in the build, despite older docs implying otherwise.

## Development Workflow

### Prerequisites (hard-enforced by `scripts/check-dependencies.js` on `pnpm install`)

- Node.js `^20.19.0 || >=22.12.0`
- pnpm `>=10`
- Rust `>=1.88.0` (Cargo workspace uses `edition = "2024"`, which needs ≥1.85; the check requires ≥1.88). Update with `rustup update stable`.
- Android Studio / Xcode for mobile builds.

If the check fails the install aborts. On Linux, Tauri also needs system libs: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libasound2-dev`, `libssl-dev`.

### Key commands

| Action | Command | Notes |
|---|---|---|
| Install deps | `pnpm install` | Runs the version check + auto-generates `src-tauri/configuration/local.yaml` from `production.yaml` |
| Desktop dev | `pnpm tauri:dev` (`pnpm td`) | Compiles Rust + launches the Tauri webview |
| Frontend-only dev | `pnpm dev` | Vite on port **5210** (blank in a plain browser — needs the Tauri runtime) |
| Web target dev/build | `pnpm web:dev` / `pnpm web:build` | `TAURI_ENV_PLATFORM=web` |
| Mobile dev | `pnpm adev` (android) / `pnpm idev` (ios) | |
| Build desktop | `pnpm tauri:build` (`pnpm tb`) | Interactive (`scripts/interactive-build-inquirer.js`) |
| Lint/format check | `pnpm check` | Biome, read-only |
| Auto-fix | `pnpm check:write` / `pnpm format:all` | Biome (+ Prettier for `.vue` via `format:vue`) |
| Tests | `pnpm test:run` (`test:ui`, `coverage`) | Vitest — currently no test files exist |
| Commit | `pnpm commit` | Commitizen, enforces Conventional Commits |

First `pnpm tauri:dev` does a full Rust compile (~2–4 min); later runs are incremental. `.npmrc` defaults to a Huawei Cloud mirror — if unreachable: `pnpm config set registry https://registry.npmjs.org/`.

## Coding Style & Conventions

- 2-space indent, LF, trim whitespace (`.editorconfig`). Format/lint with Biome; Vue templates also via Prettier.
- Import aliases (defined in `vite.config.ts`): `@` → `src/`, `#` → `src/mobile/`, `~` → repo root.
- Naming: components `PascalCase.vue`, composables `useXxx.ts`, Pinia stores in `src/stores/`.
- Prefer Composition API `<script setup>` and UnoCSS utility classes.
- **Do not** prefix unused variables with `_` — delete them. **Do not** use emojis in commits, logs, or docs.
- Reply in the language the user asked in (e.g. Simplified Chinese question → Simplified Chinese answer).

### Automated UI test hooks (`data-testid` / `aria-label`)

The Windows tester drives the desktop client via playwright-cli over CDP and **locates elements by `data-testid`** — never by visible text, CSS class, or DOM path (those churn with the UI). When you add or refactor a user-facing control that tests target, give it a stable kebab-case `data-testid` plus an `aria-label` (the `aria-label` also serves the UIA accessibility fallback). Both are plain HTML attributes — additive, no visual/behavior impact; on Naive UI components they fall through to the root DOM node, so put them on the `<n-xxx>` tag. Keep a testid stable across refactors; if you must rename one, say so in the PR so the tester updates its scripts. Canonical registry (do not silently drop one):

| testid | control | file |
|---|---|---|
| `login-username` / `login-password` / `login-button` | login fields + submit | `views/loginWindow/Login.vue` |
| `message-input` / `send-button` | composer + desktop send | `components/rightBox/MsgInput.vue` |
| `upload-button` | desktop composer upload entry (opens FileUploadModal) | `components/rightBox/MsgInput.vue` |
| `composer-error` | empty-message inline error under composer | `components/rightBox/MsgInput.vue` |
| `chat-history` | scrollable message container | `components/rightBox/chatBox/ChatMain.vue` |
| `user-message` / `assistant-message` | one bubble, conditional on `isMe` | `components/rightBox/renderMessage/index.vue` |
| `retry-button` | failed-message retry icon (resend) | `components/rightBox/renderMessage/index.vue` |
| `markdown-content` / `image-content` | content inside a bubble | `renderMessage/Text.vue` / `Image.vue` |
| `typing-status` | streaming-reply status badge | `components/rightBox/chatBox/ThinkingCard.vue` |
| `session-list` / `new-chat-button` | conversation list + "+" entry | `views/homeWindow/message/index.vue` / `layout/center/index.vue` |

## Architecture: platform abstraction is the central design

The same Vue codebase runs in three runtimes, switched by `@/utils/PlatformConstants` (`isWeb()`, `isMobile()`, desktop). Two seams matter most:

- **WebSocket** — `src/services/webSocketAdapter.ts` lazily picks the implementation: `webSocketWeb.ts` (browser-native `WebSocket`) on web, else `webSocketRust.ts` (traffic flows through the Rust backend, surfaced to Vue via Tauri events). Always import the adapter, never a concrete impl. Message/type contracts live in `wsType.ts`.
- **Native calls** — `src/services/tauriCommand.ts` wraps `invoke()` (`@tauri-apps/api/core`) around the Rust `#[command]`s; command names are enumerated in `src/enums` (`TauriCommand`) and errors are normalized through `utils/TauriInvokeHandler`. On web, `webLoginCommand.ts` is the fallback.

Adding a native capability touches **both sides**: a Rust `#[command]` under `src-tauri/src/command/`, its registration in `get_invoke_handlers()` / `generate_handler!` in `src-tauri/src/lib.rs`, and a TS wrapper in `tauriCommand.ts`.

## Rust backend (`src-tauri/src/`)

`lib.rs` is the Tauri entry (`run()`, registers all commands). `command/*.rs` = invokable commands, one file per feature area (chat history, contacts, messages, upload, oauth, user, settings, ai, …). `websocket/` = the native WS client (`client.rs`, `message.rs`), dispatched to the Vue side via Tauri events. `repository/` + `entity/` + `migration/` = SeaORM over SQLite. `desktops/` vs `mobiles/` = platform-specific code. `im_request_client.rs` = HTTP client to HuLa-Server.

Per-platform Tauri config: `src-tauri/tauri.conf.json` is the base; `tauri.{windows,macos,linux,android,ios}.conf.json` override per target. Runtime app config (server URLs, keys) is `src-tauri/configuration/*.yaml` — `local.yaml` is git-ignored and auto-generated from `production.yaml` on install; point `backend.base_url` / `ws_url` there at your HuLa-Server.

## Frontend structure (`src/`)

State is a large set of Pinia **setup-stores** in `src/stores/` (~35: `chat`, `contacts`, `group`, `user`, `ws`, `userStatus`, `initialSync`, `cached`, `session*`, …). Other key dirs: `services/` (WS + Tauri bridges, i18n, fingerprint, map/translate APIs), `strategy/` (`MessageStrategy.ts` / `TriggerStrategy.ts` — message-type and @-trigger handling), `hooks/`, `views/`, `mobile/` (mobile-only views, alias `#`), `components/`, `layout/`, `workers/`.

### Pinia patterns

- Always `defineStore('name', () => { ... })` (setup style); use `storeToRefs` when destructuring to keep reactivity.
- Keep imperative logic in actions; components stay declarative and call actions/state. Expose derived state via getters, not raw refs.
- Access a dependent store by instantiating it at the top of the action (`const settings = useEditorSettingsStore()`), sharing one instance.
- `pinia-plugin-persistedstate` is registered globally (`src/stores/index.ts`) — opt in per store via `persist: true`. `pinia-shared-state` syncs state across browser tabs.

### Theming (UnoCSS + Sass)

`src/styles/scss/global/variable.scss` is auto-injected into every SCSS file (`vite.config.ts` `additionalData`). Prefer inline UnoCSS for simple light/dark (`bg-[lightColor] dark:bg-[darkColor]`); promote a color to `variable.scss` only when reused or semantic. Light values on `:root`, dark overrides under `html[data-theme="dark"]`. Consume tokens via UnoCSS bracket syntax (`bg-[--center-bg-color]`) or `@apply` (`@unocss/transformer-directives` is enabled, along with `transformer-variant-group`).

## Security & Configuration

- Don't add secrets to tracked files; use `.env.local` for personal tokens/keys.
- Runtime config goes in `src-tauri/configuration/local.yaml` (git-ignored).
