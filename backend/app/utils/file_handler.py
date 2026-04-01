import uuid
from pathlib import Path

from fastapi import UploadFile

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR = BACKEND_DIR / "storage" / "uploads"
CLEANED_DIR = BACKEND_DIR / "storage" / "cleaned"

ALLOWED_EXTENSIONS = frozenset({".csv", ".xlsx"})


def get_upload_path_by_file_id(file_id: str) -> Path:
    """
    Resolve an uploaded file by id (stem). Tries .csv then .xlsx on disk.

    Raises:
        FileNotFoundError: No matching file under storage/uploads/.
    """
    fid = (file_id or "").strip()
    if not fid or ".." in fid or "/" in fid or "\\" in fid:
        raise FileNotFoundError("Invalid file id.")
    for ext in (".csv", ".xlsx"):
        p = UPLOAD_DIR / f"{fid}{ext}"
        if p.is_file():
            return p
    raise FileNotFoundError(f"No uploaded file found for id: {file_id}")


def generate_file_id() -> str:
    return str(uuid.uuid4())


def _extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def validate_upload_filename(filename: str | None) -> str:
    if not filename or not filename.strip():
        raise ValueError("A filename is required.")
    ext = _extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise ValueError(f"Invalid file type. Allowed extensions: {allowed}.")
    return ext


def _validate_file_content(extension: str, content: bytes) -> None:
    if not content:
        raise ValueError("The uploaded file is empty.")
    if extension == ".xlsx" and not content.startswith(b"PK"):
        raise ValueError(
            "The file does not look like a valid Excel workbook (.xlsx is a ZIP-based format)."
        )


async def save_file(upload: UploadFile) -> tuple[str, str]:
    """
    Validate type, save under storage/uploads with a unique name.

    Returns:
        file_id: UUID string (without extension; matches stem of stored file).
        file_path: Path relative to the backend directory, POSIX-style.
    """
    ext = validate_upload_filename(upload.filename)
    content = await upload.read()
    _validate_file_content(ext, content)

    file_id = generate_file_id()
    stored_name = f"{file_id}{ext}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = UPLOAD_DIR / stored_name

    dest.write_bytes(content)

    rel = Path("storage") / "uploads" / stored_name
    return file_id, rel.as_posix()
