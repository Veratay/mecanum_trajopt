/**
 * Solver API interaction
 */

import { state, getActiveTrajectory } from './state.js';
import { syncAllFollowers } from './trajectories.js';
import { mirrorTrajectoryResult } from './mirror.js';

// UI update callbacks (set during init)
let updateTrajectoryListFn = null;
let updateWaypointListFn = null;
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
    updateWaypointListFn = callbacks.updateWaypointList;
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

    // Re-evaluate all expressions before solving to ensure values are up to date
    if (window.reevaluateAllExpressions) {
        window.reevaluateAllExpressions();
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

            // Generate mirrored trajectory automatically
            traj.mirroredTrajectory = mirrorTrajectoryResult(traj.trajectory);

            if (result.success) {
                showStatus('Solution found!', 'success');
                // Sync followers so they pick up solved heading from unconstrained waypoints
                syncAllFollowers(traj.id);
            } else {
                showStatus('Solver did not converge', 'error');
            }

            // Compute event marker timestamps from solved trajectory
            computeEventMarkerTimestamps(traj);

            showResults(result);
            updateTrajectoryListFn();
            updateWaypointListFn();
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

export function computeEventMarkerTimestamps(traj) {
    if (!traj.eventMarkers || !traj.trajectory || !traj.trajectory.waypoint_times) return;

    const waypointTimes = traj.trajectory.waypoint_times;
    const times = traj.trajectory.times;
    const states = traj.trajectory.states;

    for (const marker of traj.eventMarkers) {
        marker.timestamp = null; // Reset before computing
        const wpIdx = marker.waypointIndex;
        if (wpIdx < 0 || wpIdx >= waypointTimes.length) {
            continue;
        }

        if (marker.percentage === 0 || wpIdx >= traj.waypoints.length - 1) {
            // Marker at the waypoint itself
            marker.timestamp = waypointTimes[wpIdx];
        } else {
            // Marker between waypointIndex and waypointIndex+1 at given percentage
            // Use arc-length interpolation along the path samples
            const tStart = waypointTimes[wpIdx];
            const tEnd = waypointTimes[wpIdx + 1];

            // Find knot indices for this time range
            let kStart = 0, kEnd = times.length - 1;
            for (let i = 0; i < times.length; i++) {
                if (Math.abs(times[i] - tStart) < 1e-9) { kStart = i; break; }
                if (times[i] > tStart) { kStart = Math.max(0, i - 1); break; }
            }
            for (let i = times.length - 1; i >= 0; i--) {
                if (Math.abs(times[i] - tEnd) < 1e-9) { kEnd = i; break; }
                if (times[i] < tEnd) { kEnd = Math.min(times.length - 1, i + 1); break; }
            }

            // Compute cumulative arc length between kStart and kEnd
            const arcLengths = [0];
            for (let i = kStart + 1; i <= kEnd; i++) {
                const dx = states[i][3] - states[i - 1][3];
                const dy = states[i][4] - states[i - 1][4];
                arcLengths.push(arcLengths[arcLengths.length - 1] + Math.sqrt(dx * dx + dy * dy));
            }
            const totalArcLength = arcLengths[arcLengths.length - 1];
            const targetLength = marker.percentage * totalArcLength;

            // Find the time at the target arc length
            if (totalArcLength < 1e-9) {
                marker.timestamp = tStart;
            } else {
                for (let i = 1; i < arcLengths.length; i++) {
                    if (arcLengths[i] >= targetLength) {
                        const frac = (targetLength - arcLengths[i - 1]) / (arcLengths[i] - arcLengths[i - 1]);
                        const kIdx = kStart + i - 1;
                        marker.timestamp = times[kIdx] + frac * (times[kIdx + 1] - times[kIdx]);
                        break;
                    }
                }
                if (marker.timestamp === undefined || marker.timestamp === null) {
                    marker.timestamp = tEnd;
                }
            }
        }
    }
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
