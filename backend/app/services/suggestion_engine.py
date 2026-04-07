"""
Rule-based cleaning suggestions from profiling output only (deterministic, no ML).
"""

from __future__ import annotations

import re
import warnings
from datetime import datetime
from typing import Any

import pandas as pd

# Avoid suggesting dates for plain numeric strings like "10" / "20"
_DATE_LIKE = re.compile(
    r"(^\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}/\d{1,2}/\d{2,4})|(\d{1,2}-\d{1,2}-\d{2,4})"
)

# Stable ordering for API responses
_ACTION_ORDER = {
    "rename_column": 0,
    "trim_whitespace": 1,
    "remove_duplicates": 2,
    "fill_missing": 3,
    "convert_to_numeric": 4,
    "standardize_date": 5,
    "convert_to_date": 6,
    "normalize_case": 7,
    "standardize_values": 8,
}

# (strptime pattern, stable label for "which format matched")
_DATE_PARSE_FORMATS: tuple[tuple[str, str], ...] = (
    ("%Y-%m-%d", "Y-m-d"),
    ("%Y/%m/%d", "Y/m/d"),
    ("%d-%m-%Y", "d-m-Y"),
    ("%m/%d/%Y", "m/d/Y"),
    ("%m-%d-%Y", "m-d-Y"),
    ("%d/%m/%Y", "d/m/Y"),
    ("%b %d %Y", "b d Y"),
    ("%B %d %Y", "B d Y"),
)


def generate_suggestions(
    profile: dict[str, Any], validation_findings: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """
    Build suggestions from profiling output (same shape as `profile_dataset` returns).

    Each item: {"action": str, "column": str, "reason": str}
    """
    columns = profile.get("columns") or []
    dtypes = profile.get("dtypes") or {}
    null_count = profile.get("null_count") or {}
    null_pct = profile.get("null_percentage") or {}
    dup_count = int(profile.get("duplicate_row_count") or 0)
    sample_rows = profile.get("sample_rows") or []

    suggestions: list[dict[str, Any]] = []
    invalid_date_columns = {
        str(finding.get("column") or "")
        for finding in (validation_findings or [])
        if finding.get("issue_type") == "invalid_date"
    }
    has_duplicate_key_finding = any(
        finding.get("issue_type") == "duplicate_key"
        for finding in (validation_findings or [])
    )

    for col in columns:
        if " " in col:
            suggestions.append(
                {
                    "action": "rename_column",
                    "column": col,
                    "reason": "Column name contains spaces",
                }
            )

    for col in columns:
        if _is_string_dtype(dtypes.get(col, "")):
            if _sample_has_leading_trailing_spaces(sample_rows, col):
                suggestions.append(
                    {
                        "action": "trim_whitespace",
                        "column": col,
                        "reason": "Column contains leading/trailing spaces",
                    }
                )

    if dup_count > 0 and not has_duplicate_key_finding:
        suggestions.append(
            {
                "action": "remove_duplicates",
                "column": "*",
                "reason": f"Dataset contains {dup_count} duplicate row(s)",
            }
        )

    for col in columns:
        count = int(null_count.get(col, 0) or 0)
        if count > 0:
            p = float(null_pct.get(col, 0) or 0.0)
            suggestions.append(
                {
                    "action": "fill_missing",
                    "column": col,
                    "reason": (
                        f"Column contains {count} missing value(s)"
                        if p <= 0
                        else f"Column contains {count} missing value(s) ({p:.1f}% of rows)"
                    ),
                }
            )

    for col in columns:
        if dtypes.get(col) == "object" and _looks_numeric_strings_in_sample(sample_rows, col):
            suggestions.append(
                {
                    "action": "convert_to_numeric",
                    "column": col,
                    "reason": "Values appear numeric but column is stored as text",
                }
            )

    for col in columns:
        if not _is_string_dtype(dtypes.get(col, "")):
            continue
        if _has_inconsistent_date_formats_in_sample(sample_rows, col):
            suggestions.append(
                {
                    "action": "standardize_date",
                    "column": col,
                    "reason": "Multiple date formats detected",
                }
            )
        elif (
            col not in invalid_date_columns
            and _looks_like_dates_in_sample(sample_rows, col)
            and not _is_iso_date_column_in_sample(sample_rows, col)
        ):
            suggestions.append(
                {
                    "action": "convert_to_date",
                    "column": col,
                    "reason": "Values resemble dates in common formats",
                }
            )

    standardized_value_columns: set[str] = set()
    for finding in validation_findings or []:
        if finding.get("rule_type") == "null_check":
            column = str(finding.get("column") or "")
            if column:
                suggestions.append(
                    {
                        "action": "fill_missing",
                        "column": column,
                        "reason": finding.get("message") or "Missing values detected",
                    }
                )
            continue
        if finding.get("issue_type") == "invalid_date":
            continue
        if finding.get("issue_type") == "duplicate_key":
            column = str(finding.get("column") or "")
            if column:
                suggestions.append(
                    {
                        "action": "remove_duplicates",
                        "column": column,
                        "reason": finding.get("message") or "Repeated key values detected",
                    }
                )
            continue
        if finding.get("issue_type") != "category_mapping":
            continue
        column = str(finding.get("column") or "")
        groups = finding.get("groups") or []
        if not column or not groups:
            continue
        mapping_groups = [
            {
                "from": group.get("variants") or [],
                "to": group.get("canonical"),
            }
            for group in groups
            if group.get("canonical") and group.get("variants")
        ]
        if not mapping_groups:
            continue
        standardized_value_columns.add(column)
        suggestions.append(
            {
                "action": "standardize_values",
                "column": column,
                "reason": "Inconsistent categorical values detected",
                "groups": groups,
                "mapping_groups": mapping_groups,
            }
        )

    for col in columns:
        if col in standardized_value_columns:
            continue
        if _is_string_dtype(dtypes.get(col, "")) and _has_inconsistent_casing_in_sample(sample_rows, col):
            suggestions.append(
                {
                    "action": "normalize_case",
                    "column": col,
                    "reason": "Inconsistent letter casing across values",
                }
            )

    deduped_suggestions: list[dict[str, Any]] = []
    seen = set()
    for suggestion in suggestions:
        key = (suggestion["action"], suggestion["column"])
        if key in seen:
            continue
        seen.add(key)
        deduped_suggestions.append(suggestion)

    deduped_suggestions.sort(key=lambda s: (_ACTION_ORDER.get(s["action"], 99), s["column"]))
    return deduped_suggestions


def _is_string_dtype(dtype_str: str) -> bool:
    if not dtype_str:
        return False
    return dtype_str == "object" or dtype_str.startswith("str") or dtype_str == "string"


def _string_values_in_sample(sample_rows: list[dict[str, Any]], col: str) -> list[str]:
    out: list[str] = []
    for row in sample_rows:
        v = row.get(col)
        if v is None:
            continue
        if isinstance(v, str):
            out.append(v)
    return out


def _sample_has_leading_trailing_spaces(sample_rows: list[dict[str, Any]], col: str) -> bool:
    for s in _string_values_in_sample(sample_rows, col):
        if s != s.strip():
            return True
    return False


def _looks_numeric_strings_in_sample(sample_rows: list[dict[str, Any]], col: str) -> bool:
    strings: list[str] = []
    for row in sample_rows:
        v = row.get(col)
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        if isinstance(v, bool):
            return False
        if isinstance(v, (int, float)):
            return False
        if isinstance(v, str):
            t = v.strip()
            if t == "":
                continue
            strings.append(t)
    if not strings:
        return False
    for t in strings:
        if not _parseable_as_number(t):
            return False
    return True


_NUM_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")


def _parseable_as_number(s: str) -> bool:
    s2 = s.replace(",", "").strip()
    if s2 == "":
        return False
    if _NUM_RE.match(s2):
        return True
    try:
        float(s2)
        return True
    except ValueError:
        return False


def detect_date_format(value: str) -> str | None:
    """
    Try known strptime patterns; return a stable label for the first match, else None.
    """
    s = value.strip()
    if not s:
        return None
    for strptime_fmt, label in _DATE_PARSE_FORMATS:
        try:
            datetime.strptime(s, strptime_fmt)
            return label
        except ValueError:
            continue
    return None


def _non_empty_string_values_in_sample(
    sample_rows: list[dict[str, Any]], col: str
) -> list[str]:
    out: list[str] = []
    for row in sample_rows:
        v = row.get(col)
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        if not isinstance(v, str):
            continue
        t = v.strip()
        if t:
            out.append(t)
    return out


def _has_inconsistent_date_formats_in_sample(
    sample_rows: list[dict[str, Any]], col: str
) -> bool:
    """
    True if >= 60% of non-empty string values parse as dates with strptime,
    and more than one distinct format label is seen (object/string columns only).
    """
    values = _non_empty_string_values_in_sample(sample_rows, col)
    total = len(values)
    if total == 0:
        return False

    parseable = 0
    labels: set[str] = set()
    for t in values:
        fmt = detect_date_format(t)
        if fmt is not None:
            parseable += 1
            labels.add(fmt)

    if parseable / total < 0.6:
        return False
    return len(labels) > 1


def _is_iso_date_column_in_sample(sample_rows: list[dict[str, Any]], col: str) -> bool:
    values = _non_empty_string_values_in_sample(sample_rows, col)
    if not values:
        return False
    return all(detect_date_format(value) == "Y-m-d" for value in values)


def _looks_like_dates_in_sample(sample_rows: list[dict[str, Any]], col: str) -> bool:
    raw: list[str] = []
    for row in sample_rows:
        v = row.get(col)
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        if isinstance(v, str):
            t = v.strip()
            if t:
                raw.append(t)
        else:
            return False
    if not raw:
        return False
    if not any(_DATE_LIKE.search(s) for s in raw):
        return False
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        parsed = pd.to_datetime(raw, errors="coerce", utc=False)
    if parsed.isna().any():
        return False
    return True


def _has_inconsistent_casing_in_sample(sample_rows: list[dict[str, Any]], col: str) -> bool:
    originals: list[str] = []
    for row in sample_rows:
        v = row.get(col)
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        if not isinstance(v, str):
            return False
        if not v.strip():
            continue
        originals.append(v)
    if len(originals) < 2:
        return False
    by_lower: dict[str, set[str]] = {}
    for v in originals:
        key = v.lower()
        by_lower.setdefault(key, set()).add(v)
    return any(len(variants) > 1 for variants in by_lower.values())
