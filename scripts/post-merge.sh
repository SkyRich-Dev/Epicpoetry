#!/bin/bash
set -e
npm install --legacy-peer-deps
npm run db:prepare
npm run db:push
