"""Backend package for mecanum trajectory optimizer."""

from .dynamics import RobotParams, create_dynamics_function
from .optimizer import TrajectoryOptimizer, Waypoint, SolverResult

__all__ = [
    'RobotParams',
    'create_dynamics_function',
    'TrajectoryOptimizer',
    'Waypoint',
    'SolverResult',
]
