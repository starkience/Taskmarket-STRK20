#!/usr/bin/env bash

set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
workspace_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
local_taskmarket="$workspace_dir/node_modules/.bin/taskmarket"
state_dir="$script_dir/.state"
reward_usdc="${BOUNTY_REWARD_USDC:-8}"
api_url="${TASKMARKET_API_URL:-https://api.taskmarket.dev}"
deliverable="$script_dir/demo-deliverable.md"

usage() {
  printf '%s\n' \
    "Usage: live/taskmarket-live.sh <preflight|create|submit|accept|status>" \
    "" \
    "This runner uses the current TaskMarket keystore and Base Mainnet." \
    "It never accepts or reads a private key. Import the browser EOA yourself" \
    "with the CLI's hidden interactive prompt before running it."
}

require_tools() {
  if [ -n "${TASKMARKET_BIN:-}" ] && [ -x "$TASKMARKET_BIN" ]; then
    taskmarket_bin="$TASKMARKET_BIN"
  elif [ -x "$local_taskmarket" ]; then
    taskmarket_bin="$local_taskmarket"
  elif command -v taskmarket >/dev/null 2>&1; then
    taskmarket_bin=$(command -v taskmarket)
  else
    printf '%s\n' "Missing taskmarket CLI. Run npm install in the workspace." >&2
    exit 1
  fi
  command -v jq >/dev/null 2>&1 || {
    printf '%s\n' "Missing jq." >&2
    exit 1
  }
}

wallet_address() {
  "$taskmarket_bin" address | jq -er '.data.address'
}

task_id() {
  jq -er '.data.taskId' "$state_dir/create.json"
}

confirm_exact() {
  expected=$1
  printf 'Type exactly "%s" to continue: ' "$expected" >&2
  IFS= read -r answer
  if [ "$answer" != "$expected" ]; then
    printf '%s\n' "Confirmation did not match; nothing was submitted." >&2
    exit 1
  fi
}

preflight() {
  printf 'TaskMarket API: %s\n' "$api_url"
  "$taskmarket_bin" address
  "$taskmarket_bin" deposit
  "$taskmarket_bin" wallet balance
  "$taskmarket_bin" legal status
  "$taskmarket_bin" identity status
  printf '%s\n' \
    "Confirm the printed network is Base Mainnet, chainId 8453, and native USDC" \
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 before continuing."
}

create_bounty() {
  mkdir -p "$state_dir"
  actor=$(wallet_address)
  printf 'Acting wallet: %s\nReward: %s USDC\nNetwork: Base Mainnet\n' "$actor" "$reward_usdc"
  confirm_exact "CREATE ${reward_usdc} USDC BOUNTY"

  "$taskmarket_bin" task create \
    --description "Create a concise Markdown report explaining the privacy boundary when a TaskMarket USDC payout on Base is routed through the STRK20 privacy pool on Starknet. Include exactly two sections named 'Public information' and 'Private information'. Use 6-10 bullet points total. Mention the task, worker address, payout, both CCTP legs, pool deposit, and pool withdrawal. Explain that amount and timing correlation may relink a deposit and withdrawal. State precisely what STRK20 hides. Use no more than 250 words, submit one Markdown file, and do not claim complete anonymity." \
    --reward "$reward_usdc" \
    --duration 2 \
    --mode bounty \
    --tags "privacy,starknet,strk20,documentation" \
    --task-visibility unlisted \
    --submission-visibility never | tee "$state_dir/create.json"

  task=$(task_id)
  printf 'Created task: %s\n' "$task"
  "$taskmarket_bin" task get "$task"
}

submit_bounty() {
  task=$(task_id)
  actor=$(wallet_address)
  "$taskmarket_bin" task get "$task" | tee "$state_dir/before-submit.json"
  printf 'Task: %s\nWorker: %s\nArtifact: %s\n' "$task" "$actor" "$deliverable"
  confirm_exact "SUBMIT ${task}"
  "$taskmarket_bin" task submit "$task" --file "$deliverable" | tee "$state_dir/submit.json"
  printf '%s\n' "$actor" > "$state_dir/worker-address.txt"
  "$taskmarket_bin" task submissions "$task"
}

accept_bounty() {
  task=$(task_id)
  requester=$(wallet_address)
  worker_file="$state_dir/worker-address.txt"
  if [ ! -f "$worker_file" ]; then
    printf '%s\n' "Missing worker address. Submit through this runner first." >&2
    exit 1
  fi
  worker=$(tr -d '[:space:]' < "$worker_file")
  case "$worker" in
    0x????????????????????????????????????????) ;;
    *) printf '%s\n' "Invalid worker address in $worker_file." >&2; exit 1 ;;
  esac
  "$taskmarket_bin" task get "$task" | tee "$state_dir/before-accept.json"
  "$taskmarket_bin" task submissions "$task"
  printf 'Task: %s\nRequester: %s\nWorker: %s\nAcceptance fee: 0.001 USDC\n' "$task" "$requester" "$worker"
  confirm_exact "ACCEPT ${task} FOR ${worker}"
  "$taskmarket_bin" task accept "$task" --worker "$worker" | tee "$state_dir/accept.json"
  "$taskmarket_bin" task get "$task" | tee "$state_dir/completed.json"
  "$taskmarket_bin" wallet balance
}

status() {
  task=$(task_id)
  "$taskmarket_bin" task get "$task"
  "$taskmarket_bin" wallet balance
  "$taskmarket_bin" stats
}

require_tools
export TASKMARKET_API_URL="$api_url"

case "${1:-}" in
  preflight) preflight ;;
  create) create_bounty ;;
  submit) submit_bounty ;;
  accept) accept_bounty ;;
  status) status ;;
  *) usage; exit 1 ;;
esac
