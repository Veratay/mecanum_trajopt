/**
 * Trajectory management - CRUD operations and chaining
 */

import { state, getActiveTrajectory, getTrajectoryById, getTrajectoryIndex, createDefaultTrajectory } from './state.js';

// UI update callbacks (set during init)
let updateTrajectoryListFn = null;
let updateWaypointListFn = null;
let updateConstraintListFn = null;
let updateSolverSettingsFromActiveTrajectoryFn = null;
let updatePlaybackControlsFn = null;
let renderFn = null;
let markUnsavedFn = null;
let stopPlaybackFn = null;
let stopChainPlaybackFn = null;

export function initTrajectories(callbacks) {
    updateTrajectoryListFn = callbacks.updateTrajectoryList;
    updateWaypointListFn = callbacks.updateWaypointList;
    updateConstraintListFn = callbacks.updateConstraintList;
    updateSolverSettingsFromActiveTrajectoryFn = callbacks.updateSolverSettingsFromActiveTrajectory;
    updatePlaybackControlsFn = callbacks.updatePlaybackControls;
    renderFn = callbacks.render;
    markUnsavedFn = callbacks.markUnsaved;
    stopPlaybackFn = callbacks.stopPlayback;
    stopChainPlaybackFn = callbacks.stopChainPlayback;
}

export function createTrajectory() {
    const newTraj = createDefaultTrajectory(`Trajectory ${state.trajectories.length + 1}`);
    state.trajectories.push(newTraj);
    markUnsavedFn();
    selectTrajectory(newTraj.id);
    updateTrajectoryListFn();
}

export function deleteTrajectory(id) {
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
        state.selectedConstraintIndex = null;
        state.expandedConstraintIndex = null;
    }

    markUnsavedFn();
    updateTrajectoryListFn();
    updateWaypointListFn();
    updateConstraintListFn();
    updateSolverSettingsFromActiveTrajectoryFn();
    updatePlaybackControlsFn();
    renderFn();
}

export function renameTrajectory(id, name) {
    const traj = getTrajectoryById(id);
    if (traj) {
        traj.name = name;
        markUnsavedFn();
        updateTrajectoryListFn();
    }
}

export function selectTrajectory(id) {
    if (state.activeTrajectoryId === id) return;

    // Stop any playback
    stopPlaybackFn();
    if (state.isChainPlaying) {
        stopChainPlaybackFn();
    }

    state.activeTrajectoryId = id;
    state.selectedWaypointIndex = null;
    state.expandedWaypointIndex = null;
    state.manuallyExpandedWaypoints.clear();
    state.selectedConstraintIndex = null;
    state.expandedConstraintIndex = null;

    updateTrajectoryListFn();
    updateWaypointListFn();
    updateConstraintListFn();
    updateSolverSettingsFromActiveTrajectoryFn();
    updatePlaybackControlsFn();
    renderFn();
}

export function toggleTrajectoryExpanded(id) {
    if (state.expandedTrajectoryId === id) {
        state.expandedTrajectoryId = null;
    } else {
        state.expandedTrajectoryId = id;
    }
    updateTrajectoryListFn();
}

// Trajectory chaining helpers
export function canBeFollowed(trajId) {
    // A trajectory can be followed if its last waypoint is constrained or unconstrained
    const traj = getTrajectoryById(trajId);
    if (!traj || traj.waypoints.length === 0) return false;
    const lastWp = traj.waypoints[traj.waypoints.length - 1];
    return lastWp.type === 'constrained' || lastWp.type === 'unconstrained';
}

export function canFollow(trajId) {
    // A trajectory can follow another if its first waypoint is constrained
    const traj = getTrajectoryById(trajId);
    if (!traj || traj.waypoints.length === 0) return false;
    const firstWp = traj.waypoints[0];
    return firstWp.type === 'constrained';
}

export function wouldCreateCycle(followerId, targetId) {
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

export function setTrajectoryFollows(id, followsId) {
    const traj = getTrajectoryById(id);
    if (!traj) return;

    // Clear if null or same
    if (!followsId || followsId === 'none') {
        traj.followsTrajectoryId = null;
        updateTrajectoryListFn();
        updateWaypointListFn();
        renderFn();
        return;
    }

    // Validate
    if (followsId === id) return; // Can't follow self
    if (!canBeFollowed(followsId)) return; // Target's last wp must be constrained or unconstrained
    if (!canFollow(id)) return; // Our first wp must be constrained
    if (wouldCreateCycle(id, followsId)) return; // No cycles

    traj.followsTrajectoryId = followsId;
    syncChainedWaypoint(id);
    traj.trajectory = null; // Clear solved result

    updateTrajectoryListFn();
    updateWaypointListFn();
    renderFn();
}

export function syncChainedWaypoint(trajId) {
    const traj = getTrajectoryById(trajId);
    if (!traj || !traj.followsTrajectoryId) return;
    if (traj.waypoints.length === 0) return;

    const followedTraj = getTrajectoryById(traj.followsTrajectoryId);
    if (!followedTraj || followedTraj.waypoints.length === 0) return;

    const lastWp = followedTraj.waypoints[followedTraj.waypoints.length - 1];
    const firstWp = traj.waypoints[0];

    // Copy position from followed trajectory's end
    firstWp.x = lastWp.x;
    firstWp.y = lastWp.y;

    if (lastWp.type === 'unconstrained' && followedTraj.trajectory) {
        // For unconstrained waypoints, read the solved heading from trajectory data
        const lastState = followedTraj.trajectory.states[followedTraj.trajectory.states.length - 1];
        firstWp.heading = lastState[5]; // theta
    } else {
        firstWp.heading = lastWp.heading;
    }
}

export function syncAllFollowers(trajId) {
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

export function getTrajectoryChain(trajId) {
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
