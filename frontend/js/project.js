/**
 * Project save/load management
 */

import { state, createDefaultTrajectory, generateId } from './state.js';
import { getRobotParams } from './solver.js';
import { mirrorProjectData, mirrorTrajectoryResult } from './mirror.js';

// UI update callbacks (set during init)
let updateTrajectoryListFn = null;
let updateWaypointListFn = null;
let updateConstraintListFn = null;
let updateSolverSettingsFromActiveTrajectoryFn = null;
let updatePlaybackControlsFn = null;
let updateFragmentListFn = null;
let renderFn = null;

// DOM elements
let projectNameEl = null;
let openModal = null;
let saveModal = null;
let syncModal = null;
let projectListEl = null;
let projectNameInput = null;
let confirmSaveBtn = null;
let confirmSyncBtn = null;
let syncStatusEl = null;
let fieldSizeInput = null;
let bgControls = null;
let bgScaleSlider = null;
let bgRotationSlider = null;
let bgOpacitySlider = null;
let bgMirrorH = null;
let bgMirrorV = null;

export function initProject(callbacks, elements) {
    updateTrajectoryListFn = callbacks.updateTrajectoryList;
    updateWaypointListFn = callbacks.updateWaypointList;
    updateConstraintListFn = callbacks.updateConstraintList;
    updateSolverSettingsFromActiveTrajectoryFn = callbacks.updateSolverSettingsFromActiveTrajectory;
    updatePlaybackControlsFn = callbacks.updatePlaybackControls;
    updateFragmentListFn = callbacks.updateFragmentList;
    renderFn = callbacks.render;

    projectNameEl = elements.projectNameEl;
    openModal = elements.openModal;
    saveModal = elements.saveModal;
    syncModal = elements.syncModal;
    projectListEl = elements.projectListEl;
    projectNameInput = elements.projectNameInput;
    confirmSaveBtn = elements.confirmSaveBtn;
    confirmSyncBtn = elements.confirmSyncBtn;
    syncStatusEl = elements.syncStatusEl;
    fieldSizeInput = elements.fieldSizeInput;
    bgControls = elements.bgControls;
    bgScaleSlider = elements.bgScaleSlider;
    bgRotationSlider = elements.bgRotationSlider;
    bgOpacitySlider = elements.bgOpacitySlider;
    bgMirrorH = elements.bgMirrorH;
    bgMirrorV = elements.bgMirrorV;
}

export function markUnsaved() {
    state.hasUnsavedChanges = true;
    updateProjectNameDisplay();
}

export function updateProjectNameDisplay() {
    if (projectNameEl) {
        projectNameEl.textContent = state.projectName;
        projectNameEl.classList.toggle('unsaved', state.hasUnsavedChanges);
    }
}

export function serializeProject() {
    return {
        version: 4,
        name: state.projectName,
        updatedAt: new Date().toISOString(),
        fieldSize: state.fieldSize,
        backgroundImageFilename: state.backgroundImageFilename,
        backgroundSettings: state.backgroundSettings,

        // Variables
        variables: {
            vars: Array.from(state.variables.vars.entries()).map(([name, data]) => ({
                name,
                value: data.value,
                linkedFrom: data.linkedFrom
            })),
            linkedFrom: state.variables.linkedFrom
        },

        // Robot params with linking
        robotParams: {
            ...getRobotParams(),
            linkedFrom: state.robotParams.linkedFrom
        },

        // Waypoint fragments
        fragments: state.fragments.map(f => ({
            id: f.id,
            name: f.name,
            waypoints: f.waypoints.map(wp => ({ ...wp }))
        })),

        // Group names for trajectory chains
        groupNames: Array.from(state.groupNames.entries()).map(([rootId, name]) => ({
            rootId,
            name
        })),

        trajectories: state.trajectories.map(t => ({
            id: t.id,
            name: t.name,
            waypoints: t.waypoints.map((wp, i) => {
                const baseWp = { ...wp };

                // Add _exp fields for any expressions
                const fields = ['x', 'y', 'heading', 'v_max', 'omega_max', 'intake_x', 'intake_y', 'intake_distance', 'intake_velocity_max', 'intake_velocity_slack'];
                fields.forEach(field => {
                    const key = `waypoint:${t.id}:${i}:${field}`;
                    const expr = state.expressionMap.get(key);
                    if (expr) {
                        baseWp[`${field}_exp`] = expr;
                    }
                });

                return baseWp;
            }),
            constraints: (t.constraints || []).map(con => {
                const baseCon = { ...con };

                // Add _exp fields for constraint params
                if (con.params) {
                    Object.keys(con.params).forEach(field => {
                        const key = `constraint:${t.id}:${con.id}:${field}`;
                        const expr = state.expressionMap.get(key);
                        if (expr) {
                            if (!baseCon.params_exp) {
                                baseCon.params_exp = {};
                            }
                            baseCon.params_exp[field] = expr;
                        }
                    });
                }

                return baseCon;
            }),
            eventMarkers: t.eventMarkers || [],
            solverSettings: t.solverSettings,
            trajectory: t.trajectory,
            followsTrajectoryId: t.followsTrajectoryId
        }))
    };
}

export function deserializeProject(data) {
    // Handle version migration
    const version = data.version || 1;
    if (version < 3) {
        // Migrate to v3: add empty variables, no expressions
        data.variables = data.variables || { vars: [], linkedFrom: null };
        if (data.robotParams && !data.robotParams.linkedFrom) {
            data.robotParams.linkedFrom = null;
        }
    }
    if (version < 4) {
        // Migrate to v4: add empty fragments and group names
        data.fragments = data.fragments || [];
        data.groupNames = data.groupNames || [];
    }

    // Reset state
    state.projectName = data.name || 'Untitled';
    state.fieldSize = data.fieldSize || 3.66;
    state.backgroundImageFilename = data.backgroundImageFilename || null;

    // Load variables
    state.variables.vars.clear();
    state.expressionMap.clear();

    if (data.variables && data.variables.vars) {
        data.variables.vars.forEach(v => {
            state.variables.vars.set(v.name, {
                value: v.value,
                linkedFrom: v.linkedFrom || null
            });
        });
    }
    state.variables.linkedFrom = data.variables?.linkedFrom || null;

    // Load fragments
    state.fragments = (data.fragments || []).map(f => ({
        id: f.id || generateId(),
        name: f.name || 'Fragment',
        waypoints: (f.waypoints || []).map(wp => ({ ...wp }))
    }));

    // Load group names
    state.groupNames.clear();
    if (data.groupNames) {
        for (const gn of data.groupNames) {
            state.groupNames.set(gn.rootId, gn.name);
        }
    }

    if (data.backgroundSettings) {
        state.backgroundSettings = { ...state.backgroundSettings, ...data.backgroundSettings };
        // Update UI controls
        bgScaleSlider.value = state.backgroundSettings.scale;
        bgRotationSlider.value = state.backgroundSettings.rotation;
        bgOpacitySlider.value = state.backgroundSettings.opacity;
        bgMirrorH.checked = state.backgroundSettings.mirrorH;
        bgMirrorV.checked = state.backgroundSettings.mirrorV;
        document.getElementById('bg-scale-value').textContent = state.backgroundSettings.scale.toFixed(2);
        document.getElementById('bg-rotation-value').textContent = state.backgroundSettings.rotation + '°';
        document.getElementById('bg-opacity-value').textContent = state.backgroundSettings.opacity.toFixed(2);
    }

    // Load background image if specified
    if (state.backgroundImageFilename) {
        const img = new Image();
        img.onload = () => {
            state.backgroundImage = img;
            bgControls.style.display = 'block';
            renderFn();
        };
        img.src = `/images/${state.backgroundImageFilename}`;
    } else {
        state.backgroundImage = null;
        bgControls.style.display = 'none';
    }

    // Load robot params with linking
    if (data.robotParams) {
        const rp = data.robotParams;
        document.getElementById('param-mass').value = rp.mass ?? 15.0;
        document.getElementById('param-inertia').value = rp.inertia ?? 0.5;
        document.getElementById('param-wheel-radius').value = rp.wheel_radius ?? 0.05;
        document.getElementById('param-lx').value = rp.lx ?? 0.15;
        document.getElementById('param-ly').value = rp.ly ?? 0.15;
        document.getElementById('param-wmax').value = rp.w_max ?? 100;
        document.getElementById('param-tmax').value = rp.t_max ?? 1.0;
        document.getElementById('param-ftraction').value = rp.f_traction_max ?? 20.0;
        document.getElementById('param-intake-distance').value = rp.default_intake_distance ?? 0.5;
        document.getElementById('param-intake-velocity').value = rp.default_intake_velocity ?? 1.0;

        state.robotParams.linkedFrom = rp.linkedFrom || null;
    }

    // Load trajectories and extract expressions
    if (data.trajectories && data.trajectories.length > 0) {
        state.trajectories = data.trajectories.map(t => {
            const traj = {
                id: t.id || generateId(),
                name: t.name || 'Trajectory',
                waypoints: [],
                constraints: [],
                eventMarkers: t.eventMarkers || [],
                solverSettings: t.solverSettings || { samplesPerMeter: 20.0, minSamplesPerSegment: 3 },
                trajectory: t.trajectory || null,
                mirroredTrajectory: t.trajectory ? mirrorTrajectoryResult(t.trajectory) : null,
                followsTrajectoryId: t.followsTrajectoryId || null
            };

            // Load waypoints and extract expressions
            traj.waypoints = (t.waypoints || []).map((wpData, i) => {
                const wp = { ...wpData };

                // Extract _exp fields and populate expressionMap
                const fields = ['x', 'y', 'heading', 'v_max', 'omega_max', 'intake_x', 'intake_y', 'intake_distance', 'intake_velocity_max', 'intake_velocity_slack'];
                fields.forEach(field => {
                    const expField = `${field}_exp`;
                    if (wpData[expField]) {
                        const key = `waypoint:${traj.id}:${i}:${field}`;
                        state.expressionMap.set(key, wpData[expField]);
                        delete wp[expField];  // Remove from waypoint object
                    }
                });

                return wp;
            });

            // Load constraints and extract expressions
            traj.constraints = (t.constraints || []).map(conData => {
                const con = { ...conData };

                // Extract params_exp and populate expressionMap
                if (conData.params_exp) {
                    Object.keys(conData.params_exp).forEach(field => {
                        const key = `constraint:${traj.id}:${con.id}:${field}`;
                        state.expressionMap.set(key, conData.params_exp[field]);
                    });
                    delete con.params_exp;  // Remove from constraint object
                }

                return con;
            });

            return traj;
        });
    } else {
        state.trajectories = [createDefaultTrajectory()];
    }

    state.activeTrajectoryId = state.trajectories[0].id;
    state.selectedWaypointIndex = null;
    state.expandedWaypointIndex = null;
    state.manuallyExpandedWaypoints.clear();
    state.expandedTrajectoryId = null;
    state.selectedConstraintIndex = null;
    state.expandedConstraintIndex = null;

    // Update field size input
    fieldSizeInput.value = state.fieldSize;

    // Re-evaluate all expressions to sync computed values
    if (window.reevaluateAllExpressions) {
        window.reevaluateAllExpressions();
    }

    state.hasUnsavedChanges = false;
    updateProjectNameDisplay();
    updateTrajectoryListFn();
    updateWaypointListFn();
    updateConstraintListFn();
    updateSolverSettingsFromActiveTrajectoryFn();
    updatePlaybackControlsFn();
    if (updateFragmentListFn) updateFragmentListFn();
    renderFn();

    // Render variables panel
    if (window.renderVariablesPanel) {
        window.renderVariablesPanel();
    }
}

export async function showOpenModal() {
    openModal.style.display = 'flex';
    projectListEl.innerHTML = '<div class="loading">Loading projects...</div>';

    try {
        const response = await fetch('/projects');
        const data = await response.json();

        // Filter out auto-generated mirrored files
        const projects = data.projects.filter(p => !p.filename.endsWith('_mirrored.json'));

        if (projects.length === 0) {
            projectListEl.innerHTML = '<div class="project-empty">No saved projects</div>';
            return;
        }

        projectListEl.innerHTML = projects.map(p => {
            const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '';
            return `
                <div class="project-item" data-filename="${p.filename}">
                    <div class="project-item-info">
                        <span class="project-item-name">${p.name}</span>
                        <span class="project-item-meta">${p.trajectoryCount} trajectories · ${date}</span>
                    </div>
                    <button class="project-delete-btn" data-filename="${p.filename}" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');

        // Add click handlers for project items
        projectListEl.querySelectorAll('.project-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.project-delete-btn')) {
                    loadProject(item.dataset.filename);
                }
            });
        });

        // Add delete handlers
        projectListEl.querySelectorAll('.project-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Delete this project?')) {
                    await deleteProject(btn.dataset.filename);
                    showOpenModal(); // Refresh list
                }
            });
        });
    } catch (error) {
        projectListEl.innerHTML = `<div class="project-error">Error loading projects: ${error.message}</div>`;
    }
}

export async function loadProject(filename) {
    try {
        const response = await fetch(`/projects/${filename}`);
        if (!response.ok) throw new Error('Failed to load project');

        const data = await response.json();
        state.projectFilename = filename;
        deserializeProject(data);
        openModal.style.display = 'none';
    } catch (error) {
        alert(`Error loading project: ${error.message}`);
    }
}

async function deleteProject(filename) {
    try {
        const response = await fetch(`/projects/${filename}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete project');

        // Also delete the mirrored version if it exists
        const mirroredFilename = getMirroredFilename(filename);
        await fetch(`/projects/${mirroredFilename}`, { method: 'DELETE' }).catch(() => {});
    } catch (error) {
        alert(`Error deleting project: ${error.message}`);
    }
}

export function showSaveModal() {
    projectNameInput.value = state.projectName;
    saveModal.style.display = 'flex';
    projectNameInput.focus();
    projectNameInput.select();
}

/**
 * Derive the mirrored filename from the original filename.
 * "my-project.json" -> "my-project_mirrored.json"
 */
function getMirroredFilename(filename) {
    if (filename.endsWith('.json')) {
        return filename.slice(0, -5) + '_mirrored.json';
    }
    return filename + '_mirrored';
}

export async function saveProject() {
    const name = projectNameInput.value.trim() || 'Untitled';
    state.projectName = name;

    // Generate filename from name if new project
    if (!state.projectFilename) {
        state.projectFilename = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json';
    }

    const projectData = serializeProject();

    try {
        confirmSaveBtn.disabled = true;
        confirmSaveBtn.textContent = 'Saving...';

        // Save original project
        const response = await fetch(`/projects/${state.projectFilename}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectData)
        });

        if (!response.ok) throw new Error('Failed to save project');

        const result = await response.json();
        state.projectFilename = result.filename;

        // Save mirrored version automatically
        const mirroredData = mirrorProjectData(projectData);
        mirroredData.name = name + ' (Mirrored)';
        const mirroredFilename = getMirroredFilename(state.projectFilename);

        const mirrorResponse = await fetch(`/projects/${mirroredFilename}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mirroredData)
        });

        if (!mirrorResponse.ok) {
            console.warn('Failed to save mirrored project');
        }

        state.hasUnsavedChanges = false;
        updateProjectNameDisplay();
        saveModal.style.display = 'none';
    } catch (error) {
        alert(`Error saving project: ${error.message}`);
    } finally {
        confirmSaveBtn.disabled = false;
        confirmSaveBtn.textContent = 'Save';
    }
}

export function newProject() {
    if (state.hasUnsavedChanges) {
        if (!confirm('You have unsaved changes. Create a new project anyway?')) {
            return;
        }
    }

    state.projectName = 'Untitled';
    state.projectFilename = null;
    state.backgroundImageFilename = null;
    state.backgroundImage = null;
    state.fieldSize = 3.66;
    state.fragments = [];
    state.groupNames.clear();
    state.trajectories = [createDefaultTrajectory()];
    state.activeTrajectoryId = state.trajectories[0].id;
    state.selectedWaypointIndex = null;
    state.expandedWaypointIndex = null;
    state.manuallyExpandedWaypoints.clear();
    state.selectedConstraintIndex = null;
    state.expandedConstraintIndex = null;
    state.hasUnsavedChanges = false;

    fieldSizeInput.value = state.fieldSize;
    bgControls.style.display = 'none';

    updateProjectNameDisplay();
    updateTrajectoryListFn();
    updateWaypointListFn();
    updateConstraintListFn();
    updatePlaybackControlsFn();
    if (updateFragmentListFn) updateFragmentListFn();
    renderFn();

    openModal.style.display = 'none';
}

export async function showSyncModal() {
    syncModal.style.display = 'flex';
    syncStatusEl.innerHTML = '<div class="sync-checking">Checking for Android device...</div>';
    confirmSyncBtn.disabled = true;

    try {
        const response = await fetch('/adb/status');
        const data = await response.json();

        if (data.connected) {
            syncStatusEl.innerHTML = `
                <div class="sync-connected">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    Device connected: ${data.device}
                </div>
                <p class="sync-info">Project will be synced to: <code>${'/sdcard/FIRST/trajopt/'}</code></p>
            `;
            confirmSyncBtn.disabled = !state.projectFilename;
            if (!state.projectFilename) {
                syncStatusEl.innerHTML += '<p class="sync-warning">Save the project first before syncing.</p>';
            }
        } else {
            syncStatusEl.innerHTML = `
                <div class="sync-disconnected">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    No Android device connected
                </div>
                <p class="sync-info">Connect your phone via USB and enable USB debugging.</p>
            `;
        }
    } catch (error) {
        syncStatusEl.innerHTML = `<div class="sync-error">Error checking device: ${error.message}</div>`;
    }
}

export async function syncToAndroid() {
    if (!state.projectFilename) {
        alert('Please save the project first.');
        return;
    }

    try {
        confirmSyncBtn.disabled = true;
        confirmSyncBtn.textContent = 'Syncing...';
        syncStatusEl.innerHTML = '<div class="sync-checking">Pushing to device...</div>';

        // Push original file
        const response = await fetch('/adb/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: state.projectFilename })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || 'Sync failed');
        }

        // Push mirrored file
        const mirroredFilename = getMirroredFilename(state.projectFilename);
        let mirrorSynced = false;
        try {
            const mirrorResponse = await fetch('/adb/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: mirroredFilename })
            });
            mirrorSynced = mirrorResponse.ok;
        } catch {
            // Mirrored file may not exist yet if project was never saved
        }

        syncStatusEl.innerHTML = `
            <div class="sync-success">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Successfully synced!
            </div>
            <p class="sync-info">File saved to: <code>${data.path}</code></p>
            ${mirrorSynced ? '<p class="sync-info">Mirrored file also synced.</p>' : ''}
        `;
    } catch (error) {
        syncStatusEl.innerHTML = `<div class="sync-error">Sync failed: ${error.message}</div>`;
    } finally {
        confirmSyncBtn.disabled = false;
        confirmSyncBtn.textContent = 'Sync';
    }
}
