/**
 * Waypoint management - CRUD operations and list UI
 */

import { WAYPOINT_RADIUS, HEADING_LINE_LENGTH, HEADING_HANDLE_RADIUS } from './constants.js';
import { state, getActiveTrajectory, getTrajectoryById } from './state.js';
import { fieldToCanvas } from './canvas.js';
import { syncAllFollowers } from './trajectories.js';

// UI update callbacks (set during init)
let updateTrajectoryListFn = null;
let updateWaypointListFn = null;
let updatePlaybackControlsFn = null;
let renderFn = null;
let markUnsavedFn = null;
let getDefaultIntakeDistanceFn = null;
let getDefaultIntakeVelocityFn = null;

// DOM elements
let waypointListEl = null;
let waypointCountEl = null;

export function initWaypoints(callbacks, elements) {
    updateTrajectoryListFn = callbacks.updateTrajectoryList;
    updateWaypointListFn = callbacks.updateWaypointList;
    updatePlaybackControlsFn = callbacks.updatePlaybackControls;
    renderFn = callbacks.render;
    markUnsavedFn = callbacks.markUnsaved;
    getDefaultIntakeDistanceFn = callbacks.getDefaultIntakeDistance;
    getDefaultIntakeVelocityFn = callbacks.getDefaultIntakeVelocity;

    waypointListEl = elements.waypointListEl;
    waypointCountEl = elements.waypointCountEl;
}

// Hit testing functions
export function findWaypointAt(canvasX, canvasY) {
    const traj = getActiveTrajectory();
    if (!traj) return null;

    for (let i = traj.waypoints.length - 1; i >= 0; i--) {
        const wp = traj.waypoints[i];
        if (wp.type === 'intake') continue;

        const pos = fieldToCanvas(wp.x, wp.y);
        const dx = canvasX - pos.x;
        const dy = canvasY - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= WAYPOINT_RADIUS + 5) {
            return i;
        }
    }
    return null;
}

export function findHeadingHandleAt(canvasX, canvasY) {
    const traj = getActiveTrajectory();
    if (!traj) return null;

    for (let i = traj.waypoints.length - 1; i >= 0; i--) {
        const wp = traj.waypoints[i];
        if (wp.type !== 'constrained') continue;

        const pos = fieldToCanvas(wp.x, wp.y);
        const handleX = pos.x + Math.cos(-wp.heading) * HEADING_LINE_LENGTH;
        const handleY = pos.y + Math.sin(-wp.heading) * HEADING_LINE_LENGTH;

        const dx = canvasX - handleX;
        const dy = canvasY - handleY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= HEADING_HANDLE_RADIUS + 5) {
            return i;
        }
    }
    return null;
}

export function findIntakePointAt(canvasX, canvasY) {
    const traj = getActiveTrajectory();
    if (!traj) return null;

    for (let i = traj.waypoints.length - 1; i >= 0; i--) {
        const wp = traj.waypoints[i];
        if (wp.type !== 'intake') continue;

        const intakePos = fieldToCanvas(wp.intake_x, wp.intake_y);
        const dx = canvasX - intakePos.x;
        const dy = canvasY - intakePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= 12) {
            return i;
        }
    }
    return null;
}

// Waypoint CRUD operations
export function addWaypoint(x, y, heading, type) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    // Update previous last waypoint's stop flag
    if (traj.waypoints.length > 1) {
        traj.waypoints[traj.waypoints.length - 1].stop = false;
    }

    const defaultIntakeDistance = getDefaultIntakeDistanceFn();
    const defaultIntakeVelocity = getDefaultIntakeVelocityFn();

    traj.waypoints.push({
        x, y, heading,
        stop: true,
        v_max: 3.0,
        omega_max: 10.0,
        type: type,
        intake_x: x + defaultIntakeDistance,
        intake_y: y,
        intake_distance: defaultIntakeDistance,
        intake_velocity_max: defaultIntakeVelocity,
        intake_velocity_slack: 0.1
    });

    // Clear solved trajectory since waypoints changed
    traj.trajectory = null;
    markUnsavedFn();
    updateTrajectoryListFn();

    const newIndex = traj.waypoints.length - 1;
    selectWaypoint(newIndex);
    updateWaypointListFn();
    renderFn();
}

export function addIntakeWaypoint(intakeX, intakeY) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    // For intake waypoints, the click position is the intake point
    // The robot position will be computed by the solver
    const defaultIntakeDistance = getDefaultIntakeDistanceFn();
    const defaultIntakeVelocity = getDefaultIntakeVelocityFn();

    // Update previous last waypoint's stop flag
    if (traj.waypoints.length > 1) {
        traj.waypoints[traj.waypoints.length - 1].stop = false;
    }

    traj.waypoints.push({
        x: intakeX, // Placeholder, will be computed
        y: intakeY,
        heading: 0,
        stop: true,
        v_max: 3.0,
        omega_max: 10.0,
        type: 'intake',
        intake_x: intakeX,
        intake_y: intakeY,
        intake_distance: defaultIntakeDistance,
        intake_velocity_max: defaultIntakeVelocity,
        intake_velocity_slack: 0.1
    });

    // Clear solved trajectory since waypoints changed
    traj.trajectory = null;
    markUnsavedFn();
    updateTrajectoryListFn();

    const newIndex = traj.waypoints.length - 1;
    selectWaypoint(newIndex);
    updateWaypointListFn();
    renderFn();
}

export function deleteWaypoint(index) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.waypoints.splice(index, 1);

    // Ensure first and last have stop=true
    if (traj.waypoints.length > 0) {
        traj.waypoints[0].stop = true;
        traj.waypoints[traj.waypoints.length - 1].stop = true;
    }

    // If we deleted the first waypoint and this trajectory follows another, unlink it
    if (index === 0 && traj.followsTrajectoryId) {
        traj.followsTrajectoryId = null;
    }

    // Clear solved trajectory since waypoints changed
    traj.trajectory = null;
    markUnsavedFn();
    updateTrajectoryListFn();

    // Update selection
    if (state.selectedWaypointIndex === index) {
        deselectWaypoint();
    } else if (state.selectedWaypointIndex > index) {
        state.selectedWaypointIndex--;
    }

    updateWaypointListFn();
    renderFn();
}

export function selectWaypoint(index) {
    const previousIndex = state.selectedWaypointIndex;
    state.selectedWaypointIndex = index;

    // Auto-collapse previously selected if it wasn't manually expanded
    if (previousIndex !== null && previousIndex !== index && !state.manuallyExpandedWaypoints.has(previousIndex)) {
        state.expandedWaypointIndex = null;
    }

    // Auto-expand newly selected
    state.expandedWaypointIndex = index;

    updateWaypointListFn();

    // Scroll to waypoint in list
    const waypointEl = document.querySelector(`.waypoint-item[data-index="${index}"]`);
    if (waypointEl) {
        waypointEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

export function deselectWaypoint() {
    const previousIndex = state.selectedWaypointIndex;
    state.selectedWaypointIndex = null;

    // Collapse if not manually expanded
    if (previousIndex !== null && !state.manuallyExpandedWaypoints.has(previousIndex)) {
        state.expandedWaypointIndex = null;
    }

    updateWaypointListFn();
}

export function toggleWaypointExpanded(index) {
    if (state.expandedWaypointIndex === index) {
        state.expandedWaypointIndex = null;
        state.manuallyExpandedWaypoints.delete(index);
    } else {
        state.expandedWaypointIndex = index;
        state.manuallyExpandedWaypoints.add(index);
    }
    updateWaypointListFn();
}

export function updateWaypointField(index, field, value) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    if (field === 'type') {
        const oldType = traj.waypoints[index].type;
        traj.waypoints[index].type = value;

        // If first waypoint type changes from constrained, unlink followers
        if (index === 0 && oldType === 'constrained' && value !== 'constrained') {
            traj.followsTrajectoryId = null;
        }

        // If last waypoint type changes from constrained, unlink any trajectories following this one
        if (index === traj.waypoints.length - 1 && oldType === 'constrained' && value !== 'constrained') {
            state.trajectories.forEach(t => {
                if (t.followsTrajectoryId === traj.id) {
                    t.followsTrajectoryId = null;
                }
            });
        }

        traj.trajectory = null;
        updateTrajectoryListFn();
        updateWaypointListFn();
        renderFn();
        return;
    }

    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;

    const wp = traj.waypoints[index];

    // Don't allow editing position/heading of chained first waypoint
    if (index === 0 && traj.followsTrajectoryId) {
        if (field === 'x' || field === 'y' || field === 'heading') {
            return;
        }
    }

    switch (field) {
        case 'x': wp.x = numValue; break;
        case 'y': wp.y = numValue; break;
        case 'heading': wp.heading = numValue * Math.PI / 180; break;
        case 'v_max': wp.v_max = Math.max(0.1, numValue); break;
        case 'omega_max': wp.omega_max = Math.max(0.1, numValue); break;
        case 'intake_x': wp.intake_x = numValue; break;
        case 'intake_y': wp.intake_y = numValue; break;
        case 'intake_distance': wp.intake_distance = Math.max(0.1, numValue); break;
        case 'intake_velocity_max': wp.intake_velocity_max = Math.max(0.1, numValue); break;
        case 'intake_velocity_slack': wp.intake_velocity_slack = Math.max(0, Math.min(90, numValue)) * Math.PI / 180; break;
    }

    traj.trajectory = null;
    markUnsavedFn();

    // If we changed the last waypoint's position/heading, sync any followers
    if (index === traj.waypoints.length - 1 && (field === 'x' || field === 'y' || field === 'heading')) {
        syncAllFollowers(traj.id);
    }

    updateTrajectoryListFn();
    renderFn();
}

export function toggleWaypointStop(index) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.waypoints[index].stop = !traj.waypoints[index].stop;
    traj.trajectory = null;
    markUnsavedFn();
    updateTrajectoryListFn();
    updateWaypointListFn();
    renderFn();
}

export function clearWaypoints() {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.waypoints = [];
    traj.trajectory = null;

    // Unlink any trajectories that follow this one
    state.trajectories.forEach(t => {
        if (t.followsTrajectoryId === traj.id) {
            t.followsTrajectoryId = null;
        }
    });

    // Unlink this trajectory from any it follows
    traj.followsTrajectoryId = null;

    state.selectedWaypointIndex = null;
    state.expandedWaypointIndex = null;
    state.manuallyExpandedWaypoints.clear();
    markUnsavedFn();
    updateTrajectoryListFn();
    updateWaypointListFn();
    updatePlaybackControlsFn();
    renderFn();
}

// Waypoint list UI rendering
export function updateWaypointList() {
    const traj = getActiveTrajectory();
    const waypoints = traj ? traj.waypoints : [];

    waypointCountEl.textContent = waypoints.length;

    if (waypoints.length === 0) {
        waypointListEl.innerHTML = `
            <div class="waypoint-empty">
                <svg class="waypoint-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v8M8 12h8"/>
                </svg>
                <div class="waypoint-empty-text">
                    Select a waypoint tool and<br>click on the field to add waypoints
                </div>
            </div>
        `;
        return;
    }

    const isChained = traj && traj.followsTrajectoryId;
    const defaultIntakeDist = getDefaultIntakeDistanceFn();
    const defaultIntakeVel = getDefaultIntakeVelocityFn();

    waypointListEl.innerHTML = waypoints.map((wp, i) => {
        const isSelected = state.selectedWaypointIndex === i;
        const isExpanded = state.expandedWaypointIndex === i;
        const isLast = i === waypoints.length - 1;
        const isLockedFirst = i === 0 && isChained;

        // Ensure defaults
        if (wp.type === undefined) wp.type = 'constrained';
        if (wp.v_max === undefined) wp.v_max = 3.0;
        if (wp.omega_max === undefined) wp.omega_max = 10.0;
        if (wp.intake_x === undefined) wp.intake_x = wp.x + defaultIntakeDist;
        if (wp.intake_y === undefined) wp.intake_y = wp.y;
        if (wp.intake_distance === undefined) wp.intake_distance = defaultIntakeDist;
        if (wp.intake_velocity_max === undefined) wp.intake_velocity_max = defaultIntakeVel;
        if (wp.intake_velocity_slack === undefined) wp.intake_velocity_slack = 0.1;

        const headingDeg = (wp.heading * 180 / Math.PI).toFixed(1);
        const slackDeg = (wp.intake_velocity_slack * 180 / Math.PI).toFixed(1);

        const typeLabels = {
            constrained: 'Constrained',
            unconstrained: 'Unconstrained',
            intake: 'Intake'
        };

        const coords = wp.type === 'intake'
            ? `${wp.intake_x.toFixed(2)}, ${wp.intake_y.toFixed(2)}`
            : `${wp.x.toFixed(2)}, ${wp.y.toFixed(2)}`;

        return `
            <div class="waypoint-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''} ${isLockedFirst ? 'locked' : ''}" data-index="${i}">
                <div class="waypoint-header-row" data-index="${i}">
                    <span class="waypoint-index ${wp.type}">${i + 1}</span>
                    <span class="waypoint-type-label">${typeLabels[wp.type]}</span>
                    ${isLockedFirst ? '<span class="waypoint-locked-badge">Linked</span>' : ''}
                    ${wp.stop ? '<span class="waypoint-stop-badge">Stop</span>' : ''}
                    <span class="waypoint-coords">${coords}</span>
                    <svg class="waypoint-expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
                <div class="waypoint-body">
                    <div class="waypoint-body-inner">
                        ${isLockedFirst ? `
                            <div class="wp-locked-notice">
                                Position and heading locked to followed trajectory's end point.
                            </div>
                        ` : `
                            <div class="wp-type-selector">
                                <button class="wp-type-btn ${wp.type === 'constrained' ? 'active' : ''}" data-index="${i}" data-type="constrained">Constrained</button>
                                <button class="wp-type-btn ${wp.type === 'unconstrained' ? 'active' : ''}" data-index="${i}" data-type="unconstrained">Unconstrained</button>
                                <button class="wp-type-btn ${wp.type === 'intake' ? 'active' : ''}" data-index="${i}" data-type="intake">Intake</button>
                            </div>
                        `}

                        ${wp.type !== 'intake' ? `
                            <div class="wp-input-grid ${wp.type === 'constrained' ? 'triple' : ''}">
                                <div class="wp-input-group">
                                    <label>X (m)</label>
                                    <input type="number" step="0.01" value="${wp.x.toFixed(2)}" data-index="${i}" data-field="x" ${isLockedFirst ? 'disabled' : ''}>
                                </div>
                                <div class="wp-input-group">
                                    <label>Y (m)</label>
                                    <input type="number" step="0.01" value="${wp.y.toFixed(2)}" data-index="${i}" data-field="y" ${isLockedFirst ? 'disabled' : ''}>
                                </div>
                                ${wp.type === 'constrained' ? `
                                    <div class="wp-input-group">
                                        <label>Heading (°)</label>
                                        <input type="number" step="1" value="${headingDeg}" data-index="${i}" data-field="heading" ${isLockedFirst ? 'disabled' : ''}>
                                    </div>
                                ` : ''}
                            </div>
                        ` : `
                            <div class="wp-section-label">Intake Point</div>
                            <div class="wp-input-grid triple">
                                <div class="wp-input-group">
                                    <label>X (m)</label>
                                    <input type="number" step="0.01" value="${wp.intake_x.toFixed(2)}" data-index="${i}" data-field="intake_x">
                                </div>
                                <div class="wp-input-group">
                                    <label>Y (m)</label>
                                    <input type="number" step="0.01" value="${wp.intake_y.toFixed(2)}" data-index="${i}" data-field="intake_y">
                                </div>
                                <div class="wp-input-group">
                                    <label>Distance (m)</label>
                                    <input type="number" step="0.05" min="0.1" value="${wp.intake_distance.toFixed(2)}" data-index="${i}" data-field="intake_distance">
                                </div>
                            </div>
                            <div class="wp-section-label">Velocity Constraints</div>
                            <div class="wp-input-grid">
                                <div class="wp-input-group">
                                    <label>Max V (m/s)</label>
                                    <input type="number" step="0.1" min="0.1" value="${wp.intake_velocity_max.toFixed(1)}" data-index="${i}" data-field="intake_velocity_max">
                                </div>
                                <div class="wp-input-group">
                                    <label>Slack (°)</label>
                                    <input type="number" step="1" min="0" max="90" value="${slackDeg}" data-index="${i}" data-field="intake_velocity_slack">
                                </div>
                            </div>
                        `}

                        ${!isLast ? `
                            <div class="wp-section-label">Segment ${i + 1} → ${i + 2}</div>
                            <div class="wp-input-grid">
                                <div class="wp-input-group">
                                    <label>V max (m/s)</label>
                                    <input type="number" step="0.1" min="0.1" value="${wp.v_max.toFixed(1)}" data-index="${i}" data-field="v_max">
                                </div>
                                <div class="wp-input-group">
                                    <label>ω max (rad/s)</label>
                                    <input type="number" step="0.5" min="0.1" value="${wp.omega_max.toFixed(1)}" data-index="${i}" data-field="omega_max">
                                </div>
                            </div>
                        ` : ''}

                        <div class="wp-controls-row">
                            <label class="wp-stop-toggle">
                                <input type="checkbox" ${wp.stop ? 'checked' : ''} data-index="${i}" data-toggle="stop">
                                <span>Stop at waypoint</span>
                            </label>
                            <button class="wp-delete-btn" data-index="${i}" title="Delete waypoint">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    waypointListEl.querySelectorAll('.waypoint-header-row').forEach(row => {
        row.addEventListener('click', (e) => {
            const index = parseInt(e.currentTarget.dataset.index);
            if (state.selectedWaypointIndex === index && state.expandedWaypointIndex === index) {
                toggleWaypointExpanded(index);
            } else {
                selectWaypoint(index);
            }
        });
    });

    waypointListEl.querySelectorAll('.wp-type-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            updateWaypointField(parseInt(btn.dataset.index), 'type', btn.dataset.type);
        });
    });

    waypointListEl.querySelectorAll('.wp-input-group input').forEach(input => {
        input.addEventListener('change', (e) => {
            e.stopPropagation();
            updateWaypointField(parseInt(input.dataset.index), input.dataset.field, input.value);
        });
        input.addEventListener('click', e => e.stopPropagation());
    });

    waypointListEl.querySelectorAll('input[data-toggle="stop"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            toggleWaypointStop(parseInt(checkbox.dataset.index));
        });
        checkbox.addEventListener('click', e => e.stopPropagation());
    });

    waypointListEl.querySelectorAll('.wp-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteWaypoint(parseInt(btn.dataset.index));
        });
    });
}
