"""
Centralized configuration for project directory paths.

The project directory can be set via the TRAJOPT_PROJECT_DIR environment variable.
If not set, defaults to a 'projects' folder in the repository root.
"""

import os
from pathlib import Path

_REPO_ROOT = Path(__file__).parent.parent


def get_projects_dir() -> Path:
    """Return the configured projects directory, creating it if needed."""
    env = os.environ.get("TRAJOPT_PROJECT_DIR")
    if env:
        projects_dir = Path(env).resolve()
    else:
        projects_dir = _REPO_ROOT / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)
    return projects_dir


def get_images_dir() -> Path:
    """Return the images directory at the root of the configured project directory."""
    # Images go in the root of the project directory, not in a subdirectory
    env = os.environ.get("TRAJOPT_PROJECT_DIR")
    if env:
        project_root = Path(env).resolve()
    else:
        project_root = _REPO_ROOT / "projects"
    images_dir = project_root / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    return images_dir
