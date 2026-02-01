/**
 * Mouse and keyboard event handlers
 */

import { CONSTRAINT_TYPES } from './constants.js';
import { state, getActiveTrajectory } from './state.js';
import { canvas, canvasToField, fieldToCanvas, zoom } from './canvas.js';
import { syncAllFollowers } from './trajectories.js';
import {
    findWaypointAt, findHeadingHandleAt, findIntakePointAt,
    addWaypoint, addIntakeWaypoint, selectWaypoint, deselectWaypoint,
    deleteWaypoint, updateWaypointList
} from './waypoints.js';
import {
    isConstraintTool, handleConstraintToolClick, deselectConstraint, deleteConstraint,
    selectConstraint, updateConstraintList, findCircleObstacleAt, findCircleObstacleEdgeAt
} from './constraints.js';

// Callbacks (set during init)
let renderFn = null;
let markUnsavedFn = null;
let selectToolFn = null;
let togglePlaybackFn = null;
let showSaveModalFn = null;
let showOpenModalFn = null;

// DOM elements
let mousePosEl = null;
let openModal = null;
let saveModal = null;
let syncModal = null;

export function initEvents(callbacks, elements) {
    renderFn = callbacks.render;
    markUnsavedFn = callbacks.markUnsaved;
    selectToolFn = callbacks.selectTool;
    togglePlaybackFn = callbacks.togglePlayback;
    showSaveModalFn = callbacks.showSaveModal;
    showOpenModalFn = callbacks.showOpenModal;

    mousePosEl = elements.mousePosEl;
    openModal = elements.openModal;
    saveModal = elements.saveModal;
    syncModal = elements.syncModal;
}

export function handleCanvasClick(e) {
    if (state.wasDragging) {
        state.wasDragging = false;
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Check for waypoint/handle clicks first
    const clickedIntake = findIntakePointAt(canvasX, canvasY);
    const clickedHeading = findHeadingHandleAt(canvasX, canvasY);
    const clickedWp = findWaypointAt(canvasX, canvasY);

    if (clickedIntake !== null || clickedHeading !== null || clickedWp !== null) {
        // Select the waypoint
        const wpIndex = clickedIntake ?? clickedHeading ?? clickedWp;
        selectWaypoint(wpIndex);
        return;
    }

    // If in select mode and clicked empty space, deselect
    if (state.currentTool === 'select') {
        deselectWaypoint();
        deselectConstraint();
        return;
    }

    // Add constraint based on current constraint tool
    const fieldPos = canvasToField(canvasX, canvasY);

    if (isConstraintTool(state.currentTool)) {
        handleConstraintToolClick(fieldPos.x, fieldPos.y);
        return;
    }

    // Add waypoint based on current waypoint tool
    if (state.currentTool === 'intake') {
        // For intake, click position is the intake point
        addIntakeWaypoint(fieldPos.x, fieldPos.y);
    } else {
        addWaypoint(fieldPos.x, fieldPos.y, 0, state.currentTool);
    }
}

export function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    state.dragStart = { x: canvasX, y: canvasY };

    // Middle mouse or space+click for panning
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        state.isPanning = true;
        state.panStart = { x: state.view.x, y: state.view.y };
        canvas.style.cursor = 'grabbing';
        return;
    }

    // Check for circle obstacle edge (resize) - check before center
    const obstacleEdge = findCircleObstacleEdgeAt(canvasX, canvasY);
    if (obstacleEdge !== null) {
        state.draggingConstraintIndex = obstacleEdge.index;
        state.isDraggingConstraintEdge = true;
        selectConstraint(obstacleEdge.index);
        canvas.style.cursor = 'ew-resize';
        return;
    }

    // Check for circle obstacle center (move)
    const obstacleCenter = findCircleObstacleAt(canvasX, canvasY);
    if (obstacleCenter !== null) {
        state.draggingConstraintIndex = obstacleCenter.index;
        state.isDraggingConstraint = true;
        selectConstraint(obstacleCenter.index);
        canvas.style.cursor = 'move';
        return;
    }

    // Check for intake point
    const intakeIdx = findIntakePointAt(canvasX, canvasY);
    if (intakeIdx !== null) {
        state.selectedWaypointIndex = intakeIdx;
        state.isDraggingIntakePoint = true;
        selectWaypoint(intakeIdx);
        canvas.style.cursor = 'move';
        return;
    }

    // Check for heading handle
    const headingIdx = findHeadingHandleAt(canvasX, canvasY);
    if (headingIdx !== null) {
        state.selectedWaypointIndex = headingIdx;
        state.isDraggingHeading = true;
        selectWaypoint(headingIdx);
        canvas.style.cursor = 'crosshair';
        return;
    }

    // Check for waypoint body
    const wpIndex = findWaypointAt(canvasX, canvasY);
    if (wpIndex !== null) {
        state.selectedWaypointIndex = wpIndex;
        state.isDragging = true;
        selectWaypoint(wpIndex);
        canvas.style.cursor = 'grabbing';
        return;
    }

    // Start panning if clicking empty space with select tool
    if (state.currentTool === 'select') {
        state.isPanning = true;
        state.panStart = { x: state.view.x, y: state.view.y };
        canvas.style.cursor = 'grabbing';
    }
}

export function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Update mouse position display
    const fieldPos = canvasToField(canvasX, canvasY);
    mousePosEl.textContent = `${fieldPos.x.toFixed(2)}, ${fieldPos.y.toFixed(2)}`;

    // Panning
    if (state.isPanning) {
        const dx = canvasX - state.dragStart.x;
        const dy = canvasY - state.dragStart.y;
        state.view.x = state.panStart.x + dx;
        state.view.y = state.panStart.y + dy;
        renderFn();
        return;
    }

    // Dragging constraint center (move)
    if (state.isDraggingConstraint && state.draggingConstraintIndex !== null) {
        const traj = getActiveTrajectory();
        if (traj && traj.constraints[state.draggingConstraintIndex]) {
            const con = traj.constraints[state.draggingConstraintIndex];
            if (con.type === 'circle-obstacle') {
                con.params.cx = fieldPos.x;
                con.params.cy = fieldPos.y;
                traj.trajectory = null;
                updateConstraintList();
                renderFn();
            }
        }
        return;
    }

    // Dragging constraint edge (resize)
    if (state.isDraggingConstraintEdge && state.draggingConstraintIndex !== null) {
        const traj = getActiveTrajectory();
        if (traj && traj.constraints[state.draggingConstraintIndex]) {
            const con = traj.constraints[state.draggingConstraintIndex];
            if (con.type === 'circle-obstacle') {
                // Calculate distance from center to mouse position
                const dx = fieldPos.x - con.params.cx;
                const dy = fieldPos.y - con.params.cy;
                const newRadius = Math.max(0.05, Math.sqrt(dx * dx + dy * dy));
                con.params.radius = newRadius;
                traj.trajectory = null;
                updateConstraintList();
                renderFn();
            }
        }
        return;
    }

    // Dragging intake point
    if (state.isDraggingIntakePoint && state.selectedWaypointIndex !== null) {
        const traj = getActiveTrajectory();
        if (traj) {
            const wp = traj.waypoints[state.selectedWaypointIndex];
            wp.intake_x = fieldPos.x;
            wp.intake_y = fieldPos.y;
            updateWaypointList();
            renderFn();
        }
        return;
    }

    // Dragging heading
    if (state.isDraggingHeading && state.selectedWaypointIndex !== null) {
        const traj = getActiveTrajectory();
        if (traj) {
            const wp = traj.waypoints[state.selectedWaypointIndex];
            // Don't allow dragging heading of chained first waypoint
            if (state.selectedWaypointIndex === 0 && traj.followsTrajectoryId) {
                return;
            }
            const wpCanvas = fieldToCanvas(wp.x, wp.y);
            const dx = canvasX - wpCanvas.x;
            const dy = canvasY - wpCanvas.y;
            wp.heading = -Math.atan2(dy, dx);

            // Normalize to [-pi, pi]
            while (wp.heading > Math.PI) wp.heading -= 2 * Math.PI;
            while (wp.heading < -Math.PI) wp.heading += 2 * Math.PI;

            // If dragging last waypoint's heading, sync followers
            if (state.selectedWaypointIndex === traj.waypoints.length - 1) {
                traj.trajectory = null;
                syncAllFollowers(traj.id);
            }

            updateWaypointList();
            renderFn();
        }
        return;
    }

    // Dragging waypoint
    if (state.isDragging && state.selectedWaypointIndex !== null) {
        const traj = getActiveTrajectory();
        if (traj) {
            // Don't allow dragging position of chained first waypoint
            if (state.selectedWaypointIndex === 0 && traj.followsTrajectoryId) {
                return;
            }
            traj.waypoints[state.selectedWaypointIndex].x = fieldPos.x;
            traj.waypoints[state.selectedWaypointIndex].y = fieldPos.y;

            // If dragging last waypoint, sync followers
            if (state.selectedWaypointIndex === traj.waypoints.length - 1) {
                traj.trajectory = null;
                syncAllFollowers(traj.id);
            }

            updateWaypointList();
            renderFn();
        }
        return;
    }

    // Update cursor based on hover
    updateCursor(canvasX, canvasY);
}

export function handleMouseUp() {
    const wasDraggingWaypoint = state.isDragging || state.isDraggingHeading || state.isDraggingIntakePoint;
    const wasDraggingConstraint = state.isDraggingConstraint || state.isDraggingConstraintEdge;
    state.wasDragging = wasDraggingWaypoint || wasDraggingConstraint || state.isPanning;

    // Mark unsaved if we dragged a waypoint or constraint
    if (wasDraggingWaypoint || wasDraggingConstraint) {
        markUnsavedFn();
    }

    state.isDragging = false;
    state.isDraggingHeading = false;
    state.isDraggingIntakePoint = false;
    state.isDraggingConstraint = false;
    state.isDraggingConstraintEdge = false;
    state.draggingConstraintIndex = null;
    state.isPanning = false;

    updateCursor();
}

export function handleWheel(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const traj = getActiveTrajectory();

    // Check if over a waypoint for heading rotation
    const wpIndex = findWaypointAt(canvasX, canvasY);
    if (wpIndex !== null && traj && traj.waypoints[wpIndex].type === 'constrained') {
        // Don't allow rotating heading of chained first waypoint
        if (wpIndex === 0 && traj.followsTrajectoryId) {
            return;
        }
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        traj.waypoints[wpIndex].heading += delta;

        // Normalize
        while (traj.waypoints[wpIndex].heading > Math.PI) {
            traj.waypoints[wpIndex].heading -= 2 * Math.PI;
        }
        while (traj.waypoints[wpIndex].heading < -Math.PI) {
            traj.waypoints[wpIndex].heading += 2 * Math.PI;
        }

        // If rotating last waypoint's heading, sync followers
        if (wpIndex === traj.waypoints.length - 1) {
            traj.trajectory = null;
            syncAllFollowers(traj.id);
        }

        markUnsavedFn();
        updateWaypointList();
        renderFn();
        return;
    }

    // Otherwise, zoom
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom(factor, canvasX, canvasY, renderFn);
}

export function handleKeyDown(e) {
    // Handle Ctrl+S and Ctrl+O even in inputs
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        showSaveModalFn();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        showOpenModalFn();
        return;
    }

    // Don't trigger other shortcuts if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const traj = getActiveTrajectory();

    switch (e.key.toLowerCase()) {
        case 'v':
            selectToolFn('select');
            break;
        case 'c':
            selectToolFn('constrained');
            break;
        case 'u':
            selectToolFn('unconstrained');
            break;
        case 'i':
            selectToolFn('intake');
            break;
        // Constraint tools
        case 'o':
            selectToolFn('circle-obstacle');
            break;
        case 'b':
            selectToolFn('stay-in-rect');
            break;
        case 'l':
            selectToolFn('stay-in-lane');
            break;
        case 't':
            selectToolFn('heading-tangent');
            break;
        case 'm':
            selectToolFn('max-velocity');
            break;
        case 'w':
            selectToolFn('max-omega');
            break;
        case ' ':
            e.preventDefault();
            if (traj && traj.trajectory) togglePlaybackFn();
            break;
        case 'escape':
            // Close any open modals first
            if (openModal.style.display !== 'none') {
                openModal.style.display = 'none';
                return;
            }
            if (saveModal.style.display !== 'none') {
                saveModal.style.display = 'none';
                return;
            }
            if (syncModal.style.display !== 'none') {
                syncModal.style.display = 'none';
                return;
            }
            // Cancel constraint placement if in progress
            if (state.constraintPlacementStart !== null) {
                state.constraintPlacementStart = null;
                renderFn();
                return;
            }
            deselectWaypoint();
            deselectConstraint();
            break;
        case 'delete':
        case 'backspace':
            if (state.selectedConstraintIndex !== null) {
                deleteConstraint(state.selectedConstraintIndex);
            } else if (state.selectedWaypointIndex !== null) {
                deleteWaypoint(state.selectedWaypointIndex);
            }
            break;
    }
}

function updateCursor(canvasX, canvasY) {
    if (state.currentTool !== 'select') {
        canvas.style.cursor = 'crosshair';
        return;
    }

    if (canvasX !== undefined && canvasY !== undefined) {
        // Check constraint edge first (resize)
        if (findCircleObstacleEdgeAt(canvasX, canvasY) !== null) {
            canvas.style.cursor = 'ew-resize';
        // Check constraint center (move)
        } else if (findCircleObstacleAt(canvasX, canvasY) !== null) {
            canvas.style.cursor = 'move';
        } else if (findIntakePointAt(canvasX, canvasY) !== null) {
            canvas.style.cursor = 'move';
        } else if (findHeadingHandleAt(canvasX, canvasY) !== null) {
            canvas.style.cursor = 'crosshair';
        } else if (findWaypointAt(canvasX, canvasY) !== null) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = 'default';
        }
    } else {
        canvas.style.cursor = 'default';
    }
}
