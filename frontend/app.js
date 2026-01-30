/**
 * Mecanum Trajectory Optimizer - Frontend Application
 *
 * Interactive canvas for waypoint placement and trajectory visualization.
 * Choreo-style UI with timeline and modern controls.
 */

// Field and canvas dimensions
let FIELD_SIZE = 3.66; // meters (configurable)
const CANVAS_SIZE = 800; // pixels
let SCALE = CANVAS_SIZE / FIELD_SIZE; // pixels per meter

// Robot dimensions for visualization
const ROBOT_WIDTH = 0.35; // meters
const ROBOT_LENGTH = 0.35; // meters

// Waypoint visualization
const WAYPOINT_RADIUS = 18; // pixels
const HEADING_LINE_LENGTH = 35; // pixels
const HEADING_HANDLE_RADIUS = 10; // pixels for the draggable arrow tip

// Application state
const state = {
    waypoints: [],
    trajectory: null,
    selectedWaypoint: null,
    isDragging: false,
    isDraggingHeading: false,
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
let playBtn, timeSlider, timeDisplay, totalTimeDisplay;
let fieldSizeInput, bgImageInput, bgControls;
let bgScaleSlider, bgRotationSlider, bgOpacitySlider;
let bgMirrorH, bgMirrorV;
let stepsPerSegmentInput;
let coordXEl, coordYEl, coordThetaEl;
let timelineProgress, timelineScrubber, timelineMarkers;

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
    timeSlider = document.getElementById('time-slider');
    timeDisplay = document.getElementById('time-display');
    totalTimeDisplay = document.getElementById('total-time');

    // Coordinate display
    coordXEl = document.getElementById('coord-x');
    coordYEl = document.getElementById('coord-y');
    coordThetaEl = document.getElementById('coord-theta');

    // Timeline elements
    timelineProgress = document.getElementById('timeline-progress');
    timelineScrubber = document.getElementById('timeline-scrubber');
    timelineMarkers = document.getElementById('timeline-markers');

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
    stepsPerSegmentInput = document.getElementById('steps-per-segment');

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
    playBtn.addEventListener('click', togglePlayback);
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
    document.querySelectorAll('.sidebar-section.collapsible .section-header').forEach(header => {
        header.addEventListener('click', () => {
            header.closest('.sidebar-section').classList.toggle('collapsed');
        });
    });

    // Initial render
    render();
    updateWaypointList();
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
    document.getElementById('bg-image-name').textContent = 'None';
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
    document.getElementById('bg-rotation-value').textContent = state.backgroundSettings.rotation + '\u00B0';
    document.getElementById('bg-opacity-value').textContent = state.backgroundSettings.opacity.toFixed(2);

    render();
}

/**
 * Handle canvas click - add new waypoint
 */
function handleCanvasClick(e) {
    // Don't create waypoint if we just finished dragging
    if (state.isDragging || state.isDraggingHeading || state.wasDragging) {
        state.wasDragging = false;
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Check if clicking on existing waypoint or heading handle
    const clickedWp = findWaypointAt(canvasX, canvasY);
    const clickedHeading = findHeadingHandleAt(canvasX, canvasY);
    if (clickedWp !== null || clickedHeading !== null) return;

    // Add new waypoint
    // First and last waypoints should stop by default, middle ones should not
    const fieldPos = canvasToField(canvasX, canvasY);
    const isFirstWaypoint = state.waypoints.length === 0;
    addWaypoint(fieldPos.x, fieldPos.y, 0, isFirstWaypoint);
}

/**
 * Handle mouse down - start dragging waypoint or heading
 */
function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);

    // First check for heading handle (arrow tip)
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
        highlightWaypoint(wpIndex);
    }
}

/**
 * Handle mouse move - drag waypoint, drag heading, or update display
 */
function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Update coordinate display
    const fieldPos = canvasToField(canvasX, canvasY);
    updateCoordinateDisplay(fieldPos.x, fieldPos.y, null);

    if (state.isDraggingHeading && state.selectedWaypoint !== null) {
        // Update heading based on mouse position relative to waypoint
        const wp = state.waypoints[state.selectedWaypoint];
        const wpCanvas = fieldToCanvas(wp.x, wp.y);

        const dx = canvasX - wpCanvas.x;
        const dy = canvasY - wpCanvas.y;

        // Calculate angle (canvas Y is inverted, and we want 0 = up)
        wp.heading = Math.atan2(-dx, -dy) + Math.PI;

        // Normalize to [-pi, pi]
        while (wp.heading > Math.PI) wp.heading -= 2 * Math.PI;
        while (wp.heading < -Math.PI) wp.heading += 2 * Math.PI;

        updateCoordinateDisplay(wp.x, wp.y, wp.heading * 180 / Math.PI);
        updateWaypointList();
        render();
    } else if (state.isDragging && state.selectedWaypoint !== null) {
        // Update waypoint position
        state.waypoints[state.selectedWaypoint].x = fieldPos.x;
        state.waypoints[state.selectedWaypoint].y = fieldPos.y;
        const wp = state.waypoints[state.selectedWaypoint];
        updateCoordinateDisplay(wp.x, wp.y, wp.heading * 180 / Math.PI);
        updateWaypointList();
        render();
    } else {
        // Update cursor based on hover
        const headingIdx = findHeadingHandleAt(canvasX, canvasY);
        const wpIndex = findWaypointAt(canvasX, canvasY);

        if (headingIdx !== null) {
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
    state.wasDragging = state.isDragging || state.isDraggingHeading;
    state.isDragging = false;
    state.isDraggingHeading = false;
    state.selectedWaypoint = null;
    canvas.style.cursor = 'crosshair';
}

/**
 * Handle scroll wheel - rotate waypoint heading (legacy, still works)
 */
function handleWheel(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);

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
        const pos = fieldToCanvas(wp.x, wp.y);

        // Calculate heading handle position
        const handleX = pos.x + Math.cos(-wp.heading + Math.PI / 2) * HEADING_LINE_LENGTH;
        const handleY = pos.y + Math.sin(-wp.heading + Math.PI / 2) * HEADING_LINE_LENGTH;

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
 * Update coordinate display in toolbar
 */
function updateCoordinateDisplay(x, y, theta) {
    if (coordXEl) coordXEl.value = x.toFixed(2);
    if (coordYEl) coordYEl.value = y.toFixed(2);
    if (coordThetaEl && theta !== null) coordThetaEl.value = theta.toFixed(0);
}

/**
 * Highlight a waypoint in the list
 */
function highlightWaypoint(index) {
    document.querySelectorAll('.waypoint-item').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });
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
    state.waypoints.push({ x, y, heading, stop: true, v_max, omega_max });
    updateWaypointList();
    updateTimelineMarkers();
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
    updateTimelineMarkers();
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
    updateTimelineMarkers();
    updatePlaybackControls();
    render();
}

/**
 * Update the waypoint list UI (Choreo-style)
 */
function updateWaypointList() {
    waypointListEl.innerHTML = '';

    if (state.waypoints.length === 0) {
        waypointListEl.innerHTML = '<div class="empty-message">Click on canvas to add waypoints</div>';
        return;
    }

    state.waypoints.forEach((wp, i) => {
        const div = document.createElement('div');
        div.className = 'waypoint-item';
        div.dataset.index = i;

        const iconClass = wp.stop ? 'stop' : 'pass';

        div.innerHTML = `
            <span class="waypoint-icon ${iconClass}">${wp.stop ? '+' : '\u2192'}</span>
            <span class="waypoint-name">Pose Waypoint</span>
            <span class="waypoint-index">${i + 1}</span>
            <button class="icon-btn small delete-wp" title="Delete">&#x1F5D1;</button>
        `;

        // Event listeners
        div.querySelector('.delete-wp').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteWaypoint(i);
        });

        div.addEventListener('click', () => {
            highlightWaypoint(i);
            // Center view on waypoint (optional)
            const wp = state.waypoints[i];
            updateCoordinateDisplay(wp.x, wp.y, wp.heading * 180 / Math.PI);
        });

        waypointListEl.appendChild(div);
    });
}

/**
 * Update timeline markers based on waypoints
 */
function updateTimelineMarkers() {
    if (!timelineMarkers) return;

    timelineMarkers.innerHTML = '';

    if (!state.trajectory || state.waypoints.length === 0) {
        // Just show evenly spaced markers for waypoints
        state.waypoints.forEach((wp, i) => {
            const marker = document.createElement('div');
            marker.className = 'timeline-marker';
            const percent = state.waypoints.length > 1
                ? (i / (state.waypoints.length - 1)) * 100
                : 50;
            marker.style.left = `${percent}%`;
            timelineMarkers.appendChild(marker);
        });
        return;
    }

    // With trajectory, place markers at actual time positions
    const totalTime = state.trajectory.totalTime;
    const times = state.trajectory.times;
    const states = state.trajectory.states;

    // Find times closest to waypoints
    state.waypoints.forEach((wp, i) => {
        const marker = document.createElement('div');
        marker.className = 'timeline-marker';

        // Estimate waypoint time based on segment
        let wpTime = 0;
        if (i > 0 && state.waypoints.length > 1) {
            // Approximate - in reality we'd track actual waypoint times
            wpTime = (i / (state.waypoints.length - 1)) * totalTime;
        }

        const percent = (wpTime / totalTime) * 100;
        marker.style.left = `${Math.min(100, Math.max(0, percent))}%`;
        timelineMarkers.appendChild(marker);
    });
}

/**
 * Render the canvas
 */
function render() {
    // Clear canvas
    ctx.fillStyle = '#1a1a28';
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
    if (state.trajectory && (state.isPlaying || state.playbackTime > 0)) {
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
    ctx.strokeStyle = '#2a2a42';
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
    ctx.strokeStyle = '#3a3a58';
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
    ctx.fillStyle = '#505068';
    ctx.font = '12px monospace';
    ctx.fillText('0', 5, CANVAS_SIZE - 5);
    ctx.fillText(`${FIELD_SIZE.toFixed(1)}m`, CANVAS_SIZE - 45, CANVAS_SIZE - 5);
    ctx.fillText(`${FIELD_SIZE.toFixed(1)}m`, 5, 15);
}

/**
 * Draw waypoints with draggable heading handles
 */
function drawWaypoints() {
    state.waypoints.forEach((wp, i) => {
        const pos = fieldToCanvas(wp.x, wp.y);

        // Draw connection line to next waypoint
        if (i < state.waypoints.length - 1) {
            const nextWp = state.waypoints[i + 1];
            const nextPos = fieldToCanvas(nextWp.x, nextWp.y);

            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(nextPos.x, nextPos.y);
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw waypoint circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS, 0, 2 * Math.PI);

        if (wp.stop) {
            ctx.fillStyle = '#6366f1'; // Purple for stop
        } else {
            ctx.fillStyle = '#22c55e'; // Green for pass-through
        }
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw heading indicator line
        const headingEndX = pos.x + Math.cos(-wp.heading + Math.PI / 2) * HEADING_LINE_LENGTH;
        const headingEndY = pos.y + Math.sin(-wp.heading + Math.PI / 2) * HEADING_LINE_LENGTH;

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(headingEndX, headingEndY);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw draggable handle at arrow tip
        ctx.beginPath();
        ctx.arc(headingEndX, headingEndY, HEADING_HANDLE_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw arrowhead on the line (before the handle)
        const arrowDist = HEADING_LINE_LENGTH - HEADING_HANDLE_RADIUS - 2;
        const arrowTipX = pos.x + Math.cos(-wp.heading + Math.PI / 2) * arrowDist;
        const arrowTipY = pos.y + Math.sin(-wp.heading + Math.PI / 2) * arrowDist;
        const arrowSize = 7;
        const arrowAngle = -wp.heading + Math.PI / 2;

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
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw index number
        ctx.fillStyle = '#fff';
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

    // Draw path with gradient
    ctx.beginPath();
    const firstPos = fieldToCanvas(states[0][3], states[0][4]);
    ctx.moveTo(firstPos.x, firstPos.y);

    for (let i = 1; i < states.length; i++) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        ctx.lineTo(pos.x, pos.y);
    }

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw robot poses at intervals
    const poseInterval = Math.max(1, Math.floor(states.length / 25));
    for (let i = 0; i < states.length; i += poseInterval) {
        drawRobotPose(states[i][3], states[i][4], states[i][5], 0.4);
    }

    // Draw velocity vectors at intervals
    const velInterval = Math.max(1, Math.floor(states.length / 15));
    for (let i = 0; i < states.length; i += velInterval) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        const vx = states[i][0];
        const vy = states[i][1];
        const velScale = 25; // pixels per m/s

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + vx * velScale, pos.y - vy * velScale);
        ctx.strokeStyle = '#ef4444';
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
    ctx.rotate(-theta + Math.PI / 2);

    ctx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-halfW, -halfL, ROBOT_WIDTH * SCALE, ROBOT_LENGTH * SCALE);

    // Draw front indicator
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.5, -halfL);
    ctx.lineTo(0, -halfL - 6);
    ctx.lineTo(halfW * 0.5, -halfL);
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
    ctx.rotate(-theta + Math.PI / 2);

    ctx.fillStyle = 'rgba(99, 102, 241, 0.8)';
    ctx.fillRect(-halfW, -halfL, ROBOT_WIDTH * SCALE, ROBOT_LENGTH * SCALE);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-halfW, -halfL, ROBOT_WIDTH * SCALE, ROBOT_LENGTH * SCALE);

    // Draw front indicator
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.5, -halfL);
    ctx.lineTo(0, -halfL - 10);
    ctx.lineTo(halfW * 0.5, -halfL);
    ctx.closePath();
    ctx.fillStyle = '#f59e0b';
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
        n_per_segment: parseInt(stepsPerSegmentInput.value) || 20
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
            updateTimelineMarkers();
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
    timeSlider.disabled = !hasTrajectory;

    if (hasTrajectory) {
        timeSlider.max = 1000;
        timeSlider.value = 0;
        state.playbackTime = 0;
        timeDisplay.textContent = '0.0 s';
        totalTimeDisplay.textContent = state.trajectory.totalTime.toFixed(1) + ' s';
        updateTimelineProgress(0);
    } else {
        timeDisplay.textContent = '0.0 s';
        totalTimeDisplay.textContent = '0.0 s';
    }
}

/**
 * Update timeline progress bar and scrubber
 */
function updateTimelineProgress(progress) {
    if (timelineProgress) {
        timelineProgress.style.width = `${progress * 100}%`;
    }
    if (timelineScrubber) {
        timelineScrubber.style.left = `${progress * 100}%`;
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
            timeDisplay.textContent = '0.0 s';
            updateTimelineProgress(0);
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
    playBtn.classList.add('playing');
    playBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="2" width="4" height="10"/>
            <rect x="8" y="2" width="4" height="10"/>
        </svg>
    `;

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
        timeDisplay.textContent = state.playbackTime.toFixed(1) + ' s';
        updateTimelineProgress(progress);

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
    playBtn.classList.remove('playing');
    playBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M3 1 L3 13 L12 7 Z"/>
        </svg>
    `;
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
    timeDisplay.textContent = '0.0 s';
    updateTimelineProgress(0);
    render();
}

/**
 * Handle time slider change
 */
function handleSliderChange(e) {
    if (!state.trajectory) return;

    const progress = e.target.value / 1000;
    state.playbackTime = progress * state.trajectory.totalTime;
    timeDisplay.textContent = state.playbackTime.toFixed(1) + ' s';
    updateTimelineProgress(progress);

    if (!state.isPlaying) {
        render();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
