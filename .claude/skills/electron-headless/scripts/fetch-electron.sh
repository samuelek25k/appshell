#!/usr/bin/env bash
set -euo pipefail
version="${1:-$(node -p "require('electron/package.json').version")}"
case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) os=win32 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) arch="$(uname -m)" ;; esac
dest="${XDG_CACHE_HOME:-$HOME/.cache}/electron-dist/v$version"
if [ ! -x "$dest/electron" ] && [ ! -d "$dest/Electron.app" ]; then
  mkdir -p "$dest"
  curl -fsSL --retry 3 -o "$dest.zip" "https://github.com/electron/electron/releases/download/v$version/electron-v$version-$os-$arch.zip"
  unzip -q -o "$dest.zip" -d "$dest" && rm "$dest.zip"
fi
echo "export ELECTRON_OVERRIDE_DIST_PATH=$dest"
