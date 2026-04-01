import pandas as pd
from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas.profile import ProfileResponse
from app.services import profiling_service
from app.utils import file_handler

router = APIRouter()


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    file_id: str = Query(..., description="Upload id returned from POST /upload"),
) -> ProfileResponse:
    try:
        path = file_handler.get_upload_path_by_file_id(file_id)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    try:
        data = profiling_service.profile_dataset(path)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except (ValueError, pd.errors.ParserError, pd.errors.EmptyDataError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not profile file: {e!s}",
        ) from e

    data["file_id"] = file_id.strip()
    return ProfileResponse(**data)
