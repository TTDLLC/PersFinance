# Local Docker Testing

This project can be tested locally with Docker Desktop using Docker Compose.

## First-time setup

Copy the example Docker environment file:

```bash
cp .env.docker.example .env.docker
```

Edit `.env.docker` if needed.

The default local login from the example file is:

```text
Email: admin@example.com
Password: change-this-local-password
```

Do not use these credentials outside local testing.

## Build and start the database

```bash
docker compose up -d db
```

## Run migrations

```bash
docker compose --profile tools run --rm migrate
```

## Seed development data

```bash
docker compose --profile tools run --rm seed
```

## Start the app

```bash
docker compose up --build app
```

Open:

```text
http://localhost:3000
```

## Normal local test flow

After the first setup, the usual flow is:

```bash
docker compose up --build app
```

If migrations changed:

```bash
docker compose --profile tools run --rm migrate
```

If seed data needs to be reset or ensured:

```bash
docker compose --profile tools run --rm seed
```

## Database access

The Postgres container listens inside Docker on port `5432`.

For host tools on the Mac, it is mapped to:

```text
localhost:5433
```

Connection string from the host:

```text
postgresql://finance_app:finance_dev_password@localhost:5433/finance_projection
```

Connection string from inside Docker:

```text
postgresql://finance_app:finance_dev_password@db:5432/finance_projection
```

## Reset local Docker database

Warning: this deletes local Docker test data.

```bash
docker compose down -v
docker compose up -d db
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed
docker compose up --build app
```
