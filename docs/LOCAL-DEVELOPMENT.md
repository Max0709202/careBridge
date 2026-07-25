# Local development

Setup for CareBridge, including Windows with WSL 2.

---

## Requirements

| Tool     | Version   | Notes                                        |
| -------- | --------- | -------------------------------------------- |
| Node.js  | ≥ 20.11   | 22 LTS or 24 both fine                        |
| pnpm     | 11.x      | The only supported package manager            |
| Git      | any       |                                               |
| Docker   | optional  | Only for running Supabase locally (Phase 2)   |

---

## Windows with WSL 2 (recommended)

Next.js file watching and pnpm's linking are both noticeably faster on a Linux
filesystem. Keep the repository **inside** WSL, not on `/mnt/c` — crossing the
filesystem boundary is the single biggest cause of slow rebuilds on Windows.

### 1. Install WSL 2

In PowerShell **as Administrator**:

```powershell
wsl --install -d Ubuntu
```

Reboot, then set a UNIX username and password when Ubuntu first launches.

Verify you are on version 2:

```powershell
wsl -l -v      # VERSION column must read 2
```

### 2. Install Node and pnpm inside WSL

```bash
# Node via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec $SHELL
nvm install 22
nvm use 22

# pnpm via corepack (ships with Node)
corepack enable pnpm
pnpm -v
```

### 3. Clone into the WSL filesystem

```bash
cd ~
mkdir -p projects && cd projects
git clone <repository-url> carebridge
cd carebridge
```

`~/projects/...`, **not** `/mnt/c/Users/...`.

### 4. Install and run

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open <http://localhost:3000> in Windows — WSL 2 forwards localhost
automatically.

### 5. Editor

Install the **WSL** extension for VS Code and open the folder with `code .`
from inside WSL, so the extension host runs Linux-side.

---

## Windows without WSL

Supported, but slower. Install Node from nodejs.org, then:

```powershell
npm install -g pnpm
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

If `pnpm` is not recognised afterwards, the npm global bin directory is not on
`PATH`. Add the output of `npm config get prefix` to your user `PATH` and open a
new terminal.

---

## macOS / Linux

```bash
corepack enable pnpm
pnpm install
cp .env.example .env.local
pnpm dev
```

---

## Environment

`.env.local` is git-ignored. `.env.example` contains placeholder names only and
is the file to update when a new variable is introduced.

**Phase 1 needs no credentials.** Every integration falls back to a local
development adapter that logs a safe, redacted line instead of contacting a
third party.

Configuration is validated by Zod at startup. A missing or malformed value
fails fast with the variable *name* — never its value.

---

## Database (Phase 2)

Not yet wired. When it lands:

```bash
pnpm db:generate    # generate a migration from the Drizzle schema
pnpm db:migrate     # apply migrations
pnpm db:seed        # load clearly fictional development data
```

Seed data is fictional by rule: `example.test` email addresses, `555-01xx`
telephone numbers (reserved for fiction), and invented names and addresses.
Never load real personal data into any environment.

---

## Everyday commands

```bash
pnpm dev             # dev server
pnpm check           # lint + typecheck + unit tests — run before committing
pnpm test:watch      # unit tests in watch mode
pnpm format          # Prettier write
```

### End-to-end tests

First run only:

```bash
pnpm test:e2e:install
```

Then:

```bash
pnpm test:e2e
```

Playwright builds the app and serves it on **port 3100**, so it does not
collide with a `pnpm dev` session on 3000.

On plain Windows, Playwright's `--with-deps` flag is a Linux-only concept and
is ignored; browsers still install. In WSL, run
`pnpm exec playwright install-deps` once if the browser fails to launch.

---

## Troubleshooting

| Symptom                                            | Fix                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm: command not found`                          | `corepack enable pnpm`, or add npm's global bin to `PATH`                |
| `ERR_PNPM_IGNORED_BUILDS`                          | Expected for reviewed native packages; they are allow-listed in `pnpm-workspace.yaml` |
| Very slow rebuilds on Windows                      | The repo is on `/mnt/c`. Move it inside the WSL filesystem                |
| `Invalid server environment configuration`         | A variable in `.env.local` is missing or malformed — the message names it |
| Port 3000 already in use                           | `pnpm dev --port 3001`                                                   |
| Playwright cannot launch a browser                 | `pnpm test:e2e:install`, then `pnpm exec playwright install-deps` on Linux/WSL |
| ESLint rejects `process.env`                       | Intentional. Add the variable to `src/lib/env/schema.ts` and read it from there |
| ESLint rejects a `@/server/*` import in a component | Intentional. Fetch on the server and pass plain data down as props       |
