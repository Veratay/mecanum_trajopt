/**
 * Constraint management - CRUD operations and list UI
 */

import { CONSTRAINT_TYPES } from './constants.js';
import { state, getActiveTrajectory, generateId } from './state.js';
import { getScale, fieldToCanvas } from './canvas.js';

// UI update callbacks (set during init)
let updateTrajectoryListFn = null;
let updateConstraintListFn = null;
let updateWaypointListFn = null;
let renderFn = null;
let markUnsavedFn = null;
let showStatusFn = null;

// DOM elements
let constraintListEl = null;
let constraintCountEl = null;

export function initConstraints(callbacks, elements) {
    updateTrajectoryListFn = callbacks.updateTrajectoryList;
    updateConstraintListFn = callbacks.updateConstraintList;
    updateWaypointListFn = callbacks.updateWaypointList;
    renderFn = callbacks.render;
    markUnsavedFn = callbacks.markUnsaved;
    showStatusFn = callbacks.showStatus;

    constraintListEl = elements.constraintListEl;
    constraintCountEl = elements.constraintCountEl;
}

export function isConstraintTool(tool) {
    return tool in CONSTRAINT_TYPES;
}

export function findCircleObstacleAt(canvasX, canvasY) {
    const traj = getActiveTrajectory();
    if (!traj || !traj.constraints) return null;

    const scale = getScale();

    for (let i = traj.constraints.length - 1; i >= 0; i--) {
        const con = traj.constraints[i];
        if (con.type !== 'circle-obstacle' || !con.enabled) continue;

        const center = fieldToCanvas(con.params.cx, con.params.cy);
        const radiusPx = con.params.radius * scale;
        const dx = canvasX - center.x;
        const dy = canvasY - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check if inside the circle (for dragging center)
        if (dist <= radiusPx - 8) {
            return { index: i, part: 'center' };
        }
    }
    return null;
}

export function findCircleObstacleEdgeAt(canvasX, canvasY) {
    const traj = getActiveTrajectory();
    if (!traj || !traj.constraints) return null;

    const scale = getScale();

    for (let i = traj.constraints.length - 1; i >= 0; i--) {
        const con = traj.constraints[i];
        if (con.type !== 'circle-obstacle' || !con.enabled) continue;

        const center = fieldToCanvas(con.params.cx, con.params.cy);
        const radiusPx = con.params.radius * scale;
        const dx = canvasX - center.x;
        const dy = canvasY - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check if on the edge (for resizing)
        if (dist >= radiusPx - 8 && dist <= radiusPx + 8) {
            return { index: i, part: 'edge' };
        }
    }
    return null;
}

export function handleConstraintToolClick(x, y) {
    const traj = getActiveTrajectory();
    if (!traj || traj.waypoints.length < 2) {
        // Need at least 2 waypoints for constraints
        showStatusFn('Need at least 2 waypoints to add constraints', 'error');
        return;
    }

    switch (state.currentTool) {
        case 'circle-obstacle':
            addConstraint('circle-obstacle', { cx: x, cy: y, radius: 0.3 });
            break;

        case 'stay-in-rect':
            // Default to full field size (centered at 0,0)
            const halfField = state.fieldSize / 2;
            addConstraint('stay-in-rect', { x: -halfField, y: -halfField, width: state.fieldSize, height: state.fieldSize });
            break;

        case 'stay-in-lane':
            addConstraint('stay-in-lane', { width: 0.5 });
            break;

        case 'heading-tangent':
            addConstraint('heading-tangent', {});
            break;

        case 'max-velocity':
            addConstraint('max-velocity', { v_max: 1.5 });
            break;

        case 'max-omega':
            addConstraint('max-omega', { omega_max: 5.0 });
            break;
    }
}

export function addConstraint(type, params = {}) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    const typeDef = CONSTRAINT_TYPES[type];
    if (!typeDef) return;

    // Build default params
    const defaultParams = {};
    for (const [key, def] of Object.entries(typeDef.params)) {
        defaultParams[key] = params[key] !== undefined ? params[key] : def.default;
    }

    const constraint = {
        id: generateId(),
        type: type,
        fromWaypoint: 0,  // First waypoint by default
        toWaypoint: Math.max(0, traj.waypoints.length - 1),  // Last waypoint by default
        params: defaultParams,
        enabled: true
    };

    // For stay-in-lane, only allow adjacent waypoints
    if (typeDef.adjacentOnly) {
        constraint.toWaypoint = Math.min(constraint.fromWaypoint + 1, traj.waypoints.length - 1);
    }

    traj.constraints.push(constraint);
    traj.trajectory = null;
    markUnsavedFn();

    const newIndex = traj.constraints.length - 1;
    selectConstraint(newIndex);
    updateTrajectoryListFn();
    updateConstraintListFn();
    renderFn();
}

export function deleteConstraint(index) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.constraints.splice(index, 1);
    traj.trajectory = null;
    markUnsavedFn();

    if (state.selectedConstraintIndex === index) {
        deselectConstraint();
    } else if (state.selectedConstraintIndex > index) {
        state.selectedConstraintIndex--;
    }

    updateTrajectoryListFn();
    updateConstraintListFn();
    renderFn();
}

export function selectConstraint(index) {
    state.selectedConstraintIndex = index;
    state.expandedConstraintIndex = index;
    state.selectedWaypointIndex = null;  // Deselect waypoint
    updateWaypointListFn();
    updateConstraintListFn();
}

export function deselectConstraint() {
    state.selectedConstraintIndex = null;
    state.expandedConstraintIndex = null;
    updateConstraintListFn();
}

export function toggleConstraintExpanded(index) {
    if (state.expandedConstraintIndex === index) {
        state.expandedConstraintIndex = null;
    } else {
        state.expandedConstraintIndex = index;
    }
    updateConstraintListFn();
}

export function updateConstraintField(index, field, value) {
    const traj = getActiveTrajectory();
    if (!traj || !traj.constraints[index]) return;

    const constraint = traj.constraints[index];
    const typeDef = CONSTRAINT_TYPES[constraint.type];

    if (field === 'fromWaypoint') {
        constraint.fromWaypoint = parseInt(value);
        // For stay-in-lane, toWaypoint must be fromWaypoint + 1
        if (typeDef && typeDef.adjacentOnly) {
            constraint.toWaypoint = Math.min(constraint.fromWaypoint + 1, traj.waypoints.length - 1);
        }
    } else if (field === 'toWaypoint') {
        constraint.toWaypoint = parseInt(value);
    } else if (field === 'enabled') {
        constraint.enabled = value;
    } else {
        // It's a param field
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
            constraint.params[field] = numValue;
        }
    }

    traj.trajectory = null;
    markUnsavedFn();
    updateConstraintListFn();
    renderFn();
}

export function clearConstraints() {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.constraints = [];
    traj.trajectory = null;
    state.selectedConstraintIndex = null;
    state.expandedConstraintIndex = null;
    markUnsavedFn();
    updateTrajectoryListFn();
    updateConstraintListFn();
    renderFn();
}

export function getConstraintIconSvg(type) {
    switch (type) {
        case 'circle-obstacle':
            return '<circle cx="12" cy="12" r="7"/><path d="M7 7l10 10"/>';
        case 'stay-in-rect':
            return '<rect x="5" y="7" width="14" height="10" rx="1" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>';
        case 'stay-in-lane':
            return '<path d="M8 5v14M16 5v14" stroke-dasharray="3 2"/><path d="M12 8v8" stroke-width="2.5"/>';
        case 'heading-tangent':
            return '<path d="M6 12h12M14 8l4 4-4 4"/><circle cx="6" cy="12" r="2.5"/>';
        case 'max-velocity':
            return '<path d="M13 4L5 12h7l-1 6 8-10h-7l1-4z"/>';
        case 'max-omega':
            return '<path d="M19 12a7 7 0 11-7-7"/><path d="M12 12l3-3M15 6v3h3"/>';
        default:
            return '';
    }
}

// Constraint list UI rendering
export function updateConstraintList() {
    const traj = getActiveTrajectory();
    const constraints = traj ? traj.constraints : [];
    const waypoints = traj ? traj.waypoints : [];

    constraintCountEl.textContent = constraints.length;

    if (constraints.length === 0) {
        constraintListEl.innerHTML = `
            <div class="constraint-empty">
                <svg class="constraint-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 2"/>
                    <path d="M9 9l6 6M15 9l-6 6"/>
                </svg>
                <div class="constraint-empty-text">
                    Select a constraint tool and<br>click on the field to add constraints
                </div>
            </div>
        `;
        return;
    }

    constraintListEl.innerHTML = constraints.map((con, i) => {
        const isSelected = state.selectedConstraintIndex === i;
        const isExpanded = state.expandedConstraintIndex === i;
        const typeDef = CONSTRAINT_TYPES[con.type];

        // Build waypoint options
        const waypointOptions = waypoints.map((wp, wi) =>
            `<option value="${wi}" ${con.fromWaypoint === wi ? 'selected' : ''}>${wi + 1}</option>`
        ).join('');

        const toWaypointOptions = waypoints.map((wp, wi) => {
            const disabled = typeDef && typeDef.adjacentOnly && wi !== con.fromWaypoint + 1;
            return `<option value="${wi}" ${con.toWaypoint === wi ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${wi + 1}</option>`;
        }).join('');

        // Build params inputs
        const paramsHtml = Object.entries(typeDef.params).map(([key, def]) => `
            <div class="constraint-input-group">
                <label>${def.label} (${def.unit})</label>
                <input type="number" step="0.1" value="${(con.params[key] || def.default).toFixed(2)}"
                       data-index="${i}" data-field="${key}">
            </div>
        `).join('');

        const paramsClass = Object.keys(typeDef.params).length <= 1 ? 'single' :
                           Object.keys(typeDef.params).length === 3 ? 'triple' : '';

        return `
            <div class="constraint-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}" data-index="${i}">
                <div class="constraint-header-row" data-index="${i}">
                    <span class="constraint-icon ${typeDef.icon}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${getConstraintIconSvg(con.type)}
                        </svg>
                    </span>
                    <span class="constraint-type-label">${typeDef.label}</span>
                    <span class="constraint-range">${con.fromWaypoint + 1}→${con.toWaypoint + 1}</span>
                    <svg class="constraint-expand-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
                <div class="constraint-body">
                    <div class="constraint-range-selector">
                        <div class="input-group">
                            <label>From WP</label>
                            <select data-index="${i}" data-field="fromWaypoint">
                                ${waypointOptions}
                            </select>
                        </div>
                        <div class="input-group">
                            <label>To WP</label>
                            <select data-index="${i}" data-field="toWaypoint">
                                ${toWaypointOptions}
                            </select>
                        </div>
                    </div>
                    ${paramsHtml ? `<div class="constraint-params ${paramsClass}">${paramsHtml}</div>` : ''}
                    <div class="constraint-controls-row">
                        <button class="constraint-delete-btn" data-index="${i}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    constraintListEl.querySelectorAll('.constraint-header-row').forEach(row => {
        row.addEventListener('click', () => {
            const index = parseInt(row.dataset.index);
            if (state.selectedConstraintIndex === index && state.expandedConstraintIndex === index) {
                toggleConstraintExpanded(index);
            } else if (state.selectedConstraintIndex === index) {
                toggleConstraintExpanded(index);
            } else {
                selectConstraint(index);
            }
        });
    });

    constraintListEl.querySelectorAll('select').forEach(select => {
        select.addEventListener('change', (e) => {
            e.stopPropagation();
            updateConstraintField(parseInt(select.dataset.index), select.dataset.field, select.value);
        });
        select.addEventListener('click', e => e.stopPropagation());
    });

    constraintListEl.querySelectorAll('input[type="number"]').forEach(input => {
        input.addEventListener('change', (e) => {
            e.stopPropagation();
            updateConstraintField(parseInt(input.dataset.index), input.dataset.field, input.value);
        });
        input.addEventListener('click', e => e.stopPropagation());
    });

    constraintListEl.querySelectorAll('.constraint-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConstraint(parseInt(btn.dataset.index));
        });
    });
}
