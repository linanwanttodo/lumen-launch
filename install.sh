#!/usr/bin/env bash
# lumen launch - one-click installer
#
#   ./install.sh            install the extension from this repo
#   ./install.sh --uninstall  remove it
#   ./install.sh --help     show usage
#
# clone the repo, cd into it and run ./install.sh, then log out and
# back in (required on wayland so the shell picks up the new uuid).
set -euo pipefail

UUID="lumen-launch@linanwanttodo.github.io"
SCHEMA="org.gnome.shell.extensions.lumen-launch"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${XDG_DATA_HOME:-}" ]; then
    DATA_HOME="$XDG_DATA_HOME"
else
    DATA_HOME="$HOME/.local/share"
fi
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"

usage() {
    echo "usage: $0 [--uninstall|--remove] [--help]"
    echo
    echo "  default          install $UUID from this repo"
    echo "  --uninstall      disable and remove the extension"
    echo "  --remove         same as --uninstall"
    echo "  --help           show this help"
}

uninstall() {
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    fi
    if [ -d "$DEST" ]; then
        rm -rf "$DEST"
        echo "removed $DEST"
    else
        echo "$UUID is not installed"
    fi
}

install() {
    if [ "$(basename "$SRC")" = "$UUID" ]; then
        echo "error: you are running this from inside the extensions dir, not the repo"
        exit 1
    fi
    if [ ! -f "$SRC/metadata.json" ]; then
        echo "error: no metadata.json found in $SRC, run this from the repo root"
        exit 1
    fi

    for cmd in glib-compile-schemas gnome-extensions; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            echo "error: required command '$cmd' not found"
            echo "       install glib2.0-bin (or glib2.0-dev) and gnome-shell"
            exit 1
        fi
    done

    echo "installing $UUID from $SRC"
    echo "target:  $DEST"

    mkdir -p "$(dirname "$DEST")"
    if [ -d "$DEST" ]; then
        rm -rf "$DEST"
    fi

    cp -r "$SRC" "$DEST"
    rm -rf "$DEST/.git"
    rm -rf "$DEST/tools" "$DEST/po" "$DEST/install.sh"
    rm -f "$DEST/schemas/gschemas.compiled"

    glib-compile-schemas "$DEST/schemas"

    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    if gnome-extensions enable "$UUID" >/dev/null 2>&1; then
        echo "enabled  $UUID"
    else
        echo "installed, but the shell does not know this uuid yet"
    fi

    echo
    echo "done. if the extension does not show up, log out and back in"
    echo "then run: gnome-extensions enable $UUID"
}

case "${1:-}" in
    --uninstall|--remove)
        uninstall
        ;;
    --help|-h)
        usage
        ;;
    *)
        install
        ;;
esac
