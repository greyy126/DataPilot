from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    file_id: str = Field(..., description="Unique id for this upload (matches saved file stem).")
    file_path: str = Field(
        ...,
        description="Path relative to the backend root, e.g. storage/uploads/<id>.csv",
    )
