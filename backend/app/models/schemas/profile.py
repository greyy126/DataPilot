from typing import Any

from pydantic import BaseModel, Field


class ProfileResponse(BaseModel):
    file_id: str
    file_path: str = Field(..., description="Path relative to backend root.")
    columns: list[str]
    dtypes: dict[str, str] = Field(..., description="Inferred pandas dtypes per column.")
    null_count: dict[str, int]
    null_percentage: dict[str, float]
    unique_count: dict[str, int]
    duplicate_row_count: int
    sample_rows: list[dict[str, Any]] = Field(
        ...,
        description="First five data rows as JSON-friendly values.",
    )
