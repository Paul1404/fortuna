-- The local Scalable CLI relay is gone; its ingest tokens can no longer be used.
DELETE FROM "external_connections" WHERE "provider" = 'scalable_cli_relay';
