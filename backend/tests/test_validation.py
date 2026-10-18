"""T45-T51 (server side): unified registry validation rules."""

from app.services.validation import (
    all_models_summary,
    check_model_params,
    validate_m1,
    validate_m2,
    validate_m3,
    validate_m5,
)


def severity(issues, code=None):
    return [
        (i["code"], i["severity"])
        for i in issues
        if code is None or i["code"] == code
    ]


def test_registry_has_exactly_twelve_algorithms():
    from app.forecast.registry import ALGORITHM_KEYS

    assert len(ALGORITHM_KEYS) == 12
    assert "all_models" not in ALGORITHM_KEYS


def test_dropout_out_of_range_is_an_error():
    issues, _ = check_model_params("mlp", {"dropout": 1.5})
    assert ("OUT_OF_RANGE", "error") in severity(issues)
    assert any(i["path"].endswith(".dropout") for i in issues)


def test_dropout_boundary_zero_is_valid_and_one_is_invalid():
    ok, _ = check_model_params("mlp", {"dropout": 0})
    bad, _ = check_model_params("mlp", {"dropout": 1})
    assert not [i for i in ok if i["severity"] == "error"]
    assert [i for i in bad if i["severity"] == "error"]


def test_l_zero_and_s_zero_are_errors():
    issues = validate_m3({"input_length": 0, "output_length": 6, "step": 1})
    assert ("OUT_OF_RANGE", "error") in severity(issues)
    issues_step = validate_m3({"input_length": 24, "output_length": 6, "step": 0})
    assert ("OUT_OF_RANGE", "error") in severity(issues_step)


def test_ratio_sum_must_be_one():
    issues = validate_m3({"train_ratio": 0.7, "val_ratio": 0.2, "test_ratio": 0.2})
    assert ("RATIO_SUM", "error") in severity(issues)
    clean = validate_m3({"train_ratio": 0.7, "val_ratio": 0.15, "test_ratio": 0.15,
                         "input_length": 24, "output_length": 6, "step": 1})
    assert not [i for i in clean if i["severity"] == "error"]


def test_transformer_d_model_must_be_divisible_by_heads():
    issues, _ = check_model_params("transformer", {"d_model": 130, "n_heads": 8})
    codes = severity(issues, "DIVISIBLE")
    assert codes and codes[0][1] == "error"
    fixed, _ = check_model_params("transformer", {"d_model": 128, "n_heads": 8})
    assert not [i for i in fixed if i["severity"] == "error"]


def test_huge_epochs_is_a_warning_not_an_error():
    issues, _ = check_model_params("lstm", {"epochs": 10000}, context={"train_samples": 100})
    warnings = [i for i in issues if i["severity"] == "warning"]
    errors = [i for i in issues if i["severity"] == "error"]
    assert warnings and not errors


def test_batch_size_larger_than_samples_is_a_warning_not_an_error():
    issues, _ = check_model_params("lstm", {"batch_size": 500}, context={"train_samples": 120})
    assert ("BATCH_LARGER_THAN_SAMPLES", "warning") in severity(issues)
    assert not [i for i in issues if i["severity"] == "error"]


def test_arima_trend_must_match_differencing_order():
    issues, _ = check_model_params("arima", {"d": 1, "trend": "c"})
    assert ("TREND_INCOMPATIBLE_WITH_DIFFERENCING", "error") in severity(issues)
    ok, _ = check_model_params("arima", {"d": 1, "trend": "t"})
    assert not [i for i in ok if i["severity"] == "error"]


def test_non_numeric_and_unknown_enum_are_rejected():
    issues, _ = check_model_params("lstm", {"hidden_size": "abc"})
    assert ("NOT_A_NUMBER", "error") in severity(issues)
    issues2, _ = check_model_params("lstm", {"hidden_size": 12.5})
    assert ("NOT_AN_INTEGER", "error") in severity(issues2)


def test_clustering_rules_ward_requires_euclidean():
    issues = validate_m2({"algorithm": "hierarchical", "linkage": "ward", "metric": "manhattan",
                          "features": ["mean", "std"]})
    assert ("LINKAGE_METRIC", "error") in severity(issues)
    issues2 = validate_m2({
        "algorithm": "spectral",
        "spectral_affinity": "rbf",
        "spectral_gamma": 0,
        "features": ["mean", "std"],
    })
    assert ("OUT_OF_RANGE", "error") in severity(issues2)


def test_clustering_requires_two_features():
    issues = validate_m2({"algorithm": "kmeans", "n_clusters": 3, "features": ["mean"]})
    assert ("TOO_FEW_FEATURES", "error") in severity(issues)


def test_m1_region_limit_and_unknown_region():
    issues = validate_m1({"region_ids": ["A", "B", "C"], "max_regions": 2, "window_points": 100,
                          "source_key": "milano"}, available_regions=["A", "B", "C"])
    assert ("TOO_MANY_REGIONS", "error") in severity(issues)
    issues2 = validate_m1({"region_ids": ["ZZ"], "source_key": "milano", "window_points": 100},
                          available_regions=["A"])
    assert ("UNKNOWN_REGION", "error") in severity(issues2)


def test_m5_blocks_all_regions_scope_with_single_region_experiments():
    dataset = {"dataset_id": "DS-1", "H": 6}
    experiments = [{"experiment_id": "EXP-1", "status": "Completed", "dataset_id": "DS-1",
                    "scope": "single", "region_ids": ["R1"], "algorithm_label": "ARIMA"}]
    issues = validate_m5({"experiment_ids": ["EXP-1"], "scope": "all", "region_id": "R1",
                          "test_selection": "full"}, experiments=experiments, dataset=dataset)
    assert ("SCOPE_MISMATCH", "error") in severity(issues)


def test_all_models_reports_every_algorithm_individually():
    summary = all_models_summary({"mlp": {"params": {"dropout": 1.5}}}, context={"train_samples": 100})
    assert len(summary["models"]) == 12
    broken = [m for m in summary["models"] if m["errors"]]
    assert len(broken) == 1 and broken[0]["algorithm_key"] == "mlp"
    assert summary["runnable_count"] == 11
    assert summary["blocking_error_count"] == 1
