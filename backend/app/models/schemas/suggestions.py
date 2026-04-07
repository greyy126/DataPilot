from pydantic import BaseModel, Field


class CategoryMappingGroup(BaseModel):
    canonical: str
    variants: list[str] = Field(default_factory=list)
    count: int


class CategoryMappingActionGroup(BaseModel):
    from_values: list[str] = Field(default_factory=list, alias="from")
    to: str

    model_config = {"populate_by_name": True}


class SuggestionItem(BaseModel):
    action: str
    column: str
    reason: str
    groups: list[CategoryMappingGroup] = Field(default_factory=list)
    mapping_groups: list[CategoryMappingActionGroup] = Field(default_factory=list)


class SuggestionsResponse(BaseModel):
    file_id: str
    suggestions: list[SuggestionItem] = Field(default_factory=list)
