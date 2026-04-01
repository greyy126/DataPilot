import pandas as pd
from fastapi import APIRouter, HTTPException, status

from app.models.schemas.cleaning import CleanRequest, CleanResponse
from app.services import cleaning_service
from app.utils import file_handler

router = APIRouter()


@router.post("/clean", response_model=CleanResponse, status_code=status.HTTP_201_CREATED)
async def clean_dataset(req: CleanRequest) -> CleanResponse:
    try:
        path = file_handler.get_upload_path_by_file_id(req.file_id)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    try:
        cleaned_id, rel_path = cleaning_service.clean_dataset(path, req.actions)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e
    except (ValueError, KeyError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except (pd.errors.ParserError, pd.errors.EmptyDataError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not parse source file: {e!s}",
        ) from e

    return CleanResponse(cleaned_file_id=cleaned_id, cleaned_file_path=rel_path)
