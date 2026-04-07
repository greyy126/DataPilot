import pandas as pd
from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas.validation import ValidationResponse
from app.services import validation_service
from app.utils import file_handler

router = APIRouter()


@router.get("/validations", response_model=ValidationResponse)
async def get_validations(
    file_id: str = Query(..., description="Upload id returned from POST /upload"),
) -> ValidationResponse:
    try:
        path = file_handler.get_upload_path_by_file_id(file_id)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        ) from e

    try:
        data = validation_service.validate_dataset(path)
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
            detail=f"Could not validate file: {e!s}",
        ) from e

    return ValidationResponse(file_id=file_id.strip(), **data)
