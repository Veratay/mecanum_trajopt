"""
Pydantic models for API request/response types.
"""

from typing import Optional
from pydantic import BaseModel, Field


# Waypoint models
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


# Constraint models
class ConstraintParamsRequest(BaseModel):
    """Constraint-specific parameters."""
    # Circle obstacle
    cx: Optional[float] = Field(None, description="Center X for circle obstacle")
    cy: Optional[float] = Field(None, description="Center Y for circle obstacle")
    radius: Optional[float] = Field(None, description="Radius for circle obstacle")
    # Rectangle (obstacle and stay-in-rect)
    x: Optional[float] = Field(None, description="X position for rectangle")
    y: Optional[float] = Field(None, description="Y position for rectangle")
    width: Optional[float] = Field(None, description="Width for rectangle")
    height: Optional[float] = Field(None, description="Height for rectangle")
    # Stay in lane
    # (width is shared with rectangle)
    # Max velocity
    v_max: Optional[float] = Field(None, description="Max linear velocity (m/s)")
    # Max omega
    omega_max: Optional[float] = Field(None, description="Max angular velocity (rad/s)")


class ConstraintRequest(BaseModel):
    id: str = Field(..., description="Unique constraint ID")
    type: str = Field(..., description="Constraint type: circle-obstacle, rect-obstacle, stay-in-rect, stay-in-lane, heading-tangent")
    fromWaypoint: int = Field(0, description="Starting waypoint index")
    toWaypoint: int = Field(0, description="Ending waypoint index")
    params: ConstraintParamsRequest = Field(default_factory=ConstraintParamsRequest)
    enabled: bool = Field(True, description="Whether constraint is active")


# Robot parameters
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


# Solve request/response
class SolveRequest(BaseModel):
    waypoints: list[WaypointRequest] = Field(..., min_length=2)
    constraints: list[ConstraintRequest] = Field(default_factory=list, description="Path constraints (obstacles, lanes, etc.)")
    robot_params: Optional[RobotParamsRequest] = None
    samples_per_meter: float = Field(20.0, ge=1.0, le=100.0, description="Target samples per meter (default 20 = 1 per 5cm)")
    min_samples_per_segment: int = Field(3, ge=1, le=50, description="Minimum samples between waypoints")
    control_effort_weight: float = Field(0.0, ge=0.0, le=10.0, description="Weight for control effort penalty (0 = time-optimal)")


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


# Project models
class ProjectMetadata(BaseModel):
    name: str
    filename: str
    updatedAt: str
    trajectoryCount: int


class ProjectListResponse(BaseModel):
    projects: list[ProjectMetadata]


# ADB models
class AdbPushRequest(BaseModel):
    filename: str


class AdbStatusResponse(BaseModel):
    connected: bool
    device: Optional[str] = None
