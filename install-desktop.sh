#!/usr/bin/env bash
#
# Instala (ou remove) o Mail Reader como um aplicativo do desktop: cria o atalho
# no menu de aplicativos e registra o ícone. O atalho aponta direto para o
# código em source/, então qualquer alteração no código já vale no próximo
# lançamento — não é preciso reinstalar a cada atualização. Rode este script de
# novo só se trocar o ícone, mover o repositório ou atualizar a versão do Node.
#
# Uso:
#   ./install-desktop.sh              instala/atualiza o atalho e o ícone
#   ./install-desktop.sh --uninstall  remove o atalho e os ícones
set -euo pipefail

APP_ID="mail-reader"
APP_NAME="Mail Reader"
COMMENT="Leitor de e-mail local (Gmail e Outlook)"
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
  echo "Removido: $APP_NAME"
  exit 0
fi

# Garante as dependências (o binário standalone do Electron precisa existir).
if [[ ! -x "$ELECTRON" ]]; then
  echo "Dependências não encontradas — rodando 'npm install' em source/..."
  ( cd "$SRC" && npm install )
fi

# Renderiza o ícone em vários tamanhos + versão vetorial.
for size in 512 256 128 64 48 32; do
  out="$ICON_ROOT/${size}x${size}/apps"
  mkdir -p "$out"
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out/${APP_ID}.png"
done
mkdir -p "$ICON_ROOT/scalable/apps"
cp "$SVG" "$ICON_ROOT/scalable/apps/${APP_ID}.svg"

# Cria o atalho. O Exec chama o binário standalone do Electron por caminho
# absoluto, então não depende de node/npm/nvm estarem no PATH da sessão gráfica.
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

echo "Instalado: $APP_NAME"
echo "  atalho: $DESKTOP"
echo "  Procure por \"$APP_NAME\" no seu lançador de aplicativos."
