#!/usr/bin/env bash
#
# Installs (or removes) Mail Reader as a desktop application: creates the launcher
# in the applications menu and registers the icon. The launcher points straight at
# the code in source/, so any code change already applies on the next
# launch — there's no need to reinstall after every update. Run this script
# again only if you change the icon, move the repository or update the Node version.
#
# Usage:
#   ./install-desktop.sh              installs/updates the launcher and the icon
#   ./install-desktop.sh --uninstall  removes the launcher and the icons
set -euo pipefail

APP_ID="mail-reader"
APP_NAME="Mail Reader"
COMMENT="Local e-mail reader (Gmail and Outlook)"
CATEGORIES="Network;Email;"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$REPO/source"
ELECTRON="$SRC/node_modules/electron/dist/electron"
SVG="$SRC/assets/icon.svg"

APP_DIR="$HOME/.local/share/applications"
ICON_ROOT="$HOME/.local/share/icons/hicolor"
DESKTOP="$APP_DIR/${APP_ID}.desktop"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DESKTOP"
  for size in 512 256 128 64 48 32; do rm -f "$ICON_ROOT/${size}x${size}/apps/${APP_ID}.png"; done
  rm -f "$ICON_ROOT/scalable/apps/${APP_ID}.svg"
  update-desktop-database "$APP_DIR" 2>/dev/null || true
  gtk-update-icon-cache -f "$ICON_ROOT" 2>/dev/null || true
  echo "Removed: $APP_NAME"
  exit 0
fi

# Makes sure the dependencies exist (the standalone Electron binary must be there).
if [[ ! -x "$ELECTRON" ]]; then
  echo "Dependencies not found — running 'npm install' in source/..."
  ( cd "$SRC" && npm install )
fi

# Renders the icon in several sizes + a vector version.
for size in 512 256 128 64 48 32; do
  out="$ICON_ROOT/${size}x${size}/apps"
  mkdir -p "$out"
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out/${APP_ID}.png"
done
mkdir -p "$ICON_ROOT/scalable/apps"
cp "$SVG" "$ICON_ROOT/scalable/apps/${APP_ID}.svg"

# Creates the launcher. Exec calls the standalone Electron binary by absolute
# path, so it doesn't depend on node/npm/nvm being on the graphical session's PATH.
mkdir -p "$APP_DIR"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
Comment=$COMMENT
Exec=env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$SRC"
Path=$SRC
Icon=$APP_ID
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_ID
EOF

update-desktop-database "$APP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f "$ICON_ROOT" 2>/dev/null || true

echo "Installed: $APP_NAME"
echo "  launcher: $DESKTOP"
echo "  Look for \"$APP_NAME\" in your application launcher."
