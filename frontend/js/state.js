/**
 * Application state management
 */

export function generateId() {
    return crypto.randomUUID();
}

export function createDefaultTrajectory(name = 'Trajectory 1') {
    return {
        id: generateId(),
        name: name,
        waypoints: [],
        constraints: [],  // Path constraints (obstacles, lanes, etc.)
        eventMarkers: [],  // Event markers: { waypointIndex, percentage, name, timestamp }
        trajectory: null,
        solverSettings: {
            samplesPerMeter: 20.0,
            minSamplesPerSegment: 3,
            controlEffortWeight: 0.0
        },
        followsTrajectoryId: null
    };
}

export const state = {
    // Project
    projectName: 'Untitled',
    projectFilename: null,  // null = unsaved
    hasUnsavedChanges: false,
    backgroundImageFilename: null,  // server-stored image reference

    // Field
    fieldSize: 3.66, // meters

    // View transform (pan/zoom)
    view: {
        x: 0,
        y: 0,
        scale: 1.0,
        minScale: 0.5,
        maxScale: 4.0
    },

    // Tools
    currentTool: 'select', // 'select', 'constrained', 'unconstrained', 'intake'

    // Trajectories collection
    trajectories: [createDefaultTrajectory()],
    activeTrajectoryId: null, // Set in init
    expandedTrajectoryId: null,

    // Waypoint state (for active trajectory)
    selectedWaypointIndex: null,
    expandedWaypointIndex: null,
    manuallyExpandedWaypoints: new Set(),

    // Constraint state (for active trajectory)
    selectedConstraintIndex: null,
    expandedConstraintIndex: null,
    constraintPlacementStart: null,  // For rect obstacle/stay-in-rect placement

    // Interaction
    isDragging: false,
    isDraggingHeading: false,
    isDraggingIntakePoint: false,
    isDraggingConstraint: false,
    isDraggingConstraintEdge: false,
    draggingConstraintIndex: null,
    isPanning: false,
    wasDragging: false,
    dragStart: { x: 0, y: 0 },
    panStart: { x: 0, y: 0 },

    // Playback
    playbackTime: 0,
    isPlaying: false,
    isChainPlaying: false,
    chainPlaybackData: null, // { chain: [], currentIndex: 0, totalTime: 0 }
    animationId: null,

    // Background
    backgroundImage: null,
    backgroundSettings: {
        scale: 1.0,
        rotation: 0,
        opacity: 0.5,
        mirrorH: false,
        mirrorV: false
    }
};

// Trajectory helpers
export function getActiveTrajectory() {
    return state.trajectories.find(t => t.id === state.activeTrajectoryId);
}

export function getTrajectoryById(id) {
    return state.trajectories.find(t => t.id === id);
}

export function getTrajectoryIndex(id) {
    return state.trajectories.findIndex(t => t.id === id);
}
