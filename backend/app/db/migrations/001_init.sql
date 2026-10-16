-- TN Traffic Intelligence v3.1 initial schema (spec 12.3)

CREATE TABLE IF NOT EXISTS data_sources (
    source_id            TEXT PRIMARY KEY,
    key                  TEXT NOT NULL UNIQUE,
    display_name         TEXT NOT NULL,
    csv_path             TEXT NOT NULL,
    geojson_path         TEXT NOT NULL,
    unit_label           TEXT NOT NULL,
    native_frequency     TEXT NOT NULL,
    native_frequency_minutes INTEGER NOT NULL,
    fingerprint_csv      TEXT NOT NULL,
    fingerprint_geojson  TEXT NOT NULL,
    fingerprint          TEXT NOT NULL,
    time_start           TEXT,
    time_end             TEXT,
    time_point_count     INTEGER NOT NULL DEFAULT 0,
    region_count_series  INTEGER NOT NULL DEFAULT 0,
    region_count_gis     INTEGER NOT NULL DEFAULT 0,
    zero_value_count     INTEGER NOT NULL DEFAULT 0,
    nan_value_count      INTEGER NOT NULL DEFAULT 0,
    negative_value_count INTEGER NOT NULL DEFAULT 0,
    quality_json         TEXT NOT NULL DEFAULT '{}',
    imported_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regions (
    source_id       TEXT NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
    region_id       TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    geometry_key    TEXT,
    has_timeseries  INTEGER NOT NULL DEFAULT 0,
    geometry_json   TEXT,
    properties_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (source_id, region_id)
);
CREATE INDEX IF NOT EXISTS idx_regions_source ON regions(source_id, has_timeseries);

CREATE TABLE IF NOT EXISTS dataset_versions (
    dataset_id          TEXT PRIMARY KEY,
    source_id           TEXT NOT NULL REFERENCES data_sources(source_id),
    label               TEXT NOT NULL DEFAULT '',
    scope               TEXT NOT NULL,
    region_ids_json     TEXT NOT NULL,
    frequency           TEXT NOT NULL,
    frequency_minutes   INTEGER NOT NULL,
    aggregation         TEXT NOT NULL,
    input_length        INTEGER NOT NULL,
    output_length       INTEGER NOT NULL,
    step                INTEGER NOT NULL,
    train_ratio         REAL NOT NULL,
    val_ratio           REAL NOT NULL,
    test_ratio          REAL NOT NULL,
    split_boundaries_json TEXT NOT NULL,
    preprocess_json     TEXT NOT NULL,
    scaler_ref          TEXT,
    artifact_ref        TEXT NOT NULL,
    window_counts_json  TEXT NOT NULL,
    region_window_summary_json TEXT NOT NULL DEFAULT '{}',
    quality_json        TEXT NOT NULL DEFAULT '{}',
    status              TEXT NOT NULL,
    hash                TEXT NOT NULL,
    is_referenced       INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_datasets_source ON dataset_versions(source_id, status);

CREATE TABLE IF NOT EXISTS clusters (
    cluster_run_id   TEXT PRIMARY KEY,
    source_id        TEXT NOT NULL REFERENCES data_sources(source_id),
    algorithm_key    TEXT NOT NULL,
    params_json      TEXT NOT NULL,
    features_json    TEXT NOT NULL,
    time_start       TEXT,
    time_end         TEXT,
    frequency        TEXT NOT NULL,
    aggregation      TEXT NOT NULL,
    region_count     INTEGER NOT NULL,
    cluster_count    INTEGER NOT NULL,
    noise_count      INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL,
    error            TEXT,
    metrics_json     TEXT NOT NULL DEFAULT '{}',
    result_json      TEXT NOT NULL DEFAULT '{}',
    artifact_ref     TEXT,
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clusters_source ON clusters(source_id, created_at);

CREATE TABLE IF NOT EXISTS batches (
    batch_id         TEXT PRIMARY KEY,
    dataset_id       TEXT NOT NULL REFERENCES dataset_versions(dataset_id),
    scope            TEXT NOT NULL,
    algorithm_count  INTEGER NOT NULL DEFAULT 12,
    region_count     INTEGER NOT NULL,
    planned_tasks    INTEGER NOT NULL,
    policy_json      TEXT NOT NULL,
    params_snapshot_json TEXT NOT NULL,
    task_summary_json TEXT NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    error            TEXT,
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    ended_at         TEXT,
    idempotency_key  TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_batches_dataset ON batches(dataset_id, created_at);

CREATE TABLE IF NOT EXISTS experiments (
    experiment_id    TEXT PRIMARY KEY,
    dataset_id       TEXT NOT NULL REFERENCES dataset_versions(dataset_id),
    batch_id         TEXT REFERENCES batches(batch_id),
    algorithm_key    TEXT NOT NULL,
    algorithm_label  TEXT NOT NULL,
    category         TEXT NOT NULL,
    mode             TEXT NOT NULL,
    scope            TEXT NOT NULL,
    params_json      TEXT NOT NULL,
    snapshot_json    TEXT NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL,
    progress_json    TEXT NOT NULL DEFAULT '{}',
    region_total     INTEGER NOT NULL DEFAULT 0,
    region_completed INTEGER NOT NULL DEFAULT 0,
    region_failed    INTEGER NOT NULL DEFAULT 0,
    error            TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    artifact_ref     TEXT,
    metrics_json     TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    ended_at         TEXT,
    idempotency_key  TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_experiments_dataset ON experiments(dataset_id, created_at);
CREATE INDEX IF NOT EXISTS idx_experiments_batch ON experiments(batch_id);

CREATE TABLE IF NOT EXISTS experiment_region_models (
    experiment_id    TEXT NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
    region_id        TEXT NOT NULL,
    status           TEXT NOT NULL,
    model_artifact_ref TEXT,
    checkpoint_ref   TEXT,
    metrics_json     TEXT NOT NULL DEFAULT '{}',
    history_json     TEXT NOT NULL DEFAULT '{}',
    logs_ref         TEXT,
    error            TEXT,
    started_at       TEXT,
    ended_at         TEXT,
    PRIMARY KEY (experiment_id, region_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
    evaluation_id    TEXT PRIMARY KEY,
    dataset_id       TEXT NOT NULL REFERENCES dataset_versions(dataset_id),
    batch_id         TEXT REFERENCES batches(batch_id),
    source_id        TEXT NOT NULL,
    scope            TEXT NOT NULL,
    region_id        TEXT,
    protocol_json    TEXT NOT NULL,
    test_range_json  TEXT NOT NULL DEFAULT '{}',
    metrics_summary_json TEXT NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL,
    progress_json    TEXT NOT NULL DEFAULT '{}',
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    error            TEXT,
    artifact_ref     TEXT,
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    ended_at         TEXT,
    exported_at      TEXT,
    idempotency_key  TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_evaluations_dataset ON evaluations(dataset_id, created_at);

CREATE TABLE IF NOT EXISTS evaluation_experiments (
    evaluation_id    TEXT NOT NULL REFERENCES evaluations(evaluation_id) ON DELETE CASCADE,
    experiment_id    TEXT NOT NULL REFERENCES experiments(experiment_id),
    algorithm_key    TEXT NOT NULL,
    coverage_regions INTEGER NOT NULL DEFAULT 0,
    sample_count     INTEGER NOT NULL DEFAULT 0,
    metrics_json     TEXT NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL,
    error            TEXT,
    PRIMARY KEY (evaluation_id, experiment_id)
);

CREATE TABLE IF NOT EXISTS evaluation_predictions (
    evaluation_id    TEXT NOT NULL REFERENCES evaluations(evaluation_id) ON DELETE CASCADE,
    experiment_id    TEXT NOT NULL,
    region_id        TEXT NOT NULL,
    window_index     INTEGER NOT NULL,
    horizon_step     INTEGER NOT NULL,
    target_at        TEXT NOT NULL,
    y_true           REAL,
    y_pred           REAL,
    is_valid         INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (evaluation_id, experiment_id, region_id, window_index, horizon_step)
);
CREATE INDEX IF NOT EXISTS idx_evalpred_target ON evaluation_predictions(evaluation_id, target_at);

CREATE TABLE IF NOT EXISTS jobs (
    job_id           TEXT PRIMARY KEY,
    job_type         TEXT NOT NULL,
    parent_batch_id  TEXT,
    experiment_id    TEXT,
    evaluation_id    TEXT,
    cluster_run_id   TEXT,
    dataset_id       TEXT,
    region_id        TEXT,
    sequence_no      INTEGER NOT NULL DEFAULT 0,
    state            TEXT NOT NULL,
    progress_json    TEXT NOT NULL DEFAULT '{}',
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    error_code       TEXT,
    error            TEXT,
    worker_id        TEXT,
    heartbeat_at     TEXT,
    payload_json     TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    ended_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, sequence_no);
CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(parent_batch_id, sequence_no);

CREATE TABLE IF NOT EXISTS audit_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    resource     TEXT NOT NULL,
    resource_id  TEXT NOT NULL,
    action       TEXT NOT NULL,
    detail_json  TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
