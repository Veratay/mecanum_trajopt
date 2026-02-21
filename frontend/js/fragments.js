/**
 * Waypoint Fragment management - CRUD operations and list UI
 *
 * Fragments are reusable sets of waypoints with set positions
 * that can be chained together to form new trajectories.
 * Fragments are shared across all trajectories in a project.
 */

import { state, getActiveTrajectory, createFragment, getFragmentById, getFragmentIndex, generateId } from './state.js';

// UI update callbacks (set during init)
let updateTrajectoryListFn = null;
let updateWaypointListFn = null;
let updatePlaybackControlsFn = null;
let renderFn = null;
let markUnsavedFn = null;
let getDefaultIntakeDistanceFn = null;
let getDefaultIntakeVelocityFn = null;

// DOM elements
let fragmentListEl = null;
let fragmentCountEl = null;

export function initFragments(callbacks, elements) {
    updateTrajectoryListFn = callbacks.updateTrajectoryList;
    updateWaypointListFn = callbacks.updateWaypointList;
    updatePlaybackControlsFn = callbacks.updatePlaybackControls;
    renderFn = callbacks.render;
    markUnsavedFn = callbacks.markUnsaved;
    getDefaultIntakeDistanceFn = callbacks.getDefaultIntakeDistance;
    getDefaultIntakeVelocityFn = callbacks.getDefaultIntakeVelocity;

    fragmentListEl = elements.fragmentListEl;
    fragmentCountEl = elements.fragmentCountEl;
}

// Fragment CRUD operations

export function addFragment() {
    const frag = createFragment(`Fragment ${state.fragments.length + 1}`);
    state.fragments.push(frag);
    markUnsavedFn();
    updateFragmentList();
}

export function saveTrajectoryAsFragment() {
    const traj = getActiveTrajectory();
    if (!traj || traj.waypoints.length === 0) return;

    const frag = createFragment(traj.name + ' Fragment');
    // Deep copy waypoints
    frag.waypoints = traj.waypoints.map(wp => ({ ...wp }));
    state.fragments.push(frag);
    markUnsavedFn();
    updateFragmentList();
}

export function deleteFragment(id) {
    const index = getFragmentIndex(id);
    if (index === -1) return;

    state.fragments.splice(index, 1);
    markUnsavedFn();
    updateFragmentList();
}

export function renameFragment(id, name) {
    const frag = getFragmentById(id);
    if (frag) {
        frag.name = name;
        markUnsavedFn();
        updateFragmentList();
    }
}

export function applyFragmentToTrajectory(fragmentId) {
    const frag = getFragmentById(fragmentId);
    const traj = getActiveTrajectory();
    if (!frag || !traj || frag.waypoints.length === 0) return;

    // If the trajectory already has waypoints, set the current last
    // waypoint's stop to false (so they chain smoothly)
    if (traj.waypoints.length > 1) {
        traj.waypoints[traj.waypoints.length - 1].stop = false;
    }

    // Deep copy and append fragment waypoints
    const newWaypoints = frag.waypoints.map(wp => ({ ...wp }));

    // Ensure the last appended waypoint has stop=true
    if (newWaypoints.length > 0) {
        newWaypoints[newWaypoints.length - 1].stop = true;
    }

    traj.waypoints.push(...newWaypoints);

    // Clear solved trajectory since waypoints changed
    traj.trajectory = null;
    markUnsavedFn();
    updateTrajectoryListFn();
    updateWaypointListFn();
    updatePlaybackControlsFn();
    renderFn();
}

// Fragment list UI rendering

export function updateFragmentList() {
    if (!fragmentListEl || !fragmentCountEl) return;

    fragmentCountEl.textContent = state.fragments.length;

    if (state.fragments.length === 0) {
        fragmentListEl.innerHTML = `
            <div class="fragment-empty">
                <div class="fragment-empty-text">
                    No fragments yet. Save waypoints from a trajectory<br>
                    or create an empty fragment to get started.
                </div>
            </div>
        `;
        return;
    }

    fragmentListEl.innerHTML = state.fragments.map((frag, i) => {
        const wpCount = frag.waypoints.length;

        return `
            <div class="fragment-item" data-id="${frag.id}">
                <div class="fragment-header-row" data-id="${frag.id}">
                    <span class="fragment-icon">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                    </span>
                    <span class="fragment-name">${frag.name}</span>
                    <span class="fragment-wp-count">${wpCount} wp</span>
                    <button class="fragment-apply-btn" data-id="${frag.id}" title="Insert into active trajectory" ${wpCount === 0 ? 'disabled' : ''}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Insert
                    </button>
                    <button class="fragment-delete-btn" data-id="${frag.id}" title="Delete fragment">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="fragment-body">
                    <div class="fragment-name-edit">
                        <input type="text" value="${frag.name}" data-id="${frag.id}" data-field="name" placeholder="Fragment name">
                    </div>
                    ${wpCount > 0 ? `
                        <div class="fragment-waypoints-preview">
                            ${frag.waypoints.map((wp, wi) => {
                                const typeLabel = wp.type === 'constrained' ? 'C' : wp.type === 'unconstrained' ? 'U' : 'I';
                                const coords = wp.type === 'intake'
                                    ? `${wp.intake_x.toFixed(2)}, ${wp.intake_y.toFixed(2)}`
                                    : `${wp.x.toFixed(2)}, ${wp.y.toFixed(2)}`;
                                return `<span class="fragment-wp-preview" title="${wp.type}: ${coords}">${typeLabel}${wi + 1}</span>`;
                            }).join('<span class="fragment-wp-arrow">→</span>')}
                        </div>
                    ` : '<div class="fragment-empty-notice">No waypoints</div>'}
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    fragmentListEl.querySelectorAll('.fragment-header-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.fragment-apply-btn') || e.target.closest('.fragment-delete-btn')) return;
            const item = row.closest('.fragment-item');
            item.classList.toggle('expanded');
        });
    });

    fragmentListEl.querySelectorAll('.fragment-apply-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyFragmentToTrajectory(btn.dataset.id);
        });
    });

    fragmentListEl.querySelectorAll('.fragment-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteFragment(btn.dataset.id);
        });
    });

    fragmentListEl.querySelectorAll('input[data-field="name"]').forEach(input => {
        input.addEventListener('change', (e) => {
            e.stopPropagation();
            renameFragment(input.dataset.id, input.value);
        });
        input.addEventListener('click', e => e.stopPropagation());
    });
}
