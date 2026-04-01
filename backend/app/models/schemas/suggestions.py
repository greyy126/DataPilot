from pydantic import BaseModel, Field


class SuggestionItem(BaseModel):
    action: str
    column: str
    reason: str


class SuggestionsResponse(BaseModel):
    file_id: str
    suggestions: list[SuggestionItem] = Field(default_factory=list)
