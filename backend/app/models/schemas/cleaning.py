from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class CleanAction(BaseModel):
    """Single cleaning step. Fields depend on action (validated below)."""

    action: Literal[
        "rename_column",
        "trim_whitespace",
        "normalize_case",
        "convert_to_date",
        "standardize_date",
        "convert_to_numeric",
        "remove_duplicates",
        "fill_missing",
        "drop_column",
    ]
    column: str | None = Field(
        default=None,
        description='Target column, or "*" for remove_duplicates across all columns.',
    )
    new_name: str | None = Field(default=None, description="Target name for rename_column.")
    fill_value: Any = Field(default=None, description="Value used for fill_missing.")

    @model_validator(mode="after")
    def validate_by_action(self) -> "CleanAction":
        a = self.action
        if a == "rename_column":
            if not self.column or not str(self.column).strip():
                raise ValueError("rename_column requires a non-empty column")
            if self.new_name is None or str(self.new_name).strip() == "":
                raise ValueError("rename_column requires new_name")
            return self
        if a == "remove_duplicates":
            if self.column is None:
                return self.model_copy(update={"column": "*"})
            return self
        if a == "fill_missing":
            if not self.column or not str(self.column).strip():
                raise ValueError("fill_missing requires column")
            if self.fill_value is None:
                raise ValueError("fill_missing requires fill_value (no silent default)")
            return self
        if a in (
            "trim_whitespace",
            "normalize_case",
            "convert_to_date",
            "standardize_date",
            "convert_to_numeric",
            "drop_column",
        ):
            if not self.column or not str(self.column).strip():
                raise ValueError(f"{a} requires column")
            if self.column.strip() == "*":
                raise ValueError(f"{a} requires a real column name, not '*'")
        return self


class CleanRequest(BaseModel):
    file_id: str = Field(..., description="Source upload id from POST /upload")
    actions: list[CleanAction] = Field(default_factory=list)


class CleanResponse(BaseModel):
    cleaned_file_id: str
    cleaned_file_path: str
