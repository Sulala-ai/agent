import sys
import argparse

# Create a new issue
parser = argparse.ArgumentParser()
parser.add_argument('--team', required=True)
parser.add_argument('--title', required=True)
parser.add_argument('--description', required=True)

args = parser.parse_args()

# Simulate creating a Linear issue
print(f"Creating issue in team {args.team} with title: '{args.title}' and description: '{args.description}'")
# Here you would typically call the Linear API to create the issue.