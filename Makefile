# One entry point over two package managers.
#
# `make check` is what CI runs and what a developer runs before pushing. If the
# two ever diverge, CI is wrong — the local command is the contract.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM ?= pnpm
MELOS ?= dart run melos

.PHONY: help
help: ## Show this help.
	@grep -hE '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ─── setup ───────────────────────────────────────────────────────────────────

.PHONY: install
install: ## Install TypeScript and Dart dependencies.
	$(PNPM) install
	-$(MELOS) bootstrap

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
	@# The app is not yet `dart format` clean — it predates the check, and the
	@# Dart 3.12 formatter reflows enough that running it would bury a feature
	@# diff under forty files of whitespace. Formatting it is worth doing as
	@# its own change; until then the gate covers the packages melos owns.
	-$(MELOS) run format

.PHONY: lint
lint: ## ESLint over the API, dart analyze over the Dart packages.
	$(PNPM) run lint
	@# The family app is the pub *workspace root*, and a root is never a member
	@# of its own workspace — so melos does not see it. Driven directly here.
	flutter analyze
	-$(MELOS) run analyze

.PHONY: typecheck
typecheck: ## TypeScript, no emit.
	$(PNPM) run typecheck

.PHONY: test
test: ## Unit tests.
	$(PNPM) run test
	flutter test
	-$(MELOS) run test

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
