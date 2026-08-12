# Provisioning a fresh box

> **Origin IP addresses are deliberately not written down here.** The site sits
> behind Cloudflare with an Origin Certificate, and that whole model depends on
> the origin address staying private — publish it and anyone can bypass the WAF
> and hit the box directly. Git history keeps whatever you commit, forever, even
> if you edit it out later. The real values live in the operator's password
> manager and in `~/.ssh/config` on the machines that need them.

How to get from a blank Ubuntu 24.04 VPS to something that can run All Outdoor.
Written for the case nobody wants: the production box is gone and you are
rebuilding it. It is also the recipe for a staging box, which does not currently
exist and probably should.

Production today is a self-built **Vultr** VPS at `<OLD_ORIGIN_IP>` — 4 vCPU,
7.7 GB RAM, Ubuntu 24.04.4 LTS. Not Hetzner; the operator has corrected that
more than once. The app lives at `/home/gungalore/app` and runs as the
unprivileged `gungalore` user.

Everything below is a one-time setup step. The repeatable part — shipping code
to a box that already exists — is [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

---

## Version pins that are not negotiable

| Thing | Version | Why this one |
|---|---|---|
| Ubuntu | 24.04 LTS | What production runs. 24.04 is what the PostgreSQL 16 and Meilisearch instructions below assume. |
| Node | 22.x | Production runs v22.22.2. Next 16 and NestJS 11 both want ≥ 20; `@types/node` in the backend is v24 but the runtime is 22. |
| PostgreSQL | **16**, not 17 | The dumps you will restore from are PostgreSQL **16.14**. `pg_restore` refuses a dump from a newer major, and even where it works you cannot go back. Ubuntu 24.04's default `postgresql` package is 16 — do not add the PGDG repo and take whatever is latest. |
| Meilisearch | 1.44 | Index settings are written against this API. The backend calls `updateSettings` with a filterable-attributes list on boot; older versions reject attributes they do not know. |
| nginx | 1.24 (distro) | Nothing exotic is used. The distro package is fine. |
| pm2 | 7.x | Production runs 7.0.1. |

---

## 0. Swap — do this FIRST

Not last, not "if there's a problem". First.

**The deploy builds on the server.** There is no build artefact pipeline, no CI
runner, no Docker image. `git pull` is followed by `nest build` and
`next build --webpack` executing on the same machine that is serving traffic,
next to PostgreSQL and Meilisearch. `next build --webpack` on this codebase
peaks well over 2 GB of resident memory on its own.

On a 4 GB box, with Postgres holding shared buffers and Meilisearch holding the
listing index, that does not fit. What happens is not a clean error: the kernel
OOM-killer picks the largest resident process, which is frequently PostgreSQL,
and you discover the failure as database connection errors on a site that was
fine ninety seconds ago. Or the build is killed midway, leaving a half-written
`.next/` directory — and if anything restarts the frontend at that moment you
get `ENOENT: required-server-files.json` and a 500 on every page. That exact
sequence took the site down for about ten minutes on 2026-07-20.

**This is the single most likely way a first deploy on a new box fails.**

Production runs an 8 GB swapfile (2× RAM at the time it was created). On a 4 GB
box use 8 GB; do not go below 4 GB.

```bash
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
swapon --show      # confirm: /swapfile  file  8G
```

Leave `vm.swappiness` at the default 60. Production does. The point of the swap
is to be *available* during a build, not to be used continuously — if you see
swap actually filling in steady state, the box is undersized and tuning
swappiness will only hide it.

---

## 1. Base system and a non-root user

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl build-essential ufw

sudo adduser --disabled-password --gecos "" gungalore
sudo usermod -aG sudo gungalore
sudo mkdir -p /home/gungalore/.ssh
# paste the deploy public key into /home/gungalore/.ssh/authorized_keys
sudo chown -R gungalore:gungalore /home/gungalore/.ssh
sudo chmod 700 /home/gungalore/.ssh && sudo chmod 600 /home/gungalore/.ssh/authorized_keys
```

Disable password SSH before you do anything else — `PasswordAuthentication no`
and `PermitRootLogin no` in `/etc/ssh/sshd_config`, then
`sudo systemctl restart ssh`. This box has a public IP and gets scanned within
minutes of coming up.

Firewall — only 22, 80 and 443 need to be open. Postgres (5432) and Meilisearch
(7700) are bound to localhost and must stay that way; Meilisearch in particular
will happily serve the entire catalogue to anyone who can reach the port.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Add the SSH alias on YOUR machine, not the server — `~/.ssh/config`:

```
Host gungalore
    HostName <OLD_ORIGIN_IP>
    User gungalore
    IdentityFile ~/.ssh/your_deploy_key
```

Always `ssh gungalore`. Never `ssh gungalore@<OLD_ORIGIN_IP>` — that form skips
the alias, does not find the key, and prompts for a password nobody has.

---

## 2. fail2ban

One jail, `sshd`, is what production runs and it is enough given that password
auth is off. It exists to stop the log noise and the CPU cost of a brute-force
attempt, not as the primary control.

```bash
sudo apt -y install fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status          # expect: Jail list: sshd
```

Ubuntu's default `sshd` jail config is fine as shipped. If you add a jail for
nginx, remember the Cloudflare problem: without the `set_real_ip_from` block in
[`infra/nginx/alloutdoor.conf`](../nginx/alloutdoor.conf) the access log would
be full of Cloudflare edge IPs, and banning one of those bans a chunk of the
internet. The block is present, so the logs are correct — just be aware of the
dependency before you write an nginx jail.

---

## 3. Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v      # v22.x
which npm    # /usr/bin/npm — matches the path in infra/pm2/ecosystem.config.js
```

If you install Node via nvm instead, `which npm` will be somewhere under
`~/.nvm/`, and you must update the `script` path in the pm2 ecosystem file to
match. pm2 does not resolve it from the shell's PATH at restart time.

---

## 4. PostgreSQL 16

```bash
sudo apt -y install postgresql postgresql-contrib
psql --version      # must say 16.x
```

If that prints 17, stop. You are on a distro release that ships 17, or someone
added the PGDG repo. Get 16 explicitly (`sudo apt -y install postgresql-16`)
before going further — restoring a 16.14 dump into 17 is a one-way door.

Create the role and database. Generate a real password; do not reuse anything.

```bash
sudo -u postgres psql
```
```sql
CREATE ROLE gungalore WITH LOGIN PASSWORD '<generate-a-strong-one>';
CREATE DATABASE gungalore OWNER gungalore;
\q
```

The connection string goes into `backend/.env` as `DATABASE_URL` and nowhere
else. Keep Postgres on `listen_addresses = 'localhost'` (the default).

**Restoring a dump.** When you take a `pg_dump` off production for local or
staging use, strip the `?schema=public` query parameter from the URL first —
`pg_dump` treats it as part of the database name and fails with a confusing
"database does not exist".

**Schema drift you must know about.** Three services (Ask Boet's knowledge
base, the reloading-manual full-text search, and listings full-text search) add
`tsvector GENERATED` columns and GIN indexes at boot via raw DDL. Those columns
are **not** in `schema.prisma`. They appear on first backend boot. Two
consequences:

- `npx prisma db push --accept-data-loss` will drop them, and the next boot
  does not recreate the indexes cleanly. Never run `db push` against a real
  database.
- A freshly restored dump plus a first backend boot is the correct way to get
  them. Give the backend a minute after first start before assuming search is
  broken.

---

## 5. Meilisearch 1.44

```bash
curl -L https://install.meilisearch.com | sh
sudo mv ./meilisearch /usr/local/bin/
meilisearch --version      # meilisearch 1.44.0
```

Run it as a systemd service bound to localhost, with a master key. The key goes
into `backend/.env` as `MEILISEARCH_API_KEY`, with `MEILISEARCH_HOST` set to
`http://127.0.0.1:7700`.

`/etc/systemd/system/meilisearch.service`:

```ini
[Unit]
Description=Meilisearch
After=network.target

[Service]
Type=simple
User=gungalore
ExecStart=/usr/local/bin/meilisearch \
  --db-path /var/lib/meilisearch/data.ms \
  --http-addr 127.0.0.1:7700 \
  --env production \
  --master-key ${MEILI_MASTER_KEY}
EnvironmentFile=/etc/meilisearch.env
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/meilisearch.env` holds `MEILI_MASTER_KEY=…`, mode 0600, owned by root.
That file is a secret and never goes in git.

```bash
sudo mkdir -p /var/lib/meilisearch && sudo chown gungalore:gungalore /var/lib/meilisearch
sudo systemctl daemon-reload && sudo systemctl enable --now meilisearch
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:7700/health
```

`--env production` is what makes Meilisearch *require* the master key. Without
it, it runs open and warns in a log nobody reads.

The backend degrades gracefully if Meilisearch is absent — `search.service.ts`
logs `MEILISEARCH_HOST not set — search disabled` and the site works without
search. Useful to know when triaging: a dead search box does not mean a dead
site, and vice versa.

Index population is not automatic on a new box. After the backend is up, run
the admin reindex from `/admin` (or the corresponding cron will pick it up).
`publicVisible` must be present in the index's filterable attributes or the
anonymous catalogue query fails outright — see the "Public vs Members" section
of `CLAUDE.md`.

---

## 6. nginx and the origin certificate

```bash
sudo apt -y install nginx
sudo mkdir -p /etc/ssl/cloudflare
```

Generate a **Cloudflare Origin Certificate** in the Cloudflare dashboard
(SSL/TLS → Origin Server → Create Certificate). Save the certificate as
`/etc/ssl/cloudflare/gungalore.pem` and the private key as
`/etc/ssl/cloudflare/gungalore.key`:

```bash
sudo chmod 600 /etc/ssl/cloudflare/gungalore.key
sudo chown root:root /etc/ssl/cloudflare/*
```

Set the Cloudflare SSL/TLS encryption mode to **Full (strict)**. Anything less
and the leg between the edge and the origin is either unencrypted or
unverified.

Do not reach for certbot. While the orange cloud is on, Let's Encrypt's HTTP-01
challenge is answered by Cloudflare, not by this box.

Install the site:

```bash
sudo cp infra/nginx/alloutdoor.conf /etc/nginx/sites-available/gungalore
sudo ln -s /etc/nginx/sites-available/gungalore /etc/nginx/sites-enabled/gungalore
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` before every reload, always. A syntax error on reload leaves the old
config running (good), but a syntax error on *restart* leaves nginx down.

Also create the Google Search Console verification file the config references,
or that one location block 404s:

```bash
sudo mkdir -p /var/www/gg-verify
# place google8e0764cb4d0beea8.html there (content comes from Search Console)
```

There is other, unrelated stuff on this box: the Ballistic Calculator
(`ballistics.gungalore.co.za`, its own database, its own pm2 processes, its own
nginx site) and a static marketing page at `/var/www/html`. Neither is part of
the marketplace. Do not touch them.

---

## 7. The application

```bash
sudo -iu gungalore
git clone git@github.com:gungalore/gun_galore.git ~/app
cd ~/app
git checkout <the deployment branch — see docs/DEPLOYMENT.md>
mkdir -p ~/app/logs
```

Fill in the environment files from the templates. These are the only places
secrets live:

```bash
cp backend/.env.example  backend/.env             # then fill in every value
cp frontend/.env.example frontend/.env.production # then fill in every value
chmod 600 backend/.env frontend/.env.production
```

Read `backend/.env.example` carefully — several of the variables are not
optional in the way they look. `backend/src/main.ts` has a boot gate that
*throws* on a missing or default `JWT_ADMIN_SECRET` in production (the process
will not start, by design), and logs loud errors for missing Clerk, Peach, TCG
and Anthropic credentials. A backend that boots but shouts is a backend running
with a feature degraded to a manual-review or blocked path.

Then build and start:

```bash
cd ~/app/backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build

cd ~/app/frontend
npm install
npm run build          # this is the memory-hungry one — see §0

cd ~/app
pm2 start infra/pm2/ecosystem.config.js
pm2 save
pm2 startup systemd    # prints a sudo command — run it
```

`pm2 save` writes the current process list to `~/.pm2/dump.pm2`, and
`pm2 startup` installs the systemd unit that replays it at boot. Skip either
one and the site simply does not come back after a reboot. Verify with
`systemctl is-enabled pm2-gungalore` → `enabled`.

---

## 8. Verify

```bash
curl -f  http://localhost:3001/api/health   # {"status":"ok","timestamp":…}
curl -fs http://localhost:3000 > /dev/null && echo FRONTEND OK
pm2 list                                    # both online, restart count 0
curl -sI https://gungalore.co.za | head -1  # through Cloudflare
```

Then check the real-IP path is working, because it is silent when it is broken:

```bash
sudo tail -n 5 /var/log/nginx/access.log
```

The leading address should be a plausible visitor IP, not a Cloudflare edge
address (Cloudflare's ranges are listed at the top of the nginx config). If it
is a Cloudflare address, the `set_real_ip_from` block is not loading and every
rate limit in the backend is now one shared bucket for the whole country.

---

## Ports, for reference

| Port | Service | Exposed |
|---|---|---|
| 3000 | Next.js (`next start`) | localhost only, via nginx |
| 3001 | NestJS (`dist/src/main.js`) | localhost only, via nginx `/api/` |
| 5432 | PostgreSQL 16 | localhost only |
| 7700 | Meilisearch 1.44 | localhost only |
| 80 / 443 | nginx | public |

---

## What is still not automated

Worth knowing before you plan your first week:

- **No staging.** Changes go from a local build and type-check straight to
  production. Provisioning a second box with this document is the cheapest way
  to fix that.
- **No CI.** Type-checks and builds run on the developer's machine and then
  again on the server. Nothing enforces that they passed.
- **No configuration management.** This document is the closest thing. If you
  change something on the server, change it here in the same breath.
- **No automated database backups documented here.** Confirm with the operator
  what exists (Vultr snapshots, `pg_dump` cron) before you rely on it.
