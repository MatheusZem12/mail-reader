#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Iniciando backend..."
cd "$SCRIPT_DIR/backend"
mvn spring-boot:run &
BACKEND_PID=$!

echo "Aguardando backend iniciar..."
sleep 10

echo "Iniciando frontend (web)..."
cd "$SCRIPT_DIR/frontend"
flutter run -d chrome

wait $BACKEND_PID
