/**
 * Mecanum Trajectory Optimizer - Frontend Application
 *
 * Interactive canvas for waypoint placement and trajectory visualization.
 * Features: Pan/zoom, collapsible waypoints, tool-based waypoint creation
 */

// ============================================
// CONSTANTS
// ============================================

const CANVAS_SIZE = 600; // Base canvas size in pixels
const ROBOT_WIDTH = 0.35; // meters
const ROBOT_LENGTH = 0.35; // meters
const WAYPOINT_RADIUS = 15; // pixels
const HEADING_LINE_LENGTH = 30; // pixels
const HEADING_HANDLE_RADIUS = 8; // pixels

// ============================================
// STATE
// ============================================

function generateId() {
    return crypto.randomUUID();
}

function createDefaultTrajectory(name = 'Trajectory 1') {
    return {
        id: generateId(),
        name: name,
        waypoints: [],
        trajectory: null,
        solverSettings: {
            samplesPerMeter: 20.0,
            minSamplesPerSegment: 3
        },
        followsTrajectoryId: null
    };
}

const state = {
    // Field
    fieldSize: 3.66, // meters

    // View transform (pan/zoom)
    view: {
        x: 0,
        y: 0,
        scale: 1.0,
        minScale: 0.5,
        maxScale: 4.0
    },

    // Tools
    currentTool: 'select', // 'select', 'constrained', 'unconstrained', 'intake'

    // Trajectories collection
    trajectories: [createDefaultTrajectory()],
    activeTrajectoryId: null, // Set in init
    expandedTrajectoryId: null,

    // Waypoint state (for active trajectory)
    selectedWaypointIndex: null,
    expandedWaypointIndex: null,
    manuallyExpandedWaypoints: new Set(),

    // Interaction
    isDragging: false,
    isDraggingHeading: false,
    isDraggingIntakePoint: false,
    isPanning: false,
    wasDragging: false,
    dragStart: { x: 0, y: 0 },
    panStart: { x: 0, y: 0 },

    // Playback
    playbackTime: 0,
    isPlaying: false,
    isChainPlaying: false,
    chainPlaybackData: null, // { chain: [], currentIndex: 0, totalTime: 0 }
    animationId: null,

    // Background
    backgroundImage: null,
    backgroundSettings: {
        scale: 1.0,
        rotation: 0,
        opacity: 0.5,
        mirrorH: false,
        mirrorV: false
    }
};

// ============================================
// TRAJECTORY HELPERS
// ============================================

function getActiveTrajectory() {
    return state.trajectories.find(t => t.id === state.activeTrajectoryId);
}

function getTrajectoryById(id) {
    return state.trajectories.find(t => t.id === id);
}

function getTrajectoryIndex(id) {
    return state.trajectories.findIndex(t => t.id === id);
}

// ============================================
// TRAJECTORY MANAGEMENT
// ============================================

function createTrajectory() {
    const newTraj = createDefaultTrajectory(`Trajectory ${state.trajectories.length + 1}`);
    state.trajectories.push(newTraj);
    selectTrajectory(newTraj.id);
    updateTrajectoryList();
}

function deleteTrajectory(id) {
    if (state.trajectories.length <= 1) {
        return; // Don't delete the last trajectory
    }

    const index = getTrajectoryIndex(id);
    if (index === -1) return;

    // Unlink any trajectories that follow this one
    state.trajectories.forEach(t => {
        if (t.followsTrajectoryId === id) {
            t.followsTrajectoryId = null;
        }
    });

    state.trajectories.splice(index, 1);

    // If we deleted the active trajectory, select another one
    if (state.activeTrajectoryId === id) {
        state.activeTrajectoryId = state.trajectories[0].id;
        state.selectedWaypointIndex = null;
        state.expandedWaypointIndex = null;
        state.manuallyExpandedWaypoints.clear();
    }

    updateTrajectoryList();
    updateWaypointList();
    updateSolverSettingsFromActiveTrajectory();
    updatePlaybackControls();
    render();
}

function renameTrajectory(id, name) {
    const traj = getTrajectoryById(id);
    if (traj) {
        traj.name = name;
        updateTrajectoryList();
    }
}

function selectTrajectory(id) {
    if (state.activeTrajectoryId === id) return;

    // Stop any playback
    stopPlayback();
    if (state.isChainPlaying) {
        stopChainPlayback();
    }

    state.activeTrajectoryId = id;
    state.selectedWaypointIndex = null;
    state.expandedWaypointIndex = null;
    state.manuallyExpandedWaypoints.clear();

    updateTrajectoryList();
    updateWaypointList();
    updateSolverSettingsFromActiveTrajectory();
    updatePlaybackControls();
    render();
}

function toggleTrajectoryExpanded(id) {
    if (state.expandedTrajectoryId === id) {
        state.expandedTrajectoryId = null;
    } else {
        state.expandedTrajectoryId = id;
    }
    updateTrajectoryList();
}

function updateSolverSettingsFromActiveTrajectory() {
    const traj = getActiveTrajectory();
    if (traj) {
        samplesPerMeterInput.value = traj.solverSettings.samplesPerMeter;
        minSamplesPerSegmentInput.value = traj.solverSettings.minSamplesPerSegment;
    }
}

// ============================================
// TRAJECTORY CHAINING
// ============================================

function canBeFollowed(trajId) {
    // A trajectory can be followed if its last waypoint is constrained
    const traj = getTrajectoryById(trajId);
    if (!traj || traj.waypoints.length === 0) return false;
    const lastWp = traj.waypoints[traj.waypoints.length - 1];
    return lastWp.type === 'constrained';
}

function canFollow(trajId) {
    // A trajectory can follow another if its first waypoint is constrained
    const traj = getTrajectoryById(trajId);
    if (!traj || traj.waypoints.length === 0) return false;
    const firstWp = traj.waypoints[0];
    return firstWp.type === 'constrained';
}

function wouldCreateCycle(followerId, targetId) {
    // Walk the chain from targetId to see if we reach followerId
    let current = targetId;
    const visited = new Set();

    while (current) {
        if (current === followerId) return true;
        if (visited.has(current)) return true; // Already a cycle exists
        visited.add(current);

        const traj = getTrajectoryById(current);
        current = traj ? traj.followsTrajectoryId : null;
    }

    return false;
}

function setTrajectoryFollows(id, followsId) {
    const traj = getTrajectoryById(id);
    if (!traj) return;

    // Clear if null or same
    if (!followsId || followsId === 'none') {
        traj.followsTrajectoryId = null;
        updateTrajectoryList();
        updateWaypointList();
        render();
        return;
    }

    // Validate
    if (followsId === id) return; // Can't follow self
    if (!canBeFollowed(followsId)) return; // Target's last wp must be constrained
    if (!canFollow(id)) return; // Our first wp must be constrained
    if (wouldCreateCycle(id, followsId)) return; // No cycles

    traj.followsTrajectoryId = followsId;
    syncChainedWaypoint(id);
    traj.trajectory = null; // Clear solved result

    updateTrajectoryList();
    updateWaypointList();
    render();
}

function syncChainedWaypoint(trajId) {
    const traj = getTrajectoryById(trajId);
    if (!traj || !traj.followsTrajectoryId) return;
    if (traj.waypoints.length === 0) return;

    const followedTraj = getTrajectoryById(traj.followsTrajectoryId);
    if (!followedTraj || followedTraj.waypoints.length === 0) return;

    const lastWp = followedTraj.waypoints[followedTraj.waypoints.length - 1];
    const firstWp = traj.waypoints[0];

    // Copy position and heading from followed trajectory's end
    firstWp.x = lastWp.x;
    firstWp.y = lastWp.y;
    firstWp.heading = lastWp.heading;
}

function syncAllFollowers(trajId) {
    // Find all trajectories that follow this one and sync their first waypoints
    state.trajectories.forEach(t => {
        if (t.followsTrajectoryId === trajId) {
            syncChainedWaypoint(t.id);
            // Clear solved result since waypoint changed
            t.trajectory = null;
            // Recursively sync any trajectories following this one
            syncAllFollowers(t.id);
        }
    });
}

function getTrajectoryChain(trajId) {
    // Get the full chain of trajectories from oldest ancestor to newest descendant
    // that includes the given trajectory

    // First, walk backwards to find the oldest ancestor
    let oldestId = trajId;
    const visited = new Set();
    while (true) {
        const traj = getTrajectoryById(oldestId);
        if (!traj || !traj.followsTrajectoryId || visited.has(oldestId)) break;
        visited.add(oldestId);
        oldestId = traj.followsTrajectoryId;
    }

    // Now build the chain forward from the oldest
    const chain = [];
    let currentId = oldestId;
    visited.clear();

    while (currentId && !visited.has(currentId)) {
        const traj = getTrajectoryById(currentId);
        if (!traj) break;
        chain.push(traj);
        visited.add(currentId);

        // Find the next trajectory in the chain (one that follows this one)
        const follower = state.trajectories.find(t => t.followsTrajectoryId === currentId);
        currentId = follower ? follower.id : null;
    }

    return chain;
}

// ============================================
// TRAJECTORY LIST UI
// ============================================

function updateTrajectoryList() {
    trajectoryCountEl.textContent = state.trajectories.length;

    trajectoryListEl.innerHTML = state.trajectories.map((traj, i) => {
        const isActive = traj.id === state.activeTrajectoryId;
        const isExpanded = state.expandedTrajectoryId === traj.id;
        const isSolved = traj.trajectory !== null;
        const followedTraj = traj.followsTrajectoryId ? getTrajectoryById(traj.followsTrajectoryId) : null;
        const followedIndex = followedTraj ? getTrajectoryIndex(traj.followsTrajectoryId) + 1 : null;

        // Build follows dropdown options
        const followOptions = state.trajectories
            .filter(t => t.id !== traj.id)
            .map(t => {
                const tIndex = getTrajectoryIndex(t.id) + 1;
                const canBeTarget = canBeFollowed(t.id);
                const wouldCycle = wouldCreateCycle(traj.id, t.id);
                const disabled = !canBeTarget || wouldCycle || !canFollow(traj.id);
                const reason = !canFollow(traj.id) ? '(first wp not constrained)'
                    : !canBeTarget ? '(last wp not constrained)'
                    : wouldCycle ? '(would create cycle)' : '';

                return `<option value="${t.id}" ${traj.followsTrajectoryId === t.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>
                    ${tIndex}. ${t.name} ${reason}
                </option>`;
            }).join('');

        return `
            <div class="trajectory-item ${isActive ? 'active' : ''} ${isExpanded ? 'expanded' : ''}" data-id="${traj.id}">
                <div class="trajectory-header-row" data-id="${traj.id}">
                    <span class="trajectory-index">${i + 1}</span>
                    <span class="trajectory-name">${traj.name}</span>
                    ${followedIndex ? `<span class="trajectory-follows">←${followedIndex}</span>` : ''}
                    <span class="trajectory-status ${isSolved ? 'solved' : 'unsolved'}"></span>
                    <svg class="trajectory-expand-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
                <div class="trajectory-body">
                    <div class="input-row">
                        <label>Name</label>
                        <input type="text" value="${traj.name}" data-id="${traj.id}" data-field="name">
                    </div>
                    <div class="input-row">
                        <label>Follows</label>
                        <select data-id="${traj.id}" data-field="follows">
                            <option value="none" ${!traj.followsTrajectoryId ? 'selected' : ''}>None</option>
                            ${followOptions}
                        </select>
                    </div>
                    <div class="trajectory-controls">
                        <button class="traj-delete-btn" data-id="${traj.id}" ${state.trajectories.length <= 1 ? 'disabled' : ''}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                            Delete
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    trajectoryListEl.querySelectorAll('.trajectory-header-row').forEach(row => {
        row.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            if (state.activeTrajectoryId === id && state.expandedTrajectoryId === id) {
                toggleTrajectoryExpanded(id);
            } else if (state.activeTrajectoryId === id) {
                toggleTrajectoryExpanded(id);
            } else {
                selectTrajectory(id);
            }
        });
    });

    trajectoryListEl.querySelectorAll('input[data-field="name"]').forEach(input => {
        input.addEventListener('change', (e) => {
            e.stopPropagation();
            renameTrajectory(input.dataset.id, input.value);
        });
        input.addEventListener('click', e => e.stopPropagation());
    });

    trajectoryListEl.querySelectorAll('select[data-field="follows"]').forEach(select => {
        select.addEventListener('change', (e) => {
            e.stopPropagation();
            setTrajectoryFollows(select.dataset.id, select.value);
        });
        select.addEventListener('click', e => e.stopPropagation());
    });

    trajectoryListEl.querySelectorAll('.traj-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTrajectory(btn.dataset.id);
        });
    });
}

// ============================================
// DOM ELEMENTS
// ============================================

let canvas, ctx, canvasContainer;
let trajectoryListEl, trajectoryCountEl, addTrajectoryBtn;
let waypointListEl, waypointCountEl;
let solveBtn, solveStatusInline, solveStatusEl, solveResultsEl, resultsSection;
let playBtn, chainPlayBtn, resetBtn, timeSlider, timeDisplay, playbackProgress;
let mousePosEl;
let fieldSizeInput, bgImageInput, bgControls;
let bgScaleSlider, bgRotationSlider, bgOpacitySlider, bgMirrorH, bgMirrorV;
let samplesPerMeterInput, minSamplesPerSegmentInput;
let toolButtons;

// ============================================
// INITIALIZATION
// ============================================

function init() {
    // Canvas
    canvas = document.getElementById('field-canvas');
    ctx = canvas.getContext('2d');
    canvasContainer = document.getElementById('canvas-container');

    // Trajectory list
    trajectoryListEl = document.getElementById('trajectory-list');
    trajectoryCountEl = document.getElementById('trajectory-count');
    addTrajectoryBtn = document.getElementById('add-trajectory');

    // Set initial active trajectory
    state.activeTrajectoryId = state.trajectories[0].id;

    // Waypoint list
    waypointListEl = document.getElementById('waypoint-list');
    waypointCountEl = document.getElementById('waypoint-count');

    // Solve
    solveBtn = document.getElementById('solve-btn');
    solveStatusInline = document.getElementById('solve-status-inline');
    solveStatusEl = document.getElementById('solve-status');
    solveResultsEl = document.getElementById('solve-results');
    resultsSection = document.getElementById('results-section');

    // Playback
    playBtn = document.getElementById('play-btn');
    chainPlayBtn = document.getElementById('chain-play-btn');
    resetBtn = document.getElementById('reset-btn');
    timeSlider = document.getElementById('time-slider');
    timeDisplay = document.getElementById('time-display');
    playbackProgress = document.getElementById('playback-progress');
    mousePosEl = document.getElementById('mouse-pos');

    // Field settings
    fieldSizeInput = document.getElementById('field-size');
    bgImageInput = document.getElementById('bg-image-input');
    bgControls = document.getElementById('bg-controls');
    bgScaleSlider = document.getElementById('bg-scale');
    bgRotationSlider = document.getElementById('bg-rotation');
    bgOpacitySlider = document.getElementById('bg-opacity');
    bgMirrorH = document.getElementById('bg-mirror-h');
    bgMirrorV = document.getElementById('bg-mirror-v');

    // Solver settings
    samplesPerMeterInput = document.getElementById('samples-per-meter');
    minSamplesPerSegmentInput = document.getElementById('min-samples-per-segment');

    // Tool buttons
    toolButtons = document.querySelectorAll('.tool-btn');

    // Set up canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Canvas events
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Tool selection
    toolButtons.forEach(btn => {
        btn.addEventListener('click', () => selectTool(btn.dataset.tool));
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);

    // Button events
    solveBtn.addEventListener('click', solve);
    document.getElementById('clear-waypoints').addEventListener('click', clearWaypoints);
    playBtn.addEventListener('click', togglePlayback);
    chainPlayBtn.addEventListener('click', toggleChainPlayback);
    resetBtn.addEventListener('click', resetPlayback);
    timeSlider.addEventListener('input', handleSliderChange);

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => zoom(1.25));
    document.getElementById('zoom-out').addEventListener('click', () => zoom(0.8));
    document.getElementById('zoom-fit').addEventListener('click', fitToView);

    // Field settings
    fieldSizeInput.addEventListener('change', handleFieldSizeChange);

    // Background image
    document.getElementById('bg-image-btn').addEventListener('click', () => bgImageInput.click());
    bgImageInput.addEventListener('change', handleBackgroundImageSelect);
    document.getElementById('clear-bg-btn').addEventListener('click', clearBackgroundImage);

    // Background controls
    bgScaleSlider.addEventListener('input', handleBgSettingChange);
    bgRotationSlider.addEventListener('input', handleBgSettingChange);
    bgOpacitySlider.addEventListener('input', handleBgSettingChange);
    bgMirrorH.addEventListener('change', handleBgSettingChange);
    bgMirrorV.addEventListener('change', handleBgSettingChange);

    // Collapsible sections
    document.querySelectorAll('.section-header[data-collapse]').forEach(header => {
        header.addEventListener('click', () => {
            header.closest('.settings-section').classList.toggle('collapsed');
        });
    });

    // Trajectory controls
    addTrajectoryBtn.addEventListener('click', createTrajectory);

    // Initial render
    fitToView();
    updateTrajectoryList();
    updateSolverSettingsFromActiveTrajectory();
    render();
}

// ============================================
// CANVAS SIZING
// ============================================

function resizeCanvas() {
    const wrapper = document.querySelector('.canvas-wrapper');
    const maxSize = Math.min(wrapper.clientWidth - 32, wrapper.clientHeight - 32, 800);
    const size = Math.max(400, maxSize);

    canvas.width = size;
    canvas.height = size;

    render();
}

// ============================================
// COORDINATE TRANSFORMS
// ============================================

function getScale() {
    return (canvas.width / state.fieldSize) * state.view.scale;
}

function canvasToField(canvasX, canvasY) {
    const scale = getScale();
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const x = (canvasX - centerX - state.view.x) / scale + state.fieldSize / 2;
    const y = (centerY - canvasY + state.view.y) / scale + state.fieldSize / 2;

    return { x, y };
}

function fieldToCanvas(fieldX, fieldY) {
    const scale = getScale();
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const x = (fieldX - state.fieldSize / 2) * scale + centerX + state.view.x;
    const y = centerY - (fieldY - state.fieldSize / 2) * scale + state.view.y;

    return { x, y };
}

// ============================================
// VIEW CONTROLS
// ============================================

function zoom(factor, centerX = canvas.width / 2, centerY = canvas.height / 2) {
    const newScale = Math.max(state.view.minScale, Math.min(state.view.maxScale, state.view.scale * factor));

    if (newScale !== state.view.scale) {
        // Zoom towards mouse position
        const dx = centerX - canvas.width / 2 - state.view.x;
        const dy = centerY - canvas.height / 2 - state.view.y;

        state.view.x -= dx * (factor - 1);
        state.view.y -= dy * (factor - 1);
        state.view.scale = newScale;

        render();
    }
}

function fitToView() {
    state.view.x = 0;
    state.view.y = 0;
    state.view.scale = 1.0;
    render();
}

// ============================================
// TOOL SELECTION
// ============================================

function selectTool(tool) {
    state.currentTool = tool;
    toolButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    // Update cursor
    if (tool === 'select') {
        canvas.style.cursor = 'default';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function handleKeyDown(e) {
    // Don't trigger if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const traj = getActiveTrajectory();

    switch (e.key.toLowerCase()) {
        case 'v':
            selectTool('select');
            break;
        case 'c':
            selectTool('constrained');
            break;
        case 'u':
            selectTool('unconstrained');
            break;
        case 'i':
            selectTool('intake');
            break;
        case ' ':
            e.preventDefault();
            if (traj && traj.trajectory) togglePlayback();
            break;
        case 'escape':
            deselectWaypoint();
            break;
        case 'delete':
        case 'backspace':
            if (state.selectedWaypointIndex !== null) {
                deleteWaypoint(state.selectedWaypointIndex);
            }
            break;
    }
}

// ============================================
// CANVAS EVENTS
// ============================================

function handleCanvasClick(e) {
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
        return;
    }

    // Add waypoint based on current tool
    const fieldPos = canvasToField(canvasX, canvasY);

    if (state.currentTool === 'intake') {
        // For intake, click position is the intake point
        addIntakeWaypoint(fieldPos.x, fieldPos.y);
    } else {
        addWaypoint(fieldPos.x, fieldPos.y, 0, state.currentTool);
    }
}

function handleMouseDown(e) {
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

function handleMouseMove(e) {
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
        render();
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
            render();
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
            render();
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
            render();
        }
        return;
    }

    // Update cursor based on hover
    updateCursor(canvasX, canvasY);
}

function handleMouseUp() {
    state.wasDragging = state.isDragging || state.isDraggingHeading || state.isDraggingIntakePoint || state.isPanning;
    state.isDragging = false;
    state.isDraggingHeading = false;
    state.isDraggingIntakePoint = false;
    state.isPanning = false;

    updateCursor();
}

function handleWheel(e) {
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

        updateWaypointList();
        render();
        return;
    }

    // Otherwise, zoom
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom(factor, canvasX, canvasY);
}

function updateCursor(canvasX, canvasY) {
    if (state.currentTool !== 'select') {
        canvas.style.cursor = 'crosshair';
        return;
    }

    if (canvasX !== undefined && canvasY !== undefined) {
        if (findIntakePointAt(canvasX, canvasY) !== null) {
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

// ============================================
// WAYPOINT HIT TESTING
// ============================================

function findWaypointAt(canvasX, canvasY) {
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

function findHeadingHandleAt(canvasX, canvasY) {
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

function findIntakePointAt(canvasX, canvasY) {
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

// ============================================
// WAYPOINT MANAGEMENT
// ============================================

function addWaypoint(x, y, heading, type) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    // Update previous last waypoint's stop flag
    if (traj.waypoints.length > 1) {
        traj.waypoints[traj.waypoints.length - 1].stop = false;
    }

    const defaultIntakeDistance = getDefaultIntakeDistance();
    const defaultIntakeVelocity = getDefaultIntakeVelocity();

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
    updateTrajectoryList();

    const newIndex = traj.waypoints.length - 1;
    selectWaypoint(newIndex);
    updateWaypointList();
    render();
}

function addIntakeWaypoint(intakeX, intakeY) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    // For intake waypoints, the click position is the intake point
    // The robot position will be computed by the solver
    const defaultIntakeDistance = getDefaultIntakeDistance();
    const defaultIntakeVelocity = getDefaultIntakeVelocity();

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
    updateTrajectoryList();

    const newIndex = traj.waypoints.length - 1;
    selectWaypoint(newIndex);
    updateWaypointList();
    render();
}

function deleteWaypoint(index) {
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
    updateTrajectoryList();

    // Update selection
    if (state.selectedWaypointIndex === index) {
        deselectWaypoint();
    } else if (state.selectedWaypointIndex > index) {
        state.selectedWaypointIndex--;
    }

    updateWaypointList();
    render();
}

function selectWaypoint(index) {
    const previousIndex = state.selectedWaypointIndex;
    state.selectedWaypointIndex = index;

    // Auto-collapse previously selected if it wasn't manually expanded
    if (previousIndex !== null && previousIndex !== index && !state.manuallyExpandedWaypoints.has(previousIndex)) {
        state.expandedWaypointIndex = null;
    }

    // Auto-expand newly selected
    state.expandedWaypointIndex = index;

    updateWaypointList();

    // Scroll to waypoint in list
    const waypointEl = document.querySelector(`.waypoint-item[data-index="${index}"]`);
    if (waypointEl) {
        waypointEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function deselectWaypoint() {
    const previousIndex = state.selectedWaypointIndex;
    state.selectedWaypointIndex = null;

    // Collapse if not manually expanded
    if (previousIndex !== null && !state.manuallyExpandedWaypoints.has(previousIndex)) {
        state.expandedWaypointIndex = null;
    }

    updateWaypointList();
}

function toggleWaypointExpanded(index) {
    if (state.expandedWaypointIndex === index) {
        state.expandedWaypointIndex = null;
        state.manuallyExpandedWaypoints.delete(index);
    } else {
        state.expandedWaypointIndex = index;
        state.manuallyExpandedWaypoints.add(index);
    }
    updateWaypointList();
}

function updateWaypointField(index, field, value) {
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
        updateTrajectoryList();
        updateWaypointList();
        render();
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

    // If we changed the last waypoint's position/heading, sync any followers
    if (index === traj.waypoints.length - 1 && (field === 'x' || field === 'y' || field === 'heading')) {
        syncAllFollowers(traj.id);
    }

    updateTrajectoryList();
    render();
}

function toggleWaypointStop(index) {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.waypoints[index].stop = !traj.waypoints[index].stop;
    traj.trajectory = null;
    updateTrajectoryList();
    updateWaypointList();
    render();
}

function clearWaypoints() {
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
    updateTrajectoryList();
    updateWaypointList();
    updatePlaybackControls();
    render();
}

// ============================================
// WAYPOINT LIST UI
// ============================================

function updateWaypointList() {
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

    waypointListEl.innerHTML = waypoints.map((wp, i) => {
        const isSelected = state.selectedWaypointIndex === i;
        const isExpanded = state.expandedWaypointIndex === i;
        const isLast = i === waypoints.length - 1;
        const isLockedFirst = i === 0 && isChained;

        // Ensure defaults
        const defaultIntakeDist = getDefaultIntakeDistance();
        const defaultIntakeVel = getDefaultIntakeVelocity();
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

// ============================================
// RENDERING
// ============================================

function render() {
    const size = canvas.width;

    // Clear
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(0, 0, size, size);

    // Draw background image
    if (state.backgroundImage) {
        drawBackgroundImage();
    }

    // Draw grid
    drawGrid();

    // Chain playback mode - show all trajectories in the chain
    if (state.isChainPlaying && state.chainPlaybackData) {
        const { chain } = state.chainPlaybackData;

        // Draw all trajectories in the chain
        chain.forEach(traj => {
            if (traj.trajectory) {
                drawTrajectory(traj.trajectory);
            }
        });

        // Draw waypoints for the active trajectory
        drawWaypoints();

        // Draw robot at chain playback position
        const robotState = getChainRobotStateAtTime(state.playbackTime);
        if (robotState) {
            drawRobotAt(robotState.x, robotState.y, robotState.theta);
        }
        return;
    }

    // Normal mode - draw inactive trajectories (greyed position trace only)
    state.trajectories.forEach(traj => {
        if (traj.id !== state.activeTrajectoryId) {
            drawInactiveTrajectory(traj);
        }
    });

    // Draw active trajectory
    const activeTraj = getActiveTrajectory();
    if (activeTraj && activeTraj.trajectory) {
        drawTrajectory(activeTraj.trajectory);
    }

    // Draw waypoints for active trajectory
    drawWaypoints();

    // Draw robot at playback time
    if (activeTraj && activeTraj.trajectory) {
        drawRobotAtTime(state.playbackTime);
    }
}

function drawInactiveTrajectory(traj) {
    if (!traj.trajectory?.states?.length) return;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const states = traj.trajectory.states;
    const start = fieldToCanvas(states[0][3], states[0][4]);
    ctx.moveTo(start.x, start.y);

    for (let i = 1; i < states.length; i++) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        ctx.lineTo(pos.x, pos.y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawBackgroundImage() {
    const img = state.backgroundImage;
    const settings = state.backgroundSettings;
    const scale = getScale();

    ctx.save();
    ctx.globalAlpha = settings.opacity;

    // Move to center
    const center = fieldToCanvas(state.fieldSize / 2, state.fieldSize / 2);
    ctx.translate(center.x, center.y);
    ctx.rotate(settings.rotation * Math.PI / 180);

    const scaleX = settings.mirrorH ? -1 : 1;
    const scaleY = settings.mirrorV ? -1 : 1;
    ctx.scale(scaleX * settings.scale, scaleY * settings.scale);

    const imgW = img.width || canvas.width;
    const imgH = img.height || canvas.height;
    const imgAspect = imgW / imgH;

    const drawSize = state.fieldSize * scale;
    let drawW, drawH;
    if (imgAspect > 1) {
        drawW = drawSize;
        drawH = drawSize / imgAspect;
    } else {
        drawH = drawSize;
        drawW = drawSize * imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
}

function drawGrid() {
    const scale = getScale();

    // Calculate grid spacing
    let gridSpacingM = 0.5;
    if (state.fieldSize > 10) gridSpacingM = 1.0;
    if (state.fieldSize > 15) gridSpacingM = 2.0;
    if (state.fieldSize < 2) gridSpacingM = 0.25;

    ctx.strokeStyle = '#2a2f3a';
    ctx.lineWidth = 1;

    // Draw grid lines
    const startX = 0;
    const startY = 0;
    const endX = state.fieldSize;
    const endY = state.fieldSize;

    for (let x = 0; x <= endX; x += gridSpacingM) {
        const p1 = fieldToCanvas(x, startY);
        const p2 = fieldToCanvas(x, endY);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }

    for (let y = 0; y <= endY; y += gridSpacingM) {
        const p1 = fieldToCanvas(startX, y);
        const p2 = fieldToCanvas(endX, y);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }

    // Draw center lines
    ctx.strokeStyle = '#363c4a';
    ctx.lineWidth = 2;

    const cx = state.fieldSize / 2;
    const cy = state.fieldSize / 2;

    let p1 = fieldToCanvas(cx, 0);
    let p2 = fieldToCanvas(cx, state.fieldSize);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    p1 = fieldToCanvas(0, cy);
    p2 = fieldToCanvas(state.fieldSize, cy);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = '#4b5563';
    ctx.font = '11px "JetBrains Mono", monospace';

    const origin = fieldToCanvas(0, 0);
    const maxX = fieldToCanvas(state.fieldSize, 0);
    const maxY = fieldToCanvas(0, state.fieldSize);

    ctx.fillText('0', origin.x + 4, origin.y - 4);
    ctx.fillText(`${state.fieldSize.toFixed(1)}m`, maxX.x - 35, maxX.y - 4);
    ctx.fillText(`${state.fieldSize.toFixed(1)}m`, maxY.x + 4, maxY.y + 14);
}

function drawWaypoints() {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.waypoints.forEach((wp, i) => {
        if (wp.type === undefined) wp.type = 'constrained';

        const isSelected = state.selectedWaypointIndex === i;
        const isLockedFirst = i === 0 && traj.followsTrajectoryId;

        if (wp.type === 'intake') {
            drawIntakeWaypoint(wp, i, isSelected);
        } else if (wp.type === 'unconstrained') {
            drawUnconstrainedWaypoint(wp, i, isSelected);
        } else {
            drawConstrainedWaypoint(wp, i, isSelected, isLockedFirst);
        }
    });
}

function drawConstrainedWaypoint(wp, index, isSelected, isLocked = false) {
    const pos = fieldToCanvas(wp.x, wp.y);

    // Waypoint circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = isSelected ? '#3b82f6' : (wp.stop ? '#f0f2f5' : '#9ca3af');
    ctx.fill();

    if (isSelected) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Draw dashed border for locked waypoints
    if (isLocked) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS + 4, 0, 2 * Math.PI);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Heading line
    const headingEndX = pos.x + Math.cos(-wp.heading) * HEADING_LINE_LENGTH;
    const headingEndY = pos.y + Math.sin(-wp.heading) * HEADING_LINE_LENGTH;

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(headingEndX, headingEndY);
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Heading handle
    ctx.beginPath();
    ctx.arc(headingEndX, headingEndY, HEADING_HANDLE_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = '#6b7280';
    ctx.fill();
    ctx.strokeStyle = '#f0f2f5';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Index number
    ctx.fillStyle = isSelected ? '#ffffff' : '#0a0b0f';
    ctx.font = 'bold 12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), pos.x, pos.y);
}

function drawUnconstrainedWaypoint(wp, index, isSelected) {
    const pos = fieldToCanvas(wp.x, wp.y);

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS, 0, 2 * Math.PI);
    ctx.strokeStyle = isSelected ? '#3b82f6' : (wp.stop ? '#f0f2f5' : '#9ca3af');
    ctx.lineWidth = 3;
    ctx.stroke();

    if (isSelected) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 5;
        ctx.stroke();
    }

    // Index number
    ctx.fillStyle = isSelected ? '#3b82f6' : '#f0f2f5';
    ctx.font = 'bold 12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), pos.x, pos.y);
}

function drawIntakeWaypoint(wp, index, isSelected) {
    const intakePos = fieldToCanvas(wp.intake_x, wp.intake_y);
    const scale = getScale();
    const distPixels = wp.intake_distance * scale;

    // Distance circle
    ctx.beginPath();
    ctx.arc(intakePos.x, intakePos.y, distPixels, 0, 2 * Math.PI);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = isSelected ? '#f59e0b' : '#6b7280';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // X marker
    const markerSize = 10;
    ctx.beginPath();
    ctx.moveTo(intakePos.x - markerSize, intakePos.y - markerSize);
    ctx.lineTo(intakePos.x + markerSize, intakePos.y + markerSize);
    ctx.moveTo(intakePos.x + markerSize, intakePos.y - markerSize);
    ctx.lineTo(intakePos.x - markerSize, intakePos.y + markerSize);
    ctx.strokeStyle = isSelected ? '#fbbf24' : '#f59e0b';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (isSelected) {
        ctx.beginPath();
        ctx.arc(intakePos.x, intakePos.y, markerSize + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Index number
    ctx.fillStyle = isSelected ? '#fbbf24' : '#f59e0b';
    ctx.font = 'bold 12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), intakePos.x, intakePos.y - markerSize - 12);
}

function drawTrajectory(trajectory) {
    if (!trajectory || trajectory.states.length < 2) return;

    const states = trajectory.states;

    // Draw path
    ctx.beginPath();
    const firstPos = fieldToCanvas(states[0][3], states[0][4]);
    ctx.moveTo(firstPos.x, firstPos.y);

    for (let i = 1; i < states.length; i++) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        ctx.lineTo(pos.x, pos.y);
    }

    ctx.strokeStyle = '#f0f2f5';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw robot poses
    for (let i = 0; i < states.length; i++) {
        drawRobotPose(states[i][3], states[i][4], states[i][5], 0.25);
    }
}

function drawRobotPose(x, y, theta, alpha = 1.0) {
    const pos = fieldToCanvas(x, y);
    const scale = getScale();
    const halfW = ROBOT_WIDTH * scale / 2;
    const halfL = ROBOT_LENGTH * scale / 2;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(-theta);

    ctx.strokeStyle = `rgba(240, 242, 245, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-halfL, -halfW, ROBOT_LENGTH * scale, ROBOT_WIDTH * scale);

    // Front indicator
    ctx.beginPath();
    ctx.moveTo(halfL, -halfW * 0.5);
    ctx.lineTo(halfL + 4, 0);
    ctx.lineTo(halfL, halfW * 0.5);
    ctx.stroke();

    ctx.restore();
}

function drawRobotAtTime(time) {
    const traj = getActiveTrajectory();
    if (!traj || !traj.trajectory) return;

    const times = traj.trajectory.times;
    const states = traj.trajectory.states;

    let idx = 0;
    for (let i = 0; i < times.length - 1; i++) {
        if (times[i + 1] >= time) {
            idx = i;
            break;
        }
    }

    const t0 = times[idx];
    const t1 = times[idx + 1] || times[idx];
    const alpha = t1 > t0 ? (time - t0) / (t1 - t0) : 0;

    const s0 = states[idx];
    const s1 = states[idx + 1] || states[idx];

    const px = s0[3] + alpha * (s1[3] - s0[3]);
    const py = s0[4] + alpha * (s1[4] - s0[4]);
    const theta = s0[5] + alpha * (s1[5] - s0[5]);

    drawRobotAt(px, py, theta);
}

function drawRobotAt(px, py, theta) {
    const pos = fieldToCanvas(px, py);
    const scale = getScale();
    const halfW = ROBOT_WIDTH * scale / 2;
    const halfL = ROBOT_LENGTH * scale / 2;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(-theta);

    ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';
    ctx.fillRect(-halfL, -halfW, ROBOT_LENGTH * scale, ROBOT_WIDTH * scale);

    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.strokeRect(-halfL, -halfW, ROBOT_LENGTH * scale, ROBOT_WIDTH * scale);

    // Front indicator
    ctx.beginPath();
    ctx.moveTo(halfL, -halfW * 0.5);
    ctx.lineTo(halfL + 6, 0);
    ctx.lineTo(halfL, halfW * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#3b82f6';
    ctx.fill();

    ctx.restore();
}

// ============================================
// FIELD SETTINGS
// ============================================

function handleFieldSizeChange(e) {
    const newSize = parseFloat(e.target.value);
    if (newSize > 0 && newSize <= 20) {
        state.fieldSize = newSize;
        render();
    }
}

function handleBackgroundImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            state.backgroundImage = img;
            bgControls.style.display = 'block';
            render();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function clearBackgroundImage() {
    state.backgroundImage = null;
    bgControls.style.display = 'none';
    bgImageInput.value = '';
    render();
}

function handleBgSettingChange() {
    state.backgroundSettings.scale = parseFloat(bgScaleSlider.value);
    state.backgroundSettings.rotation = parseFloat(bgRotationSlider.value);
    state.backgroundSettings.opacity = parseFloat(bgOpacitySlider.value);
    state.backgroundSettings.mirrorH = bgMirrorH.checked;
    state.backgroundSettings.mirrorV = bgMirrorV.checked;

    document.getElementById('bg-scale-value').textContent = state.backgroundSettings.scale.toFixed(2);
    document.getElementById('bg-rotation-value').textContent = state.backgroundSettings.rotation + '°';
    document.getElementById('bg-opacity-value').textContent = state.backgroundSettings.opacity.toFixed(2);

    render();
}

// ============================================
// ROBOT PARAMETERS
// ============================================

function getRobotParams() {
    return {
        mass: parseFloat(document.getElementById('param-mass').value),
        inertia: parseFloat(document.getElementById('param-inertia').value),
        wheel_radius: parseFloat(document.getElementById('param-wheel-radius').value),
        lx: parseFloat(document.getElementById('param-lx').value),
        ly: parseFloat(document.getElementById('param-ly').value),
        w_max: parseFloat(document.getElementById('param-wmax').value),
        t_max: parseFloat(document.getElementById('param-tmax').value),
        f_traction_max: parseFloat(document.getElementById('param-ftraction').value),
        default_intake_distance: parseFloat(document.getElementById('param-intake-distance').value),
        default_intake_velocity: parseFloat(document.getElementById('param-intake-velocity').value)
    };
}

function getDefaultIntakeDistance() {
    return parseFloat(document.getElementById('param-intake-distance').value) || 0.5;
}

function getDefaultIntakeVelocity() {
    return parseFloat(document.getElementById('param-intake-velocity').value) || 1.0;
}

// ============================================
// SOLVER
// ============================================

async function solve() {
    const traj = getActiveTrajectory();
    if (!traj) return;

    if (traj.waypoints.length < 2) {
        showStatus('Need at least 2 waypoints', 'error');
        return;
    }

    showStatus('Solving...', 'loading');
    solveBtn.disabled = true;

    // Save solver settings from UI to trajectory
    traj.solverSettings.samplesPerMeter = parseFloat(samplesPerMeterInput.value) || 20.0;
    traj.solverSettings.minSamplesPerSegment = parseInt(minSamplesPerSegmentInput.value) || 3;

    const request = {
        waypoints: traj.waypoints,
        robot_params: getRobotParams(),
        samples_per_meter: traj.solverSettings.samplesPerMeter,
        min_samples_per_segment: traj.solverSettings.minSamplesPerSegment
    };

    try {
        const response = await fetch('/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });

        const result = await response.json();

        if (response.ok) {
            traj.trajectory = result.trajectory;
            traj.trajectory.totalTime = result.total_time;

            if (result.success) {
                showStatus('Solution found!', 'success');
            } else {
                showStatus('Solver did not converge', 'error');
            }

            showResults(result);
            updateTrajectoryList();
            updatePlaybackControls();
            render();
        } else {
            showStatus(`Error: ${result.detail}`, 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
    }

    solveBtn.disabled = false;
}

function showStatus(message, type) {
    solveStatusInline.textContent = message;
    solveStatusInline.className = `solve-status-inline ${type}`;

    solveStatusEl.textContent = message;
    solveStatusEl.className = `solve-status ${type}`;
}

function showResults(result) {
    resultsSection.style.display = 'block';

    solveResultsEl.innerHTML = `
        <div class="result-row">
            <span class="result-label">Total time</span>
            <span class="result-value">${result.total_time.toFixed(3)}s</span>
        </div>
        <div class="result-row">
            <span class="result-label">Solve time</span>
            <span class="result-value">${result.solver_stats.solve_time_ms.toFixed(1)}ms</span>
        </div>
        <div class="result-row">
            <span class="result-label">Iterations</span>
            <span class="result-value">${result.solver_stats.iterations}</span>
        </div>
    `;
}

// ============================================
// PLAYBACK
// ============================================

function updatePlaybackControls() {
    const traj = getActiveTrajectory();
    const hasTrajectory = traj && traj.trajectory !== null;
    playBtn.disabled = !hasTrajectory;
    resetBtn.disabled = !hasTrajectory;
    timeSlider.disabled = !hasTrajectory;

    // Check if there's a chain with solved trajectories
    const chain = traj ? getTrajectoryChain(traj.id) : [];
    const hasChain = chain.length > 1 && chain.every(t => t.trajectory !== null);
    chainPlayBtn.disabled = !hasChain;

    if (hasTrajectory) {
        timeSlider.max = 1000;
        timeSlider.value = 0;
        state.playbackTime = 0;
        timeDisplay.textContent = '0.00s';
        playbackProgress.style.width = '0%';
    }
}

function togglePlayback() {
    const traj = getActiveTrajectory();
    if (state.isPlaying) {
        stopPlayback();
    } else {
        if (traj && traj.trajectory && state.playbackTime >= traj.trajectory.totalTime) {
            state.playbackTime = 0;
            timeSlider.value = 0;
            timeDisplay.textContent = '0.00s';
            playbackProgress.style.width = '0%';
        }
        startPlayback();
    }
}

function startPlayback() {
    const traj = getActiveTrajectory();
    if (!traj || !traj.trajectory) return;

    state.isPlaying = true;
    playBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
        </svg>
    `;
    playBtn.classList.add('playing');

    const totalTime = traj.trajectory.totalTime;
    const startRealTime = performance.now();
    const startPlaybackTime = state.playbackTime;

    function animate() {
        if (!state.isPlaying) return;

        const elapsed = (performance.now() - startRealTime) / 1000;
        state.playbackTime = startPlaybackTime + elapsed;

        if (state.playbackTime >= totalTime) {
            state.playbackTime = totalTime;
            stopPlayback();
        }

        const progress = state.playbackTime / totalTime;
        timeSlider.value = Math.round(progress * 1000);
        timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';
        playbackProgress.style.width = `${progress * 100}%`;

        render();

        if (state.isPlaying) {
            state.animationId = requestAnimationFrame(animate);
        }
    }

    state.animationId = requestAnimationFrame(animate);
}

function stopPlayback() {
    state.isPlaying = false;
    playBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
    `;
    playBtn.classList.remove('playing');

    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }
    render();
}

function resetPlayback() {
    stopPlayback();
    if (state.isChainPlaying) {
        stopChainPlayback();
    }
    state.playbackTime = 0;
    timeSlider.value = 0;
    timeDisplay.textContent = '0.00s';
    playbackProgress.style.width = '0%';
    render();
}

function handleSliderChange(e) {
    const traj = getActiveTrajectory();
    if (!traj || !traj.trajectory) return;

    const progress = e.target.value / 1000;
    state.playbackTime = progress * traj.trajectory.totalTime;
    timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';
    playbackProgress.style.width = `${progress * 100}%`;

    if (!state.isPlaying) {
        render();
    }
}

// ============================================
// CHAIN PLAYBACK
// ============================================

function toggleChainPlayback() {
    if (state.isChainPlaying) {
        stopChainPlayback();
    } else {
        startChainPlayback();
    }
}

function startChainPlayback() {
    const traj = getActiveTrajectory();
    if (!traj) return;

    const chain = getTrajectoryChain(traj.id);
    if (chain.length === 0 || !chain.every(t => t.trajectory !== null)) return;

    // Calculate total time for all trajectories in chain
    let totalTime = 0;
    const timings = [];
    chain.forEach(t => {
        timings.push({ start: totalTime, traj: t });
        totalTime += t.trajectory.totalTime;
    });

    state.isChainPlaying = true;
    state.isPlaying = false;
    state.chainPlaybackData = {
        chain: chain,
        timings: timings,
        totalTime: totalTime,
        currentIndex: 0
    };
    state.playbackTime = 0;

    chainPlayBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
        </svg>
    `;
    chainPlayBtn.classList.add('playing');
    playBtn.disabled = true;
    timeSlider.disabled = true;

    const startRealTime = performance.now();

    function animateChain() {
        if (!state.isChainPlaying) return;

        const elapsed = (performance.now() - startRealTime) / 1000;
        state.playbackTime = elapsed;

        if (state.playbackTime >= totalTime) {
            state.playbackTime = totalTime;
            stopChainPlayback();
        }

        const progress = state.playbackTime / totalTime;
        timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';
        playbackProgress.style.width = `${progress * 100}%`;

        render();

        if (state.isChainPlaying) {
            state.animationId = requestAnimationFrame(animateChain);
        }
    }

    state.animationId = requestAnimationFrame(animateChain);
}

function stopChainPlayback() {
    state.isChainPlaying = false;
    state.chainPlaybackData = null;

    chainPlayBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="3 3 13 12 3 21 3 3"/>
            <polygon points="13 3 23 12 13 21 13 3"/>
        </svg>
    `;
    chainPlayBtn.classList.remove('playing');

    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }

    updatePlaybackControls();
    render();
}

function getChainRobotStateAtTime(time) {
    if (!state.chainPlaybackData) return null;

    const { timings, totalTime } = state.chainPlaybackData;

    // Find which trajectory we're in
    let currentTraj = null;
    let localTime = 0;

    for (let i = 0; i < timings.length; i++) {
        const timing = timings[i];
        const trajDuration = timing.traj.trajectory.totalTime;
        const trajEnd = timing.start + trajDuration;

        if (time <= trajEnd || i === timings.length - 1) {
            currentTraj = timing.traj;
            localTime = Math.max(0, Math.min(time - timing.start, trajDuration));
            break;
        }
    }

    if (!currentTraj || !currentTraj.trajectory) return null;

    const times = currentTraj.trajectory.times;
    const states = currentTraj.trajectory.states;

    let idx = 0;
    for (let i = 0; i < times.length - 1; i++) {
        if (times[i + 1] >= localTime) {
            idx = i;
            break;
        }
        idx = i;
    }

    const t0 = times[idx];
    const t1 = times[idx + 1] || times[idx];
    const alpha = t1 > t0 ? (localTime - t0) / (t1 - t0) : 0;

    const s0 = states[idx];
    const s1 = states[idx + 1] || states[idx];

    return {
        x: s0[3] + alpha * (s1[3] - s0[3]),
        y: s0[4] + alpha * (s1[4] - s0[4]),
        theta: s0[5] + alpha * (s1[5] - s0[5]),
        trajectoryId: currentTraj.id
    };
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', init);
