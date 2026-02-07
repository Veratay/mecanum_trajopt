"""
Project storage endpoints.
"""

import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..models import ProjectMetadata, ProjectListResponse
from ..config import get_projects_dir

router = APIRouter()


@router.get("/projects", response_model=ProjectListResponse)
async def list_projects():
    """List all saved projects with metadata."""
    projects = []
    for path in get_projects_dir().glob("*.json"):
        try:
            with open(path, 'r') as f:
                data = json.load(f)
            projects.append(ProjectMetadata(
                name=data.get('name', path.stem),
                filename=path.name,
                updatedAt=data.get('updatedAt', ''),
                trajectoryCount=len(data.get('trajectories', []))
            ))
        except (json.JSONDecodeError, IOError):
            continue

    # Sort by update time, newest first
    projects.sort(key=lambda p: p.updatedAt, reverse=True)
    return ProjectListResponse(projects=projects)


@router.get("/projects/{filename}")
async def load_project(filename: str):
    """Load a specific project by filename."""
    if not filename.endswith('.json'):
        filename += '.json'

    # Sanitize filename to prevent directory traversal
    safe_filename = Path(filename).name
    path = get_projects_dir() / safe_filename

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        with open(path, 'r') as f:
            data = json.load(f)
        return data
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid project file")


@router.post("/projects/{filename}")
async def save_project(filename: str, project: dict):
    """Save a project (create or overwrite)."""
    if not filename.endswith('.json'):
        filename += '.json'

    # Sanitize filename
    safe_filename = Path(filename).name
    path = get_projects_dir() / safe_filename

    # Add/update timestamp
    project['updatedAt'] = datetime.utcnow().isoformat() + 'Z'

    try:
        with open(path, 'w') as f:
            json.dump(project, f, indent=2)
        return {"success": True, "filename": safe_filename}
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save project: {str(e)}")


@router.delete("/projects/{filename}")
async def delete_project(filename: str):
    """Delete a project."""
    if not filename.endswith('.json'):
        filename += '.json'

    safe_filename = Path(filename).name
    path = get_projects_dir() / safe_filename

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        path.unlink()
        return {"success": True}
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete project: {str(e)}")
