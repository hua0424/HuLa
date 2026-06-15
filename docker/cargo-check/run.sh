#!/usr/bin/env bash
#
# run.sh - run `cargo check` for src-tauri inside the cargo-check container (#77).
#
# Usage:
#   docker/cargo-check/run.sh                 # cargo check the whole workspace
#   docker/cargo-check/run.sh cargo check -p hula        # pass custom cargo args
#
# Catches Linux-target + common-code Rust compile errors before opening a PR.
# Does NOT produce a Windows .exe — that stays with the Windows tester.
# Does NOT compile Windows-only (#[cfg(target_os="windows")]) branches.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# docker/cargo-check -> frontend repo root (mounted so src-tauri's `../tauri-plugin-hula`
# path dep and the build.rs `../dist` creation both resolve).
FRONTEND_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE="hula-cargo-check:latest"

if ! docker info >/dev/null 2>&1; then
  echo "[cargo-check] ERROR: Docker daemon not running" >&2
  exit 1
fi

# Build the image. Docker layer-caches, so this is fast once the base layers exist;
# it rebuilds only when the Dockerfile changes.
echo "[cargo-check] building image $IMAGE ..."
docker build -t "$IMAGE" "$SCRIPT_DIR"

# Keep the host working tree clean: every path the build writes is redirected to a
# volume / tmpfs, so nothing lands in your git-tracked tree.
#   - cargo registry + src-tauri/target/   -> named volumes (persisted cache, fast repeat)
#   - src-tauri/gen/schemas/ (tauri-build generated) -> named volume
#   - ../dist (build.rs ensure_frontend_dist)        -> tmpfs (throwaway)
# (/work itself is rw only so Docker can create those nested mountpoints; cargo writes
#  nothing to the source tree and Cargo.lock is not rewritten by a current `cargo check`.
#  The only host-visible side effect is an empty, git-ignored `dist/` mountpoint dir.)
echo "[cargo-check] running cargo check (src-tauri workspace) ..."
docker run --rm \
  -v "$FRONTEND_ROOT":/work \
  -v hula-cargo-registry:/usr/local/cargo/registry \
  -v hula-cargo-target:/work/src-tauri/target \
  -v hula-cargo-gen-schemas:/work/src-tauri/gen/schemas \
  --tmpfs /work/dist \
  "$IMAGE" "$@"

echo "[cargo-check] done."
