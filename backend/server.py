"""
FastAPI server for the mecanum trajectory optimizer.

Endpoints:
- GET /: Serve the frontend
- POST /solve: Accept waypoints and robot params, return trajectory
- GET/POST/DELETE /projects: Project storage
- GET/POST /images: Background image storage
- GET/POST /adb: Android device sync
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .routes import solve_router, projects_router, images_router, adb_router


# Create FastAPI app
app = FastAPI(
    title="Mecanum Trajectory Optimizer",
    description="Time-optimal trajectory planning for mecanum drive robots",
    version="1.0.0"
)

# Get the project root directory
PROJECT_ROOT = Path(__file__).parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

# Include routers
app.include_router(solve_router)
app.include_router(projects_router)
app.include_router(images_router)
app.include_router(adb_router)


@app.get("/")
async def serve_frontend():
    """Serve the main frontend page."""
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend not found")
    return FileResponse(index_path)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# Mount static files for frontend assets
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


def main():
    """Run the server."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
