---
name: github
description: Use GitHub (repos, issues, PRs, comments) via the Portal. When the user asks about repos, issues, or pull requests, list connections with list_integrations_connections (provider github) and use run_command with curl to the GitHub API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "🐙",
      "requires": { "bins": ["curl"] }
    }
  }
---

# GitHub

1. **list_integrations_connections** with `provider: "github"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` and `Accept: application/vnd.github.v3+json` for all requests.

Base URL: `https://api.github.com`. Add `api.github.com` to **ALLOWED_CURL_HOSTS**.

Official docs: https://docs.github.com/en/rest

---

## Repositories

- **List repos** (authenticated user): `GET https://api.github.com/user/repos?per_page=20&sort=updated`. Returns `[].id`, `name`, `full_name`, `clone_url`, `private`.
- **List repos** (org): `GET https://api.github.com/orgs/<org>/repos?per_page=20`.

---

## Issues

- **List issues** (repo): `GET https://api.github.com/repos/<owner>/<repo>/issues?state=all&per_page=20`. Returns `[].number`, `title`, `state`, `body`, `user.login`.
- **Create issue**: `POST https://api.github.com/repos/<owner>/<repo>/issues` with body `{"title": "Title", "body": "Description"}`. Optional: `"labels": ["bug"]`, `"assignees": ["username"]`.
- **Get issue**: `GET https://api.github.com/repos/<owner>/<repo>/issues/<issue_number>`.

---

## Comments

- **List comments** (on issue): `GET https://api.github.com/repos/<owner>/<repo>/issues/<issue_number>/comments`.
- **Create comment** (on issue): `POST https://api.github.com/repos/<owner>/<repo>/issues/<issue_number>/comments` with body `{"body": "Comment text"}`.

---

## Pull requests

- **List PRs**: `GET https://api.github.com/repos/<owner>/<repo>/pulls?state=open&per_page=20`.
- **Create PR**: `POST https://api.github.com/repos/<owner>/<repo>/pulls` with body `{"title": "Title", "head": "<branch>", "base": "main", "body": "Description"}`. `head` is the branch with changes (e.g. `username:feature-branch` for fork).

---

## File content

- **Get file**: `GET https://api.github.com/repos/<owner>/<repo>/contents/<path>`. Response has `content` (base64); decode to get file text. Optional: `?ref=<branch>`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect GitHub in the Portal.
