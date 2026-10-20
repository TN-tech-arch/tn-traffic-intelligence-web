-- Preserve internal ULID keys while adding readable, persistent display IDs.

CREATE UNIQUE INDEX IF NOT EXISTS idx_dataset_display_id
    ON dataset_versions(display_id) WHERE display_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cluster_display_id
    ON clusters(display_id) WHERE display_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_experiment_display_id
    ON experiments(display_id) WHERE display_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_display_id
    ON batches(display_id) WHERE display_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS history_id_migrations (
    resource_type   TEXT NOT NULL,
    internal_id     TEXT NOT NULL,
    display_id      TEXT NOT NULL,
    old_external_id TEXT,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (resource_type, internal_id),
    UNIQUE (resource_type, display_id)
);

CREATE TABLE IF NOT EXISTS history_id_migration_issues (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_type TEXT NOT NULL,
    internal_id   TEXT NOT NULL,
    reason        TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    UNIQUE (resource_type, internal_id)
);
