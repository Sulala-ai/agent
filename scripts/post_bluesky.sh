#!/bin/bash

# Posting a message to Bluesky

MESSAGE=$1

if [ -z "$MESSAGE" ]; then
  echo "No message provided."
  exit 1
fi

# Use the Bluesky client to post the message
bluesky -H "$BSKY_HANDLE" -P "$BSKY_APP_PASSWORD" -m "$MESSAGE"