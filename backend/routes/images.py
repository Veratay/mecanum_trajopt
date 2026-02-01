"""
Background image storage endpoints.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

router = APIRouter()

# Get the project root directory
PROJECT_ROOT = Path(__file__).parent.parent.parent
PROJECTS_DIR = PROJECT_ROOT / "projects"
IMAGES_DIR = PROJECTS_DIR / "images"

# Ensure directory exists
IMAGES_DIR.mkdir(exist_ok=True)


@router.post("/images/upload")
async def upload_image(file: UploadFile = File(...)):
    """Upload a background image, returns the stored filename."""
    # Generate unique filename while preserving extension
    ext = Path(file.filename).suffix.lower() if file.filename else '.png'
    if ext not in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']:
        raise HTTPException(status_code=400, detail="Invalid image format")

    new_filename = f"{uuid.uuid4().hex}{ext}"
    path = IMAGES_DIR / new_filename

    try:
        contents = await file.read()
        with open(path, 'wb') as f:
            f.write(contents)
        return {"filename": new_filename}
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save image: {str(e)}")


@router.get("/images/{filename}")
async def get_image(filename: str):
    """Serve a stored background image."""
    safe_filename = Path(filename).name
    path = IMAGES_DIR / safe_filename

    if not path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(path)
