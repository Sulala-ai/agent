#!/bin/bash

# Create a tennis event in macOS Calendar
event_title="Tennis"
event_start="2023-10-11T21:00:00"
event_end="2023-10-11T21:30:00"
event_description="Go to play tennis"

osascript <<EOF

tell application "Calendar"
    set newEvent to make new event at end of calendar "Home"
    set summary of newEvent to "$event_title"
    set start date of newEvent to date "$event_start"
    set end date of newEvent to date "$event_end"
    set description of newEvent to "$event_description"
end tell
EOF