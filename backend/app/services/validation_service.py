from datetime import datetime
from pathlib import Path
import re
from typing import Any
from collections import Counter

import pandas as pd

from app.utils.file_handler import BACKEND_DIR

_GENERIC_SUFFIX_TOKENS = {
    "dept",
    "department",
    "team",
    "payment",
    "transfer",
    "method",
    "device",
    "computer",
    "phone",
    "pc",
}

_DATE_INPUT_FORMATS: tuple[str, ...] = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%m/%d/%Y",
    "%m-%d-%Y",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%b %d %Y",
    "%B %d %Y",
)


def _load_dataframe(file_path: Path) -> pd.DataFrame:
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(file_path)
    if suffix == ".xlsx":
        return pd.read_excel(file_path, engine="openpyxl")
    raise ValueError(f"Unsupported file format: {suffix}")


def _resolve_path(file_path: str | Path) -> Path:
    path = Path(file_path)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return path.resolve()


def _severity_for_null_percentage(null_pct: float) -> str:
    if null_pct >= 40.0:
        return "error"
    if null_pct >= 10.0:
        return "warning"
    return "info"


def _severity_for_issue_percentage(issue_pct: float) -> str:
    if issue_pct >= 10.0:
        return "error"
    if issue_pct > 0.0:
        return "warning"
    return "info"


def _severity_for_issue(column: str, issue_type: str, issue_pct: float) -> str:
    if issue_type == "negative_values" and column.strip().lower() == "age":
        return "error"
    return _severity_for_issue_percentage(issue_pct)


def _debug_log(column: str, numeric_ratio: float, outlier_count: int, invalid_count: int) -> None:
    print(
        f"[VALIDATION] column={column} "
        f"numeric_ratio={numeric_ratio:.4f} "
        f"outlier_count={outlier_count} "
        f"invalid_count={invalid_count}"
    )


def _default_fill_value(dtype_str: str) -> Any | None:
    lowered = dtype_str.lower()
    if "int" in lowered or "float" in lowered:
        return 0
    if "bool" in lowered:
        return False
    return "Unknown"


def _default_fill_strategy(dtype_str: str) -> str:
    lowered = dtype_str.lower()
    if "int" in lowered or "float" in lowered:
        return "default_numeric"
    if "bool" in lowered:
        return "mode"
    return "default_text"


def _should_avoid_mode_fill(column: str) -> bool:
    lower = column.lower()
    return "email" in lower or _is_id_column(column)


def _has_high_uniqueness(series: pd.Series) -> bool:
    non_null = series.dropna()
    if non_null.empty:
        return False
    unique_ratio = float(non_null.nunique() / len(non_null))
    return unique_ratio > 0.8


def _coerce_scalar(value: Any) -> Any:
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def _fill_recommendation_for_series(
    column: str, series: pd.Series, dtype_str: str
) -> dict[str, Any]:
    non_null = series.dropna()
    fill_value = _default_fill_value(dtype_str)
    fill_strategy = _default_fill_strategy(dtype_str)
    reason = "Use a deterministic placeholder or default value to keep row count stable."

    if non_null.empty:
        return {
            "action": "fill_missing",
            "reason": reason,
            "fill_value": fill_value,
            "fill_strategy": fill_strategy,
        }

    lowered = dtype_str.lower()
    if "bool" in lowered:
        mode = non_null.mode(dropna=True)
        if not mode.empty:
            fill_value = _coerce_scalar(mode.iloc[0])
            fill_strategy = "mode"
            reason = "Fill missing values with the most common value in this column."
    elif _should_avoid_mode_fill(column) or _has_high_uniqueness(series):
        fill_value = _default_fill_value(dtype_str)
        fill_strategy = "default_text"
        reason = "Use a placeholder value instead of copying a high-uniqueness value."
    else:
        numeric_series = _numeric_series_or_none(series)
        if numeric_series is not None:
            numeric_series = numeric_series.dropna()
        if numeric_series is not None and not numeric_series.empty:
            median = _coerce_scalar(numeric_series.median())
            if ("int" in lowered or "float" in lowered) and isinstance(median, float) and median.is_integer():
                median = int(median)
            fill_value = median
            fill_strategy = "median"
            reason = "Fill missing values with the median to reduce sensitivity to outliers."
        else:
            mode = non_null.mode(dropna=True)
            if not mode.empty:
                fill_value = _coerce_scalar(mode.iloc[0])
                fill_strategy = "mode"
                reason = "Fill missing values with the most common value in this column."

    return {
        "action": "fill_missing",
        "reason": reason,
        "fill_value": fill_value,
        "fill_strategy": fill_strategy,
    }


def _recommendations_for_nulls(
    column: str, series: pd.Series, dtype_str: str, null_pct: float, issue_count: int
) -> list[dict[str, Any]]:
    recommendations: list[dict[str, Any]] = [
        _fill_recommendation_for_series(column, series, dtype_str)
    ]

    if issue_count > 0:
        recommendations.append(
            {
                "action": "drop_rows",
                "reason": "Only remove affected rows if this column is required for downstream use.",
            }
        )

    if null_pct >= 60.0:
        recommendations.append(
            {
                "action": "drop_column",
                "reason": "This column is mostly empty and may not be useful unless it is business-critical.",
            }
        )
    else:
        recommendations.append(
            {
                "action": "review",
                "reason": "Confirm whether missing values are expected before applying a destructive fix.",
            }
        )

    return recommendations


def _row_indices_for_mask(mask: pd.Series, limit: int | None = None) -> list[int]:
    row_numbers = list(dict.fromkeys(int(idx) + 2 for idx in mask[mask].index.tolist()))
    if limit is None:
        return row_numbers
    return row_numbers[:limit]


def _null_row_indices(df: pd.DataFrame, column: str) -> list[int]:
    sample = df.index[df[column].isna()].tolist()
    return list(dict.fromkeys(int(idx) + 2 for idx in sample))


def _sample_null_row_indices(df: pd.DataFrame, column: str, limit: int = 5) -> list[int]:
    return _null_row_indices(df, column)[:limit]


def _sample_values_for_mask(series: pd.Series, mask: pd.Series, limit: int = 3) -> list[Any]:
    values = series[mask].head(limit).tolist()
    out: list[Any] = []
    for value in values:
        if pd.isna(value):
            out.append(None)
        elif isinstance(value, (pd.Timestamp, datetime)):
            out.append(str(value))
        else:
            out.append(value)
    return out


def _numeric_series_or_none(series: pd.Series) -> pd.Series | None:
    total_count = len(series)
    non_null_count = int(series.notna().sum())
    if total_count == 0 or non_null_count == 0:
        return None

    converted = pd.to_numeric(series, errors="coerce")
    numeric_count = int(converted.notna().sum())
    numeric_ratio = float(numeric_count / total_count)
    if numeric_ratio >= 0.8 or (
        numeric_count >= 3 and numeric_count > (non_null_count / 2)
    ):
        return converted
    return None


def _numeric_profile(series: pd.Series) -> tuple[pd.Series, int, int, float]:
    converted = pd.to_numeric(series, errors="coerce")
    numeric_count = int(converted.notna().sum())
    non_null_count = int(series.notna().sum())
    numeric_ratio = (
        float(numeric_count / non_null_count) if non_null_count else 0.0
    )
    return converted, numeric_count, non_null_count, numeric_ratio


def _is_id_column(column: str) -> bool:
    return "id" in column.lower()


def _normalize_category_value(value: Any) -> str:
    text = str(value).strip().lower()
    return re.sub(r"\s+", " ", text)


def _reduced_category_value(value: str) -> str:
    parts = [part for part in _normalize_category_value(value).split(" ") if part]
    while len(parts) > 1 and parts[-1] in _GENERIC_SUFFIX_TOKENS:
        parts.pop()
    return " ".join(parts)


def _has_generic_suffix(value: str) -> bool:
    parts = [part for part in _normalize_category_value(value).split(" ") if part]
    return len(parts) > 1 and parts[-1] in _GENERIC_SUFFIX_TOKENS


def _compact_letters(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _initials_for_value(value: str) -> str:
    parts = [part for part in re.split(r"\s+", value.strip().lower()) if part]
    return "".join(part[0] for part in parts)


def _candidate_abbreviation_matches(short_value: str, long_value: str, raw_short_value: str) -> bool:
    long_parts = [part for part in re.split(r"\s+", long_value.strip()) if part]
    if len(long_parts) > 1:
        initials = _initials_for_value(long_value)
        if short_value == initials:
            return True
        if len(short_value) == 3 and short_value.startswith(initials):
            return True
        return False

    long_compact = _compact_letters(long_value)
    if len(long_compact) < len(short_value) + 3:
        return False
    if len(short_value) == 1:
        return short_value == long_compact[:1]
    if len(short_value) == 2:
        return False
    if "." in raw_short_value and len(short_value) >= 4 and long_compact.startswith(short_value):
        return True
    if short_value[0] != long_compact[0]:
        return False
    if _is_ordered_subsequence(short_value, long_compact):
        return True
    if len(short_value) == 3 and long_compact:
        return short_value[0] == long_compact[0] and short_value[-1] == long_compact[-1]
    return False


def _looks_like_abbreviation(raw_value: str, compact_value: str) -> bool:
    stripped = raw_value.strip()
    vowel_count = sum(1 for char in compact_value if char in {"a", "e", "i", "o", "u"})
    return len(compact_value) <= 4 and (
        "." in stripped or stripped.isupper() or vowel_count <= 1
    )


def _is_ordered_subsequence(short_value: str, long_value: str) -> bool:
    if not short_value:
        return False
    pos = 0
    for char in long_value:
        if pos < len(short_value) and short_value[pos] == char:
            pos += 1
    return pos == len(short_value)


def _category_values_match(left: str, right: str) -> bool:
    if left == right:
        return True

    left_compact = _compact_letters(left)
    right_compact = _compact_letters(right)
    if left_compact == right_compact:
        return True

    left_reduced = _reduced_category_value(left)
    right_reduced = _reduced_category_value(right)
    left_match_compact = _compact_letters(left_reduced or left)
    right_match_compact = _compact_letters(right_reduced or right)
    if left_reduced and right_reduced:
        if left_reduced == right_reduced:
            return True
        if _compact_letters(left_reduced) == _compact_letters(right_reduced):
            return True

    if not left_compact or not right_compact:
        return False

    if (
        len(left_match_compact) <= 3
        or ("." in left and len(left_match_compact) <= 5)
        or _looks_like_abbreviation(left, left_match_compact)
    ) and len(right_match_compact) > len(left_match_compact):
        short_value, long_value = left_match_compact, right_reduced or right
        raw_short_candidate = left
    elif (
        len(right_match_compact) <= 3
        or ("." in right and len(right_match_compact) <= 5)
        or _looks_like_abbreviation(right, right_match_compact)
    ) and len(left_match_compact) > len(right_match_compact):
        short_value, long_value = right_match_compact, left_reduced or left
        raw_short_candidate = right
    else:
        return False

    candidate_count = 0
    for candidate in (left_reduced or left, right_reduced or right):
        candidate_compact = _compact_letters(candidate)
        if len(candidate_compact) <= len(short_value):
            continue
        if _candidate_abbreviation_matches(short_value, candidate, raw_short_candidate):
            candidate_count += 1
            if _compact_letters(candidate) != _compact_letters(long_value):
                return False
    if candidate_count > 1:
        return False
    return _candidate_abbreviation_matches(short_value, long_value, raw_short_candidate)


def _is_numeric_like_series(series: pd.Series) -> bool:
    non_null = series.dropna()
    if non_null.empty:
        return False
    converted = pd.to_numeric(non_null, errors="coerce")
    numeric_count = int(converted.notna().sum())
    non_null_count = int(non_null.notna().sum())
    numeric_ratio = float(numeric_count / non_null_count) if non_null_count else 0.0
    return numeric_ratio >= 0.8 or (
        numeric_count >= 3 and numeric_count > (non_null_count / 2)
    )


def _is_categorical_column(series: pd.Series) -> bool:
    unique_count = int(series.dropna().nunique())
    if unique_count == 0:
        return False
    if not _is_numeric_like_series(series):
        return True
    return unique_count < 50


def _display_value_score(value: str, count: int) -> tuple[int, int, int, int, str]:
    stripped = value.strip()
    has_space = 1 if " " in stripped else 0
    title_like = 1 if stripped == stripped.title() and stripped.lower() != stripped else 0
    has_suffix = 1 if _has_generic_suffix(value) else 0
    return (count, -has_suffix, has_space + title_like, -len(stripped), stripped)


def _canonical_display_value(counts: Counter[str]) -> str:
    return max(counts.items(), key=lambda item: _display_value_score(item[0], item[1]))[0]


def _category_mapping_groups(df: pd.DataFrame, column: str) -> list[dict[str, Any]]:
    series = df[column]
    if not _is_categorical_column(series):
        return []

    normalized_counts: dict[str, Counter[str]] = {}
    for value in series.dropna().tolist():
        text = str(value).strip()
        if not text:
            continue
        normalized = _normalize_category_value(text)
        if not normalized:
            continue
        normalized_counts.setdefault(normalized, Counter())[text] += 1

    if not any(len(raw_counts) > 1 for raw_counts in normalized_counts.values()) and len(normalized_counts) < 2:
        return []

    clusters: list[list[str]] = []
    for normalized in sorted(normalized_counts):
        matching_cluster_indexes = [
            index
            for index, cluster in enumerate(clusters)
            if any(_category_values_match(normalized, existing) for existing in cluster)
        ]
        compact_normalized = _compact_letters(normalized)
        if len(compact_normalized) <= 3 and len(matching_cluster_indexes) > 1:
            print(
                f"[CATEGORY_MAPPING] column={column} "
                f"skipping_ambiguous_abbreviation={normalized} "
                f"candidate_clusters={[clusters[index] for index in matching_cluster_indexes]}"
            )
            clusters.append([normalized])
            continue
        if len(compact_normalized) > 3 and len(matching_cluster_indexes) > 1:
            merged_cluster = []
            for index in matching_cluster_indexes:
                merged_cluster.extend(clusters[index])
            merged_cluster.append(normalized)
            first_index = matching_cluster_indexes[0]
            clusters[first_index] = list(dict.fromkeys(merged_cluster))
            for index in reversed(matching_cluster_indexes[1:]):
                clusters.pop(index)
            continue
        if matching_cluster_indexes:
            clusters[matching_cluster_indexes[0]].append(normalized)
            continue
        clusters.append([normalized])

    groups: list[dict[str, Any]] = []
    for cluster in clusters:
        raw_counts: Counter[str] = Counter()
        for normalized in cluster:
            raw_counts.update(normalized_counts[normalized])
        if len(raw_counts) <= 1:
            continue
        canonical = _canonical_display_value(raw_counts)
        variants = [value for value, _ in raw_counts.most_common()][:5]
        groups.append(
            {
                "canonical": canonical,
                "variants": variants,
                "count": int(sum(raw_counts.values())),
            }
        )

    groups.sort(key=lambda item: (-item["count"], item["canonical"]))
    return groups


def _append_issue(
    findings: list[dict[str, Any]],
    df: pd.DataFrame,
    column: str,
    issue_type: str,
    mask: pd.Series,
    message: str,
    rule_type: str = "range_check",
    expected_min: float | None = None,
    expected_max: float | None = None,
    expected_range: str | None = None,
    recommendations: list[dict[str, Any]] | None = None,
) -> None:
    issue_count = int(mask.sum())
    if issue_count == 0:
        return
    if any(
        item.get("column") == column and item.get("issue_type") == issue_type
        for item in findings
    ):
        return

    row_count = len(df)
    issue_pct = round((issue_count / row_count * 100), 4) if row_count else 0.0
    findings.append(
        {
            "rule_type": rule_type,
            "severity": _severity_for_issue(column, issue_type, issue_pct),
            "column": column,
            "issue_type": issue_type,
            "issue_count": issue_count,
            "issue_percentage": issue_pct,
            "affected_row_indices": _row_indices_for_mask(mask),
            "sample_row_indices": _row_indices_for_mask(mask, limit=5),
            "range_value_type": "numeric" if rule_type == "range_check" else None,
            "expected_min": expected_min,
            "expected_max": expected_max,
            "expected_range": expected_range,
            "sample_values": _sample_values_for_mask(df[column], mask, limit=3),
            "message": message,
            "recommendations": recommendations or [],
        }
    )


def _issue_mask_is_fully_covered_by_existing_range_issue(
    findings: list[dict[str, Any]],
    df: pd.DataFrame,
    column: str,
    mask: pd.Series,
) -> bool:
    target_rows = set(_row_indices_for_mask(mask))
    if not target_rows:
        return True

    covered_rows: set[int] = set()
    for finding in findings:
        if finding.get("column") != column:
            continue
        if finding.get("rule_type") != "range_check":
            continue
        covered_rows.update(int(row) for row in finding.get("affected_row_indices") or [])

    return target_rows.issubset(covered_rows)


def _negative_value_recommendations() -> list[dict[str, Any]]:
    return [
        {
            "action": "drop_rows",
            "reason": "Remove rows with clearly invalid negative numeric values.",
        },
        {
            "action": "review",
            "reason": "Review negative values before changing records.",
        },
    ]


def _range_recommendations(expected_range: str) -> list[dict[str, Any]]:
    return [
        {
            "action": "clip_to_range",
            "reason": f"Clamp flagged values into the expected range {expected_range}.",
        },
        {
            "action": "drop_rows",
            "reason": "Remove only the affected rows if those records are unreliable.",
        },
        {
            "action": "review",
            "reason": "Review flagged values before changing them.",
        },
    ]


def _type_mismatch_recommendations() -> list[dict[str, Any]]:
    return [
        {
            "action": "drop_rows",
            "reason": "Remove rows with non-numeric values if they are invalid records.",
        },
        {
            "action": "review",
            "reason": "Review type mismatches before applying destructive fixes.",
        },
    ]


def _duplicate_key_recommendations() -> list[dict[str, Any]]:
    return [
        {
            "action": "remove_duplicates",
            "reason": "Keep the first row for each repeated key and drop later duplicates.",
        },
        {
            "action": "review",
            "reason": "Review repeated keys before removing records when duplicates may conflict.",
        },
    ]


def _invalid_date_recommendations() -> list[dict[str, Any]]:
    return [
        {
            "action": "drop_rows",
            "reason": "Remove rows with invalid date values before converting the column.",
        },
        {
            "action": "review",
            "reason": "Review invalid date values before dropping records.",
        },
    ]


def _check_negative_values(
    df: pd.DataFrame, findings: list[dict[str, Any]], column: str, converted: pd.Series
) -> None:
    valid = converted.dropna()
    if valid.empty:
        return
    median = valid.median()
    if pd.isna(median) or median <= 0:
        return

    negative_mask = converted < 0
    _append_issue(
        findings=findings,
        df=df,
        column=column,
        issue_type="negative_values",
        mask=negative_mask.fillna(False),
        message=f"Column '{column}' contains negative numeric values.",
        expected_min=0.0,
        expected_max=None,
        expected_range=">= 0",
        recommendations=_range_recommendations(">= 0"),
    )


def _check_extreme_values(
    df: pd.DataFrame, findings: list[dict[str, Any]], column: str, converted: pd.Series
) -> None:
    valid = converted.dropna()
    if valid.empty:
        return

    median = valid.median()
    if pd.isna(median):
        return

    upper_bound = float(median * 3)
    lower_bound = 0.0 if median > 0 else float(median * 0.1)
    high_mask = converted > upper_bound
    low_mask = converted < lower_bound
    extreme_mask = (high_mask | low_mask).fillna(False)
    outlier_count = int(extreme_mask.sum())
    row_count = len(df)
    if row_count == 0 or (outlier_count / row_count) < 0.02:
        return
    _append_issue(
        findings=findings,
        df=df,
        column=column,
        issue_type="extreme_values",
        mask=extreme_mask,
        message=(
            f"Column '{column}' contains values far from the median "
            f"({median:g}); expected range {lower_bound:g} to {upper_bound:g}."
        ),
        expected_min=lower_bound,
        expected_max=upper_bound,
        expected_range=f"{lower_bound:g} to {upper_bound:g}",
        recommendations=_range_recommendations(f"{lower_bound:g} to {upper_bound:g}"),
    )


def _check_named_sanity_rules(
    df: pd.DataFrame, findings: list[dict[str, Any]], column: str, converted: pd.Series
) -> None:
    col_lower = column.lower()

    if "age" in col_lower:
        mask = (converted > 100).fillna(False)
        if _issue_mask_is_fully_covered_by_existing_range_issue(findings, df, column, mask):
            return
        _append_issue(
            findings=findings,
            df=df,
            column=column,
            issue_type="domain_check",
            mask=mask,
            message="Values fall outside typical domain range.",
            expected_min=None,
            expected_max=100.0,
            expected_range="<= 100",
            recommendations=_range_recommendations("<= 100"),
        )

    if "score" in col_lower:
        mask = (converted > 100).fillna(False)
        if _issue_mask_is_fully_covered_by_existing_range_issue(findings, df, column, mask):
            return
        _append_issue(
            findings=findings,
            df=df,
            column=column,
            issue_type="domain_check",
            mask=mask,
            message="Values fall outside typical domain range.",
            expected_min=None,
            expected_max=100.0,
            expected_range="<= 100",
            recommendations=_range_recommendations("<= 100"),
        )

    if "temperature" in col_lower:
        mask = ((converted < 30) | (converted > 45)).fillna(False)
        if _issue_mask_is_fully_covered_by_existing_range_issue(findings, df, column, mask):
            return
        _append_issue(
            findings=findings,
            df=df,
            column=column,
            issue_type="domain_check",
            mask=mask,
            message="Values fall outside typical domain range.",
            expected_min=30.0,
            expected_max=45.0,
            expected_range="30 to 45",
            recommendations=_range_recommendations("30 to 45"),
        )


def _check_type_mismatch(
    df: pd.DataFrame, findings: list[dict[str, Any]], column: str
) -> int:
    original = df[column]
    normalized = original.map(
        lambda value: value.strip().lower() if isinstance(value, str) else value
    )
    invalid_token_mask = normalized.isin({"", "na", "n/a", "--", "null"})
    candidate = original.mask(invalid_token_mask, other=None)
    converted, numeric_count, non_null_count, numeric_ratio = _numeric_profile(candidate)

    is_numeric_intent = numeric_ratio >= 0.8 or (
        numeric_count >= 3 and numeric_count > (non_null_count / 2)
    )
    if not is_numeric_intent:
        return 0

    invalid_mask = ((converted.isna() & candidate.notna()) | invalid_token_mask).fillna(False)
    invalid_count = int(invalid_mask.sum())
    if invalid_count == 0:
        return 0

    _append_issue(
        findings=findings,
        df=df,
        column=column,
        issue_type="type_mismatch",
        mask=invalid_mask,
        message=f"Column '{column}' contains non-numeric values in a mostly numeric column.",
        rule_type="type_check",
        recommendations=_type_mismatch_recommendations(),
    )
    return invalid_count


def _parse_date_value(value: Any) -> datetime | pd.Timestamp | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None

    raw = value.strip()
    if not raw:
        return None

    for fmt in _DATE_INPUT_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue

    parsed = pd.to_datetime(raw, errors="coerce", utc=False)
    if pd.isna(parsed):
        return None
    return parsed


def _looks_like_date_column(column: str, series: pd.Series) -> bool:
    non_null = series.dropna()
    if non_null.empty:
        return False
    if "date" in column.lower() or column.lower().endswith("_dt") or column.lower().endswith("dt"):
        return True
    string_values = [
        value.strip()
        for value in non_null.tolist()
        if isinstance(value, str) and value.strip()
    ]
    if not string_values:
        return False
    parseable_count = sum(_parse_date_value(value) is not None for value in string_values)
    return (parseable_count / len(string_values)) >= 0.6


def _add_invalid_date_findings(df: pd.DataFrame, findings: list[dict[str, Any]]) -> None:
    row_count = len(df)
    if row_count == 0:
        return

    for column in df.columns:
        col_name = str(column)
        series = df[column]
        if not _looks_like_date_column(col_name, series):
            continue

        invalid_mask = series.map(
            lambda value: (
                isinstance(value, str)
                and value.strip() != ""
                and _parse_date_value(value) is None
            )
        ).fillna(False)
        issue_count = int(invalid_mask.sum())
        if issue_count == 0:
            continue

        issue_pct = round((issue_count / row_count * 100), 4)
        findings.append(
            {
                "rule_type": "type_check",
                "severity": _severity_for_issue_percentage(issue_pct),
                "column": col_name,
                "issue_type": "invalid_date",
                "issue_count": issue_count,
                "issue_percentage": issue_pct,
                "affected_row_indices": _row_indices_for_mask(invalid_mask),
                "sample_row_indices": _row_indices_for_mask(invalid_mask, limit=5),
                "sample_values": _sample_values_for_mask(series, invalid_mask, limit=3),
                "groups": [],
                "message": f"Column '{col_name}' contains invalid date values.",
                "recommendations": _invalid_date_recommendations(),
            }
        )


def _has_conflicting_rows_for_key(df: pd.DataFrame, column: str) -> bool:
    other_columns = [col for col in df.columns if str(col) != column]
    if not other_columns:
        return False

    non_null = df[df[column].notna()].copy()
    if non_null.empty:
        return False

    for _, group in non_null.groupby(column, dropna=True):
        if len(group) < 2:
            continue
        comparable = group[other_columns].copy()
        comparable = comparable.fillna("__NULL__")
        if len(comparable.drop_duplicates()) > 1:
            return True
    return False


def _add_duplicate_key_findings(df: pd.DataFrame, findings: list[dict[str, Any]]) -> None:
    row_count = len(df)
    if row_count == 0:
        return

    for column in df.columns:
        col_name = str(column)
        if not _is_id_column(col_name):
            continue

        non_null = df[df[column].notna()].copy()
        if non_null.empty:
            continue

        duplicate_mask = non_null.duplicated(subset=[column], keep=False)
        if not duplicate_mask.any():
            continue

        duplicate_rows = non_null.loc[duplicate_mask]
        issue_count = int(len(duplicate_rows))
        issue_pct = round((issue_count / row_count * 100), 4)
        duplicate_keys = duplicate_rows[column].drop_duplicates().astype(str).tolist()
        conflicting = _has_conflicting_rows_for_key(df, col_name)
        message = (
            f"Column '{col_name}' contains repeated key values with conflicting rows."
            if conflicting
            else f"Column '{col_name}' contains repeated key values."
        )
        findings.append(
            {
                "rule_type": "type_check",
                "severity": _severity_for_issue_percentage(issue_pct),
                "column": col_name,
                "issue_type": "duplicate_key",
                "issue_count": issue_count,
                "issue_percentage": issue_pct,
                "affected_row_indices": [int(idx) + 2 for idx in duplicate_rows.index.tolist()],
                "sample_row_indices": [int(idx) + 2 for idx in duplicate_rows.index.tolist()[:5]],
                "sample_values": duplicate_keys[:3],
                "groups": [],
                "message": message,
                "recommendations": _duplicate_key_recommendations(),
            }
        )


def _add_numeric_validation_findings(df: pd.DataFrame, findings: list[dict[str, Any]]) -> None:
    for column in df.columns:
        col_name = str(column)
        converted, numeric_count, non_null_count, numeric_ratio = _numeric_profile(df[column])
        is_numeric_like = numeric_ratio >= 0.8 or (
            numeric_count >= 3 and numeric_count > (non_null_count / 2)
        )
        if not is_numeric_like:
            _debug_log(col_name, numeric_ratio, 0, 0)
            continue

        outlier_count = 0
        valid = converted.dropna()
        if not valid.empty:
            median = valid.median()
            if not pd.isna(median):
                upper_bound = float(median * 3)
                lower_bound = 0.0 if median > 0 else float(median * 0.1)
                outlier_count = int(((converted < lower_bound) | (converted > upper_bound)).fillna(False).sum())
        invalid_count = 0

        _check_negative_values(df, findings, col_name, converted)

        if _is_id_column(col_name):
            _debug_log(col_name, numeric_ratio, outlier_count, 0)
            continue

        _check_extreme_values(df, findings, col_name, converted)
        _check_named_sanity_rules(df, findings, col_name, converted)
        invalid_count = _check_type_mismatch(df, findings, col_name)
        _debug_log(col_name, numeric_ratio, outlier_count, invalid_count)


def _add_category_mapping_findings(df: pd.DataFrame, findings: list[dict[str, Any]]) -> None:
    row_count = len(df)
    if row_count == 0:
        return

    for column in df.columns:
        col_name = str(column)
        groups = _category_mapping_groups(df, col_name)
        if not groups:
            continue
        issue_count = int(sum(group["count"] for group in groups))
        issue_pct = round((issue_count / row_count * 100), 4)
        sample_values = [
            variant
            for group in groups[:2]
            for variant in group["variants"][:3]
        ][:3]
        print(
            f"[CATEGORY_MAPPING] column={col_name} "
            f"group_count={len(groups)} sample_groups={groups[:2]}"
        )
        findings.append(
            {
                "rule_type": "type_check",
                "severity": _severity_for_issue_percentage(issue_pct),
                "column": col_name,
                "issue_type": "category_mapping",
                "issue_count": issue_count,
                "issue_percentage": issue_pct,
                "affected_row_indices": [],
                "sample_row_indices": [],
                "sample_values": sample_values,
                "groups": groups,
                "message": "Inconsistent categorical values detected",
                "recommendations": [],
            }
        )


def validate_dataset(file_path: str | Path) -> dict[str, Any]:
    path = _resolve_path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    df = _load_dataframe(path)
    row_count = len(df)
    findings: list[dict[str, Any]] = []

    for column in df.columns:
        issue_count = int(df[column].isna().sum())
        if issue_count == 0 or row_count == 0:
            continue

        issue_pct = round((issue_count / row_count * 100), 4) if row_count else 0.0
        dtype_str = str(df[column].dtype)
        findings.append(
            {
                "rule_type": "null_check",
                "severity": _severity_for_null_percentage(issue_pct),
                "column": str(column),
                "issue_type": None,
                "issue_count": issue_count,
                "issue_percentage": issue_pct,
                "affected_row_indices": _null_row_indices(df, column),
                "sample_row_indices": _sample_null_row_indices(df, column),
                "message": (
                    f"Column '{column}' contains {issue_count} missing value(s) "
                    f"({issue_pct:.2f}% of rows)."
                ),
                "recommendations": _recommendations_for_nulls(
                    column=str(column),
                    series=df[column],
                    dtype_str=dtype_str,
                    null_pct=issue_pct,
                    issue_count=issue_count,
                ),
            }
        )

    _add_numeric_validation_findings(df, findings)
    _add_invalid_date_findings(df, findings)
    _add_duplicate_key_findings(df, findings)
    _add_category_mapping_findings(df, findings)

    if not findings:
        return {"message": "No validation issues found", "findings": []}
    return {"findings": findings}
