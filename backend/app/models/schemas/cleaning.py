from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class StandardizeValuesGroup(BaseModel):
    from_values: list[str] = Field(default_factory=list, alias="from")
    to: str

    model_config = {"populate_by_name": True}


class CleanAction(BaseModel):
    """Single cleaning step. Fields depend on action (validated below)."""

    action: Literal[
        "rename_column",
        "trim_whitespace",
        "normalize_case",
        "convert_to_date",
        "standardize_date",
        "convert_to_numeric",
        "convert_numeric",
        "remove_duplicates",
        "fill_missing",
        "drop_rows",
        "clip_to_range",
        "drop_column",
        "replace",
        "standardize_values",
    ]
    column: str | None = Field(
        default=None,
        description='Target column, or "*" for remove_duplicates across all columns.',
    )
    row_numbers: list[int] | None = Field(
        default=None,
        description="1-based spreadsheet row numbers to target for row-level actions.",
    )
    min_value: float | int | None = Field(default=None, description="Lower bound for clip_to_range.")
    max_value: float | int | None = Field(default=None, description="Upper bound for clip_to_range.")
    new_name: str | None = Field(default=None, description="Target name for rename_column.")
    fill_value: Any = Field(default=None, description="Value used for fill_missing.")
    value: Any = Field(default=None, description="Replacement value used for targeted replace actions.")
    groups: list[StandardizeValuesGroup] | None = Field(
        default=None,
        description="Value groups used for standardize_values.",
    )

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
        if a == "replace":
            if not self.column or not str(self.column).strip():
                raise ValueError("replace requires column")
            if self.value is None:
                raise ValueError("replace requires value")
            return self
        if a == "standardize_values":
            if not self.column or not str(self.column).strip():
                raise ValueError("standardize_values requires column")
            if self.column.strip() == "*":
                raise ValueError("standardize_values requires a real column name, not '*'")
            if not self.groups:
                raise ValueError("standardize_values requires at least one mapping group")
            for group in self.groups:
                if not group.from_values:
                    raise ValueError("standardize_values groups require at least one source value")
                if str(group.to).strip() == "":
                    raise ValueError("standardize_values groups require a non-empty target value")
            return self
        if a == "drop_rows":
            if not self.column or not str(self.column).strip():
                raise ValueError("drop_rows requires column")
            if self.column.strip() == "*":
                raise ValueError("drop_rows requires a real column name, not '*'")
            if not self.row_numbers:
                raise ValueError("drop_rows requires at least one row number")
            if any(int(n) < 2 for n in self.row_numbers):
                raise ValueError("drop_rows row numbers must be spreadsheet rows >= 2")
            return self
        if a == "clip_to_range":
            if not self.column or not str(self.column).strip():
                raise ValueError("clip_to_range requires column")
            if self.column.strip() == "*":
                raise ValueError("clip_to_range requires a real column name, not '*'")
            if not self.row_numbers:
                raise ValueError("clip_to_range requires at least one row number")
            if any(int(n) < 2 for n in self.row_numbers):
                raise ValueError("clip_to_range row numbers must be spreadsheet rows >= 2")
            if self.min_value is None and self.max_value is None:
                raise ValueError("clip_to_range requires min_value and/or max_value")
            return self
        if a in (
            "trim_whitespace",
            "normalize_case",
            "convert_to_date",
            "standardize_date",
            "convert_to_numeric",
            "convert_numeric",
            "drop_column",
        ):
            if not self.column or not str(self.column).strip():
                raise ValueError(f"{a} requires column")
            if self.column.strip() == "*":
                raise ValueError(f"{a} requires a real column name, not '*'")
        return self


class CleanRequest(BaseModel):
    file_id: str = Field(..., description="Source upload id from POST /upload")
    selected_columns: list[str] | None = Field(
        default=None,
        description="Subset of columns to keep before applying cleaning actions.",
    )
    actions: list[CleanAction] = Field(default_factory=list)


class CleanResponse(BaseModel):
    cleaned_file_id: str
    cleaned_file_path: str
