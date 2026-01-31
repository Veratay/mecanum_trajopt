/**
 * Mecanum Trajectory Optimizer - Frontend Application
 *
 * Interactive canvas for waypoint placement and trajectory visualization.
 */

// Field and canvas dimensions
let FIELD_SIZE = 3.66; // meters (configurable)
const CANVAS_SIZE = 600; // pixels
let SCALE = CANVAS_SIZE / FIELD_SIZE; // pixels per meter

// Robot dimensions for visualization
const ROBOT_WIDTH = 0.35; // meters
const ROBOT_LENGTH = 0.35; // meters

// Waypoint visualization
const WAYPOINT_RADIUS = 15; // pixels
const HEADING_LINE_LENGTH = 30; // pixels
const HEADING_HANDLE_RADIUS = 8; // pixels for the draggable arrow tip

// Application state
const state = {
    waypoints: [],
    trajectory: null,
    selectedWaypoint: null,
    isDragging: false,
    isDraggingHeading: false,
    isDraggingIntakePoint: false,
    selectedIntakeWaypoint: null,
    wasDragging: false,  // Track if a drag just occurred (to prevent click creating waypoint)
    playbackTime: 0,
    isPlaying: false,
    animationId: null,
    // Background image state
    backgroundImage: null,
    backgroundSettings: {
        scale: 1.0,
        rotation: 0,
        opacity: 0.5,
        mirrorH: false,
        mirrorV: false
    }
};

// Canvas and context
let canvas, ctx;

// DOM elements
let waypointListEl, solveBtn, solveStatusEl, solveResultsEl;
let playBtn, resetBtn, timeSlider, timeDisplay, mousePosEl;
let fieldSizeInput, bgImageInput, bgControls;
let bgScaleSlider, bgRotationSlider, bgOpacitySlider;
let bgMirrorH, bgMirrorV;
let samplesPerMeterInput, minSamplesPerSegmentInput;

/**
 * Initialize the application
 */
function init() {
    canvas = document.getElementById('field-canvas');
    ctx = canvas.getContext('2d');

    // DOM elements
    waypointListEl = document.getElementById('waypoint-list');
    solveBtn = document.getElementById('solve-btn');
    solveStatusEl = document.getElementById('solve-status');
    solveResultsEl = document.getElementById('solve-results');
    playBtn = document.getElementById('play-btn');
    resetBtn = document.getElementById('reset-btn');
    timeSlider = document.getElementById('time-slider');
    timeDisplay = document.getElementById('time-display');
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

    // Canvas event listeners
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Button event listeners
    solveBtn.addEventListener('click', solve);
    document.getElementById('clear-waypoints').addEventListener('click', clearWaypoints);
    playBtn.addEventListener('click', togglePlayback);
    resetBtn.addEventListener('click', resetPlayback);
    timeSlider.addEventListener('input', handleSliderChange);

    // Field size
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

    // Collapsible panels
    document.querySelectorAll('.panel.collapsible .panel-header').forEach(header => {
        header.addEventListener('click', () => {
            header.closest('.panel').classList.toggle('collapsed');
        });
    });

    // Initial render
    render();
}

/**
 * Update scale when field size changes
 */
function updateScale() {
    SCALE = CANVAS_SIZE / FIELD_SIZE;
}

/**
 * Convert canvas coordinates to field coordinates
 */
function canvasToField(x, y) {
    return {
        x: x / SCALE,
        y: (CANVAS_SIZE - y) / SCALE // Y is inverted
    };
}

/**
 * Convert field coordinates to canvas coordinates
 */
function fieldToCanvas(x, y) {
    return {
        x: x * SCALE,
        y: CANVAS_SIZE - y * SCALE // Y is inverted
    };
}

/**
 * Handle field size change
 */
function handleFieldSizeChange(e) {
    const newSize = parseFloat(e.target.value);
    if (newSize > 0 && newSize <= 20) {
        FIELD_SIZE = newSize;
        updateScale();
        render();
    }
}

/**
 * Handle background image selection
 */
function handleBackgroundImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('bg-image-name').textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            state.backgroundImage = img;
            bgControls.style.display = 'block';
            render();
        };
        img.onerror = () => {
            // Try loading as SVG if regular image load fails
            const svgBlob = new Blob([event.target.result], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(svgBlob);
            img.src = url;
        };

        // Check if it's an SVG
        if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
            // For SVG, we need to handle it specially
            const svgImg = new Image();
            svgImg.onload = () => {
                state.backgroundImage = svgImg;
                bgControls.style.display = 'block';
                render();
            };
            svgImg.src = event.target.result;
        } else {
            img.src = event.target.result;
        }
    };

    // Read as data URL for images, or as text for SVG
    if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
        reader.readAsDataURL(file);
    } else {
        reader.readAsDataURL(file);
    }
}

/**
 * Clear background image
 */
function clearBackgroundImage() {
    state.backgroundImage = null;
    bgControls.style.display = 'none';
    document.getElementById('bg-image-name').textContent = 'No file chosen';
    bgImageInput.value = '';
    render();
}

/**
 * Handle background setting changes
 */
function handleBgSettingChange() {
    state.backgroundSettings.scale = parseFloat(bgScaleSlider.value);
    state.backgroundSettings.rotation = parseFloat(bgRotationSlider.value);
    state.backgroundSettings.opacity = parseFloat(bgOpacitySlider.value);
    state.backgroundSettings.mirrorH = bgMirrorH.checked;
    state.backgroundSettings.mirrorV = bgMirrorV.checked;

    // Update display values
    document.getElementById('bg-scale-value').textContent = state.backgroundSettings.scale.toFixed(2);
    document.getElementById('bg-rotation-value').textContent = state.backgroundSettings.rotation + '°';
    document.getElementById('bg-opacity-value').textContent = state.backgroundSettings.opacity.toFixed(2);

    render();
}

/**
 * Handle canvas click - add new waypoint
 */
function handleCanvasClick(e) {
    // Don't create waypoint if we just finished dragging
    if (state.isDragging || state.isDraggingHeading || state.isDraggingIntakePoint || state.wasDragging) {
        state.wasDragging = false;
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Check if clicking on existing waypoint, heading handle, or intake point
    const clickedWp = findWaypointAt(canvasX, canvasY);
    const clickedHeading = findHeadingHandleAt(canvasX, canvasY);
    const clickedIntake = findIntakePointAt(canvasX, canvasY);
    if (clickedWp !== null || clickedHeading !== null || clickedIntake !== null) return;

    // Add new waypoint
    // First and last waypoints should stop by default, middle ones should not
    const fieldPos = canvasToField(canvasX, canvasY);
    const isFirstWaypoint = state.waypoints.length === 0;
    addWaypoint(fieldPos.x, fieldPos.y, 0, isFirstWaypoint);
}

/**
 * Handle mouse down - start dragging waypoint, heading, or intake point
 */
function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // First check for intake point marker
    const intakeIdx = findIntakePointAt(canvasX, canvasY);
    if (intakeIdx !== null) {
        state.selectedIntakeWaypoint = intakeIdx;
        state.isDraggingIntakePoint = true;
        canvas.style.cursor = 'move';
        return;
    }

    // Then check for heading handle (arrow tip)
    const headingIdx = findHeadingHandleAt(canvasX, canvasY);
    if (headingIdx !== null) {
        state.selectedWaypoint = headingIdx;
        state.isDraggingHeading = true;
        canvas.style.cursor = 'crosshair';
        return;
    }

    // Then check for waypoint body
    const wpIndex = findWaypointAt(canvasX, canvasY);
    if (wpIndex !== null) {
        state.selectedWaypoint = wpIndex;
        state.isDragging = true;
        canvas.style.cursor = 'grabbing';
    }
}

/**
 * Handle mouse move - drag waypoint, drag heading, drag intake point, or update display
 */
function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Update mouse position display
    const fieldPos = canvasToField(canvasX, canvasY);
    mousePosEl.textContent = `(${fieldPos.x.toFixed(2)}m, ${fieldPos.y.toFixed(2)}m)`;

    if (state.isDraggingIntakePoint && state.selectedIntakeWaypoint !== null) {
        // Update intake point position
        const wp = state.waypoints[state.selectedIntakeWaypoint];
        wp.intake_x = fieldPos.x;
        wp.intake_y = fieldPos.y;
        updateWaypointList();
        render();
    } else if (state.isDraggingHeading && state.selectedWaypoint !== null) {
        // Update heading based on mouse position relative to waypoint
        const wp = state.waypoints[state.selectedWaypoint];
        const wpCanvas = fieldToCanvas(wp.x, wp.y);

        const dx = canvasX - wpCanvas.x;
        const dy = canvasY - wpCanvas.y;

        // Calculate angle (heading=0 faces right/+x, canvas Y is inverted)
        wp.heading = -Math.atan2(dy, dx);

        // Normalize to [-pi, pi]
        while (wp.heading > Math.PI) wp.heading -= 2 * Math.PI;
        while (wp.heading < -Math.PI) wp.heading += 2 * Math.PI;

        updateWaypointList();
        render();
    } else if (state.isDragging && state.selectedWaypoint !== null) {
        // Update waypoint position
        state.waypoints[state.selectedWaypoint].x = fieldPos.x;
        state.waypoints[state.selectedWaypoint].y = fieldPos.y;
        updateWaypointList();
        render();
    } else {
        // Update cursor based on hover
        const intakeIdx = findIntakePointAt(canvasX, canvasY);
        const headingIdx = findHeadingHandleAt(canvasX, canvasY);
        const wpIndex = findWaypointAt(canvasX, canvasY);

        if (intakeIdx !== null) {
            canvas.style.cursor = 'move';
        } else if (headingIdx !== null) {
            canvas.style.cursor = 'crosshair';
        } else if (wpIndex !== null) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    }
}

/**
 * Handle mouse up - stop dragging
 */
function handleMouseUp() {
    // Track if we were dragging (to prevent click from creating waypoint)
    state.wasDragging = state.isDragging || state.isDraggingHeading || state.isDraggingIntakePoint;
    state.isDragging = false;
    state.isDraggingHeading = false;
    state.isDraggingIntakePoint = false;
    state.selectedWaypoint = null;
    state.selectedIntakeWaypoint = null;
    canvas.style.cursor = 'crosshair';
}

/**
 * Handle scroll wheel - rotate waypoint heading (legacy, still works)
 */
function handleWheel(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const wpIndex = findWaypointAt(canvasX, canvasY);
    if (wpIndex !== null) {
        // Rotate heading
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        state.waypoints[wpIndex].heading += delta;

        // Normalize to [-pi, pi]
        while (state.waypoints[wpIndex].heading > Math.PI) {
            state.waypoints[wpIndex].heading -= 2 * Math.PI;
        }
        while (state.waypoints[wpIndex].heading < -Math.PI) {
            state.waypoints[wpIndex].heading += 2 * Math.PI;
        }

        updateWaypointList();
        render();
    }
}

/**
 * Find waypoint at canvas position (body only, not heading handle)
 */
function findWaypointAt(canvasX, canvasY) {
    for (let i = state.waypoints.length - 1; i >= 0; i--) {
        const wp = state.waypoints[i];
        // Skip intake waypoints (their position is computed, not draggable)
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

/**
 * Find heading handle (arrow tip) at canvas position
 */
function findHeadingHandleAt(canvasX, canvasY) {
    for (let i = state.waypoints.length - 1; i >= 0; i--) {
        const wp = state.waypoints[i];
        // Skip unconstrained and intake waypoints (no heading handle)
        if (wp.type === 'unconstrained' || wp.type === 'intake') continue;

        const pos = fieldToCanvas(wp.x, wp.y);

        // Calculate heading handle position
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

/**
 * Find intake point marker at canvas position
 */
function findIntakePointAt(canvasX, canvasY) {
    for (let i = state.waypoints.length - 1; i >= 0; i--) {
        const wp = state.waypoints[i];
        // Only intake waypoints have intake point markers
        if (wp.type !== 'intake') continue;

        const intakePos = fieldToCanvas(wp.intake_x, wp.intake_y);

        const dx = canvasX - intakePos.x;
        const dy = canvasY - intakePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= 12) {  // Slightly larger hit area for the X marker
            return i;
        }
    }
    return null;
}

/**
 * Add a new waypoint
 * First and last waypoints default to stop=true, middle waypoints default to stop=false
 */
function addWaypoint(x, y, heading, stop, v_max = 3.0, omega_max = 10.0) {
    // If there's a previous waypoint that was the last, and it's not also the first,
    // it should no longer stop by default (it's now a middle waypoint)
    if (state.waypoints.length > 1) {
        const prevLastIdx = state.waypoints.length - 1;
        state.waypoints[prevLastIdx].stop = false;
    }

    // New waypoint is added as the last, so it should stop
    state.waypoints.push({
        x, y, heading, stop: true, v_max, omega_max,
        type: 'constrained',
        intake_x: x + 0.5,
        intake_y: y,
        intake_distance: 0.5,
        intake_velocity_max: 1.0,
        intake_velocity_slack: 0.1
    });
    updateWaypointList();
    render();
}

/**
 * Delete a waypoint
 * Updates stop flags to ensure first and last waypoints are stopped
 */
function deleteWaypoint(index) {
    state.waypoints.splice(index, 1);

    // Ensure first and last waypoints have stop=true
    if (state.waypoints.length > 0) {
        state.waypoints[0].stop = true;
        state.waypoints[state.waypoints.length - 1].stop = true;
    }

    updateWaypointList();
    render();
}

/**
 * Toggle waypoint stop flag
 */
function toggleWaypointStop(index) {
    state.waypoints[index].stop = !state.waypoints[index].stop;
    updateWaypointList();
    render();
}

/**
 * Update waypoint from input field
 */
function updateWaypointField(index, field, value) {
    if (field === 'type') {
        state.waypoints[index].type = value;
        updateWaypointList();
        render();
        return;
    }

    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;

    if (field === 'x') {
        state.waypoints[index].x = numValue;
    } else if (field === 'y') {
        state.waypoints[index].y = numValue;
    } else if (field === 'heading') {
        // Convert degrees to radians
        state.waypoints[index].heading = numValue * Math.PI / 180;
    } else if (field === 'v_max') {
        state.waypoints[index].v_max = Math.max(0.1, numValue);
    } else if (field === 'omega_max') {
        state.waypoints[index].omega_max = Math.max(0.1, numValue);
    } else if (field === 'intake_x') {
        state.waypoints[index].intake_x = numValue;
    } else if (field === 'intake_y') {
        state.waypoints[index].intake_y = numValue;
    } else if (field === 'intake_distance') {
        state.waypoints[index].intake_distance = Math.max(0.1, numValue);
    } else if (field === 'intake_velocity_max') {
        state.waypoints[index].intake_velocity_max = Math.max(0.1, numValue);
    } else if (field === 'intake_velocity_slack') {
        // Convert degrees to radians
        state.waypoints[index].intake_velocity_slack = Math.max(0, Math.min(90, numValue)) * Math.PI / 180;
    }

    render();
}

/**
 * Clear all waypoints
 */
function clearWaypoints() {
    state.waypoints = [];
    state.trajectory = null;
    updateWaypointList();
    updatePlaybackControls();
    render();
}

/**
 * Update the waypoint list UI with editable inputs
 */
function updateWaypointList() {
    waypointListEl.innerHTML = '';

    state.waypoints.forEach((wp, i) => {
        const div = document.createElement('div');
        div.className = 'waypoint-item';

        const headingDeg = (wp.heading * 180 / Math.PI).toFixed(1);
        const isLastWaypoint = i === state.waypoints.length - 1;

        // Ensure defaults for all fields
        if (wp.v_max === undefined) wp.v_max = 3.0;
        if (wp.omega_max === undefined) wp.omega_max = 10.0;
        if (wp.type === undefined) wp.type = 'constrained';
        if (wp.intake_x === undefined) wp.intake_x = wp.x + 0.5;
        if (wp.intake_y === undefined) wp.intake_y = wp.y;
        if (wp.intake_distance === undefined) wp.intake_distance = 0.5;
        if (wp.intake_velocity_max === undefined) wp.intake_velocity_max = 1.0;
        if (wp.intake_velocity_slack === undefined) wp.intake_velocity_slack = 0.1;

        // Velocity limits row (only for non-last waypoints since they define segment limits)
        const velocityRow = isLastWaypoint ? '' : `
            <div class="waypoint-inputs velocity-row">
                <div class="waypoint-input-group segment-label">Segment ${i + 1} → ${i + 2} limits:</div>
                <div class="waypoint-input-group">
                    <label>V max (m/s)</label>
                    <input type="number" step="0.1" min="0.1" value="${wp.v_max.toFixed(1)}" data-index="${i}" data-field="v_max">
                </div>
                <div class="waypoint-input-group">
                    <label>ω max (rad/s)</label>
                    <input type="number" step="0.5" min="0.1" value="${wp.omega_max.toFixed(1)}" data-index="${i}" data-field="omega_max">
                </div>
            </div>
        `;

        // Heading input - hide for unconstrained and intake types
        const headingInput = (wp.type === 'unconstrained' || wp.type === 'intake') ? '' : `
            <div class="waypoint-input-group">
                <label>Heading (°)</label>
                <input type="number" step="1" value="${headingDeg}" data-index="${i}" data-field="heading">
            </div>
        `;

        // Position inputs - hide for intake type (position is computed from constraints)
        const positionInputs = wp.type === 'intake' ? '' : `
            <div class="waypoint-input-group">
                <label>X (m)</label>
                <input type="number" step="0.01" value="${wp.x.toFixed(2)}" data-index="${i}" data-field="x">
            </div>
            <div class="waypoint-input-group">
                <label>Y (m)</label>
                <input type="number" step="0.01" value="${wp.y.toFixed(2)}" data-index="${i}" data-field="y">
            </div>
        `;

        // Intake inputs - only show for intake type
        const slackDeg = (wp.intake_velocity_slack * 180 / Math.PI).toFixed(1);
        const intakeInputs = wp.type === 'intake' ? `
            <div class="waypoint-inputs intake-row">
                <div class="waypoint-input-group segment-label">Intake point:</div>
                <div class="waypoint-input-group">
                    <label>Intake X (m)</label>
                    <input type="number" step="0.01" value="${wp.intake_x.toFixed(2)}" data-index="${i}" data-field="intake_x">
                </div>
                <div class="waypoint-input-group">
                    <label>Intake Y (m)</label>
                    <input type="number" step="0.01" value="${wp.intake_y.toFixed(2)}" data-index="${i}" data-field="intake_y">
                </div>
                <div class="waypoint-input-group">
                    <label>Distance (m)</label>
                    <input type="number" step="0.05" min="0.1" value="${wp.intake_distance.toFixed(2)}" data-index="${i}" data-field="intake_distance">
                </div>
            </div>
            <div class="waypoint-inputs intake-row">
                <div class="waypoint-input-group segment-label">Velocity constraints:</div>
                <div class="waypoint-input-group">
                    <label>Max V (m/s)</label>
                    <input type="number" step="0.1" min="0.1" value="${wp.intake_velocity_max.toFixed(1)}" data-index="${i}" data-field="intake_velocity_max">
                </div>
                <div class="waypoint-input-group">
                    <label>Slack (°)</label>
                    <input type="number" step="1" min="0" max="90" value="${slackDeg}" data-index="${i}" data-field="intake_velocity_slack">
                </div>
            </div>
        ` : '';

        // Position/heading row - only show if there are inputs (not for intake waypoints)
        const positionHeadingRow = (positionInputs || headingInput) ? `
            <div class="waypoint-inputs">
                ${positionInputs}
                ${headingInput}
            </div>
        ` : '';

        div.innerHTML = `
            <div class="waypoint-header">
                <span class="index">${i + 1}</span>
                <select class="type-select" data-index="${i}">
                    <option value="constrained" ${wp.type === 'constrained' ? 'selected' : ''}>Constrained</option>
                    <option value="unconstrained" ${wp.type === 'unconstrained' ? 'selected' : ''}>Unconstrained</option>
                    <option value="intake" ${wp.type === 'intake' ? 'selected' : ''}>Intake</option>
                </select>
                <label class="stop-toggle">
                    <input type="checkbox" ${wp.stop ? 'checked' : ''} data-index="${i}">
                    Stop
                </label>
                <button class="delete-btn" data-index="${i}">×</button>
            </div>
            ${positionHeadingRow}
            ${intakeInputs}
            ${velocityRow}
        `;

        // Event listeners
        div.querySelector('.delete-btn').addEventListener('click', () => deleteWaypoint(i));
        div.querySelector('input[type="checkbox"]').addEventListener('change', () => toggleWaypointStop(i));
        div.querySelector('.type-select').addEventListener('change', (e) => {
            updateWaypointField(i, 'type', e.target.value);
        });

        // Input field listeners
        div.querySelectorAll('.waypoint-input-group input[type="number"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const field = e.target.dataset.field;
                updateWaypointField(idx, field, e.target.value);
            });
            // Update on blur too
            input.addEventListener('blur', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const field = e.target.dataset.field;
                updateWaypointField(idx, field, e.target.value);
            });
        });

        waypointListEl.appendChild(div);
    });
}

/**
 * Render the canvas
 */
function render() {
    // Clear canvas
    ctx.fillStyle = '#2a2a4a';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw background image if present
    if (state.backgroundImage) {
        drawBackgroundImage();
    }

    // Draw grid
    drawGrid();

    // Draw trajectory if available
    if (state.trajectory) {
        drawTrajectory();
    }

    // Draw waypoints
    drawWaypoints();

    // Draw robot at current playback position
    if (state.trajectory) {
        drawRobotAtTime(state.playbackTime);
    }
}

/**
 * Draw background image with transforms
 */
function drawBackgroundImage() {
    const img = state.backgroundImage;
    const settings = state.backgroundSettings;

    ctx.save();

    // Set opacity
    ctx.globalAlpha = settings.opacity;

    // Move to center of canvas
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);

    // Apply rotation
    ctx.rotate(settings.rotation * Math.PI / 180);

    // Apply mirroring
    const scaleX = settings.mirrorH ? -1 : 1;
    const scaleY = settings.mirrorV ? -1 : 1;
    ctx.scale(scaleX * settings.scale, scaleY * settings.scale);

    // Draw image centered
    const imgW = img.width || CANVAS_SIZE;
    const imgH = img.height || CANVAS_SIZE;

    // Scale image to fit canvas while maintaining aspect ratio
    const canvasAspect = 1; // CANVAS_SIZE / CANVAS_SIZE
    const imgAspect = imgW / imgH;

    let drawW, drawH;
    if (imgAspect > canvasAspect) {
        drawW = CANVAS_SIZE;
        drawH = CANVAS_SIZE / imgAspect;
    } else {
        drawH = CANVAS_SIZE;
        drawW = CANVAS_SIZE * imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

    ctx.restore();
}

/**
 * Draw field grid
 */
function drawGrid() {
    ctx.strokeStyle = '#3a3a5a';
    ctx.lineWidth = 1;

    // Calculate grid spacing (aim for ~10-20 lines)
    let gridSpacingM = 0.5;
    if (FIELD_SIZE > 10) gridSpacingM = 1.0;
    if (FIELD_SIZE > 15) gridSpacingM = 2.0;
    if (FIELD_SIZE < 2) gridSpacingM = 0.25;

    const gridSpacing = gridSpacingM * SCALE;
    const numLines = Math.ceil(FIELD_SIZE / gridSpacingM);

    for (let i = 0; i <= numLines; i++) {
        const pos = i * gridSpacing;
        if (pos > CANVAS_SIZE) break;

        // Vertical lines
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, CANVAS_SIZE);
        ctx.stroke();

        // Horizontal lines
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(CANVAS_SIZE, pos);
        ctx.stroke();
    }

    // Draw center lines
    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;

    // Center cross
    ctx.beginPath();
    ctx.moveTo(CANVAS_SIZE / 2, 0);
    ctx.lineTo(CANVAS_SIZE / 2, CANVAS_SIZE);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, CANVAS_SIZE / 2);
    ctx.lineTo(CANVAS_SIZE, CANVAS_SIZE / 2);
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.fillText('0', 5, CANVAS_SIZE - 5);
    ctx.fillText(`${FIELD_SIZE.toFixed(1)}m`, CANVAS_SIZE - 40, CANVAS_SIZE - 5);
    ctx.fillText(`${FIELD_SIZE.toFixed(1)}m`, 5, 15);
}

/**
 * Draw waypoints with draggable heading handles
 */
function drawWaypoints() {
    state.waypoints.forEach((wp, i) => {
        const pos = fieldToCanvas(wp.x, wp.y);

        // Ensure defaults
        if (wp.type === undefined) wp.type = 'constrained';

        // For intake waypoints, draw only the intake point and distance circle (no waypoint circle/heading)
        if (wp.type === 'intake') {
            const intakePos = fieldToCanvas(wp.intake_x, wp.intake_y);
            const distPixels = wp.intake_distance * SCALE;

            // Draw dashed distance circle around intake point
            ctx.beginPath();
            ctx.arc(intakePos.x, intakePos.y, distPixels, 0, 2 * Math.PI);
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#888888';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw intake point marker (X shape)
            const markerSize = 8;
            ctx.beginPath();
            ctx.moveTo(intakePos.x - markerSize, intakePos.y - markerSize);
            ctx.lineTo(intakePos.x + markerSize, intakePos.y + markerSize);
            ctx.moveTo(intakePos.x + markerSize, intakePos.y - markerSize);
            ctx.lineTo(intakePos.x - markerSize, intakePos.y + markerSize);
            ctx.strokeStyle = wp.stop ? '#ffffff' : '#c0c0c0';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Draw index number at intake point
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), intakePos.x, intakePos.y - markerSize - 10);

            // Skip drawing waypoint circle and heading for intake waypoints
            return;
        }

        // Draw waypoint circle (not for intake waypoints)
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS, 0, 2 * Math.PI);

        if (wp.type === 'unconstrained') {
            // Hollow circle for unconstrained waypoints
            ctx.fillStyle = 'transparent';
            ctx.strokeStyle = wp.stop ? '#ffffff' : '#c0c0c0';
            ctx.lineWidth = 3;
            ctx.stroke();
        } else {
            // Filled circle for constrained waypoints
            if (wp.stop) {
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.fillStyle = '#c0c0c0';
            }
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Draw heading indicator line (only for constrained type, not intake or unconstrained)
        if (wp.type === 'constrained') {
            const headingEndX = pos.x + Math.cos(-wp.heading) * HEADING_LINE_LENGTH;
            const headingEndY = pos.y + Math.sin(-wp.heading) * HEADING_LINE_LENGTH;

            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(headingEndX, headingEndY);
            ctx.strokeStyle = '#888888';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Draw draggable handle at arrow tip
            ctx.beginPath();
            ctx.arc(headingEndX, headingEndY, HEADING_HANDLE_RADIUS, 0, 2 * Math.PI);
            ctx.fillStyle = '#888888';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw arrowhead on the line (before the handle)
            const arrowDist = HEADING_LINE_LENGTH - HEADING_HANDLE_RADIUS - 2;
            const arrowTipX = pos.x + Math.cos(-wp.heading) * arrowDist;
            const arrowTipY = pos.y + Math.sin(-wp.heading) * arrowDist;
            const arrowSize = 6;
            const arrowAngle = -wp.heading;

            ctx.beginPath();
            ctx.moveTo(arrowTipX, arrowTipY);
            ctx.lineTo(
                arrowTipX - arrowSize * Math.cos(arrowAngle - 0.5),
                arrowTipY - arrowSize * Math.sin(arrowAngle - 0.5)
            );
            ctx.moveTo(arrowTipX, arrowTipY);
            ctx.lineTo(
                arrowTipX - arrowSize * Math.cos(arrowAngle + 0.5),
                arrowTipY - arrowSize * Math.sin(arrowAngle + 0.5)
            );
            ctx.strokeStyle = '#888888';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Draw index number
        ctx.fillStyle = wp.type === 'unconstrained' ? '#ffffff' : '#1a1a2e';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), pos.x, pos.y);
    });
}

/**
 * Draw the trajectory path
 */
function drawTrajectory() {
    if (!state.trajectory || state.trajectory.states.length < 2) return;

    const states = state.trajectory.states;

    // Draw path
    ctx.beginPath();
    const firstPos = fieldToCanvas(states[0][3], states[0][4]);
    ctx.moveTo(firstPos.x, firstPos.y);

    for (let i = 1; i < states.length; i++) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        ctx.lineTo(pos.x, pos.y);
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw robot poses at intervals
    const poseInterval = Math.max(1, Math.floor(states.length / 20));
    for (let i = 0; i < states.length; i += poseInterval) {
        drawRobotPose(states[i][3], states[i][4], states[i][5], 0.3);
    }

    // Draw velocity vectors at intervals
    const velInterval = Math.max(1, Math.floor(states.length / 15));
    for (let i = 0; i < states.length; i += velInterval) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        const vx = states[i][0];
        const vy = states[i][1];
        const velScale = 20; // pixels per m/s

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + vx * velScale, pos.y - vy * velScale);
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

/**
 * Draw a robot pose outline
 */
function drawRobotPose(x, y, theta, alpha = 1.0) {
    const pos = fieldToCanvas(x, y);
    const halfW = ROBOT_WIDTH * SCALE / 2;
    const halfL = ROBOT_LENGTH * SCALE / 2;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(-theta);  // heading=0 faces right (+x)

    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-halfL, -halfW, ROBOT_LENGTH * SCALE, ROBOT_WIDTH * SCALE);

    // Draw front indicator (on +x side, which is right when theta=0)
    ctx.beginPath();
    ctx.moveTo(halfL, -halfW * 0.5);
    ctx.lineTo(halfL + 5, 0);
    ctx.lineTo(halfL, halfW * 0.5);
    ctx.stroke();

    ctx.restore();
}

/**
 * Draw robot at specific time during playback
 */
function drawRobotAtTime(time) {
    if (!state.trajectory) return;

    const times = state.trajectory.times;
    const states = state.trajectory.states;

    // Find the state at this time (linear interpolation)
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

    // Interpolate state
    const px = s0[3] + alpha * (s1[3] - s0[3]);
    const py = s0[4] + alpha * (s1[4] - s0[4]);
    const theta = s0[5] + alpha * (s1[5] - s0[5]);

    // Draw filled robot
    const pos = fieldToCanvas(px, py);
    const halfW = ROBOT_WIDTH * SCALE / 2;
    const halfL = ROBOT_LENGTH * SCALE / 2;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(-theta);  // heading=0 faces right (+x)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(-halfL, -halfW, ROBOT_LENGTH * SCALE, ROBOT_WIDTH * SCALE);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-halfL, -halfW, ROBOT_LENGTH * SCALE, ROBOT_WIDTH * SCALE);

    // Draw front indicator (on +x side, which is right when theta=0)
    ctx.beginPath();
    ctx.moveTo(halfL, -halfW * 0.5);
    ctx.lineTo(halfL + 8, 0);
    ctx.lineTo(halfL, halfW * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#888888';
    ctx.fill();

    ctx.restore();
}

/**
 * Get robot parameters from form
 */
function getRobotParams() {
    return {
        mass: parseFloat(document.getElementById('param-mass').value),
        inertia: parseFloat(document.getElementById('param-inertia').value),
        wheel_radius: parseFloat(document.getElementById('param-wheel-radius').value),
        lx: parseFloat(document.getElementById('param-lx').value),
        ly: parseFloat(document.getElementById('param-ly').value),
        w_max: parseFloat(document.getElementById('param-wmax').value),
        t_max: parseFloat(document.getElementById('param-tmax').value),
        f_traction_max: parseFloat(document.getElementById('param-ftraction').value)
    };
}

/**
 * Solve for trajectory
 */
async function solve() {
    if (state.waypoints.length < 2) {
        showStatus('Need at least 2 waypoints', 'error');
        return;
    }

    showStatus('Solving...', 'loading');
    solveBtn.disabled = true;

    const request = {
        waypoints: state.waypoints,
        robot_params: getRobotParams(),
        samples_per_meter: parseFloat(samplesPerMeterInput.value) || 20.0,
        min_samples_per_segment: parseInt(minSamplesPerSegmentInput.value) || 3
    };

    try {
        const response = await fetch('/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });

        const result = await response.json();

        if (response.ok) {
            state.trajectory = result.trajectory;
            state.trajectory.totalTime = result.total_time;

            if (result.success) {
                showStatus('Solution found!', 'success');
            } else {
                showStatus('Solver did not converge (showing debug)', 'error');
            }

            showResults(result);
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

/**
 * Show solve status
 */
function showStatus(message, type) {
    solveStatusEl.textContent = message;
    solveStatusEl.className = `status ${type}`;
}

/**
 * Show solve results
 */
function showResults(result) {
    solveResultsEl.innerHTML = `
        <div class="result-item">
            <span class="result-label">Total time:</span>
            <span class="result-value">${result.total_time.toFixed(3)}s</span>
        </div>
        <div class="result-item">
            <span class="result-label">Solve time:</span>
            <span class="result-value">${result.solver_stats.solve_time_ms.toFixed(1)}ms</span>
        </div>
        <div class="result-item">
            <span class="result-label">Iterations:</span>
            <span class="result-value">${result.solver_stats.iterations}</span>
        </div>
    `;
}

/**
 * Update playback controls based on trajectory availability
 */
function updatePlaybackControls() {
    const hasTrajectory = state.trajectory !== null;
    playBtn.disabled = !hasTrajectory;
    resetBtn.disabled = !hasTrajectory;
    timeSlider.disabled = !hasTrajectory;

    if (hasTrajectory) {
        timeSlider.max = 1000;
        timeSlider.value = 0;
        state.playbackTime = 0;
        timeDisplay.textContent = '0.00s';
    }
}

/**
 * Toggle playback
 * If at the end, reset to the beginning before playing
 */
function togglePlayback() {
    if (state.isPlaying) {
        stopPlayback();
    } else {
        // If at the end of playback, reset to beginning first
        if (state.trajectory && state.playbackTime >= state.trajectory.totalTime) {
            state.playbackTime = 0;
            timeSlider.value = 0;
            timeDisplay.textContent = '0.00s';
        }
        startPlayback();
    }
}

/**
 * Start playback
 */
function startPlayback() {
    if (!state.trajectory) return;

    state.isPlaying = true;
    playBtn.textContent = 'Pause';

    const totalTime = state.trajectory.totalTime;
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

        // Update slider and display
        const progress = state.playbackTime / totalTime;
        timeSlider.value = Math.round(progress * 1000);
        timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';

        render();

        if (state.isPlaying) {
            state.animationId = requestAnimationFrame(animate);
        }
    }

    state.animationId = requestAnimationFrame(animate);
}

/**
 * Stop playback
 */
function stopPlayback() {
    state.isPlaying = false;
    playBtn.textContent = 'Play';
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }
    render();
}

/**
 * Reset playback to beginning
 */
function resetPlayback() {
    stopPlayback();
    state.playbackTime = 0;
    timeSlider.value = 0;
    timeDisplay.textContent = '0.00s';
    render();
}

/**
 * Handle time slider change
 */
function handleSliderChange(e) {
    if (!state.trajectory) return;

    const progress = e.target.value / 1000;
    state.playbackTime = progress * state.trajectory.totalTime;
    timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';

    if (!state.isPlaying) {
        render();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
