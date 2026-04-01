import pandas as pd
from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas.suggestions import SuggestionsResponse
from app.services import profiling_service
from app.services.suggestion_engine import generate_suggestions
from app.utils import file_handler

router = APIRouter()


@router.get("/suggestions", response_model=SuggestionsResponse)
async def get_suggestions(
    file_id: str = Query(..., description="Upload id returned from POST /upload"),
) -> SuggestionsResponse:
    try:
        path = file_handler.get_upload_path_by_file_id(file_id)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    try:
        profile = profiling_service.profile_dataset(path)
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
            detail=f"Could not load file for suggestions: {e!s}",
        ) from e

    items = generate_suggestions(profile)
    return SuggestionsResponse(file_id=file_id.strip(), suggestions=items)
