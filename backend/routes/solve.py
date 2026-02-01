"""
Trajectory solver endpoint.
"""

from fastapi import APIRouter, HTTPException

from ..models import SolveRequest, SolveResponse, TrajectoryResponse, SolverStatsResponse
from ..dynamics import RobotParams
from ..optimizer import TrajectoryOptimizer, Waypoint, PathConstraint

router = APIRouter()


@router.post("/solve", response_model=SolveResponse)
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

    # Convert constraints
    constraints = [
        PathConstraint(
            type=c.type,
            from_waypoint=c.fromWaypoint,
            to_waypoint=c.toWaypoint,
            params=c.params.model_dump(exclude_none=True)
        )
        for c in request.constraints if c.enabled
    ]

    # Create optimizer and solve
    optimizer = TrajectoryOptimizer(params, samples_per_meter=request.samples_per_meter, min_samples_per_segment=request.min_samples_per_segment)

    try:
        result = optimizer.solve(waypoints, constraints)
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
