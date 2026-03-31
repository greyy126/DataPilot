from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.models.schemas.upload import UploadResponse
from app.utils import file_handler

router = APIRouter()


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_file(file: UploadFile = File(...)) -> UploadResponse:
    try:
        file_id, file_path = await file_handler.save_file(file)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    return UploadResponse(file_id=file_id, file_path=file_path)
