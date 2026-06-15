# cargo-check container for src-tauri (aichatoverview#77)
#
# Purpose: let developers catch Linux-target + common-code Rust compile errors
# BEFORE opening a PR, shortening the feedback loop (e.g. the missing
# `use migration::ExprTrait;` that only surfaced at the Windows tester's build).
#
# Scope (deliberate):
#   - Runs `cargo check` ONLY — it does NOT build a .exe and does NOT link a
#     final binary. Windows desktop compile + smoke stays with the Windows tester.
#   - `cargo check` covers the Linux target + platform-agnostic code. It does
#     NOT compile `#[cfg(target_os = "windows")]` / `#[cfg(target_os = "ios")]`
#     branches — those still rely on the tester's Windows build.
#
# Base: ubuntu:24.04 — needed for `libwebkit2gtk-4.1-dev` (Ubuntu 22.04 only ships
# the 4.0 variant, which this app does not use).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Tauri v2 Linux system deps. The `*-sys` crates' build.rs probe these via
# pkg-config even for `cargo check`, so they must be present (not just for link).
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git build-essential pkg-config \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libasound2-dev \
      libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Rust toolchain. Frontend MSRV is >=1.88.0 (scripts/check-dependencies.js);
# edition 2024 needs >=1.85. Pin a stable that satisfies both.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain 1.88.0 --profile minimal \
    && rustc --version && cargo --version

WORKDIR /work/src-tauri

# Default: cargo check the whole workspace (".", entity, migration). Overridable
# by passing args to `docker run`.
CMD ["cargo", "check", "--workspace", "--manifest-path", "/work/src-tauri/Cargo.toml"]
