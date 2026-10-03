#!/bin/bash
# Start the OpenMALS development server (http://localhost:5173).
# macOS: double-click this file in Finder. Also works from a terminal: ./start.command
cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  # Finder starts a login shell that may not include Homebrew or nvm paths.
  for p in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do
    [ -x "$p/npm" ] && export PATH="$p:$PATH"
  done
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org/ and try again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  if ! npm install; then
    echo "npm install failed."
    read -r -p "Press Enter to close..."
    exit 1
  fi
fi

npm run dev -- --open
