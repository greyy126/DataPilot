"""
Deterministic Pandas cleaning pipeline: apply approved actions in order, save CSV.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from app.models.schemas.cleaning import CleanAction
from app.utils.file_handler import BACKEND_DIR, CLEANED_DIR, generate_file_id


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


def _apply_convert_to_date(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    out = df.copy()
    try:
        out[column] = pd.to_datetime(out[column], errors="raise", utc=False)
    except Exception as e:
        raise ValueError(f"convert_to_date failed for column {column!r}: {e!s}") from e
    return out


def _apply_standardize_date(df: pd.DataFrame, column: str) -> pd.DataFrame:
    """
    Parse with coerce (invalid → NaT), then store as YYYY-MM-DD strings for export.
    """
    _require_column(df, column)
    out = df.copy()
    parsed = pd.to_datetime(out[column], errors="coerce", utc=False)
    out[column] = parsed.dt.strftime("%Y-%m-%d")
    return out


def _apply_convert_to_numeric(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    out = df.copy()
    try:
        out[column] = pd.to_numeric(out[column], errors="raise")
    except Exception as e:
        raise ValueError(f"convert_to_numeric failed for column {column!r}: {e!s}") from e
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


def _apply_drop_column(df: pd.DataFrame, column: str) -> pd.DataFrame:
    _require_column(df, column)
    return df.drop(columns=[column])


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
    if a == "remove_duplicates":
        return _apply_remove_duplicates(df, action.column)
    if a == "fill_missing":
        if action.fill_value is None:
            raise ValueError("fill_missing requires fill_value")
        return _apply_fill_missing(df, action.column, action.fill_value)
    if a == "drop_column":
        return _apply_drop_column(df, action.column)
    raise ValueError(f"Unsupported action: {a!r}")


def clean_dataset(
    file_path: str | Path,
    actions: list[CleanAction],
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
    for i, act in enumerate(actions):
        try:
            df = apply_action(df, act)
        except Exception as e:
            raise ValueError(f"Action {i + 1} ({act.action!r}) failed: {e!s}") from e

    cleaned_id = generate_file_id()
    CLEANED_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{cleaned_id}.csv"
    out_path = CLEANED_DIR / out_name
    df.to_csv(out_path, index=False)

    rel = (Path("storage") / "cleaned" / out_name).as_posix()
    return cleaned_id, rel
