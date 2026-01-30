# Mecanum Trajectory Optimizer

Interactive web-based trajectory optimizer for mecanum drive robots using CasADi + Fatrop. Place waypoints on a 2D canvas, and the backend solves for time-optimal trajectories in real-time.

## Features

- **Time-optimal trajectory planning**: Minimizes total trajectory time while respecting robot dynamics
- **Interactive waypoint placement**: Click to add, drag to move, scroll to rotate heading
- **Configurable waypoint behavior**: Stop vs pass-through at each waypoint
- **Real-time trajectory visualization**: See the computed path, velocity vectors, and robot poses
- **Animated playback**: Watch the robot follow the trajectory
- **Customizable robot parameters**: Adjust mass, inertia, motor characteristics, and traction limits

## Installation

1. Create a virtual environment:
```bash
cd mecanum_trajopt
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# or: .venv\Scripts\activate  # Windows
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

Note: CasADi includes Fatrop as a built-in solver option. If Fatrop is not available, the optimizer will automatically fall back to IPOPT.

## Usage

1. Start the server:
```bash
python -m uvicorn backend.server:app --reload --host 0.0.0.0 --port 8000
```

2. Open your browser to [http://localhost:8000](http://localhost:8000)

3. Interact with the canvas:
   - **Click** anywhere to add a waypoint
   - **Drag** a waypoint to move it
   - **Scroll** over a waypoint to rotate its heading
   - **Check/uncheck "Stop"** in the waypoint list to toggle stop vs pass-through behavior

4. Click **Solve Trajectory** to compute the time-optimal path

5. Use the playback controls to animate the trajectory

## API

### POST /solve

Solve for the time-optimal trajectory through waypoints.

**Request:**
```json
{
  "waypoints": [
    {"x": 0, "y": 0, "heading": 0, "stop": true},
    {"x": 1.5, "y": 0.5, "heading": 1.57, "stop": false},
    {"x": 2.0, "y": 2.0, "heading": 3.14, "stop": true}
  ],
  "robot_params": {
    "mass": 15.0,
    "inertia": 0.5,
    "wheel_radius": 0.05,
    "lx": 0.15,
    "ly": 0.15,
    "w_max": 100.0,
    "t_max": 1.0,
    "f_traction_max": 20.0
  }
}
```

**Response:**
```json
{
  "success": true,
  "total_time": 2.34,
  "trajectory": {
    "times": [0.0, 0.1, 0.2, ...],
    "states": [[vx, vy, omega, px, py, theta], ...],
    "controls": [[drive, strafe, turn], ...]
  },
  "solver_stats": {
    "iterations": 45,
    "solve_time_ms": 120
  }
}
```

## Technical Details

### Dynamics Model

The mecanum robot is modeled with a 6-DOF state:
- `vx, vy`: Field-frame linear velocities (m/s)
- `omega`: Angular velocity (rad/s)
- `px, py`: Position (m)
- `theta`: Heading angle (rad)

Control inputs are 3-DOF commands (drive, strafe, turn) which map to 4 motor duty cycles.

### Optimization Formulation

- **Objective**: Minimize total trajectory time (free-time formulation)
- **Integration**: 4th-order Runge-Kutta
- **Solver**: CasADi with Fatrop interior-point solver (falls back to IPOPT)

Constraints:
- Dynamics via direct multiple shooting
- Waypoint position and heading
- Optional zero velocity at "stop" waypoints
- Motor duty cycle bounds (-1 to 1)
- Wheel traction force limits

## Project Structure

```
mecanum_trajopt/
├── backend/
│   ├── __init__.py
│   ├── dynamics.py      # Mecanum robot dynamics model
│   ├── optimizer.py     # CasADi/Fatrop trajectory optimizer
│   └── server.py        # FastAPI server
├── frontend/
│   ├── index.html       # Main page
│   ├── style.css        # Styling
│   └── app.js           # Canvas interaction & visualization
├── requirements.txt     # Python dependencies
└── README.md
```
