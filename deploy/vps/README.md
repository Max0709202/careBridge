# CareBridge on one VPS

The whole product runs on this host, with no cloud account, as the unprivileged user. Everything is stored under `~/carebridge-prod`.

| Replaces | With | Where the data lives |
|---|---|---|
| RDS | PostgreSQL 16 (the cluster at `~/.local/share/carebridge-pg`), database `carebridge_prod` | that cluster |
| ElastiCache | Valkey 9 (Redis-compatible), `127.0.0.1:56380` | `~/carebridge-prod/valkey` |
| S3 | the filesystem storage adapter, behind the API's signed URLs | `~/carebridge-prod/storage` |
| SES | maddy, outbound only, DKIM-signed, `127.0.0.1:2525` | `~/carebridge-prod/maddy` |
| CloudFront / ALB | Caddy: the three apps, the `/api` proxy, TLS | `~/carebridge-prod/caddy` |
| Google Maps | OpenStreetMap (Nominatim + OSRM) | none (no key) |

Each of these runs as a systemd **user** unit: `carebridge-{postgres,valkey,mail,api,web}` and a nightly `carebridge-backup.timer`. The API listens on loopback only, so the web server is the only way in.

## Day to day

```sh
deploy/vps/carebridge-vps.sh status
deploy/vps/carebridge-vps.sh deploy          # after pulling new code: build, migrate, publish, restart
deploy/vps/carebridge-vps.sh logs api        # or web, mail, valkey, postgres
deploy/vps/carebridge-vps.sh backup          # also runs nightly at 03:30
```

Settings are in `~/carebridge-prod/vps.conf`. After you edit it, run `deploy` (or `render && restart` if the web apps don't need rebuilding).

## Bringing a transport operator on

Nobody gets an account made for them. Each person signs up in the family app and clicks the link in the verification email. Then:

```sh
# 1. The operator's owner signs up at the family app, verifies, then:
deploy/vps/carebridge-vps.sh admin create-org --name "Acme Transit" --slug acme-transit \
    --contact-email ops@acme.com --owner dana@acme.com

# 2. More console staff (each signs up and verifies first):
deploy/vps/carebridge-vps.sh admin add-member --org acme-transit --email sam@acme.com --role dispatcher

# 3. You, as platform staff (then turn on two-factor in Settings → Security):
deploy/vps/carebridge-vps.sh admin set-platform-role --email you@example.com --role admin

deploy/vps/carebridge-vps.sh admin list-orgs
deploy/vps/carebridge-vps.sh admin account --email someone@example.com
```

**Drivers** need nothing from the CLI. The owner adds a vehicle and a driver in the ops console, using the driver's email address. The driver signs up in the family app with that address and verifies it. When they sign in to the driver app, they are linked to that roster place automatically. They upload their licence, insurance and registration, the ops console approves each document and then the driver, and the driver goes on shift.

**Families** sign up themselves, add a person they care for and their clinic, book an appointment and request a ride. The ride shows up in every operator's dispatch queue. A dispatcher assigns it, the driver works it, and the family watches the car live.

## Steps that need you (root, DNS, accounts)

1. **Keep the services running after logout and reboot.** Run once: `sudo loginctl enable-linger remoteuser`.
2. **DNS.** Run `deploy/vps/carebridge-vps.sh dns` and add the records it prints. They are all subdomains, so the existing `devplusplus.xyz` website and mail forwarding are left alone.
3. **Reverse DNS.** At the server provider, set the PTR record for the IP to `mail.devplusplus.xyz`. Without it, Gmail and Outlook will send the verification emails to spam or reject them.
4. **HTTPS.** Let Caddy bind ports 80/443, then switch HTTPS on:
   ```sh
   sudo setcap cap_net_bind_service=+ep /home/remoteuser/.local/opt/caddy/caddy
   # (and open 80/443 in the firewall if one is active, e.g. sudo ufw allow 80,443/tcp)
   sed -i 's/^HTTPS=off/HTTPS=on/' ~/carebridge-prod/vps.conf
   deploy/vps/carebridge-vps.sh deploy
   ```
   Caddy gets the certificates itself. The old `IP:8080/8081/8082` links then redirect to the domains. **Drivers' GPS needs this step**: browsers only allow location access over HTTPS.
5. **Payments (optional).** Until Stripe is set up, the pilot records plans and seats but charges nobody (the API logs a warning about this at boot). To charge for real, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `vps.conf`. Point Stripe's webhook at `https://care.devplusplus.xyz/api/v1/billing/webhooks/payments`, then run `deploy`.
6. **Off-site backups.** `~/carebridge-prod/backups` sits on the same disk as the data. Copy it somewhere else regularly, together with `~/carebridge-prod/secrets.env`, which you need to read the backups back.

## Restoring

```sh
deploy/vps/carebridge-vps.sh stop
pg_restore --clean --if-exists -d "postgresql://carebridge_prod:<DB_PASSWORD>@127.0.0.1:55432/carebridge_prod" \
    ~/carebridge-prod/backups/db-<stamp>.dump
tar -C ~/carebridge-prod -xzf ~/carebridge-prod/backups/documents-<stamp>.tgz
deploy/vps/carebridge-vps.sh start
```

## Limits worth knowing

- The public OpenStreetMap servers are shared community infrastructure, limited to roughly one request per second. Usage here is low (geocoding when an address is saved, routing behind the ETA cache). If it grows, point `MAPS_GEOCODER_URL` / `MAPS_ROUTER_URL` at your own instances, or set `MAPS_DRIVER=google` with a key.
- One host means one disk. The nightly backup protects against mistakes, not against losing the machine, so see step 6.
- There is no device push (`PUSH_DRIVER=none`). The web apps show every notification in their inbox.
- Live card payments need one more piece of work. The "Add a card" dialogs ask for a payment-provider token (`tok_…`), and a real customer can only get one from a Stripe Elements card form, which the web apps don't have yet. Until it's built, keep the unbilled pilot.
- Console staff are added from the CLI. The ops console has no team-management screen yet.
