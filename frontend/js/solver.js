/**
 * Solver API interaction
 */

import { state, getActiveTrajectory } from './state.js';

// UI update callbacks (set during init)
let updateTrajectoryListFn = null;
let updatePlaybackControlsFn = null;
let renderFn = null;

// DOM elements
let solveBtn = null;
let solveStatusInline = null;
let solveStatusEl = null;
let solveResultsEl = null;
let resultsSection = null;
let samplesPerMeterInput = null;
let minSamplesPerSegmentInput = null;
let controlEffortWeightInput = null;
let controlEffortWeightValue = null;

export function initSolver(callbacks, elements) {
    updateTrajectoryListFn = callbacks.updateTrajectoryList;
    updatePlaybackControlsFn = callbacks.updatePlaybackControls;
    renderFn = callbacks.render;

    solveBtn = elements.solveBtn;
    solveStatusInline = elements.solveStatusInline;
    solveStatusEl = elements.solveStatusEl;
    solveResultsEl = elements.solveResultsEl;
    resultsSection = elements.resultsSection;
    samplesPerMeterInput = elements.samplesPerMeterInput;
    minSamplesPerSegmentInput = elements.minSamplesPerSegmentInput;
    controlEffortWeightInput = elements.controlEffortWeightInput;
    controlEffortWeightValue = elements.controlEffortWeightValue;

    // Update value display when slider changes
    if (controlEffortWeightInput && controlEffortWeightValue) {
        controlEffortWeightInput.addEventListener('input', () => {
            controlEffortWeightValue.textContent = parseFloat(controlEffortWeightInput.value).toFixed(2);
        });
    }
}

export function getRobotParams() {
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

export function getDefaultIntakeDistance() {
    return parseFloat(document.getElementById('param-intake-distance').value) || 0.5;
}

export function getDefaultIntakeVelocity() {
    return parseFloat(document.getElementById('param-intake-velocity').value) || 1.0;
}

export function updateSolverSettingsFromActiveTrajectory() {
    const traj = getActiveTrajectory();
    if (traj) {
        samplesPerMeterInput.value = traj.solverSettings.samplesPerMeter;
        minSamplesPerSegmentInput.value = traj.solverSettings.minSamplesPerSegment;
        const effortWeight = traj.solverSettings.controlEffortWeight ?? 0.0;
        controlEffortWeightInput.value = effortWeight;
        controlEffortWeightValue.textContent = effortWeight.toFixed(2);
    }
}

export async function solve() {
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
    traj.solverSettings.controlEffortWeight = parseFloat(controlEffortWeightInput.value) || 0.0;

    const request = {
        waypoints: traj.waypoints,
        constraints: (traj.constraints || []).filter(c => c.enabled),
        robot_params: getRobotParams(),
        samples_per_meter: traj.solverSettings.samplesPerMeter,
        min_samples_per_segment: traj.solverSettings.minSamplesPerSegment,
        control_effort_weight: traj.solverSettings.controlEffortWeight
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
            updateTrajectoryListFn();
            updatePlaybackControlsFn();
            renderFn();
        } else {
            showStatus(`Error: ${result.detail}`, 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
    }

    solveBtn.disabled = false;
}

export function showStatus(message, type) {
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
