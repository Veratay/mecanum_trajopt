/**
 * Trajectory list UI rendering
 */

import { state, getTrajectoryById, getTrajectoryIndex } from './state.js';
import {
    selectTrajectory, toggleTrajectoryExpanded, deleteTrajectory, renameTrajectory,
    setTrajectoryFollows, canBeFollowed, canFollow, wouldCreateCycle
} from './trajectories.js';

// DOM elements
let trajectoryListEl = null;
let trajectoryCountEl = null;

export function initTrajectoryList(elements) {
    trajectoryListEl = elements.trajectoryListEl;
    trajectoryCountEl = elements.trajectoryCountEl;
}

export function updateTrajectoryList() {
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
