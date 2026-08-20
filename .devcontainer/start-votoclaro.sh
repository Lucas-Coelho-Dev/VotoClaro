#!/usr/bin/env bash
set -euo pipefail

if curl --silent --show-error --max-time 2 --output /dev/null http://127.0.0.1:3000/; then
  echo "VotoClaro já está em execução."
  exit 0
fi

nohup npm start >/tmp/votoclaro.log 2>&1 &

for _ in $(seq 1 30); do
  if curl --silent --show-error --max-time 2 --output /dev/null http://127.0.0.1:3000/; then
    echo "VotoClaro disponível na porta 3000."
    exit 0
  fi
  sleep 1
done

echo "O VotoClaro não iniciou dentro do tempo esperado."
tail -n 100 /tmp/votoclaro.log || true
exit 1
