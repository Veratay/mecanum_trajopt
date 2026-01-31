"""
Time-optimal trajectory optimizer for mecanum robots using CasADi + Fatrop.

Formulation:
- Free-time optimal control problem (minimize total time)
- Direct multiple shooting with RK4 integration
- Waypoint constraints (position, heading, optional velocity=0)
- Motor duty cycle bounds
- Traction force limits
"""

from dataclasses import dataclass
from typing import Optional
import casadi as ca
import numpy as np

from .dynamics import RobotParams, create_dynamics_function, create_rk4_integrator, create_wheel_forces_function


@dataclass
class Waypoint:
    """A waypoint that the robot must pass through."""
    x: float
    y: float
    heading: float  # radians
    stop: bool = True  # if True, robot must have zero velocity at this waypoint
    v_max: float = 3.0  # max linear velocity for segment starting at this waypoint (m/s)
    omega_max: float = 10.0  # max angular velocity for segment starting at this waypoint (rad/s)
    type: str = "constrained"  # "constrained", "unconstrained", "intake"
    intake_x: float = 0.0  # Intake point X (for type="intake")
    intake_y: float = 0.0  # Intake point Y (for type="intake")
    intake_distance: float = 0.5  # Distance from intake point (for type="intake")
    intake_velocity_max: float = 1.0  # Max approach velocity at intake (m/s)
    intake_velocity_slack: float = 0.1  # Slack angle for velocity direction constraint (radians)


@dataclass
class SolverResult:
    """Result from the trajectory optimizer."""
    success: bool
    total_time: float
    times: list[float]  # cumulative times at each knot
    states: list[list[float]]  # states at each knot [vx, vy, omega, px, py, theta]
    controls: list[list[float]]  # controls at each interval [drive, strafe, turn]
    iterations: int
    solve_time_ms: float


class TrajectoryOptimizer:
    """Time-optimal trajectory optimizer for mecanum robots."""

    def __init__(self, params: RobotParams, n_per_segment: int = 20):
        """
        Initialize the optimizer.

        Args:
            params: Robot physical parameters
            n_per_segment: Number of collocation points per waypoint segment
        """
        self.params = params
        self.n_per_segment = n_per_segment

        # Create dynamics functions
        self.f_dynamics = create_dynamics_function(params)
        self.f_rk4 = create_rk4_integrator(self.f_dynamics, ca.MX.sym('dt'))
        self.f_wheel_forces = create_wheel_forces_function(params)

        # Solver options
        self.dt_min = 0.01  # minimum segment time (s)
        self.dt_max = 1.0   # maximum segment time (s)

    def solve(self, waypoints: list[Waypoint]) -> SolverResult:
        """
        Solve for the time-optimal trajectory through the given waypoints.

        Args:
            waypoints: List of waypoints (at least 2)

        Returns:
            SolverResult with trajectory data
        """
        if len(waypoints) < 2:
            raise ValueError("Need at least 2 waypoints")

        n_segments = len(waypoints) - 1
        N = n_segments * self.n_per_segment  # total intervals
        K = N + 1  # total knot points

        # Create optimization problem
        opti = ca.Opti()

        # Decision variables
        # States at each knot point: [vx, vy, omega, px, py, theta]
        X = opti.variable(6, K)

        # Controls at each interval: [drive, strafe, turn]
        U = opti.variable(3, N)

        # Segment times (free-time formulation)
        # One dt per segment (shared by all intervals in that segment)
        DT_seg = opti.variable(n_segments)

        # Objective: minimize total time
        # Total time = sum of (dt_per_interval * n_intervals_per_segment) for each segment
        opti.minimize(ca.sum1(DT_seg) * self.n_per_segment)

        # Constraints

        # 1. Dynamics constraints (RK4 integration)
        for k in range(N):
            seg_idx = k // self.n_per_segment  # which segment this interval belongs to
            x_next = self.f_rk4(X[:, k], U[:, k], DT_seg[seg_idx])
            opti.subject_to(X[:, k+1] == x_next)

        # 2. Waypoint constraints
        # First, unwrap waypoint headings to be continuous (avoids "long way around" issue)
        # This ensures the optimizer doesn't try to turn 350° instead of 10°
        unwrapped_headings = []
        prev_heading = waypoints[0].heading
        for wp in waypoints:
            heading = wp.heading
            # Unwrap: adjust heading to be within π of previous heading
            while heading - prev_heading > np.pi:
                heading -= 2 * np.pi
            while heading - prev_heading < -np.pi:
                heading += 2 * np.pi
            unwrapped_headings.append(heading)
            prev_heading = heading

        for i, wp in enumerate(waypoints):
            # Knot index for this waypoint
            if i == 0:
                k_wp = 0
            elif i == len(waypoints) - 1:
                k_wp = K - 1
            else:
                k_wp = i * self.n_per_segment

            # Constraints depend on waypoint type
            if wp.type == "constrained":
                # Position + heading constraints
                opti.subject_to(X[3, k_wp] == wp.x)  # px
                opti.subject_to(X[4, k_wp] == wp.y)  # py
                opti.subject_to(X[5, k_wp] == unwrapped_headings[i])  # theta (unwrapped)

            elif wp.type == "unconstrained":
                # Position constraints only, heading is free
                opti.subject_to(X[3, k_wp] == wp.x)  # px
                opti.subject_to(X[4, k_wp] == wp.y)  # py

            elif wp.type == "intake":
                # Circular constraint: robot must be at intake_distance from intake point
                px = X[3, k_wp]
                py = X[4, k_wp]
                theta = X[5, k_wp]
                vx = X[0, k_wp]
                vy = X[1, k_wp]
                omega = X[2, k_wp]

                # Distance constraint: (px - intake_x)^2 + (py - intake_y)^2 == intake_distance^2
                opti.subject_to(
                    (px - wp.intake_x)**2 + (py - wp.intake_y)**2 == wp.intake_distance**2
                )

                # Heading faces intake point using sin/cos form (avoids atan2 discontinuity):
                # sin(theta) * (intake_x - px) == cos(theta) * (intake_y - py)
                opti.subject_to(
                    ca.sin(theta) * (wp.intake_x - px) == ca.cos(theta) * (wp.intake_y - py)
                )

                # Plus facing-toward constraint: cos(theta)*(intake_x-px) + sin(theta)*(intake_y-py) >= 0
                opti.subject_to(
                    ca.cos(theta) * (wp.intake_x - px) + ca.sin(theta) * (wp.intake_y - py) >= 0
                )

                # Intake velocity constraints:
                # 1. Angular velocity must be zero
                opti.subject_to(omega == 0)

                # 2. Velocity magnitude constraint
                opti.subject_to(vx**2 + vy**2 <= wp.intake_velocity_max**2)

                # 3. Velocity direction must face toward intake point (with slack)
                # The velocity should be roughly in the heading direction (which faces intake)
                # Cross product of velocity and heading gives sin of angle between them
                # |vx*sin(theta) - vy*cos(theta)| <= |v| * sin(slack)
                # Squared form: (vx*sin(theta) - vy*cos(theta))^2 <= (vx^2 + vy^2) * sin^2(slack)
                sin_slack_sq = np.sin(wp.intake_velocity_slack)**2
                cross_product = vx * ca.sin(theta) - vy * ca.cos(theta)
                v_sq = vx**2 + vy**2
                opti.subject_to(cross_product**2 <= v_sq * sin_slack_sq)

                # 4. Velocity must be forward (toward intake), not backward
                # Dot product of velocity and heading must be non-negative
                opti.subject_to(vx * ca.cos(theta) + vy * ca.sin(theta) >= 0)

            # Velocity constraints if stop waypoint
            if wp.stop:
                opti.subject_to(X[0, k_wp] == 0)  # vx
                opti.subject_to(X[1, k_wp] == 0)  # vy
                opti.subject_to(X[2, k_wp] == 0)  # omega

        # 3. Motor duty cycle bounds (-1 to 1)
        # duties = [drive - strafe - turn, drive + strafe - turn,
        #           drive - strafe + turn, drive + strafe + turn]
        for k in range(N):
            drive, strafe, turn = U[0, k], U[1, k], U[2, k]
            duty_fl = drive - strafe - turn
            duty_bl = drive + strafe - turn
            duty_br = drive - strafe + turn
            duty_fr = drive + strafe + turn

            opti.subject_to(opti.bounded(-1, duty_fl, 1))
            opti.subject_to(opti.bounded(-1, duty_bl, 1))
            opti.subject_to(opti.bounded(-1, duty_br, 1))
            opti.subject_to(opti.bounded(-1, duty_fr, 1))

        # 4. Traction force limits
        f_max = self.params.f_traction_max
        for k in range(N):
            forces = self.f_wheel_forces(X[:, k], U[:, k])
            for i in range(4):
                opti.subject_to(opti.bounded(-f_max, forces[i], f_max))

        # 5. Segment time bounds (per-segment dt)
        for s in range(n_segments):
            opti.subject_to(opti.bounded(self.dt_min, DT_seg[s], self.dt_max))

        # 6. Velocity bounds (per-segment limits)
        for k in range(K):
            # Determine which segment this knot belongs to
            seg_idx = min(k // self.n_per_segment, n_segments - 1)
            v_max = waypoints[seg_idx].v_max
            omega_max = waypoints[seg_idx].omega_max

            opti.subject_to(opti.bounded(-v_max, X[0, k], v_max))  # vx
            opti.subject_to(opti.bounded(-v_max, X[1, k], v_max))  # vy
            opti.subject_to(opti.bounded(-omega_max, X[2, k], omega_max))  # omega

        # Initial guess (pass unwrapped headings for consistency with constraints)
        self._set_initial_guess(opti, X, U, DT_seg, waypoints, unwrapped_headings, K, N, n_segments)

        # Configure solver - use IPOPT (reliable, always available)
        opti.solver('ipopt', {
            'ipopt.print_level': 0,
            'ipopt.sb': 'yes',  # suppress banner
            'print_time': False,
            'ipopt.max_iter': 1000,
            'ipopt.tol': 1e-6,
            'ipopt.acceptable_tol': 1e-4,
            'ipopt.linear_solver': 'mumps',
            'expand': True
        })

        # Solve
        import time
        start_time = time.time()

        try:
            sol = opti.solve()
            success = True
        except Exception as e:
            print(f"Solver failed: {e}")
            sol = opti.debug
            success = False

        solve_time_ms = (time.time() - start_time) * 1000

        # Extract solution
        X_opt = sol.value(X)
        U_opt = sol.value(U)
        DT_seg_opt = sol.value(DT_seg)

        # Compute cumulative times
        # Each segment has n_per_segment intervals, all with the same dt
        times = [0.0]
        for k in range(N):
            seg_idx = k // self.n_per_segment
            dt = float(DT_seg_opt[seg_idx]) if hasattr(DT_seg_opt, '__len__') else float(DT_seg_opt)
            times.append(times[-1] + dt)

        total_time = times[-1]

        # Format states and controls as lists
        states = []
        for k in range(K):
            states.append([float(X_opt[i, k]) for i in range(6)])

        controls = []
        for k in range(N):
            controls.append([float(U_opt[i, k]) for i in range(3)])

        # Get solver stats
        try:
            stats = sol.stats()
            iterations = stats.get('iter_count', 0)
        except Exception:
            iterations = 0

        return SolverResult(
            success=success,
            total_time=float(total_time),
            times=[float(t) for t in times],
            states=states,
            controls=controls,
            iterations=iterations,
            solve_time_ms=solve_time_ms
        )

    def _set_initial_guess(self, opti: ca.Opti, X: ca.MX, U: ca.MX, DT_seg: ca.MX,
                          waypoints: list[Waypoint], unwrapped_headings: list[float],
                          K: int, N: int, n_segments: int):
        """Set initial guess using linear interpolation between waypoints."""
        # Compute effective waypoint positions (for intake waypoints, compute position on circle)
        effective_positions = []
        for i, wp in enumerate(waypoints):
            if wp.type == "intake":
                # For intake waypoint, place robot behind intake point relative to travel direction
                # Use previous waypoint to determine approach direction
                if i > 0:
                    prev_wp = waypoints[i - 1]
                    prev_x = effective_positions[i - 1][0]
                    prev_y = effective_positions[i - 1][1]
                    # Direction from prev to intake point
                    dx = wp.intake_x - prev_x
                    dy = wp.intake_y - prev_y
                    dist = np.sqrt(dx * dx + dy * dy)
                    if dist > 1e-6:
                        # Robot positioned behind intake point (away from approach)
                        eff_x = wp.intake_x - (dx / dist) * wp.intake_distance
                        eff_y = wp.intake_y - (dy / dist) * wp.intake_distance
                    else:
                        # Fallback: place robot to the left of intake point
                        eff_x = wp.intake_x - wp.intake_distance
                        eff_y = wp.intake_y
                else:
                    # First waypoint is intake - use default position
                    eff_x = wp.intake_x - wp.intake_distance
                    eff_y = wp.intake_y
                # Heading faces intake point
                eff_theta = np.arctan2(wp.intake_y - eff_y, wp.intake_x - eff_x)
                effective_positions.append((eff_x, eff_y, eff_theta))
            else:
                # Use unwrapped heading for constrained/unconstrained waypoints
                effective_positions.append((wp.x, wp.y, unwrapped_headings[i]))

        # Estimate total time based on distances per segment
        segment_dists = []
        for i in range(len(waypoints) - 1):
            x1, y1, _ = effective_positions[i]
            x2, y2, _ = effective_positions[i + 1]
            dx = x2 - x1
            dy = y2 - y1
            segment_dists.append(np.sqrt(dx*dx + dy*dy))

        avg_speed = 1.0  # m/s conservative estimate
        total_time_guess = max(sum(segment_dists) / avg_speed, 1.0)

        # Set time guesses per segment (dt is per interval, not per segment)
        for s in range(n_segments):
            seg_dist = segment_dists[s] if segment_dists else 1.0
            seg_time = max(seg_dist / avg_speed, 0.1)
            dt_guess = seg_time / self.n_per_segment  # dt per interval in this segment
            opti.set_initial(DT_seg[s], dt_guess)

        # Linear interpolation for states
        for k in range(K):
            # Find which segment this knot belongs to
            progress = k / (K - 1) if K > 1 else 0
            seg_idx = int(progress * (len(waypoints) - 1))
            seg_idx = min(seg_idx, len(waypoints) - 2)

            # Local progress within segment
            seg_start = seg_idx / (len(waypoints) - 1) if len(waypoints) > 1 else 0
            seg_end = (seg_idx + 1) / (len(waypoints) - 1) if len(waypoints) > 1 else 1
            local_progress = (progress - seg_start) / (seg_end - seg_start) if seg_end > seg_start else 0

            x1, y1, theta1 = effective_positions[seg_idx]
            x2, y2, theta2 = effective_positions[seg_idx + 1]

            # Interpolate position
            px = x1 + local_progress * (x2 - x1)
            py = y1 + local_progress * (y2 - y1)

            # Interpolate heading (handle wrapping)
            dtheta = theta2 - theta1
            if dtheta > np.pi:
                dtheta -= 2 * np.pi
            elif dtheta < -np.pi:
                dtheta += 2 * np.pi
            theta = theta1 + local_progress * dtheta

            # Estimate velocities from position differences
            if k < K - 1:
                seg_dist = segment_dists[seg_idx] if seg_idx < len(segment_dists) else 1.0
                seg_time = max(seg_dist / avg_speed, 0.1)
                vx = (x2 - x1) / seg_time
                vy = (y2 - y1) / seg_time
            else:
                vx, vy = 0, 0

            # Set initial guess
            opti.set_initial(X[0, k], vx)  # vx
            opti.set_initial(X[1, k], vy)  # vy
            opti.set_initial(X[2, k], 0)   # omega
            opti.set_initial(X[3, k], px)  # px
            opti.set_initial(X[4, k], py)  # py
            opti.set_initial(X[5, k], theta)  # theta

        # Zero initial guess for controls
        for k in range(N):
            opti.set_initial(U[:, k], ca.DM.zeros(3))

    def _compute_constraint_counts(self, waypoints: list[Waypoint], K: int, N: int) -> list[int]:
        """
        Compute the number of path constraints at each knot for Fatrop structure.
        This is needed for manual structure detection.
        """
        ng = []

        for k in range(K):
            count = 0

            # Velocity bounds: 3 constraints (vx, vy, omega) - box constraints
            # These are handled by Fatrop internally, may not count

            # Check if this is a waypoint knot
            is_waypoint = False
            wp_idx = -1
            for i, wp in enumerate(waypoints):
                if i == 0 and k == 0:
                    is_waypoint = True
                    wp_idx = i
                elif i == len(waypoints) - 1 and k == K - 1:
                    is_waypoint = True
                    wp_idx = i
                elif i > 0 and i < len(waypoints) - 1 and k == i * self.n_per_segment:
                    is_waypoint = True
                    wp_idx = i

            if is_waypoint:
                # Position + heading: 3 equality constraints
                count += 3
                # Velocity if stop: 3 equality constraints
                if waypoints[wp_idx].stop:
                    count += 3

            # Motor duty bounds: 4 box constraints per control (at k < N)
            # Traction force bounds: 4 inequality constraints per control
            if k < N:
                count += 8  # 4 duty bounds + 4 force bounds

            ng.append(count)

        return ng


def test_optimizer():
    """Simple test of the optimizer."""
    params = RobotParams()
    optimizer = TrajectoryOptimizer(params, n_per_segment=10)

    waypoints = [
        Waypoint(x=0.0, y=0.0, heading=0.0, stop=True),
        Waypoint(x=1.0, y=0.5, heading=np.pi/4, stop=False),
        Waypoint(x=2.0, y=1.0, heading=0.0, stop=True),
    ]

    result = optimizer.solve(waypoints)
    print(f"Success: {result.success}")
    print(f"Total time: {result.total_time:.3f} s")
    print(f"Solve time: {result.solve_time_ms:.1f} ms")
    print(f"Iterations: {result.iterations}")

    return result


if __name__ == "__main__":
    test_optimizer()
