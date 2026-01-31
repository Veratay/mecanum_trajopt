"""
FastAPI server for the mecanum trajectory optimizer.

Endpoints:
- GET /: Serve the frontend
- POST /solve: Accept waypoints and robot params, return trajectory
"""

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .dynamics import RobotParams
from .optimizer import TrajectoryOptimizer, Waypoint


# Pydantic models for API
class WaypointRequest(BaseModel):
    x: float = Field(..., description="X position in meters")
    y: float = Field(..., description="Y position in meters")
    heading: float = Field(..., description="Heading angle in radians")
    stop: bool = Field(True, description="Whether robot should stop at this waypoint")
    v_max: float = Field(3.0, description="Max linear velocity for segment starting here (m/s)")
    omega_max: float = Field(10.0, description="Max angular velocity for segment starting here (rad/s)")
    type: str = Field("constrained", description="Waypoint type: constrained, unconstrained, or intake")
    intake_x: float = Field(0.0, description="Intake point X position (for type=intake)")
    intake_y: float = Field(0.0, description="Intake point Y position (for type=intake)")
    intake_distance: float = Field(0.5, description="Distance from intake point (for type=intake)")
    intake_velocity_max: float = Field(1.0, description="Max approach velocity at intake (m/s)")
    intake_velocity_slack: float = Field(0.1, description="Slack angle for velocity direction constraint (radians)")


class RobotParamsRequest(BaseModel):
    mass: float = Field(15.0, description="Robot mass in kg")
    inertia: float = Field(0.5, description="Moment of inertia in kg*m^2")
    wheel_radius: float = Field(0.05, description="Wheel radius in meters")
    lx: float = Field(0.15, description="Half wheelbase in x direction (meters)")
    ly: float = Field(0.15, description="Half wheelbase in y direction (meters)")
    w_max: float = Field(100.0, description="Motor max free speed (rad/s)")
    t_max: float = Field(1.0, description="Motor max stall torque (N*m)")
    f_traction_max: float = Field(20.0, description="Max traction force per wheel (N)")
    k_roller_viscous: float = Field(3.0, description="Viscous roller bearing friction coefficient (N·s/m)")
    default_intake_distance: float = Field(0.5, description="Default distance from intake point (m)")
    default_intake_velocity: float = Field(1.0, description="Default max approach velocity for intake (m/s)")


class SolveRequest(BaseModel):
    waypoints: list[WaypointRequest] = Field(..., min_length=2)
    robot_params: Optional[RobotParamsRequest] = None
    samples_per_meter: float = Field(20.0, ge=1.0, le=100.0, description="Target samples per meter (default 20 = 1 per 5cm)")
    min_samples_per_segment: int = Field(3, ge=1, le=50, description="Minimum samples between waypoints")


class SolverStatsResponse(BaseModel):
    iterations: int
    solve_time_ms: float


class TrajectoryResponse(BaseModel):
    times: list[float]
    states: list[list[float]]  # [vx, vy, omega, px, py, theta] per knot
    controls: list[list[float]]  # [drive, strafe, turn] per interval


class SolveResponse(BaseModel):
    success: bool
    total_time: float
    trajectory: TrajectoryResponse
    solver_stats: SolverStatsResponse


# Create FastAPI app
app = FastAPI(
    title="Mecanum Trajectory Optimizer",
    description="Time-optimal trajectory planning for mecanum drive robots",
    version="1.0.0"
)

# Get the project root directory
PROJECT_ROOT = Path(__file__).parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"


@app.get("/")
async def serve_frontend():
    """Serve the main frontend page."""
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend not found")
    return FileResponse(index_path)


# Mount static files for frontend assets
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.post("/solve", response_model=SolveResponse)
async def solve_trajectory(request: SolveRequest):
    """
    Solve for the time-optimal trajectory through the given waypoints.

    The solver minimizes total trajectory time while respecting:
    - Robot dynamics
    - Motor duty cycle limits
    - Traction force limits
    - Waypoint position and heading constraints
    """
    # Convert request to internal types
    if request.robot_params:
        params = RobotParams(
            mass=request.robot_params.mass,
            inertia=request.robot_params.inertia,
            wheel_radius=request.robot_params.wheel_radius,
            lx=request.robot_params.lx,
            ly=request.robot_params.ly,
            w_max=request.robot_params.w_max,
            t_max=request.robot_params.t_max,
            f_traction_max=request.robot_params.f_traction_max,
            k_roller_viscous=request.robot_params.k_roller_viscous,
            default_intake_distance=request.robot_params.default_intake_distance,
            default_intake_velocity=request.robot_params.default_intake_velocity
        )
    else:
        params = RobotParams()

    waypoints = [
        Waypoint(x=wp.x, y=wp.y, heading=wp.heading, stop=wp.stop,
                 v_max=wp.v_max, omega_max=wp.omega_max,
                 type=wp.type, intake_x=wp.intake_x, intake_y=wp.intake_y,
                 intake_distance=wp.intake_distance)
        for wp in request.waypoints
    ]

    # Create optimizer and solve
    optimizer = TrajectoryOptimizer(params, samples_per_meter=request.samples_per_meter, min_samples_per_segment=request.min_samples_per_segment)

    try:
        result = optimizer.solve(waypoints)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Solver error: {str(e)}")

    return SolveResponse(
        success=result.success,
        total_time=result.total_time,
        trajectory=TrajectoryResponse(
            times=result.times,
            states=result.states,
            controls=result.controls
        ),
        solver_stats=SolverStatsResponse(
            iterations=result.iterations,
            solve_time_ms=result.solve_time_ms
        )
    )


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


def main():
    """Run the server."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
