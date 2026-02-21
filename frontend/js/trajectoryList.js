/**
 * Trajectory list UI rendering - with group support
 *
 * Trajectories are grouped by their chain relationships (followsTrajectoryId).
 * Each group can be named by the user.
 */

import { state, getTrajectoryById, getTrajectoryIndex } from './state.js';
import {
    selectTrajectory, toggleTrajectoryExpanded, deleteTrajectory, renameTrajectory,
    setTrajectoryFollows, canBeFollowed, canFollow, wouldCreateCycle,
    computeTrajectoryGroups, renameGroup, getGroupName
} from './trajectories.js';

// DOM elements
let trajectoryListEl = null;
let trajectoryCountEl = null;

export function initTrajectoryList(elements) {
    trajectoryListEl = elements.trajectoryListEl;
    trajectoryCountEl = elements.trajectoryCountEl;
}

function renderTrajectoryItem(traj, i) {
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
                : !canBeTarget ? '(last wp must be constrained/unconstrained)'
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
                ${followedIndex ? `<span class="trajectory-follows">\u2190${followedIndex}</span>` : ''}
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
}

export function updateTrajectoryList() {
    trajectoryCountEl.textContent = state.trajectories.length;

    const groups = computeTrajectoryGroups();

    // Separate groups into chains (2+ trajectories) and singletons
    const chainGroups = groups.filter(g => g.trajectories.length > 1);
    const singletons = groups.filter(g => g.trajectories.length === 1);

    let html = '';

    // Render chain groups first
    for (const group of chainGroups) {
        const groupName = getGroupName(group.rootId) || '';
        const displayName = groupName || 'Unnamed Group';
        const trajCount = group.trajectories.length;

        html += `
            <div class="trajectory-group" data-root-id="${group.rootId}">
                <div class="trajectory-group-header" data-root-id="${group.rootId}">
                    <svg class="group-chain-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                    </svg>
                    <span class="group-name-display">${displayName}</span>
                    <span class="group-traj-count">${trajCount}</span>
                    <button class="group-edit-btn" data-root-id="${group.rootId}" title="Rename group">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="trajectory-group-name-editor" data-root-id="${group.rootId}" style="display: none;">
                    <input type="text" value="${groupName}" placeholder="Group name..." data-root-id="${group.rootId}" data-field="group-name">
                </div>
                <div class="trajectory-group-items">
        `;

        for (const traj of group.trajectories) {
            const globalIndex = getTrajectoryIndex(traj.id);
            html += renderTrajectoryItem(traj, globalIndex);
        }

        html += `
                </div>
            </div>
        `;
    }

    // Render singleton trajectories (no group wrapper needed)
    for (const group of singletons) {
        const traj = group.trajectories[0];
        const globalIndex = getTrajectoryIndex(traj.id);
        html += renderTrajectoryItem(traj, globalIndex);
    }

    trajectoryListEl.innerHTML = html;

    // Add event listeners for trajectory headers
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

    // Group header click to toggle name editor
    trajectoryListEl.querySelectorAll('.group-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rootId = btn.dataset.rootId;
            const editor = trajectoryListEl.querySelector(`.trajectory-group-name-editor[data-root-id="${rootId}"]`);
            if (editor) {
                const isVisible = editor.style.display !== 'none';
                editor.style.display = isVisible ? 'none' : 'block';
                if (!isVisible) {
                    const input = editor.querySelector('input');
                    input.focus();
                    input.select();
                }
            }
        });
    });

    // Group name input
    trajectoryListEl.querySelectorAll('input[data-field="group-name"]').forEach(input => {
        input.addEventListener('change', (e) => {
            e.stopPropagation();
            renameGroup(input.dataset.rootId, input.value);
        });
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                renameGroup(input.dataset.rootId, input.value);
                const editor = input.closest('.trajectory-group-name-editor');
                if (editor) editor.style.display = 'none';
            }
        });
    });

    // Group header click to select first trajectory in group
    trajectoryListEl.querySelectorAll('.trajectory-group-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.group-edit-btn')) return;
            // Select the first trajectory in this group
            const groupEl = header.closest('.trajectory-group');
            const firstTraj = groupEl.querySelector('.trajectory-item');
            if (firstTraj) {
                selectTrajectory(firstTraj.dataset.id);
            }
        });
    });
}
