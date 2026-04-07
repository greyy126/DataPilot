from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from app.utils.file_handler import BACKEND_DIR

router = APIRouter()


@router.get("/download")
async def download_file(file_id: str):
    relative_path = Path("storage") / "cleaned" / f"{file_id}.csv"
    file_path = BACKEND_DIR / relative_path

    print("Download requested for:", file_id)
    print("Looking for file at:", file_path)

    if not file_path.is_file():
        return JSONResponse(
            status_code=404,
            content={
                "error": f"Cleaned file not found for file_id '{file_id}'",
                "file_path": relative_path.as_posix(),
            },
        )

    return FileResponse(
        path=file_path,
        media_type="text/csv",
        filename="cleaned_data.csv",
    )
