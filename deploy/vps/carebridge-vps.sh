#!/usr/bin/env bash
# CareBridge on a single host, with no cloud account and no root.
#
#   deploy/vps/carebridge-vps.sh init       # once: secrets, database, config, services
#   deploy/vps/carebridge-vps.sh deploy     # build, migrate, publish, restart
#   deploy/vps/carebridge-vps.sh render     # re-generate config after editing vps.conf
#   deploy/vps/carebridge-vps.sh start|stop|restart|status
#   deploy/vps/carebridge-vps.sh logs [api|web|mail|valkey|postgres]
#   deploy/vps/carebridge-vps.sh admin <command> …   # organizations, roles — see apps/api/scripts/admin.ts
#   deploy/vps/carebridge-vps.sh backup     # database + documents, keeps 14
#   deploy/vps/carebridge-vps.sh dns        # the DNS records this host needs
#
# Everything the system stores lives on this machine, under $CB_HOME:
#
#   vps.conf       addresses, ports, HTTPS on/off — edit, then `render`
#   secrets.env    generated once; chmod 600; never committed
#   api.env        rendered from vps.conf
#   storage/       driver documents (the S3 replacement)
#   valkey/        queue, live positions, rate limits (the Redis replacement)
#   maddy/         outbound mail queue and DKIM key (the SES replacement)
#   caddy/         TLS certificates
#   www/           the three built web apps, as published
#   backups/       nightly database dumps and document archives
#
# PostgreSQL is the cluster already at ~/.local/share/carebridge-pg, with a
# separate database and role for production, so the development data and the
# real data never share a table.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CB_HOME="${CB_HOME:-$HOME/carebridge-prod}"
BIN="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
PG_DATA="${PG_DATA:-$HOME/.local/share/carebridge-pg}"
PG_BIN=/usr/lib/postgresql/16/bin
PG_PORT=55432
UNITS=(carebridge-postgres carebridge-valkey carebridge-mail carebridge-api carebridge-web)

# The repo pins its pnpm; corepack runs that version when pnpm is not installed.
pnpm() { if type -P pnpm >/dev/null 2>&1; then command pnpm "$@"; else corepack pnpm "$@"; fi; }

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

load_conf() {
  [ -f "$CB_HOME/vps.conf" ] || die "no $CB_HOME/vps.conf — run init first"
  # shellcheck source=/dev/null
  . "$CB_HOME/vps.conf"
  # shellcheck source=/dev/null
  set -a; . "$CB_HOME/secrets.env"; set +a
}

# ─── init ────────────────────────────────────────────────────────────────────

write_default_conf() {
  local ip
  ip="$(hostname -I | awk '{print $1}')"
  cat >"$CB_HOME/vps.conf" <<EOF
# CareBridge host configuration. Edit, then: deploy/vps/carebridge-vps.sh render && … restart

# Reached by address and port until HTTPS is switched on, and redirected to
# the domains after.
PUBLIC_IP=$ip
PORT_FAMILY=8080
PORT_OPS=8081
PORT_DRIVER=8082

# The API listens on loopback only; the web server is the only way in.
API_PORT=3300

# off: plain HTTP on the ports above. Browsers refuse location sharing on
#      plain HTTP from another machine, so the driver app cannot report GPS.
# on:  HTTPS on the three domains below, with certificates from Let's Encrypt.
#      Needs the DNS records from \`dns\` and permission to bind ports 80/443.
HTTPS=off
DOMAIN_FAMILY=care.devplusplus.xyz
DOMAIN_OPS=ops.devplusplus.xyz
DOMAIN_DRIVER=driver.devplusplus.xyz
# Optional: Let's Encrypt expiry notices.
ACME_EMAIL=

# Outbound mail is sent from this host, signed for this domain. A subdomain so
# the main domain's existing mail setup is untouched.
MAIL_DOMAIN=mail.devplusplus.xyz
MAIL_SMTP_PORT=2525
# Or relay through a provider instead: set these and MAIL_RELAY=on.
MAIL_RELAY=off
MAIL_RELAY_HOST=
MAIL_RELAY_PORT=587
MAIL_RELAY_USER=
MAIL_RELAY_PASSWORD=
MAIL_RELAY_FROM=

# Who the OpenStreetMap servers can contact about our traffic (their usage
# policy requires it). Defaults to the sender address.
MAPS_CONTACT=

# Payments. Until Stripe keys are set the pilot records plans but charges nobody.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
EOF
}

write_secrets() {
  umask 077
  cat >"$CB_HOME/secrets.env" <<EOF
# Generated $(date -u +%FT%TZ). Losing JWT_SECRET signs everybody out; losing
# MFA_SECRET_KEY makes every enrolled second factor unreadable. Back this up
# somewhere that is not this machine.
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
MFA_SECRET_KEY=$(openssl rand -base64 32 | tr -d '\n')
DB_PASSWORD=$(openssl rand -hex 24)
VALKEY_PASSWORD=$(openssl rand -hex 24)
EOF
}

ensure_postgres_unit() {
  # The cluster may already be running by hand; adopt it into systemd so it
  # comes back after a reboot.
  if ! systemctl --user is-active --quiet carebridge-postgres; then
    if "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
      say "Handing the running PostgreSQL cluster to systemd"
      "$PG_BIN/pg_ctl" -D "$PG_DATA" stop -m fast >/dev/null
    fi
    systemctl --user start carebridge-postgres
  fi
  for _ in $(seq 1 30); do
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PG_PORT" -q && return 0
    sleep 1
  done
  die "PostgreSQL did not become ready"
}

create_database() {
  local admin_url="postgresql://carebridge:carebridge-local-dev@127.0.0.1:$PG_PORT/postgres"
  psql "$admin_url" -v ON_ERROR_STOP=1 -q <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'carebridge_prod') THEN
    CREATE ROLE carebridge_prod LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE carebridge_prod LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;
EOF
  if ! psql "$admin_url" -tAc "SELECT 1 FROM pg_database WHERE datname='carebridge_prod'" | grep -q 1; then
    psql "$admin_url" -q -c "CREATE DATABASE carebridge_prod OWNER carebridge_prod"
  fi
  psql "$admin_url" -q -c "REVOKE ALL ON DATABASE carebridge_prod FROM PUBLIC"
}

init() {
  mkdir -p "$CB_HOME"/{storage,valkey,maddy/state,maddy/run,caddy,www,backups,logs} "$UNIT_DIR"
  chmod 700 "$CB_HOME"
  for b in caddy maddy valkey-server; do [ -x "$BIN/$b" ] || die "$BIN/$b is missing — see deploy/vps/README.md"; done

  [ -f "$CB_HOME/vps.conf" ] || { write_default_conf; say "Wrote $CB_HOME/vps.conf"; }
  [ -f "$CB_HOME/secrets.env" ] || { write_secrets; say "Generated $CB_HOME/secrets.env"; }
  load_conf

  render
  systemctl --user daemon-reload
  ensure_postgres_unit
  create_database
  say "Database carebridge_prod ready"
  systemctl --user enable "${UNITS[@]}" >/dev/null 2>&1
  say "Initialised. Next: $0 deploy"
}

# ─── render ──────────────────────────────────────────────────────────────────

origin_family() { if [ "$HTTPS" = on ]; then echo "https://$DOMAIN_FAMILY"; else echo "http://$PUBLIC_IP:$PORT_FAMILY"; fi; }
origin_ops() { if [ "$HTTPS" = on ]; then echo "https://$DOMAIN_OPS"; else echo "http://$PUBLIC_IP:$PORT_OPS"; fi; }
origin_driver() { if [ "$HTTPS" = on ]; then echo "https://$DOMAIN_DRIVER"; else echo "http://$PUBLIC_IP:$PORT_DRIVER"; fi; }

render_api_env() {
  local from mail_host mail_port mail_user mail_pass payments_driver unbilled
  if [ "$MAIL_RELAY" = on ]; then
    mail_host=$MAIL_RELAY_HOST mail_port=$MAIL_RELAY_PORT mail_user=$MAIL_RELAY_USER mail_pass=$MAIL_RELAY_PASSWORD
    from="${MAIL_RELAY_FROM:-CareBridge <$MAIL_RELAY_USER>}"
  else
    mail_host=127.0.0.1 mail_port=$MAIL_SMTP_PORT mail_user= mail_pass=
    from="CareBridge <no-reply@$MAIL_DOMAIN>"
  fi
  if [ -n "$STRIPE_SECRET_KEY" ]; then payments_driver=stripe unbilled=false; else payments_driver=local unbilled=true; fi

  umask 077
  cat >"$CB_HOME/api.env" <<EOF
# Rendered by carebridge-vps.sh from vps.conf — edit that, not this.
NODE_ENV=production
PORT=$API_PORT
HOST=127.0.0.1
LOG_LEVEL=info
LOG_PRETTY=false
DATABASE_URL=postgresql://carebridge_prod:$DB_PASSWORD@127.0.0.1:$PG_PORT/carebridge_prod?schema=public
REDIS_URL=redis://:$VALKEY_PASSWORD@127.0.0.1:56380
TRUST_PROXY_HOPS=1
PUBLIC_APP_URL=$(origin_family)
CORS_ORIGINS=$(origin_family),$(origin_ops),$(origin_driver)
SEED_ON_START=false

MAIL_DRIVER=smtp
MAIL_SMTP_HOST=$mail_host
MAIL_SMTP_PORT=$mail_port
MAIL_SMTP_USER=$mail_user
MAIL_SMTP_PASSWORD=$mail_pass
MAIL_FROM="$from"

PUSH_DRIVER=none

MAPS_DRIVER=osm
MAPS_CONTACT=${MAPS_CONTACT:-no-reply@$MAIL_DOMAIN}

STORAGE_DRIVER=filesystem
STORAGE_LOCAL_ROOT=$CB_HOME/storage
STORAGE_LOCAL_DURABLE=true
STORAGE_PUBLIC_BASE_URL=/api/v1

PAYMENTS_DRIVER=$payments_driver
PAYMENTS_UNBILLED_PILOT=$unbilled
STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET
PAYMENTS_WEBHOOK_SECRET=$(printf '%s' "$JWT_SECRET" | sha256sum | cut -c1-40)
EOF
  # The secrets the API reads directly.
  cat >>"$CB_HOME/api.env" <<EOF
JWT_SECRET=$JWT_SECRET
MFA_SECRET_KEY=$MFA_SECRET_KEY
EOF
}

render_valkey() {
  umask 077
  cat >"$CB_HOME/valkey/valkey.conf" <<EOF
bind 127.0.0.1
port 56380
protected-mode yes
requirepass $VALKEY_PASSWORD
dir $CB_HOME/valkey
appendonly yes
save 60 1
maxmemory 512mb
maxmemory-policy noeviction
EOF
}

render_maddy() {
  cat >"$CB_HOME/maddy/maddy.conf" <<EOF
# Outbound-only mail for CareBridge. Listens on loopback; accepts only mail
# from @$MAIL_DOMAIN; signs it with DKIM; queues and retries delivery.
\$(hostname) = $MAIL_DOMAIN
\$(primary_domain) = $MAIL_DOMAIN

hostname \$(hostname)
state_dir $CB_HOME/maddy/state
runtime_dir $CB_HOME/maddy/run
tls off
log stderr

smtp tcp://127.0.0.1:$MAIL_SMTP_PORT {
    limits {
        all rate 20 1s
        all concurrency 10
    }
    source \$(primary_domain) {
        default_destination {
            modify {
                dkim \$(primary_domain) \$(primary_domain) default
            }
            deliver_to &remote_queue
        }
    }
    default_source {
        reject 501 5.1.8 "This relay only sends CareBridge mail"
    }
}

target.remote outbound_delivery {
    limits {
        destination rate 20 1s
        destination concurrency 10
    }
    mx_auth {
        dane
        mtasts {
            cache fs
            fs_dir mtasts_cache/
        }
        local_policy {
            min_tls_level none
            min_mx_level none
        }
    }
}

target.queue remote_queue {
    target &outbound_delivery
    autogenerated_msg_domain \$(primary_domain)
    bounce {
        default_destination {
            reject 550 5.0.0 "No bounces are delivered from this host"
        }
    }
}
EOF
}

# Content-Security-Policy per app, from infrastructure/nginx: the family app
# never asks for location; the driver app does, for itself only.
CSP_BASE="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'"
PERMS_BASE="accelerometer=(), camera=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"

caddy_site_body() { # app, geolocation policy
  local app=$1 geo=$2 hsts=""
  [ "$HTTPS" = on ] && hsts='Strict-Transport-Security "max-age=31536000; includeSubDomains"'
  cat <<EOF
	encode zstd gzip
	handle /api/* {
		reverse_proxy 127.0.0.1:$API_PORT
	}
	handle {
		root * $CB_HOME/www/$app
		header {
			Content-Security-Policy "$CSP_BASE"
			Permissions-Policy "$PERMS_BASE, geolocation=$geo, screen-wake-lock=(self)"
			X-Frame-Options DENY
			X-Content-Type-Options nosniff
			Referrer-Policy no-referrer
			$hsts
			-Server
		}
		@static path /assets/* /fonts/* /icons/*
		header @static Cache-Control "public, max-age=604800"
		@page not path /assets/* /fonts/* /icons/*
		header @page Cache-Control "no-store, must-revalidate"
		try_files {path} {path}.html /index.html
		file_server
	}
	log {
		output file $CB_HOME/logs/web-$app.log {
			roll_size 20MiB
			roll_keep 5
		}
		format json
	}
EOF
}

render_caddy() {
  local global
  if [ "$HTTPS" = on ]; then
    global="storage file_system $CB_HOME/caddy
	admin unix/$CB_HOME/caddy/admin.sock"
    [ -n "$ACME_EMAIL" ] && global="$global
	email $ACME_EMAIL"
  else
    global="storage file_system $CB_HOME/caddy
	admin unix/$CB_HOME/caddy/admin.sock
	auto_https off"
  fi

  {
    printf '# Rendered by carebridge-vps.sh — edit vps.conf, not this.\n{\n\t%s\n}\n\n' "$global"
    if [ "$HTTPS" = on ]; then
      printf '%s {\n' "$DOMAIN_FAMILY"; caddy_site_body family '()'; printf '}\n\n'
      printf '%s {\n' "$DOMAIN_OPS"; caddy_site_body ops '()'; printf '}\n\n'
      printf '%s {\n' "$DOMAIN_DRIVER"; caddy_site_body driver '(self)'; printf '}\n\n'
      # One origin per app: the old address-and-port links keep working, but
      # land on HTTPS, so a session is never split across two origins.
      printf 'http://:%s {\n\tredir https://%s{uri} permanent\n}\n' "$PORT_FAMILY" "$DOMAIN_FAMILY"
      printf 'http://:%s {\n\tredir https://%s{uri} permanent\n}\n' "$PORT_OPS" "$DOMAIN_OPS"
      printf 'http://:%s {\n\tredir https://%s{uri} permanent\n}\n' "$PORT_DRIVER" "$DOMAIN_DRIVER"
    else
      printf 'http://:%s {\n' "$PORT_FAMILY"; caddy_site_body family '()'; printf '}\n\n'
      printf 'http://:%s {\n' "$PORT_OPS"; caddy_site_body ops '()'; printf '}\n\n'
      printf 'http://:%s {\n' "$PORT_DRIVER"; caddy_site_body driver '(self)'; printf '}\n'
    fi
  } >"$CB_HOME/Caddyfile"
  "$BIN/caddy" fmt --overwrite "$CB_HOME/Caddyfile" >/dev/null 2>&1 || true
  "$BIN/caddy" validate --config "$CB_HOME/Caddyfile" --adapter caddyfile >/dev/null 2>&1 \
    || { "$BIN/caddy" validate --config "$CB_HOME/Caddyfile" --adapter caddyfile; die "Caddyfile invalid"; }
}

render_units() {
  local node
  node="$(command -v node)"
  cat >"$UNIT_DIR/carebridge-postgres.service" <<EOF
[Unit]
Description=CareBridge PostgreSQL
[Service]
Type=simple
ExecStart=$PG_BIN/postgres -D $PG_DATA -p $PG_PORT -k $PG_DATA/run -c listen_addresses=127.0.0.1
ExecReload=/bin/kill -HUP \$MAINPID
KillMode=mixed
KillSignal=SIGINT
TimeoutStopSec=60
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  cat >"$UNIT_DIR/carebridge-valkey.service" <<EOF
[Unit]
Description=CareBridge Valkey (queues, live positions, rate limits)
[Service]
ExecStart=$BIN/valkey-server $CB_HOME/valkey/valkey.conf
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  cat >"$UNIT_DIR/carebridge-mail.service" <<EOF
[Unit]
Description=CareBridge outbound mail (maddy)
[Service]
ExecStart=$BIN/maddy -config $CB_HOME/maddy/maddy.conf run
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  cat >"$UNIT_DIR/carebridge-api.service" <<EOF
[Unit]
Description=CareBridge API
After=carebridge-postgres.service carebridge-valkey.service carebridge-mail.service
Wants=carebridge-postgres.service carebridge-valkey.service carebridge-mail.service
[Service]
WorkingDirectory=$ROOT/apps/api
EnvironmentFile=$CB_HOME/api.env
ExecStart=$node dist/src/main.js
Restart=on-failure
RestartSec=3
[Install]
WantedBy=default.target
EOF
  cat >"$UNIT_DIR/carebridge-web.service" <<EOF
[Unit]
Description=CareBridge web (Caddy: the three apps, the API proxy, TLS)
After=carebridge-api.service
[Service]
ExecStart=$BIN/caddy run --config $CB_HOME/Caddyfile --adapter caddyfile
ExecReload=$BIN/caddy reload --config $CB_HOME/Caddyfile --adapter caddyfile --address unix/$CB_HOME/caddy/admin.sock
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  cat >"$UNIT_DIR/carebridge-backup.service" <<EOF
[Unit]
Description=CareBridge nightly backup
[Service]
Type=oneshot
ExecStart=$ROOT/deploy/vps/carebridge-vps.sh backup
EOF
  cat >"$UNIT_DIR/carebridge-backup.timer" <<EOF
[Unit]
Description=CareBridge nightly backup
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
}

render() {
  load_conf
  render_api_env
  render_valkey
  render_maddy
  render_caddy
  render_units
  systemctl --user daemon-reload
  say "Rendered config for $(origin_family) · $(origin_ops) · $(origin_driver)"
}

# ─── deploy ──────────────────────────────────────────────────────────────────

api_env_exec() { # runs a command with the production environment
  (set -a; . "$CB_HOME/api.env"; set +a; cd "$ROOT/apps/api" && "$@")
}

deploy() {
  load_conf
  render
  cd "$ROOT"
  say "Installing dependencies"
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile >/dev/null

  say "Building the API"
  (cd apps/api && npx prisma generate >/dev/null && pnpm run build >/dev/null)

  systemctl --user start carebridge-postgres carebridge-valkey carebridge-mail
  say "Migrating the database"
  api_env_exec npx prisma migrate deploy
  api_env_exec node dist/prisma/seed.js --reference-only

  say "Building the web apps"
  for app in family ops driver; do
    VITE_ACCOUNT_APP_URL="$(origin_family)" pnpm --filter "@carebridge/$app-web" build >/dev/null
    rm -rf "$CB_HOME/www/$app.next"
    cp -r "apps/${app}_web/dist" "$CB_HOME/www/$app.next"
    rm -rf "$CB_HOME/www/$app.prev"
    [ -d "$CB_HOME/www/$app" ] && mv "$CB_HOME/www/$app" "$CB_HOME/www/$app.prev"
    mv "$CB_HOME/www/$app.next" "$CB_HOME/www/$app"
  done

  systemctl --user restart carebridge-api
  systemctl --user restart carebridge-web
  systemctl --user enable --now carebridge-backup.timer >/dev/null 2>&1
  wait_healthy
  status
}

wait_healthy() {
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health/ready" >/dev/null 2>&1; then
      say "API healthy"; return 0
    fi
    sleep 1
  done
  journalctl --user -u carebridge-api -n 40 --no-pager
  die "API did not become healthy"
}

# ─── operations ──────────────────────────────────────────────────────────────

status() {
  load_conf
  for u in "${UNITS[@]}" carebridge-backup.timer; do
    printf '%-26s %s\n' "$u" "$(systemctl --user is-active "$u" 2>/dev/null || true)"
  done
  echo
  echo "family  $(origin_family)"
  echo "ops     $(origin_ops)"
  echo "driver  $(origin_driver)"
  echo "data    $CB_HOME"
}

logs() {
  local unit=carebridge-${1:-api}
  journalctl --user -u "$unit" -n 200 -f
}

admin() {
  load_conf
  api_env_exec node dist/scripts/admin.js "$@"
}

backup() {
  load_conf
  local stamp dest
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  dest="$CB_HOME/backups"
  umask 077
  PGPASSWORD="$DB_PASSWORD" pg_dump -h 127.0.0.1 -p "$PG_PORT" -U carebridge_prod -Fc carebridge_prod \
    -f "$dest/db-$stamp.dump"
  tar -C "$CB_HOME" -czf "$dest/documents-$stamp.tgz" storage
  # Keep fourteen of each.
  ls -1t "$dest"/db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
  ls -1t "$dest"/documents-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm -f
  echo "backup $stamp written to $dest"
}

dns() {
  load_conf
  local ip dkim
  ip="$PUBLIC_IP"
  dkim=$(ls "$CB_HOME"/maddy/state/dkim_keys/*.dns 2>/dev/null | head -1 || true)
  cat <<EOF
Add these at your DNS provider (Namecheap → Domain List → devplusplus.xyz → Advanced DNS).
Host is the part before .devplusplus.xyz.

  Type  Host                          Value
  A     ${DOMAIN_FAMILY%%.devplusplus.xyz}                          $ip
  A     ${DOMAIN_OPS%%.devplusplus.xyz}                           $ip
  A     ${DOMAIN_DRIVER%%.devplusplus.xyz}                        $ip
  A     ${MAIL_DOMAIN%%.devplusplus.xyz}                          $ip
  TXT   ${MAIL_DOMAIN%%.devplusplus.xyz}                          v=spf1 ip4:$ip -all
  TXT   _dmarc.${MAIL_DOMAIN%%.devplusplus.xyz}                   v=DMARC1; p=quarantine; adkim=s; aspf=s
EOF
  if [ -n "$dkim" ]; then
    printf '  TXT   default._domainkey.%s     %s\n' "${MAIL_DOMAIN%%.devplusplus.xyz}" "$(tr -d '\n' <"$dkim")"
  else
    echo "  TXT   default._domainkey.${MAIL_DOMAIN%%.devplusplus.xyz}     (start the mail service once, then run dns again)"
  fi
  cat <<EOF

And at your server provider, set reverse DNS (PTR) for $ip to $MAIL_DOMAIN.
Existing records for devplusplus.xyz itself are not touched.
EOF
}

case "${1:-}" in
  init) init ;;
  render) render ;;
  deploy) deploy ;;
  start) systemctl --user start "${UNITS[@]}"; status ;;
  stop) systemctl --user stop carebridge-web carebridge-api carebridge-mail carebridge-valkey ;;
  restart) load_conf; systemctl --user restart carebridge-valkey carebridge-mail carebridge-api carebridge-web; wait_healthy; status ;;
  status) status ;;
  logs) shift; logs "${1:-api}" ;;
  admin) shift; admin "$@" ;;
  backup) backup ;;
  dns) dns ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
