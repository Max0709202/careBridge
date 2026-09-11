# One entry point over two package managers.
#
# `make check` is what CI runs and what a developer runs before pushing. If the
# two ever diverge, CI is wrong — the local command is the contract.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM ?= pnpm
MELOS ?= dart run melos

# The host port the API is published on.
#
# docker-compose publishes it as `127.0.0.1:$${API_PORT:-3000}:3000`, so an
# .env that moves the port moves it for the app too — and the app fails the
# only way it can: `NetworkFailure`, rendered as "We could not reach
# CareBridge. Check your connection." Nothing in that message can tell a
# developer they are dialling a port nobody is listening on, so the number is
# read from the same place compose reads it rather than written twice.
API_PORT ?= $(strip $(shell sed -n 's/^API_PORT=//p' .env 2>/dev/null | tail -1))
ifeq ($(API_PORT),)
API_PORT := 3000
endif

.PHONY: help
help: ## Show this help.
	@grep -hE '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ─── setup ───────────────────────────────────────────────────────────────────

.PHONY: install
install: ## Install TypeScript and Dart dependencies.
	$(PNPM) install
	$(MELOS) bootstrap

.PHONY: ops
ops: ## Run the dispatch console in Chrome against a local API.
	cd apps/ops_console && flutter run -d chrome \
		--dart-define=CAREBRIDGE_API_BASE_URL=http://localhost:$(API_PORT)/api/v1

.PHONY: driver
driver: ## Run the driver app on an attached device or emulator.
	@# 10.0.2.2 is the Android emulator's alias for the host machine's
	@# loopback. On a physical handset, replace it with the machine's LAN
	@# address — localhost on a phone is the phone.
	cd apps/driver_app && flutter run \
		--dart-define=CAREBRIDGE_API_BASE_URL=http://10.0.2.2:$(API_PORT)/api/v1

# ─── release builds ──────────────────────────────────────────────────────────
#
# The one thing these targets exist to enforce is that API_URL is set. A
# release build with no base URL used to compile, sign, upload, install and
# then fail every request as a network error — the default `/api/v1` is
# relative, which only means anything on web, where nginx proxies it from the
# same origin. That is now refused at startup rather than shipped, and refused
# here rather than at startup.

API_URL ?=

.PHONY: _require-api-url
_require-api-url:
	@if [ -z "$(API_URL)" ]; then \
		echo "API_URL is required for a release build. On a device there is no"; \
		echo "page for the default /api/v1 to be relative to."; \
		echo; \
		echo "  make $(MAKECMDGOALS) API_URL=https://staging.carebridge.example/api/v1"; \
		exit 1; \
	fi

.PHONY: release-android
release-android: _require-api-url ## Build both Android app bundles. Needs API_URL=https://…
	flutter build appbundle --release --dart-define=CAREBRIDGE_API_BASE_URL=$(API_URL)
	cd apps/driver_app && flutter build appbundle --release \
		--dart-define=CAREBRIDGE_API_BASE_URL=$(API_URL)
	@echo
	@echo "  family → build/app/outputs/bundle/release/app-release.aab"
	@echo "  driver → apps/driver_app/build/app/outputs/bundle/release/app-release.aab"
	@echo
	@echo "Unsigned with a real key unless android/key.properties exists."
	@echo "See docs/runbooks/release-android.md."

.PHONY: release-ios
release-ios: _require-api-url ## Build both iOS archives. macOS only. Needs API_URL=https://…
	@# There is no way around the macOS requirement: the iOS toolchain, the
	@# code signer and the uploader are macOS-only binaries.
	flutter build ipa --release --dart-define=CAREBRIDGE_API_BASE_URL=$(API_URL)
	cd apps/driver_app && flutter build ipa --release \
		--dart-define=CAREBRIDGE_API_BASE_URL=$(API_URL)
	@echo
	@echo "Upload with Transporter. See docs/runbooks/release-ios.md."

.PHONY: up
up: ## Start Postgres, Redis, Mailpit and MinIO.
	docker compose up -d db redis mailpit minio
	@echo "Mailpit UI  → http://localhost:8025"
	@echo "MinIO UI    → http://localhost:9001"

.PHONY: down
down: ## Stop the local stack, keeping volumes.
	docker compose down

.PHONY: reset-db
reset-db: ## Drop and recreate the database, then migrate and seed. Destructive.
	$(PNPM) --filter @carebridge/api exec prisma migrate reset --force

# ─── development ─────────────────────────────────────────────────────────────

.PHONY: migrate
migrate: ## Apply pending migrations to the local database.
	$(PNPM) --filter @carebridge/api exec prisma migrate dev

.PHONY: seed
seed: ## Load the fictional demo family.
	$(PNPM) --filter @carebridge/api run seed

.PHONY: api
api: ## Run the API in watch mode.
	$(PNPM) --filter @carebridge/api run start:dev

.PHONY: openapi
openapi: ## Regenerate packages/contracts/openapi.json from the running decorators.
	$(PNPM) run openapi

.PHONY: dart-client
dart-client: openapi ## Regenerate the Dart client from the OpenAPI document.
	node scripts/generate-dart-client.mjs
	dart format packages/dart/carebridge_api
	@# Regenerating is not enough — the output has to compile. A generator
	@# change emitting a missing type produces a stable diff and a client
	@# nobody can build.
	cd packages/dart/carebridge_api && dart pub get && dart analyze

# ─── verification ────────────────────────────────────────────────────────────

.PHONY: format
format: ## Check formatting (does not rewrite).
	$(PNPM) run format
	@# The app is the pub workspace root and therefore not a melos member, so
	@# it is checked directly. Fails rather than rewrites: a gate that edits
	@# your tree tells you nothing about the commit you were about to push.
	dart format --output=none --set-exit-if-changed lib test
	$(MELOS) run format

.PHONY: lint
lint: ## ESLint over the API, dart analyze over the Dart packages.
	$(PNPM) run lint
	@# The family app is the pub *workspace root*, and a root is never a member
	@# of its own workspace — so melos does not see it. Driven directly here.
	@# The console and the shared packages *are* members, so melos covers them.
	flutter analyze
	$(MELOS) run analyze

.PHONY: typecheck
typecheck: ## TypeScript, no emit.
	$(PNPM) run typecheck

.PHONY: test
test: ## Unit tests, with the coverage floors enforced.
	@# `pnpm test` runs jest with --coverage: the thresholds in
	@# apps/api/jest.config.js only apply when coverage is collected, and a
	@# gate you have to remember a flag for is not a gate.
	$(PNPM) run test
	flutter test --coverage
	node scripts/check-dart-coverage.mjs
	@# Covers the ops console and carebridge_client, which are workspace
	@# members rather than the root package.
	$(MELOS) run test
	@# The driver app runs again with coverage, because it is the one package
	@# whose lib/domain is not a mirror of anything: the cadence rules exist
	@# only there, so nothing on the server would catch them being wrong.
	cd apps/driver_app && flutter test --coverage
	node scripts/check-dart-coverage.mjs apps/driver_app

.PHONY: test-integration
test-integration: ## Integration tests against containerised Postgres and Redis.
	$(PNPM) run test:integration

.PHONY: contract-drift
contract-drift: ## Fail if the committed OpenAPI document is stale.
	$(PNPM) run openapi
	@git diff --exit-code --stat packages/contracts/openapi.json \
		|| (echo ""; echo "openapi.json is stale — run 'make dart-client' and commit the result."; exit 1)

.PHONY: check
check: format lint typecheck test contract-drift ## Everything CI runs, in CI's order.
	@echo "✓ check passed"
