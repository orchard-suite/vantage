.PHONY: check land

# The full check: typecheck, tests, sizes. It runs on the machine that lands
# and in CI before every release.
check:
	bun install --frozen-lockfile
	bun run --filter @vantage/viewer build
	bun run check

# Lands main only after the full check passes on this machine.
land: check
	release-damnit land $(BRANCH)
