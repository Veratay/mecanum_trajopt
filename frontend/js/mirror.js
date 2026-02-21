/**
 * Path mirroring utilities - mirrors trajectories across the Y-axis (x=0).
 *
 * For a field centered at the origin, reflecting across x=0 means:
 *   x  -> -x
 *   y  ->  y
 *   heading -> pi - heading
 *   vx -> -vx,  vy -> vy,  omega -> -omega
 *   drive -> drive,  strafe -> -strafe,  turn -> -turn
 */

/**
 * Mirror a single waypoint object across x=0.
 */
export function mirrorWaypoint(wp) {
    const m = { ...wp };
    m.x = -wp.x;
    m.heading = Math.PI - wp.heading;

    if (wp.type === 'intake') {
        m.intake_x = -wp.intake_x;
    }

    // Drop expression fields – the mirrored file uses concrete values only
    const expFields = [
        'x_exp', 'y_exp', 'heading_exp', 'v_max_exp', 'omega_max_exp',
        'intake_x_exp', 'intake_y_exp', 'intake_distance_exp',
        'intake_velocity_max_exp', 'intake_velocity_slack_exp'
    ];
    expFields.forEach(f => delete m[f]);

    return m;
}

/**
 * Mirror a single constraint object across x=0.
 */
export function mirrorConstraint(con) {
    const m = { ...con, params: { ...con.params } };

    // Drop expression fields
    delete m.params_exp;

    switch (con.type) {
        case 'circle-obstacle':
            m.params.cx = -con.params.cx;
            break;
        case 'stay-in-rect':
            // Rectangle defined by bottom-left (x, y) + width/height.
            // Mirroring moves the bottom-left corner.
            m.params.x = -(con.params.x + con.params.width);
            break;
        // stay-in-lane, heading-tangent, max-velocity, max-omega
        // depend on waypoint indices (already mirrored) or scalar limits – no change needed.
    }

    return m;
}

/**
 * Mirror solved trajectory data (states + controls) across x=0.
 *
 * State vector: [vx, vy, omega, px, py, theta]
 * Control vector: [drive, strafe, turn]
 */
export function mirrorTrajectoryResult(trajectory) {
    if (!trajectory) return null;

    return {
        ...trajectory,
        states: trajectory.states.map(s => [
            -s[0],              // vx  -> -vx
             s[1],              // vy  ->  vy
            -s[2],              // omega -> -omega
            -s[3],              // px  -> -px
             s[4],              // py  ->  py
             Math.PI - s[5]     // theta -> pi - theta
        ]),
        controls: trajectory.controls.map(c => [
             c[0],              // drive   ->  drive
            -c[1],              // strafe  -> -strafe
            -c[2]               // turn    -> -turn
        ])
    };
}

/**
 * Mirror an entire serialized project across x=0.
 *
 * Takes the output of serializeProject() and returns a deep-cloned,
 * fully mirrored version suitable for saving as a standalone project file.
 */
export function mirrorProjectData(projectData) {
    const mirrored = JSON.parse(JSON.stringify(projectData)); // deep clone

    mirrored.trajectories = mirrored.trajectories.map(traj => {
        // Mirror waypoints
        traj.waypoints = traj.waypoints.map(wp => mirrorWaypoint(wp));

        // Mirror constraints
        traj.constraints = (traj.constraints || []).map(con => mirrorConstraint(con));

        // Mirror solved trajectory
        if (traj.trajectory) {
            traj.trajectory = mirrorTrajectoryResult(traj.trajectory);
        }

        return traj;
    });

    return mirrored;
}
