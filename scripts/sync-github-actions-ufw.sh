#!/usr/bin/env bash
# Sync GitHub Actions IP ranges into a UFW ipset and allow HTTPS (Infisical/CI).
#
# Run on the VPS (Ubuntu) as root when GitHub-hosted runners cannot reach
# https://infisical.gggfox.com (dial tcp ...:443: i/o timeout).
#
# Usage (on the server):
#   curl -fsSL https://raw.githubusercontent.com/gggfox/Tavli/main/scripts/sync-github-actions-ufw.sh | sudo bash
#   # or, from a checkout:
#   sudo ./scripts/sync-github-actions-ufw.sh
#
# Optional weekly cron (GitHub updates ranges periodically):
#   0 4 * * 0 root /opt/tavli/scripts/sync-github-actions-ufw.sh >> /var/log/github-actions-ufw.log 2>&1

set -euo pipefail

IPSET_NAME="github_actions"
META_URL="https://api.github.com/meta"
HTTPS_PORT="443"
MARKER="# github-actions-ufw (managed by sync-github-actions-ufw.sh)"

if [ "$(id -u)" -ne 0 ]; then
	echo "Run as root (sudo)." >&2
	exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
	echo "ufw not installed; nothing to configure." >&2
	exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ipset curl jq >/dev/null

TMP="$(mktemp)"
curl -fsSL "$META_URL" -o "$TMP"

if ! ipset list "$IPSET_NAME" >/dev/null 2>&1; then
	ipset create "$IPSET_NAME" hash:net family inet hashsize 8192 maxelem 1048576
fi

ipset flush "$IPSET_NAME"
while IFS= read -r cidr; do
	[ -n "$cidr" ] || continue
	ipset add "$IPSET_NAME" "$cidr" -exist
done < <(jq -r '.actions[]' "$TMP")

BEFORE_RULES="/etc/ufw/before.rules"
if ! grep -Fq "$MARKER" "$BEFORE_RULES"; then
	cat >>"$BEFORE_RULES" <<EOF

$MARKER
-A ufw-before-input -m set --match-set $IPSET_NAME src -p tcp --dport $HTTPS_PORT -j ACCEPT
EOF
fi

# Persist ipset across reboots (best-effort)
if [ -d /etc/ipset.conf.d ] && [ ! -f "/etc/ipset.conf.d/$IPSET_NAME" ]; then
	mkdir -p /etc/ipset.conf.d
	echo "create $IPSET_NAME hash:net family inet hashsize 8192 maxelem 1048576" \
		>"/etc/ipset.conf.d/$IPSET_NAME"
fi

ufw reload

COUNT="$(ipset list "$IPSET_NAME" | grep -c '^[0-9]' || true)"
echo "Synced $COUNT GitHub Actions CIDRs; UFW accepts TCP $HTTPS_PORT from ipset '$IPSET_NAME'."
rm -f "$TMP"
