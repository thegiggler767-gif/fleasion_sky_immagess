#!/bin/sh
set -e
cd "$(dirname "$0")"
OUT=../app/src/main/assets/www
mkdir -p $OUT
npx esbuild src/main.js --bundle --minify --format=iife --target=chrome80 --outfile=$OUT/app.js --log-level=warning
cp index.html styles.css $OUT/
echo "built -> $OUT"
