#!/usr/bin/env bash
# One-command setup for the RPM WhatsApp server on a fresh Ubuntu LTS VM.
# Run from this folder:  sudo bash setup-vm.sh
# Values can be given as environment variables to skip the questions:
#   DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN, WAHA_DASHBOARD_PASSWORD
set -euo pipefail

cd "$(dirname "$0")"
DIR="$(pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Please run with sudo: sudo bash setup-vm.sh"; exit 1; fi
RUN_USER="${SUDO_USER:-ubuntu}"

say() { printf '\n==> %s\n' "$1"; }

# ---------- questions ----------
if [ -f .env ]; then
  say "Found an existing .env, keeping it"
  set -a; . ./.env; set +a
else
  [ -n "${DUCKDNS_SUBDOMAIN:-}" ] || read -rp "DuckDNS subdomain (just the name, e.g. rpm-wa): " DUCKDNS_SUBDOMAIN
  [ -n "${DUCKDNS_TOKEN:-}" ] || read -rsp "DuckDNS token (hidden): " DUCKDNS_TOKEN; echo
  if [ -z "${WAHA_DASHBOARD_PASSWORD:-}" ]; then
    read -rsp "Dashboard password (leave empty to generate one): " WAHA_DASHBOARD_PASSWORD; echo
    [ -n "$WAHA_DASHBOARD_PASSWORD" ] || WAHA_DASHBOARD_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=')"
  fi
  DUCKDNS_SUBDOMAIN="${DUCKDNS_SUBDOMAIN%.duckdns.org}"
  WAHA_DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"
  WAHA_API_KEY="$(openssl rand -hex 32)"
  case "$(uname -m)" in
    aarch64|arm64) WAHA_IMAGE="devlikeapro/waha:arm" ;;
    *) WAHA_IMAGE="devlikeapro/waha:latest" ;;
  esac
  umask 077
  cat > .env <<EOF
WAHA_DOMAIN=${WAHA_DOMAIN}
WAHA_IMAGE=${WAHA_IMAGE}
WAHA_API_KEY=${WAHA_API_KEY}
WAHA_DASHBOARD_USERNAME=rpm
WAHA_DASHBOARD_PASSWORD=${WAHA_DASHBOARD_PASSWORD}
DUCKDNS_SUBDOMAIN=${DUCKDNS_SUBDOMAIN}
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
EOF
  chown "$RUN_USER" .env
  umask 022
fi

# ---------- system ----------
say "Updating the system"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg unattended-upgrades

say "Turning on automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# Small free VMs have little memory: add swap so WAHA never runs out
if ! swapon --show | grep -q swapfile; then
  say "Adding 2GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- docker ----------
if ! command -v docker >/dev/null; then
  say "Installing Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  usermod -aG docker "$RUN_USER" || true
fi
systemctl enable --now docker

# ---------- firewall: only 80 and 443 (plus SSH) ----------
say "Opening ports 80 and 443"
if command -v iptables >/dev/null; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi
fi

# ---------- DuckDNS ----------
say "Pointing ${WAHA_DOMAIN} at this server (DuckDNS, refreshed every 5 minutes)"
install -d -m 700 -o "$RUN_USER" /home/"$RUN_USER"/duckdns
cat > /home/"$RUN_USER"/duckdns/duck.sh <<EOF
#!/bin/sh
echo url="https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" | curl -s -o /home/${RUN_USER}/duckdns/duck.log -K -
EOF
chmod 700 /home/"$RUN_USER"/duckdns/duck.sh
chown "$RUN_USER" /home/"$RUN_USER"/duckdns/duck.sh
sh /home/"$RUN_USER"/duckdns/duck.sh
echo "DuckDNS replied: $(cat /home/"$RUN_USER"/duckdns/duck.log)"
( crontab -u "$RUN_USER" -l 2>/dev/null | grep -v duckdns/duck.sh; echo "*/5 * * * * /home/${RUN_USER}/duckdns/duck.sh >/dev/null 2>&1" ) | crontab -u "$RUN_USER" -

# ---------- start ----------
mkdir -p data/sessions data/media
chown -R "$RUN_USER" "$DIR"
say "Starting WAHA and Caddy"
docker compose pull
docker compose up -d

say "Waiting for HTTPS to come up (can take a minute)"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "https://${WAHA_DOMAIN}/ping" 2>/dev/null; then ok=1; break; fi
  sleep 5
done

echo
echo "------------------------------------------------------------"
if [ "${ok:-0}" = "1" ]; then echo "Server is live: https://${WAHA_DOMAIN}"; else echo "Started, but HTTPS is not answering yet. Check ports 80/443 are open in the cloud firewall."; fi
echo "Dashboard:      https://${WAHA_DOMAIN}/dashboard"
echo "Dashboard user: rpm"
echo "Dashboard pass and API key are in: ${DIR}/.env"
echo "------------------------------------------------------------"
