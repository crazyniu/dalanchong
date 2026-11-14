#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
/bin/bash "$ROOT/scripts/setup-macos.sh"
status=$?
printf '\n按回车关闭窗口…'
read -r _
exit "$status"
