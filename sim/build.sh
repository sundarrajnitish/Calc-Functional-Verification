#!/usr/bin/env bash
# Build the Verilator executables for both designs.
#   usage: sim/build.sh [calc1|calc3|all]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VFLAGS="--binary --timing -j 0 -Wno-fatal -Wno-ASCRANGE -Wno-WIDTH -Wno-IMPLICITSTATIC -O2"
build() {
  local d=$1
  for bug in $(seq 0 7); do
    verilator $VFLAGS --top-module ${d}_tb_top -GBUG=$bug -Mdir "$ROOT/build/${d}_bug$bug" \
      "$ROOT/rtl/$d/${d}_top.v" "$ROOT/tb/$d/${d}_if.sv" "$ROOT/tb/$d/${d}_pkg.sv" "$ROOT/tb/$d/${d}_tb_top.sv" \
      > "$ROOT/build/${d}_bug$bug.log" 2>&1 || { cat "$ROOT/build/${d}_bug$bug.log"; exit 1; }
    echo "built ${d} BUG=$bug"
  done
}
mkdir -p "$ROOT/build"
case "${1:-all}" in
  calc1) build calc1 ;;
  calc3) build calc3 ;;
  all)   build calc1; build calc3 ;;
esac
