/**
 * Mecanum Trajectory Optimizer - Main Application Entry Point
 *
 * This file initializes all modules and sets up the application.
 */

import { state } from './state.js';
import { initCanvas, canvas, resizeCanvas, zoom, fitToView } from './canvas.js';
import { initTrajectories, createTrajectory } from './trajectories.js';
import { initTrajectoryList, updateTrajectoryList } from './trajectoryList.js';
import { initWaypoints, updateWaypointList, clearWaypoints } from './waypoints.js';
import { initConstraints, updateConstraintList, clearConstraints } from './constraints.js';
import { render } from './rendering.js';
import {
    initEvents, handleCanvasClick, handleMouseDown, handleMouseMove,
    handleMouseUp, handleWheel, handleKeyDown
} from './events.js';
import {
    initSolver, solve, updateSolverSettingsFromActiveTrajectory,
    getDefaultIntakeDistance, getDefaultIntakeVelocity, showStatus
} from './solver.js';
import {
    initPlayback, updatePlaybackControls, togglePlayback, toggleChainPlayback,
    resetPlayback, handleSliderChange, stopPlayback, stopChainPlayback
} from './playback.js';
import {
    initProject, markUnsaved, updateProjectNameDisplay, showOpenModal, showSaveModal,
    saveProject, newProject, showSyncModal, syncToAndroid
} from './project.js';
import {
    initBackground, handleBackgroundImageSelect, clearBackgroundImage, handleBgSettingChange,
    handleFieldSizeChange
} from './background.js';

// Tool buttons
let toolButtons = null;

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

function initPanelResize() {
    const handles = document.querySelectorAll('.panel-resize-handle');
    let activeHandle = null;
    let startY = 0;
    let aboveSection = null;
    let belowSection = null;
    let aboveStartHeight = 0;
    let belowStartHeight = 0;

    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            activeHandle = handle;
            startY = e.clientY;
            aboveSection = handle.previousElementSibling;
            belowSection = handle.nextElementSibling;
            aboveStartHeight = aboveSection.getBoundingClientRect().height;
            belowStartHeight = belowSection.getBoundingClientRect().height;
            handle.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });
    });

    document.addEventListener('mousemove', (e) => {
        if (!activeHandle) return;
        const dy = e.clientY - startY;
        const minHeight = 48;

        let newAboveHeight = aboveStartHeight + dy;
        let newBelowHeight = belowStartHeight - dy;

        if (newAboveHeight < minHeight) {
            newAboveHeight = minHeight;
            newBelowHeight = aboveStartHeight + belowStartHeight - minHeight;
        }
        if (newBelowHeight < minHeight) {
            newBelowHeight = minHeight;
            newAboveHeight = aboveStartHeight + belowStartHeight - minHeight;
        }

        aboveSection.style.flex = `0 0 ${newAboveHeight}px`;
        belowSection.style.flex = `0 0 ${newBelowHeight}px`;
    });

    document.addEventListener('mouseup', () => {
        if (activeHandle) {
            activeHandle.classList.remove('dragging');
            activeHandle = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

function init() {
    // Initialize canvas
    initCanvas();

    // Get DOM elements
    const trajectoryListEl = document.getElementById('trajectory-list');
    const trajectoryCountEl = document.getElementById('trajectory-count');
    const addTrajectoryBtn = document.getElementById('add-trajectory');

    const waypointListEl = document.getElementById('waypoint-list');
    const waypointCountEl = document.getElementById('waypoint-count');

    const constraintListEl = document.getElementById('constraint-list');
    const constraintCountEl = document.getElementById('constraint-count');

    const solveBtn = document.getElementById('solve-btn');
    const solveStatusInline = document.getElementById('solve-status-inline');
    const solveStatusEl = document.getElementById('solve-status');
    const solveResultsEl = document.getElementById('solve-results');
    const resultsSection = document.getElementById('results-section');
    const samplesPerMeterInput = document.getElementById('samples-per-meter');
    const minSamplesPerSegmentInput = document.getElementById('min-samples-per-segment');
    const controlEffortWeightInput = document.getElementById('control-effort-weight');
    const controlEffortWeightValue = document.getElementById('control-effort-weight-value');

    const playBtn = document.getElementById('play-btn');
    const chainPlayBtn = document.getElementById('chain-play-btn');
    const resetBtn = document.getElementById('reset-btn');
    const timeSlider = document.getElementById('time-slider');
    const timeDisplay = document.getElementById('time-display');
    const playbackProgress = document.getElementById('playback-progress');
    const mousePosEl = document.getElementById('mouse-pos');

    const fieldSizeInput = document.getElementById('field-size');
    const bgImageInput = document.getElementById('bg-image-input');
    const bgControls = document.getElementById('bg-controls');
    const bgScaleSlider = document.getElementById('bg-scale');
    const bgRotationSlider = document.getElementById('bg-rotation');
    const bgOpacitySlider = document.getElementById('bg-opacity');
    const bgMirrorH = document.getElementById('bg-mirror-h');
    const bgMirrorV = document.getElementById('bg-mirror-v');

    const openBtn = document.getElementById('open-btn');
    const saveBtn = document.getElementById('save-btn');
    const syncBtn = document.getElementById('sync-btn');
    const projectNameEl = document.getElementById('project-name');
    const openModal = document.getElementById('open-modal');
    const saveModal = document.getElementById('save-modal');
    const syncModal = document.getElementById('sync-modal');
    const projectListEl = document.getElementById('project-list');
    const projectNameInput = document.getElementById('project-name-input');
    const confirmSaveBtn = document.getElementById('confirm-save-btn');
    const confirmSyncBtn = document.getElementById('confirm-sync-btn');
    const syncStatusEl = document.getElementById('sync-status');

    toolButtons = document.querySelectorAll('.tool-btn');

    // Set initial active trajectory
    state.activeTrajectoryId = state.trajectories[0].id;

    // Create callback objects that modules need
    const callbacks = {
        render,
        markUnsaved,
        updateTrajectoryList,
        updateWaypointList,
        updateConstraintList,
        updateSolverSettingsFromActiveTrajectory,
        updatePlaybackControls,
        getDefaultIntakeDistance,
        getDefaultIntakeVelocity,
        selectTool,
        togglePlayback,
        showSaveModal,
        showOpenModal,
        showStatus,
        stopPlayback,
        stopChainPlayback
    };

    // Initialize all modules
    initTrajectoryList({ trajectoryListEl, trajectoryCountEl });

    initTrajectories({
        updateTrajectoryList,
        updateWaypointList,
        updateConstraintList,
        updateSolverSettingsFromActiveTrajectory,
        updatePlaybackControls,
        render,
        markUnsaved,
        stopPlayback,
        stopChainPlayback
    });

    initWaypoints(callbacks, { waypointListEl, waypointCountEl });

    initConstraints(callbacks, { constraintListEl, constraintCountEl });

    initSolver(callbacks, {
        solveBtn, solveStatusInline, solveStatusEl, solveResultsEl, resultsSection,
        samplesPerMeterInput, minSamplesPerSegmentInput,
        controlEffortWeightInput, controlEffortWeightValue
    });

    initPlayback(callbacks, {
        playBtn, chainPlayBtn, resetBtn, timeSlider, timeDisplay, playbackProgress
    });

    initProject(callbacks, {
        projectNameEl, openModal, saveModal, syncModal, projectListEl,
        projectNameInput, confirmSaveBtn, confirmSyncBtn, syncStatusEl,
        fieldSizeInput, bgControls, bgScaleSlider, bgRotationSlider,
        bgOpacitySlider, bgMirrorH, bgMirrorV
    });

    initBackground(callbacks, {
        bgImageInput, bgControls, bgScaleSlider, bgRotationSlider,
        bgOpacitySlider, bgMirrorH, bgMirrorV
    });

    initEvents(callbacks, {
        mousePosEl, openModal, saveModal, syncModal
    });

    // Set up canvas size
    resizeCanvas(render);
    window.addEventListener('resize', () => resizeCanvas(render));

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
    document.getElementById('clear-constraints').addEventListener('click', clearConstraints);
    playBtn.addEventListener('click', togglePlayback);
    chainPlayBtn.addEventListener('click', toggleChainPlayback);
    resetBtn.addEventListener('click', resetPlayback);
    timeSlider.addEventListener('input', handleSliderChange);

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => zoom(1.25, undefined, undefined, render));
    document.getElementById('zoom-out').addEventListener('click', () => zoom(0.8, undefined, undefined, render));
    document.getElementById('zoom-fit').addEventListener('click', () => fitToView(render));

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

    // Project management
    openBtn.addEventListener('click', showOpenModal);
    saveBtn.addEventListener('click', showSaveModal);
    syncBtn.addEventListener('click', showSyncModal);
    confirmSaveBtn.addEventListener('click', saveProject);
    confirmSyncBtn.addEventListener('click', syncToAndroid);
    document.getElementById('new-project-btn').addEventListener('click', newProject);

    // Modal close buttons
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modal;
            document.getElementById(modalId).style.display = 'none';
        });
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });

    // Panel resize handles
    initPanelResize();

    // Unsaved changes warning
    window.addEventListener('beforeunload', (e) => {
        if (state.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // Initial render
    fitToView(render);
    updateTrajectoryList();
    updateConstraintList();
    updateSolverSettingsFromActiveTrajectory();
    updateProjectNameDisplay();
    render();
}

document.addEventListener('DOMContentLoaded', init);
