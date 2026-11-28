.PHONY: check land proof

# The full check: typecheck, tests, sizes. It runs on the machine that lands
# and in CI before every release.
check:
	bun install --frozen-lockfile
	bun run --filter @vantage/viewer build
	bun run check

# Lands main: release-damnit land runs the config's check (make check) on
# exactly what lands and signs its proof, which the release verifies. From a
# worktree: make land BRANCH=<branch>.
land:
	release-damnit land $(BRANCH)

# The proofs that need a real Postgres (VAN-3006, VAN-3010, VAN-2009), on a
# throwaway container; CI runs them on its own Postgres service.
PROOF_PORT ?= 55439
proof:
	docker run -d --rm --name vantage-proof-pg -e POSTGRES_PASSWORD=proof -e POSTGRES_DB=proof -p $(PROOF_PORT):5432 postgres:17 >/dev/null
	until docker exec vantage-proof-pg pg_isready -U postgres -d proof >/dev/null 2>&1; do sleep 1; done
	VANTAGE_TEST_DATABASE_URL=postgres://postgres:proof@localhost:$(PROOF_PORT)/proof bun test --timeout 120000 packages/hub/src/tracking/proof.test.ts packages/hub/src/db/postgres.test.ts; status=$$?; docker stop vantage-proof-pg >/dev/null; exit $$status
