.PHONY: install infra dev seed test lint typecheck build check chaos-down chaos-heal compose-up compose-down

install:
	pnpm install

infra:
	./scripts/infra.sh up

dev:
	pnpm dev

seed:
	pnpm seed

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build

check: typecheck lint test build

chaos-down:
	./scripts/chaos.sh down

chaos-heal:
	./scripts/chaos.sh healthy

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down
