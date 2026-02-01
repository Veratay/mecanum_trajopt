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
class PathConstraint:
    """A path constraint that applies over a range of waypoints."""
    type: str  # "circle-obstacle", "stay-in-rect", "stay-in-lane", "heading-tangent", "max-velocity", "max-omega"
    from_waypoint: int = 0
    to_waypoint: int = 0
    params: dict = None  # type-specific parameters

    def __post_init__(self):
        if self.params is None:
            self.params = {}


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

    def __init__(self, params: RobotParams, samples_per_meter: float = 20.0, min_samples_per_segment: int = 3):
        """
        Initialize the optimizer.

        Args:
            params: Robot physical parameters
            samples_per_meter: Target number of samples per meter of distance (default 20 = 1 per 5cm)
            min_samples_per_segment: Minimum number of samples between two waypoints (default 3)
        """
        self.params = params
        self.samples_per_meter = samples_per_meter
        self.min_samples_per_segment = min_samples_per_segment

        # Create dynamics functions
        self.f_dynamics = create_dynamics_function(params)
        self.f_rk4 = create_rk4_integrator(self.f_dynamics, ca.MX.sym('dt'))
        self.f_wheel_forces = create_wheel_forces_function(params)

        # Solver options
        self.dt_min = 0.01  # minimum segment time (s)
        self.dt_max = 1.0   # maximum segment time (s)

    def _compute_effective_positions(self, waypoints: list[Waypoint]) -> list[tuple[float, float, float]]:
        """Compute effective positions for waypoints (handles intake waypoints specially)."""
        effective_positions = []
        for i, wp in enumerate(waypoints):
            if wp.type == "intake":
                # For intake waypoint, place robot behind intake point relative to travel direction
                if i > 0:
                    prev_x = effective_positions[i - 1][0]
                    prev_y = effective_positions[i - 1][1]
                    dx = wp.intake_x - prev_x
                    dy = wp.intake_y - prev_y
                    dist = np.sqrt(dx * dx + dy * dy)
                    if dist > 1e-6:
                        eff_x = wp.intake_x - (dx / dist) * wp.intake_distance
                        eff_y = wp.intake_y - (dy / dist) * wp.intake_distance
                    else:
                        eff_x = wp.intake_x - wp.intake_distance
                        eff_y = wp.intake_y
                else:
                    eff_x = wp.intake_x - wp.intake_distance
                    eff_y = wp.intake_y
                eff_theta = np.arctan2(wp.intake_y - eff_y, wp.intake_x - eff_x)
                effective_positions.append((eff_x, eff_y, eff_theta))
            else:
                effective_positions.append((wp.x, wp.y, wp.heading))
        return effective_positions

    def _compute_samples_per_segment(self, waypoints: list[Waypoint]) -> list[int]:
        """Compute number of samples for each segment based on distance."""
        effective_positions = self._compute_effective_positions(waypoints)
        samples_per_segment = []
        for i in range(len(waypoints) - 1):
            x1, y1, _ = effective_positions[i]
            x2, y2, _ = effective_positions[i + 1]
            dist = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
            n_samples = max(self.min_samples_per_segment, int(np.ceil(dist * self.samples_per_meter)))
            samples_per_segment.append(n_samples)
        return samples_per_segment

    def solve(self, waypoints: list[Waypoint], constraints: list[PathConstraint] = None) -> SolverResult:
        """
        Solve for the time-optimal trajectory through the given waypoints.

        Args:
            waypoints: List of waypoints (at least 2)
            constraints: List of path constraints (optional)

        Returns:
            SolverResult with trajectory data
        """
        if len(waypoints) < 2:
            raise ValueError("Need at least 2 waypoints")

        if constraints is None:
            constraints = []

        n_segments = len(waypoints) - 1
        samples_per_segment = self._compute_samples_per_segment(waypoints)
        N = sum(samples_per_segment)  # total intervals
        K = N + 1  # total knot points

        # Compute cumulative indices for segment boundaries
        segment_start_indices = [0]
        for n in samples_per_segment:
            segment_start_indices.append(segment_start_indices[-1] + n)

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
        total_time_expr = 0
        for s in range(n_segments):
            total_time_expr += DT_seg[s] * samples_per_segment[s]
        opti.minimize(total_time_expr)

        # Constraints

        # Helper to find segment index for a given interval/knot
        def get_segment_index(k):
            for s in range(n_segments):
                if k < segment_start_indices[s + 1]:
                    return s
            return n_segments - 1

        # 1. Dynamics constraints (RK4 integration)
        for k in range(N):
            seg_idx = get_segment_index(k)
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
                k_wp = segment_start_indices[i]

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

        # # 6. Velocity bounds (per-segment limits)
        # for k in range(K):
        #     # Determine which segment this knot belongs to
        #     seg_idx = get_segment_index(k) if k < N else n_segments - 1
        #     v_max = waypoints[seg_idx].v_max
        #     omega_max = waypoints[seg_idx].omega_max
        #
        #     opti.subject_to(opti.bounded(-v_max, X[0, k], v_max))  # vx
        #     opti.subject_to(opti.bounded(-v_max, X[1, k], v_max))  # vy
        #     opti.subject_to(opti.bounded(-omega_max, X[2, k], omega_max))  # omega

        # 7. Path constraints
        self._add_path_constraints(opti, X, K, N, waypoints, constraints, segment_start_indices, get_segment_index)

        # Initial guess (pass unwrapped headings for consistency with constraints)
        self._set_initial_guess(opti, X, U, DT_seg, waypoints, unwrapped_headings, K, N, n_segments, samples_per_segment, segment_start_indices)

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
        # Each segment has variable intervals, all with the same dt within a segment
        times = [0.0]
        for k in range(N):
            seg_idx = get_segment_index(k)
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

    def _add_path_constraints(self, opti: ca.Opti, X: ca.MX, K: int, N: int,
                              waypoints: list[Waypoint], constraints: list[PathConstraint],
                              segment_start_indices: list[int], get_segment_index):
        """Add path constraints to the optimization problem."""
        n_waypoints = len(waypoints)

        for con in constraints:
            # Validate waypoint range
            from_wp = max(0, min(con.from_waypoint, n_waypoints - 1))
            to_wp = max(0, min(con.to_waypoint, n_waypoints - 1))

            # Get knot index range for this constraint
            if from_wp == 0:
                start_k = 0
            else:
                start_k = segment_start_indices[from_wp]

            if to_wp >= n_waypoints - 1:
                end_k = K - 1
            else:
                end_k = segment_start_indices[to_wp + 1] - 1

            # Apply constraint based on type
            if con.type == 'circle-obstacle':
                self._add_circle_obstacle(opti, X, start_k, end_k, con.params)
            elif con.type == 'stay-in-rect':
                self._add_stay_in_rect(opti, X, start_k, end_k, con.params)
            elif con.type == 'stay-in-lane':
                self._add_stay_in_lane(opti, X, waypoints, from_wp, to_wp, start_k, end_k, con.params)
            elif con.type == 'heading-tangent':
                self._add_heading_tangent(opti, X, start_k, end_k, K)
            elif con.type == 'max-velocity':
                self._add_max_velocity(opti, X, start_k, end_k, con.params)
            elif con.type == 'max-omega':
                self._add_max_omega(opti, X, start_k, end_k, con.params)

    def _add_circle_obstacle(self, opti: ca.Opti, X: ca.MX, start_k: int, end_k: int, params: dict):
        """Add circular obstacle avoidance constraint."""
        cx = params.get('cx', 0)
        cy = params.get('cy', 0)
        radius = params.get('radius', 0.3)

        for k in range(start_k, end_k + 1):
            px = X[3, k]
            py = X[4, k]
            # Robot must stay outside circle: (px-cx)^2 + (py-cy)^2 >= radius^2
            opti.subject_to((px - cx)**2 + (py - cy)**2 >= radius**2)

    def _add_stay_in_rect(self, opti: ca.Opti, X: ca.MX, start_k: int, end_k: int, params: dict):
        """Add stay-in-rectangle constraint."""
        x = params.get('x', 0)
        y = params.get('y', 0)
        width = params.get('width', 3.66)
        height = params.get('height', 3.66)

        for k in range(start_k, end_k + 1):
            px = X[3, k]
            py = X[4, k]
            opti.subject_to(opti.bounded(x, px, x + width))
            opti.subject_to(opti.bounded(y, py, y + height))

    def _add_stay_in_lane(self, opti: ca.Opti, X: ca.MX, waypoints: list[Waypoint],
                          from_wp: int, to_wp: int, start_k: int, end_k: int, params: dict):
        """Add stay-in-lane constraint between two adjacent waypoints."""
        lane_width = params.get('width', 0.5)
        half_width = lane_width / 2

        if to_wp <= from_wp or from_wp >= len(waypoints) - 1:
            return

        # Get waypoint positions
        wp1 = waypoints[from_wp]
        wp2 = waypoints[min(to_wp, len(waypoints) - 1)]

        # Lane direction and perpendicular
        dx = wp2.x - wp1.x
        dy = wp2.y - wp1.y
        length = np.sqrt(dx**2 + dy**2)

        if length < 1e-6:
            return

        # Unit vectors
        ux = dx / length
        uy = dy / length
        # Perpendicular (90 degrees counterclockwise)
        px_dir = -uy
        py_dir = ux

        for k in range(start_k, end_k + 1):
            rx = X[3, k]
            ry = X[4, k]
            # Distance from robot to lane centerline (perpendicular projection)
            # Vector from wp1 to robot
            vrx = rx - wp1.x
            vry = ry - wp1.y
            # Perpendicular distance (signed)
            perp_dist = vrx * px_dir + vry * py_dir
            opti.subject_to(opti.bounded(-half_width, perp_dist, half_width))

    def _add_heading_tangent(self, opti: ca.Opti, X: ca.MX, start_k: int, end_k: int, K: int):
        """Add heading-follows-tangent constraint."""
        for k in range(start_k, end_k + 1):
            vx = X[0, k]
            vy = X[1, k]
            theta = X[5, k]

            # Heading should match velocity direction
            # sin(theta) * vx = cos(theta) * vy  =>  vx * sin(theta) - vy * cos(theta) = 0
            # But only when moving (velocity > threshold)
            v_sq = vx**2 + vy**2
            cross = vx * ca.sin(theta) - vy * ca.cos(theta)
            # Normalized constraint: cross^2 <= small * v_sq (allowing some slack when nearly stopped)
            # This is a soft constraint using slack
            opti.subject_to(cross**2 <= 0.01 * v_sq + 1e-6)

    def _add_max_velocity(self, opti: ca.Opti, X: ca.MX, start_k: int, end_k: int, params: dict):
        """Add maximum velocity constraint over a range of knots."""
        v_max = params.get('v_max', 1.5)

        for k in range(start_k, end_k + 1):
            vx = X[0, k]
            vy = X[1, k]
            opti.subject_to(vx**2 + vy**2 <= v_max**2)

    def _add_max_omega(self, opti: ca.Opti, X: ca.MX, start_k: int, end_k: int, params: dict):
        """Add maximum angular velocity constraint over a range of knots."""
        omega_max = params.get('omega_max', 5.0)

        for k in range(start_k, end_k + 1):
            omega = X[2, k]
            opti.subject_to(opti.bounded(-omega_max, omega, omega_max))

    def _set_initial_guess(self, opti: ca.Opti, X: ca.MX, U: ca.MX, DT_seg: ca.MX,
                          waypoints: list[Waypoint], unwrapped_headings: list[float],
                          K: int, N: int, n_segments: int,
                          samples_per_segment: list[int], segment_start_indices: list[int]):
        """Set initial guess using linear interpolation between waypoints."""
        # Compute effective waypoint positions (for intake waypoints, compute position on circle)
        effective_positions = []
        for i, wp in enumerate(waypoints):
            if wp.type == "intake":
                # For intake waypoint, place robot behind intake point relative to travel direction
                # Use previous waypoint to determine approach direction
                if i > 0:
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
            dt_guess = seg_time / samples_per_segment[s]  # dt per interval in this segment
            opti.set_initial(DT_seg[s], dt_guess)

        # Helper to find segment index for a given knot
        def get_segment_index(k):
            for s in range(n_segments):
                if k < segment_start_indices[s + 1]:
                    return s
            return n_segments - 1

        # Linear interpolation for states
        for k in range(K):
            # Find which segment this knot belongs to
            seg_idx = get_segment_index(k) if k < N else n_segments - 1

            # Local progress within segment
            seg_start_k = segment_start_indices[seg_idx]
            seg_end_k = segment_start_indices[seg_idx + 1]
            local_progress = (k - seg_start_k) / (seg_end_k - seg_start_k) if seg_end_k > seg_start_k else 0

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

    def _compute_constraint_counts(self, waypoints: list[Waypoint], K: int, N: int, segment_start_indices: list[int]) -> list[int]:
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
                elif i > 0 and i < len(waypoints) - 1 and k == segment_start_indices[i]:
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
    optimizer = TrajectoryOptimizer(params, samples_per_meter=20.0, min_samples_per_segment=3)

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
