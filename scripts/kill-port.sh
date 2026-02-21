#!/bin/bash

PORT=${1:-3100}

echo "🔍 Checking for processes on port $PORT..."

# Find process ID using the port
PID=$(lsof -ti:$PORT)

if [ -z "$PID" ]; then
  echo "✅ Port $PORT is free"
  exit 0
else
  echo "⚠️  Found process $PID using port $PORT"
  echo "🔪 Killing process..."
  kill -9 $PID

  # Wait a moment for the port to be released
  sleep 1

  # Verify it's killed
  if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "❌ Failed to kill process on port $PORT"
    exit 1
  else
    echo "✅ Port $PORT is now free"
    exit 0
  fi
fi
