-- Persisted sequence for human-readable history IDs and per-region EXP IDs.

CREATE TABLE IF NOT EXISTS readable_id_sequences (
    sequence_key TEXT PRIMARY KEY,
    next_value   INTEGER NOT NULL,
    updated_at   TEXT NOT NULL
);

ALTER TABLE experiment_region_models ADD COLUMN region_experiment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_region_model_experiment_id
    ON experiment_region_models(region_experiment_id)
    WHERE region_experiment_id IS NOT NULL;
