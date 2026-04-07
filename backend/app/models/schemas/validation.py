from typing import Any, Literal

from pydantic import BaseModel, Field


class CategoryMappingGroup(BaseModel):
    canonical: str
    variants: list[str] = Field(default_factory=list)
    count: int | None = None


class ValidationRecommendation(BaseModel):
    action: Literal["fill_missing", "drop_rows", "drop_column", "clip_to_range", "review", "remove_duplicates"]
    reason: str
    fill_value: Any | None = None
    fill_strategy: str | None = None


class ValidationFinding(BaseModel):
    rule_type: Literal["null_check", "range_check", "type_check"]
    severity: Literal["info", "warning", "error"]
    column: str
    issue_type: Literal["negative_values", "extreme_values", "domain_check", "type_mismatch", "category_mapping", "duplicate_key", "invalid_date"] | None = None
    issue_count: int
    issue_percentage: float
    affected_row_indices: list[int] = Field(default_factory=list)
    sample_row_indices: list[int] = Field(default_factory=list)
    range_value_type: Literal["numeric", "date"] | None = None
    expected_min: Any | None = None
    expected_max: Any | None = None
    expected_range: str | None = None
    sample_values: list[Any] = Field(default_factory=list)
    groups: list[CategoryMappingGroup] = Field(default_factory=list)
    message: str
    recommendations: list[ValidationRecommendation] = Field(default_factory=list)


class ValidationResponse(BaseModel):
    file_id: str
    message: str | None = None
    findings: list[ValidationFinding] = Field(default_factory=list)
