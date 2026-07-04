#!/usr/bin/env sh
set -e
cd "$(dirname "$0")/.."
echo "AphroArchive Test Suite"
echo "======================="
npm test
