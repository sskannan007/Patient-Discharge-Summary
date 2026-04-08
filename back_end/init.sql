-- Runs once on first Postgres container start (docker-entrypoint-initdb.d).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
