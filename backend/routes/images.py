"""
Background image storage endpoints.
"""

import hashlib
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from ..config import get_images_dir

router = APIRouter()


@router.post("/images/upload")
async def upload_image(file: UploadFile = File(...)):
    """Upload a background image, returns the stored filename."""
    # Generate unique filename while preserving extension
    ext = Path(file.filename).suffix.lower() if file.filename else '.png'
    if ext not in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']:
        raise HTTPException(status_code=400, detail="Invalid image format")

    try:
        contents = await file.read()
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Failed to read upload: {str(e)}")

    # Use content hash as filename to deduplicate identical images
    content_hash = hashlib.sha256(contents).hexdigest()
    new_filename = f"{content_hash}{ext}"
    path = get_images_dir() / new_filename

    if not path.exists():
        try:
            with open(path, 'wb') as f:
                f.write(contents)
        except IOError as e:
            raise HTTPException(status_code=500, detail=f"Failed to save image: {str(e)}")

    return {"filename": new_filename}


@router.get("/images/{filename}")
async def get_image(filename: str):
    """Serve a stored background image."""
    safe_filename = Path(filename).name
    path = get_images_dir() /safe_filename

    if not path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(path)
