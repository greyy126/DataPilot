"""
Deterministic Pandas cleaning pipeline: apply approved actions in order, save CSV.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from app.models.schemas.cleaning import CleanAction
from app.utils.file_handler import BACKEND_DIR, CLEANED_DIR, generate_file_id

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
_SOURCE_ROW_NUMBER_COLUMN = "__source_row_number__"


def _resolve_path(file_path: str | Path) -> Path:
    path = Path(file_path)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return path.resolve()


def _load_dataframe(file_path: Path) -> pd.DataFrame:
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(file_path)
    if suffix == ".xlsx":
        return pd.read_excel(file_path, engine="openpyxl")
    raise ValueError(f"Unsupported file format: {suffix}")


def _require_column(df: pd.DataFrame, column: str) -> None:
    if column not in df.columns:
        raise ValueError(
            f"Column not found: {column!r} (available: {list(df.columns)})"
        )


def _apply_rename_column(df: pd.DataFrame, column: str, new_name: str) -> pd.DataFrame:
    _require_column(df, column)
    if new_name in df.columns and new_name != column:
        raise ValueError(f"Target column name already exists: {new_name!r}")
    return df.rename(columns={column: new_name})


def _apply_trim_whitespace(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    s = df[column]
    mask = s.notna()
    if mask.any():
        trimmed = s.loc[mask].map(lambda x: x.strip() if isinstance(x, str) else x)
        out = df.copy()
        out.loc[mask, column] = trimmed
        return out
    return df


def _apply_normalize_case(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    s = df[column]
    mask = s.notna()
    out = df.copy()
    out.loc[mask, column] = s.loc[mask].map(
        lambda x: x.lower() if isinstance(x, str) else x
    )
    return out


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


def _apply_convert_to_date(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    out = df.copy()
    converted = out[column].map(_parse_date_value)
    failed_mask = out[column].notna() & converted.isna()
    if failed_mask.any():
        failed_values = out.loc[failed_mask, column].astype(str).head(3).tolist()
        raise ValueError(
            f"convert_to_date failed for column {column!r}: could not parse values {failed_values}"
        )
    out[column] = pd.to_datetime(converted, errors="raise", utc=False)
    return out


def _apply_standardize_date(df: pd.DataFrame, column: str) -> pd.DataFrame:
    """
    Parse values individually so mixed valid formats normalize consistently.
    Preserve blanks and unparseable originals instead of replacing them with empty cells.
    """
    _require_column(df, column)
    out = df.copy()
    out[column] = out[column].map(
        lambda value: parsed.strftime("%Y-%m-%d")
        if (parsed := _parse_date_value(value)) is not None
        else value
    )
    return out


def _apply_convert_to_numeric(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    out = df.copy()
    try:
        out[column] = pd.to_numeric(out[column], errors="raise")
    except Exception as e:
        raise ValueError(f"convert_to_numeric failed for column {column!r}: {e!s}") from e
    return out


def _apply_convert_numeric(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    out = df.copy()
    out[column] = pd.to_numeric(out[column], errors="coerce")
    return out


def _apply_standardize_values(
    df: pd.DataFrame, column: str, groups: list[Any] | None
) -> pd.DataFrame:
    _require_column(df, column)
    if not groups:
        raise ValueError("standardize_values requires at least one mapping group")

    replacements: dict[str, Any] = {}
    for group in groups:
        for from_value in group.from_values:
            replacements[str(from_value).strip()] = group.to

    out = df.copy()
    out[column] = out[column].map(
        lambda value: (
            replacements.get(value.strip(), value)
            if isinstance(value, str)
            else value
        )
        if pd.notna(value)
        else value
    )
    return out


def _apply_remove_duplicates(df: pd.DataFrame, column: str | None) -> pd.DataFrame:
    col = column or "*"
    if col == "*":
        return df.drop_duplicates()
    _require_column(df, col)
    return df.drop_duplicates(subset=[col])


def _apply_fill_missing(df: pd.DataFrame, column: str, fill_value: Any) -> pd.DataFrame:
    _require_column(df, column)
    out = df.copy()
    out[column] = out[column].fillna(fill_value)
    return out


def _apply_replace_invalid_numeric_values(df: pd.DataFrame, column: str, value: Any) -> pd.DataFrame:
    _require_column(df, column)
    out = df.copy()
    converted = pd.to_numeric(out[column], errors="coerce")
    invalid_mask = converted.isna() & out[column].notna()
    out.loc[invalid_mask, column] = value
    return out


def _row_mask_for_numbers(df: pd.DataFrame, row_numbers: list[int]) -> pd.Series:
    if _SOURCE_ROW_NUMBER_COLUMN not in df.columns:
        raise ValueError("Internal row tracking column is missing.")

    target_rows = sorted({int(row_number) for row_number in row_numbers})
    missing_rows = sorted(
        set(target_rows).difference(set(df[_SOURCE_ROW_NUMBER_COLUMN].astype(int).tolist()))
    )
    if missing_rows:
        raise ValueError(f"Action contains unknown or already-removed row numbers: {missing_rows}")

    return df[_SOURCE_ROW_NUMBER_COLUMN].isin(target_rows)


def _apply_drop_rows(df: pd.DataFrame, column: str, row_numbers: list[int]) -> pd.DataFrame:
    _require_column(df, column)
    row_mask = _row_mask_for_numbers(df, row_numbers)
    return df.loc[~row_mask].copy()


def _apply_clip_to_range(
    df: pd.DataFrame,
    column: str,
    row_numbers: list[int],
    min_value: float | int | None,
    max_value: float | int | None,
) -> pd.DataFrame:
    _require_column(df, column)
    if not pd.api.types.is_numeric_dtype(df[column]):
        raise ValueError(f"clip_to_range requires a numeric column, got {column!r}")

    row_mask = _row_mask_for_numbers(df, row_numbers)
    out = df.copy()
    out.loc[row_mask, column] = out.loc[row_mask, column].clip(
        lower=min_value, upper=max_value
    )
    return out


def _apply_drop_column(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    return df.drop(columns=[column])


def _apply_selected_columns(df: pd.DataFrame, selected_columns: list[str] | None) -> pd.DataFrame:
    if selected_columns is None:
        return df
    if len(selected_columns) == 0:
        raise ValueError("selected_columns must contain at least one column")
    missing = [column for column in selected_columns if column not in df.columns]
    if missing:
        raise ValueError(f"Selected columns not found: {missing}")
    return df.loc[:, selected_columns].copy()


def apply_action(df: pd.DataFrame, action: CleanAction) -> pd.DataFrame:
    """Apply one validated action. Raises on invalid state or transformation failure."""
    a = action.action
    if a == "rename_column":
        if action.new_name is None:
            raise ValueError("rename_column requires new_name")
        return _apply_rename_column(df, action.column, action.new_name)
    if a == "trim_whitespace":
        return _apply_trim_whitespace(df, action.column)
    if a == "normalize_case":
        return _apply_normalize_case(df, action.column)
    if a == "convert_to_date":
        return _apply_convert_to_date(df, action.column)
    if a == "standardize_date":
        return _apply_standardize_date(df, action.column)
    if a == "convert_to_numeric":
        return _apply_convert_to_numeric(df, action.column)
    if a == "convert_numeric":
        return _apply_convert_numeric(df, action.column)
    if a == "standardize_values":
        return _apply_standardize_values(df, action.column, action.groups)
    if a == "remove_duplicates":
        return _apply_remove_duplicates(df, action.column)
    if a == "fill_missing":
        if action.fill_value is None:
            raise ValueError("fill_missing requires fill_value")
        return _apply_fill_missing(df, action.column, action.fill_value)
    if a == "drop_rows":
        return _apply_drop_rows(df, action.column, action.row_numbers or [])
    if a == "clip_to_range":
        return _apply_clip_to_range(
            df,
            action.column,
            action.row_numbers or [],
            action.min_value,
            action.max_value,
        )
    if a == "drop_column":
        return _apply_drop_column(df, action.column)
    if a == "replace":
        return _apply_replace_invalid_numeric_values(df, action.column, action.value)
    raise ValueError(f"Unsupported action: {a!r}")


def clean_dataset(
    file_path: str | Path,
    actions: list[CleanAction],
    selected_columns: list[str] | None = None,
) -> tuple[str, str]:
    """
    Load file, apply actions in order, write CSV under storage/cleaned/.

    Returns:
        cleaned_file_id: UUID stem of the saved file.
        cleaned_file_path: Relative to backend root (POSIX).
    """
    path = _resolve_path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    df = _load_dataframe(path)
    df = df.copy()
    df[_SOURCE_ROW_NUMBER_COLUMN] = [i + 2 for i in range(len(df))]
    if selected_columns is not None:
        source_row_numbers = df[_SOURCE_ROW_NUMBER_COLUMN].copy()
        df = _apply_selected_columns(df, selected_columns)
        df[_SOURCE_ROW_NUMBER_COLUMN] = source_row_numbers
    for i, act in enumerate(actions):
        try:
            df = apply_action(df, act)
        except Exception as e:
            raise ValueError(f"Action {i + 1} ({act.action!r}) failed: {e!s}") from e

    if _SOURCE_ROW_NUMBER_COLUMN in df.columns:
        df = df.drop(columns=[_SOURCE_ROW_NUMBER_COLUMN])

    cleaned_id = generate_file_id()
    CLEANED_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{cleaned_id}.csv"
    out_path = CLEANED_DIR / out_name
    df.to_csv(out_path, index=False)

    rel = (Path("storage") / "cleaned" / out_name).as_posix()
    return cleaned_id, rel
