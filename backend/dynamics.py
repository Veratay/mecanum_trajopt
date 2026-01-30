"""
Mecanum drive dynamics model for trajectory optimization.

State vector (6 DOF):
    x = [vx, vy, omega, px, py, theta]
    - vx, vy: field-frame velocities (m/s)
    - omega: angular velocity (rad/s)
    - px, py: position (m)
    - theta: heading angle (rad)

Control inputs (3 DOF -> 4 motors):
    u = [drive, strafe, turn]
    - drive: forward/backward command (-1 to 1)
    - strafe: left/right command (-1 to 1)
    - turn: rotation command (-1 to 1)
"""

from dataclasses import dataclass
import casadi as ca
import numpy as np


@dataclass
class RobotParams:
    """Physical parameters for the mecanum robot."""
    mass: float = 15.0           # kg
    inertia: float = 0.5         # kg*m^2 (moment of inertia about z-axis)
    wheel_radius: float = 0.05   # m (mecanum wheel radius)
    lx: float = 0.15             # m (half wheelbase in x direction)
    ly: float = 0.15             # m (half wheelbase in y direction)
    w_max: float = 100.0         # rad/s (motor max free speed)
    t_max: float = 1.0           # N*m (motor max stall torque)
    f_traction_max: float = 20.0 # N (max traction force per wheel before slip)


def create_dynamics_function(params: RobotParams) -> ca.Function:
    """
    Create a CasADi function for the mecanum robot continuous dynamics.

    Returns:
        f_dynamics: CasADi Function (state, control) -> state_dot
    """
    # State variables
    vx = ca.MX.sym('vx')      # field-frame velocity x
    vy = ca.MX.sym('vy')      # field-frame velocity y
    omega = ca.MX.sym('omega') # angular velocity
    px = ca.MX.sym('px')      # position x
    py = ca.MX.sym('py')      # position y
    theta = ca.MX.sym('theta') # heading

    state = ca.vertcat(vx, vy, omega, px, py, theta)

    # Control inputs (normalized -1 to 1)
    drive = ca.MX.sym('drive')   # forward/backward
    strafe = ca.MX.sym('strafe') # left/right
    turn = ca.MX.sym('turn')     # rotation

    control = ca.vertcat(drive, strafe, turn)

    # Robot parameters
    m = params.mass
    I = params.inertia
    r = params.wheel_radius
    lx = params.lx
    ly = params.ly
    w_max = params.w_max
    t_max = params.t_max

    # Convert field-frame velocities to robot-frame
    # Robot frame: x forward, y left
    vx_robot = vx * ca.cos(theta) + vy * ca.sin(theta)
    vy_robot = -vx * ca.sin(theta) + vy * ca.cos(theta)

    # Mecanum wheel kinematics (standard X-configuration)
    # Wheel arrangement: FL, BL, BR, FR
    # Each wheel has rollers at 45 degrees
    # wheel_velocity = (vx_robot ± vy_robot ± (lx+ly)*omega) / r

    # Wheel velocities (rad/s)
    # FL: forward-left, roller axis pointing forward-right
    # BR: back-right, roller axis pointing back-left
    # etc.
    w_fl = (vx_robot - vy_robot - (lx + ly) * omega) / r
    w_bl = (vx_robot + vy_robot - (lx + ly) * omega) / r
    w_br = (vx_robot - vy_robot + (lx + ly) * omega) / r
    w_fr = (vx_robot + vy_robot + (lx + ly) * omega) / r

    # Motor duty cycles from control inputs
    # Map drive/strafe/turn to individual wheel duties
    # FL = drive - strafe - turn
    # BL = drive + strafe - turn
    # BR = drive - strafe + turn
    # FR = drive + strafe + turn
    duty_fl = drive - strafe - turn
    duty_bl = drive + strafe - turn
    duty_br = drive - strafe + turn
    duty_fr = drive + strafe + turn

    # Motor torque model: torque = t_max * (duty_cycle - wheel_velocity / w_max)
    # This models the motor's speed-torque curve
    torque_fl = t_max * (duty_fl - w_fl / w_max)
    torque_bl = t_max * (duty_bl - w_bl / w_max)
    torque_br = t_max * (duty_br - w_br / w_max)
    torque_fr = t_max * (duty_fr - w_fr / w_max)

    # Wheel forces (at ground contact)
    f_fl = torque_fl / r
    f_bl = torque_bl / r
    f_br = torque_br / r
    f_fr = torque_fr / r

    # Net forces/torques in robot frame from mecanum geometry
    # Each wheel contributes based on roller angle (45 degrees)
    # Force contributions (robot frame):
    fx_robot = (f_fl + f_bl + f_br + f_fr) / 4  # simplified - actual depends on roller angle
    fy_robot = (-f_fl + f_bl - f_br + f_fr) / 4
    tau = (-f_fl - f_bl + f_br + f_fr) * (lx + ly) / 4

    # More accurate mecanum force model:
    # Each wheel produces force at 45 deg to wheel axis
    # For X-configuration mecanum:
    fx_robot = (f_fl + f_bl + f_br + f_fr)
    fy_robot = (-f_fl + f_bl - f_br + f_fr)
    tau = (lx + ly) * (-f_fl - f_bl + f_br + f_fr)

    # Accelerations in robot frame
    ax_robot = fx_robot / m
    ay_robot = fy_robot / m
    alpha = tau / I

    # Convert accelerations back to field frame
    ax_field = ax_robot * ca.cos(theta) - ay_robot * ca.sin(theta)
    ay_field = ax_robot * ca.sin(theta) + ay_robot * ca.cos(theta)

    # State derivatives
    vx_dot = ax_field
    vy_dot = ay_field
    omega_dot = alpha
    px_dot = vx
    py_dot = vy
    theta_dot = omega

    state_dot = ca.vertcat(vx_dot, vy_dot, omega_dot, px_dot, py_dot, theta_dot)

    return ca.Function('f_dynamics', [state, control], [state_dot])


def create_motor_duties_function(params: RobotParams) -> ca.Function:
    """
    Create a function to compute motor duty cycles from control inputs.
    Used for constraint checking.

    Returns:
        f_duties: CasADi Function (control) -> [duty_fl, duty_bl, duty_br, duty_fr]
    """
    drive = ca.MX.sym('drive')
    strafe = ca.MX.sym('strafe')
    turn = ca.MX.sym('turn')
    control = ca.vertcat(drive, strafe, turn)

    duty_fl = drive - strafe - turn
    duty_bl = drive + strafe - turn
    duty_br = drive - strafe + turn
    duty_fr = drive + strafe + turn

    duties = ca.vertcat(duty_fl, duty_bl, duty_br, duty_fr)

    return ca.Function('f_duties', [control], [duties])


def create_wheel_forces_function(params: RobotParams) -> ca.Function:
    """
    Create a function to compute wheel forces for traction constraint checking.

    Returns:
        f_wheel_forces: CasADi Function (state, control) -> [f_fl, f_bl, f_br, f_fr]
    """
    # State variables
    vx = ca.MX.sym('vx')
    vy = ca.MX.sym('vy')
    omega = ca.MX.sym('omega')
    px = ca.MX.sym('px')
    py = ca.MX.sym('py')
    theta = ca.MX.sym('theta')
    state = ca.vertcat(vx, vy, omega, px, py, theta)

    # Control inputs
    drive = ca.MX.sym('drive')
    strafe = ca.MX.sym('strafe')
    turn = ca.MX.sym('turn')
    control = ca.vertcat(drive, strafe, turn)

    # Robot parameters
    r = params.wheel_radius
    lx = params.lx
    ly = params.ly
    w_max = params.w_max
    t_max = params.t_max

    # Convert to robot frame
    vx_robot = vx * ca.cos(theta) + vy * ca.sin(theta)
    vy_robot = -vx * ca.sin(theta) + vy * ca.cos(theta)

    # Wheel velocities
    w_fl = (vx_robot - vy_robot - (lx + ly) * omega) / r
    w_bl = (vx_robot + vy_robot - (lx + ly) * omega) / r
    w_br = (vx_robot - vy_robot + (lx + ly) * omega) / r
    w_fr = (vx_robot + vy_robot + (lx + ly) * omega) / r

    # Motor duties
    duty_fl = drive - strafe - turn
    duty_bl = drive + strafe - turn
    duty_br = drive - strafe + turn
    duty_fr = drive + strafe + turn

    # Torques and forces
    torque_fl = t_max * (duty_fl - w_fl / w_max)
    torque_bl = t_max * (duty_bl - w_bl / w_max)
    torque_br = t_max * (duty_br - w_br / w_max)
    torque_fr = t_max * (duty_fr - w_fr / w_max)

    f_fl = torque_fl / r
    f_bl = torque_bl / r
    f_br = torque_br / r
    f_fr = torque_fr / r

    forces = ca.vertcat(f_fl, f_bl, f_br, f_fr)

    return ca.Function('f_wheel_forces', [state, control], [forces])


def create_rk4_integrator(f_dynamics: ca.Function, dt: ca.MX) -> ca.Function:
    """
    Create an RK4 integrator for the dynamics with variable time step.

    Args:
        f_dynamics: Continuous dynamics function
        dt: Time step (can be symbolic for free-time formulation)

    Returns:
        f_integrator: CasADi Function (state, control, dt) -> next_state
    """
    state = ca.MX.sym('state', 6)
    control = ca.MX.sym('control', 3)
    h = ca.MX.sym('dt')

    k1 = f_dynamics(state, control)
    k2 = f_dynamics(state + h/2 * k1, control)
    k3 = f_dynamics(state + h/2 * k2, control)
    k4 = f_dynamics(state + h * k3, control)

    next_state = state + h/6 * (k1 + 2*k2 + 2*k3 + k4)

    return ca.Function('f_rk4', [state, control, h], [next_state])
