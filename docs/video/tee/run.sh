#!/usr/bin/env bash
# run.sh <name> <command...>: runs a command live in the repo, writes logs/<name>.log with epoch timestamps per line.
set -o pipefail
name=$1; shift
cd /Users/gwill/Developer/chaperone
echo "$(python3 -c 'import time;print(f"{time.time():.3f}")')	\$ $*" > ~/Developer/chaperone-video/tee/logs/$name.log
bash -c "$*" 2>&1 | python3 -u ~/.claude/skills/pitch-video/scripts/stamp.py | tee -a ~/Developer/chaperone-video/tee/logs/$name.log | cut -f2-
