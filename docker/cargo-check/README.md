# src-tauri cargo-check container (#77)

A containerized `cargo check` for the Tauri Rust backend (`src-tauri/`), so you can
catch Rust compile errors **before opening a PR** without installing the Rust
toolchain + WebKitGTK system deps on your host. Shortens the feedback loop for
front-end Rust changes (e.g. a missing trait import that would otherwise only
surface at the Windows tester's build).

## Usage

```bash
# from the frontend repo root (or anywhere)
docker/cargo-check/run.sh                      # cargo check the whole workspace
docker/cargo-check/run.sh cargo check -p hula  # custom cargo args
```

First run builds the image (Ubuntu 24.04 + Rust 1.88 + Tauri Linux deps) and
downloads/compiles all crates — slow. Repeat runs reuse the named cache volumes
(`hula-cargo-registry`, `hula-cargo-target`) and are fast.

## Scope — what it does and does NOT cover

- **Does**: `cargo check` for the **Linux target** + all platform-agnostic code
  (the bulk of `src-tauri/`, `entity/`, `migration/`).
- **Does NOT** build a `.exe` / link a final binary — desktop packaging stays
  with the Windows tester.
- **Does NOT** compile platform-specific branches such as
  `#[cfg(target_os = "windows")]` / `#[cfg(target_os = "ios")]`. **A green
  `cargo check` here is not a 100% substitute for the Windows build** — the
  Windows tester's `cargo tauri build` remains the gate for Windows-only code.

## Notes

- Base image is `ubuntu:24.04` because Tauri here needs `libwebkit2gtk-4.1-dev`
  (Ubuntu 22.04 only ships the 4.0 variant).
- The whole frontend repo is mounted at `/work` so src-tauri's
  `../tauri-plugin-hula` path dependency resolves. To keep your working tree
  clean, every path the build writes is redirected off it: `target/` + the cargo
  registry + `gen/schemas/` (tauri-build generated) are named volumes (persisted
  cache), and `../dist` (created by `build.rs`) is a throwaway tmpfs. The only
  host-visible side effect is an empty, git-ignored `dist/` mountpoint dir;
  `git status` stays clean. `Cargo.lock` is not rewritten by a current
  `cargo check`.
