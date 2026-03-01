#!/usr/bin/env bash
# Build hts-service Docker image for Linux/AMD64 k8s deployment.
#
# Three strategies (choose based on situation):
#
#  prebuilt (DEFAULT — fastest for daily dev)
#    1. Compile TypeScript locally on Mac (native, ~15s)
#    2. Build Docker with Dockerfile.prebuilt (only npm install --prod runs
#       under QEMU, ~1-2 min vs ~8-10 min for full build)
#    3. scp image tar to remote; ctr -n k8s.io images import (containerd)
#    Total: ~3-4 min
#
#  remote-source (best for clean/first builds)
#    1. rsync source to k8s master (fast — only changed files)
#    2. docker build on the Linux server NATIVELY (no QEMU at all, ~2-3 min)
#    3. docker save | ctr -n k8s.io images import (containerd, no file transfer)
#    Total: ~2-3 min
#
#  full (slowest — full QEMU build, kept as fallback)
#    docker buildx build --platform linux/amd64 with full Dockerfile
#    scp image tar to remote; ctr -n k8s.io images import (containerd)
#    Total: ~8-10 min
#
# Usage:
#   ./scripts/build-image.sh                         # prebuilt strategy
#   ./scripts/build-image.sh --strategy remote-source
#   ./scripts/build-image.sh --strategy full
#   ./scripts/build-image.sh --no-push               # build only, skip transfer

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-hts-service:local-amd64}"
STRATEGY="${STRATEGY:-prebuilt}"
REMOTE_HOST="${REMOTE_HOST:-192.168.1.209}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_BUILD_DIR="${REMOTE_BUILD_DIR:-/tmp/hts-service-build}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/cheng_wang_github}"
TEMP_IMAGE_FILE="/tmp/hts-service-amd64.tar"
SKIP_TRANSFER=false
SKIP_BUILD=false

# ─── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✅ $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ❌ $*" >&2; exit 1; }
sep()  { echo "────────────────────────────────────────"; }

# SSH/rsync helpers with identity key
ssh_cmd()   { ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "$@"; }
rsync_cmd() { rsync -az -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" "$@"; }
scp_cmd()   { scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$@"; }

# Import a local tar into containerd on the remote node (k8s.io namespace)
ctr_import() {
  local tar="$1"
  local remote_tar="/tmp/$(basename "$tar")"
  log "Exporting image to ${tar}..."
  docker save "$IMAGE_NAME" -o "$tar"
  log "Uploading to ${REMOTE_HOST}..."
  scp_cmd "$tar" "${REMOTE_USER}@${REMOTE_HOST}:${remote_tar}"
  log "Importing into containerd (ctr -n k8s.io)..."
  ssh_cmd "bash -lc 'ctr -n k8s.io images import ${remote_tar} && rm -f ${remote_tar}'"
  rm -f "$tar"
  ok "Image imported into containerd on ${REMOTE_HOST}: ${IMAGE_NAME}"
}

# ─── Args ─────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --strategy)      STRATEGY="$2";       shift 2 ;;
    --image)         IMAGE_NAME="$2";     shift 2 ;;
    --remote-host)   REMOTE_HOST="$2";    shift 2 ;;
    --remote-user)   REMOTE_USER="$2";    shift 2 ;;
    --ssh-key)       SSH_KEY="$2";        shift 2 ;;
    --no-push)       SKIP_TRANSFER=true;  shift   ;;
    --skip-build)    SKIP_BUILD=true;     shift   ;;
    --help)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY (use --ssh-key or set SSH_KEY)"

log "Strategy : $STRATEGY"
log "Image    : $IMAGE_NAME"
log "Remote   : ${REMOTE_USER}@${REMOTE_HOST}"
log "SSH key  : $SSH_KEY"
sep

# ─── Strategy: prebuilt ───────────────────────────────────────────────────────
if [[ "$STRATEGY" == "prebuilt" ]]; then
  command -v docker >/dev/null || fail "docker not found"
  command -v npm    >/dev/null || fail "npm not found"

  if [[ "$SKIP_BUILD" == false ]]; then
    log "Step 1/3 — Compiling TypeScript locally (native)..."
    cd "$SERVICE_DIR"
    npm run build
    ok "TypeScript compiled → dist/"
  else
    log "Step 1/3 — Skipping TypeScript compile (--skip-build)"
    [[ -d "$SERVICE_DIR/dist" ]] || fail "dist/ not found — run without --skip-build first"
  fi

  sep
  log "Step 2/3 — Building Docker image (prebuilt, prod deps only)..."
  cd "$SERVICE_DIR"
  DOCKER_BUILDKIT=1 docker buildx build \
    --platform linux/amd64 \
    -f Dockerfile.prebuilt \
    --load \
    -t "$IMAGE_NAME" \
    .
  ok "Docker image built: $IMAGE_NAME"

  if [[ "$SKIP_TRANSFER" == true ]]; then
    ok "Skipping transfer (--no-push)"
    exit 0
  fi

  sep
  log "Step 3/3 — Transferring image to ${REMOTE_HOST} (containerd)..."
  ctr_import "$TEMP_IMAGE_FILE"

# ─── Strategy: remote-source ──────────────────────────────────────────────────
elif [[ "$STRATEGY" == "remote-source" ]]; then
  command -v rsync >/dev/null || fail "rsync not found"

  if [[ "$SKIP_BUILD" == false ]]; then
    sep
    log "Step 1/2 — Syncing source to ${REMOTE_HOST}:${REMOTE_BUILD_DIR}..."
    rsync_cmd --delete \
      --exclude='.git' \
      --exclude='node_modules' \
      --exclude='dist' \
      --exclude='coverage' \
      --exclude='**/node_modules' \
      --exclude='**/dist' \
      --exclude='**/*.log' \
      --exclude='.env' \
      --exclude='.env.*' \
      --exclude='test' \
      --exclude='htc-docs' \
      --exclude='*.md' \
      "$SERVICE_DIR/" \
      "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_BUILD_DIR}/"
    ok "Source synced to ${REMOTE_HOST}:${REMOTE_BUILD_DIR}"
  else
    log "Skipping rsync (--skip-build)"
  fi

  sep
  log "Step 2/2 — Building Docker natively on ${REMOTE_HOST} (no QEMU)..."
  ssh_cmd "bash -lc 'cd ${REMOTE_BUILD_DIR} && DOCKER_BUILDKIT=1 docker build -t ${IMAGE_NAME} .'"
  ok "Image built natively on ${REMOTE_HOST}: ${IMAGE_NAME}"

  sep
  log "Step 2b — Importing into containerd (ctr -n k8s.io)..."
  ssh_cmd "bash -lc 'docker save ${IMAGE_NAME} | ctr -n k8s.io images import -'"
  ok "Image imported into containerd on ${REMOTE_HOST}: ${IMAGE_NAME}"

# ─── Strategy: full ───────────────────────────────────────────────────────────
elif [[ "$STRATEGY" == "full" ]]; then
  command -v docker >/dev/null || fail "docker not found"

  log "Building with full Dockerfile (QEMU cross-compile — slow)..."
  cd "$SERVICE_DIR"
  DOCKER_BUILDKIT=1 docker buildx build \
    --platform linux/amd64 \
    --load \
    -t "$IMAGE_NAME" \
    .
  ok "Docker image built: $IMAGE_NAME"

  if [[ "$SKIP_TRANSFER" == true ]]; then
    ok "Skipping transfer (--no-push)"
    exit 0
  fi

  sep
  log "Transferring image to ${REMOTE_HOST} (containerd)..."
  ctr_import "$TEMP_IMAGE_FILE"

else
  fail "Unknown strategy: $STRATEGY (valid: prebuilt | remote-source | full)"
fi

sep
ok "Build complete: $IMAGE_NAME on ${REMOTE_HOST}"
