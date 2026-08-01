#!/usr/bin/env bash
# PostToolUse hook (Write|Edit): roasts Dockerfiles with `droast` right after
# Claude Code touches one. See droast.toml for the project's accepted-risk
# rule skips — this repo's droast release predates --config support, so the
# skip list is passed explicitly here instead.
set -euo pipefail

input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')"

[ -n "$file" ] || exit 0

case "$(basename "$file")" in
	Dockerfile | Dockerfile.*) ;;
	*) exit 0 ;;
esac

if ! command -v droast >/dev/null 2>&1; then
	echo '{"systemMessage": "droast not installed — skipping Dockerfile lint. Install: brew tap immanuwell/droast https://github.com/immanuwell/homebrew-droast.git && brew install immanuwell/droast/droast"}'
	exit 0
fi

output="$(droast --skip DF021,DF005,DF011 "$file" 2>&1 || true)"

case "$output" in
	*"Summary: 0 error(s), 0 warning(s), 0 info(s)"*) exit 0 ;;
esac

jq -n --arg file "$file" --arg ctx "$output" \
	'{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: ("droast findings for \($file):\n\($ctx)")}}'
