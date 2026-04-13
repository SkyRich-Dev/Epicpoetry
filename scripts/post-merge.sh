#!/bin/bash
set -e
npm install
npm run db:prepare
npm run db:push
