#!/usr/bin/env bash
# run.sh <name> <command...>: runs a command live in the repo and writes logs/<name>.log next to this
# script, every output line prefixed with its epoch time (the real output and timing of the clip).
set -o pipefail
here=$(cd "$(dirname "$0")" && pwd)
name=$1; shift
cd "$(git -C "$here" rev-parse --show-toplevel)"
mkdir -p "$here/logs"
echo "$(python3 -c 'import time;print(f"{time.time():.3f}")')	\$ $*" > "$here/logs/$name.log"
bash -c "$*" 2>&1 | python3 -u "$HOME/.claude/skills/pitch-video/scripts/stamp.py" | tee -a "$here/logs/$name.log" | cut -f2-
