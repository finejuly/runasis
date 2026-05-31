#!/bin/zsh
set -u

cd -- "$(dirname "$0")" || exit 1

if [ ! -x "./scripts/run-server.sh" ]; then
  echo "Could not find the server launch script: scripts/run-server.sh"
  echo
  echo "Press any key to close this window."
  read -k 1
  exit 1
fi

echo "Starting Runasis."
echo "To stop the server, press Ctrl+C in this window or close the terminal window."
echo

opened=0
./scripts/run-server.sh 2>&1 | while IFS= read -r line; do
  print -r -- "$line"

  if [ "$opened" -eq 0 ] && [[ "$line" == Runasis\ is\ running\ at\ http* ]]; then
    url="${line#Runasis is running at }"
    open "$url"
    opened=1
  fi
done

echo
echo "Runasis has stopped."
echo "Press any key to close this window."
read -k 1
