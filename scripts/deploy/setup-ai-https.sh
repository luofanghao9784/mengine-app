#!/usr/bin/env bash
# Run on the verified 9POP host as root. Only creates the new ai.9pop.top site.
# This is an HTTPS maintenance endpoint, NOT application deployment.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'root required' >&2; exit 1; }
account=${1:?Pass an existing verified Certbot account ID}
[[ "$account" =~ ^[a-f0-9]{32}$ ]] || exit 2
test -f "/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/$account/regr.json"
site=/etc/nginx/sites-available/ai.9pop.top.conf
enabled=/etc/nginx/sites-enabled/ai.9pop.top.conf
hook=/etc/letsencrypt/renewal-hooks/deploy/50-dreamcore-ai
for file in "$site" "$enabled" "$hook"; do
  if test -e "$file" || test -L "$file"; then echo "Already exists, inspect before retry: $file" >&2; exit 3; fi
done
if nginx -T 2>/dev/null | grep -Eq 'server_name[^;]*\bai\.9pop\.top\b'; then
  echo 'A site for ai.9pop.top already exists' >&2; exit 3
fi
nginx -t
curl -fsS --max-time 8 http://127.0.0.1:8086/actuator/health
evidence=/var/lib/dreamcore/deploy-evidence/https-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$evidence"
find /etc/nginx/sites-enabled -maxdepth 1 \( -type f -o -type l \) -exec sha256sum {} \; > "$evidence/existing-sites.sha256"
install -d -m 0755 /var/lib/dreamcore/acme/.well-known/acme-challenge
cat > "$site" <<'NGINX'
server {
    listen 80;
    server_name ai.9pop.top;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/dreamcore/acme;
        try_files $uri =404;
    }
    location / {
        charset utf-8;
        default_type text/plain;
        add_header Retry-After 3600 always;
        return 503 '梦擎工作空间正在部署，请稍后访问。\n';
    }
}
NGINX
chmod 0644 "$site"
ln -s "$site" "$enabled"
if ! nginx -t; then unlink "$enabled"; exit 4; fi
systemctl reload nginx
cp "$site" "$evidence/http.conf"
# Existing ACME account only: no new registration, email changes or implicit new ToS acceptance.
certbot certonly --webroot -w /var/lib/dreamcore/acme \
  --cert-name ai.9pop.top -d ai.9pop.top --account "$account" \
  --non-interactive --keep-until-expiring
cat > "$site" <<'NGINX'
server {
    listen 80;
    server_name ai.9pop.top;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/dreamcore/acme;
        try_files $uri =404;
    }
    location / { return 301 https://ai.9pop.top$request_uri; }
}
server {
    listen 443 ssl;
    server_name ai.9pop.top;
    ssl_certificate /etc/letsencrypt/live/ai.9pop.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.9pop.top/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    location / {
        charset utf-8;
        default_type text/plain;
        add_header Retry-After 3600 always;
        return 503 '梦擎工作空间正在部署，请稍后访问。\n';
    }
}
NGINX
if ! nginx -t; then cp "$evidence/http.conf" "$site"; exit 5; fi
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > "$hook" <<'HOOK'
#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/ai.9pop.top ] || exit 0
/usr/sbin/nginx -t
/bin/systemctl reload nginx
HOOK
chmod 0755 "$hook"
sha256sum -c "$evidence/existing-sites.sha256"
curl -fsS --max-time 8 http://127.0.0.1:8086/actuator/health
# nginx reload is asynchronous: old workers may briefly present the previous default certificate.
# Keep certificate verification enabled and wait for the new worker to serve this hostname.
verified=false
for attempt in 1 2 3 4 5; do
  if code=$(curl -sS --max-time 15 --resolve ai.9pop.top:443:127.0.0.1 -o "$evidence/maintenance.txt" -w '%{http_code}' https://ai.9pop.top/) && test "$code" = 503; then
    verified=true; break
  fi
  sleep 1
done
test "$verified" = true
openssl x509 -in /etc/letsencrypt/live/ai.9pop.top/fullchain.pem -noout -subject -issuer -dates
cp "$site" "$evidence/https.conf"
printf '\nHTTPS maintenance endpoint ready; evidence: %s\n' "$evidence"
