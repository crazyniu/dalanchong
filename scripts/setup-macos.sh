#!/bin/bash
# Project-local macOS setup. No sudo, global installs, or shell/browser changes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/.tools"
NODE_VERSION=24.11.1
PNPM_VERSION=11.15.1
fail() { printf '\n安装失败：%s\n' "$*" >&2; exit 1; }
trap 'printf "\n安装未完成（第 %s 行）。请保留上面的错误信息；未修改系统或浏览器设置。\n" "$LINENO" >&2' ERR
[[ "$(uname -s)" == Darwin ]] || fail '此脚本仅支持 macOS。'
case "$(uname -m)" in arm64) ARCH=arm64;; x86_64) ARCH=x64;; *) fail '仅支持 Apple Silicon 或 Intel Mac。';; esac
[[ $# -eq 0 || ( $# -eq 1 && "$1" == --dry-run ) ]] || fail '仅支持 --dry-run 参数。'
if [[ "${1:-}" == --dry-run ]]; then
  printf '项目：%s\n架构：%s\n优先复用 Node >=24 和 npm，否则下载 Node %s。\n工具目录：%s\npnpm：%s\n将安装打包依赖；插件源码可直接加载，不会修改系统配置。\n' "$ROOT" "$ARCH" "$NODE_VERSION" "$TOOLS" "$PNPM_VERSION"
  exit 0
fi
mkdir -p "$TOOLS" "$TOOLS/cache" "$TOOLS/npm-cache" "$TOOLS/pnpm-home" "$TOOLS/config"
export npm_config_cache="$TOOLS/npm-cache" npm_config_userconfig="$TOOLS/config/npmrc"
export XDG_CACHE_HOME="$TOOLS/cache" XDG_DATA_HOME="$TOOLS/data" XDG_CONFIG_HOME="$TOOLS/config"
export PNPM_HOME="$TOOLS/pnpm-home"
NODE_BIN='' NPM_CLI=''
LOCAL_NODE="$TOOLS/node-v${NODE_VERSION}-darwin-${ARCH}"
if [[ -x "$LOCAL_NODE/bin/node" && -f "$LOCAL_NODE/lib/node_modules/npm/bin/npm-cli.js" ]]; then
  export PATH="$LOCAL_NODE/bin:$PATH"
fi
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  candidate="$(command -v node)"
  version="$("$candidate" --version 2>/dev/null || true)"
  if [[ "$version" =~ ^v([0-9]+)\. && "${BASH_REMATCH[1]}" -ge 24 ]]; then
    npm_candidate="$(command -v npm)"
    if "$candidate" "$npm_candidate" --version >/dev/null 2>&1; then NODE_BIN="$candidate"; NPM_CLI="$npm_candidate"; fi
  fi
fi
if [[ -z "$NODE_BIN" ]]; then
  command -v curl >/dev/null || fail '缺少 curl，无法下载官方 Node。'
  command -v shasum >/dev/null || fail '缺少 shasum，无法校验下载。'
  ARCHIVE="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
  BASE="https://nodejs.org/dist/v${NODE_VERSION}"
  TMP="$(mktemp -d "$TOOLS/node-download.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  printf '下载官方 Node %s (%s)…\n' "$NODE_VERSION" "$ARCH"
  curl --fail --location --show-error --silent --connect-timeout 20 --max-time 600 --proto '=https' --tlsv1.2 "$BASE/$ARCHIVE" -o "$TMP/$ARCHIVE"
  curl --fail --location --show-error --silent --connect-timeout 20 --max-time 600 --proto '=https' --tlsv1.2 "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  EXPECTED="$(awk -v file="$ARCHIVE" '$2 == file { print $1 }' "$TMP/SHASUMS256.txt")"
  [[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || fail '官方校验表没有唯一有效的目标文件校验值。'
  ACTUAL="$(shasum -a 256 "$TMP/$ARCHIVE")"; ACTUAL="${ACTUAL%% *}"
  [[ "$ACTUAL" == "$EXPECTED" ]] || fail 'Node SHA256 校验失败，已停止，不会运行下载文件。'
  tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
  NODE_DIR="$TOOLS/node-v${NODE_VERSION}-darwin-${ARCH}"
  # Move only verified files; a failed previous attempt is retained rather than overwritten.
  if [[ -e "$NODE_DIR" ]]; then fail "工具目录已存在但未使用：$NODE_DIR。请检查后移走该目录重试。"; fi
  mv "$TMP/node-v${NODE_VERSION}-darwin-${ARCH}" "$NODE_DIR"
  NODE_BIN="$NODE_DIR/bin/node"; NPM_CLI="$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
printf 'Node：%s\n' "$("$NODE_BIN" --version)"
printf '安装项目专用 pnpm %s…\n' "$PNPM_VERSION"
"$NODE_BIN" "$NPM_CLI" install --prefix "$TOOLS/pnpm" --registry=https://registry.npmjs.org --no-audit --no-fund --ignore-scripts "pnpm@$PNPM_VERSION"
PNPM_CLI="$("$NODE_BIN" -e '
const fs = require("node:fs"), path = require("node:path");
const root = process.argv[1], expected = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.version !== expected || typeof pkg.bin?.pnpm !== "string") throw Error("pnpm package metadata mismatch");
const bin = path.resolve(root, pkg.bin.pnpm);
if (!bin.startsWith(root + path.sep) || !fs.statSync(bin).isFile()) throw Error("Invalid pnpm entry point");
process.stdout.write(bin);
' "$TOOLS/pnpm/node_modules/pnpm" "$PNPM_VERSION")"
# Dependency scripts use the project-local pnpm and selected Node.
export PATH="$TOOLS/pnpm/node_modules/.bin:$(dirname "$NODE_BIN"):$PATH"
[[ "$("$NODE_BIN" "$PNPM_CLI" --version)" == "$PNPM_VERSION" ]] || fail 'pnpm 版本不符合固定版本要求。'
cd "$ROOT"
"$NODE_BIN" "$PNPM_CLI" install --frozen-lockfile --store-dir "$TOOLS/pnpm-store"
printf '\n依赖安装完成。\n打开浏览器扩展管理页，开启开发者模式，选择“加载已解压的扩展程序”：\n%s/browser-extension\n不会自动修改浏览器安装策略。\n' "$ROOT"
