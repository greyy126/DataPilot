from pathlib import Path

import numpy as np
import pandas as pd

from app.utils.file_handler import BACKEND_DIR


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


def profile_dataset(file_path: str | Path) -> dict:
    """
    Build a deterministic profile for a CSV or Excel file.

    Returns a JSON-serializable dict.
    """
    path = _resolve_path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    df = _load_dataframe(path)
    n = len(df)
    columns = [str(c) for c in df.columns]

    dtypes = {str(col): str(dtype) for col, dtype in df.dtypes.items()}

    null_count_series = df.isna().sum()
    null_count = {str(k): int(v) for k, v in null_count_series.items()}

    if n == 0:
        null_percentage = {str(c): 0.0 for c in df.columns}
    else:
        null_pct_series = (df.isna().sum() / n * 100).round(4)
        null_percentage = {str(k): float(v) for k, v in null_pct_series.items()}

    unique_count_series = df.nunique(dropna=False)
    unique_count = {str(k): int(v) for k, v in unique_count_series.items()}

    duplicate_row_count = int(df.duplicated().sum())

    sample_rows = _sample_rows_jsonable(df.head(5))

    try:
        rel_path = path.relative_to(BACKEND_DIR)
    except ValueError:
        rel_path = path
    return {
        "file_path": rel_path.as_posix(),
        "columns": columns,
        "dtypes": dtypes,
        "null_count": null_count,
        "null_percentage": null_percentage,
        "unique_count": unique_count,
        "duplicate_row_count": duplicate_row_count,
        "sample_rows": sample_rows,
    }


def _serialize_cell(val: object) -> object:
    if pd.isna(val):
        return None
    if isinstance(val, (np.integer, np.int64, np.int32, np.uint64)):
        return int(val)
    if isinstance(val, (np.floating, np.float64, np.float32)):
        return float(val)
    if isinstance(val, np.bool_):
        return bool(val)
    if isinstance(val, pd.Timestamp):
        return val.isoformat()
    if isinstance(val, pd.Timedelta):
        return str(val)
    if isinstance(val, (str, bool, int, float)):
        return val
    return str(val)


def _sample_rows_jsonable(sample: pd.DataFrame) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for _, row in sample.iterrows():
        rows.append({str(k): _serialize_cell(v) for k, v in row.items()})
    return rows
