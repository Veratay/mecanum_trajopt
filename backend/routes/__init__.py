"""
API route modules.
"""

from .solve import router as solve_router
from .projects import router as projects_router
from .images import router as images_router
from .adb import router as adb_router

__all__ = ['solve_router', 'projects_router', 'images_router', 'adb_router']
