/**
 * Application constants
 */

export const CANVAS_SIZE = 600; // Base canvas size in pixels
export const ROBOT_WIDTH = 0.35; // meters
export const ROBOT_LENGTH = 0.35; // meters
export const WAYPOINT_RADIUS = 15; // pixels
export const HEADING_LINE_LENGTH = 30; // pixels
export const HEADING_HANDLE_RADIUS = 8; // pixels

// Constraint type definitions
export const CONSTRAINT_TYPES = {
    'circle-obstacle': {
        label: 'Circle Obstacle',
        icon: 'circle-obstacle',
        params: {
            cx: { label: 'Center X', unit: 'm', default: 0.5 },
            cy: { label: 'Center Y', unit: 'm', default: 0.5 },
            radius: { label: 'Radius', unit: 'm', default: 0.3 }
        }
    },
    'stay-in-rect': {
        label: 'Stay in Rectangle',
        icon: 'stay-in-rect',
        params: {
            x: { label: 'X (min)', unit: 'm', default: -1.83 },
            y: { label: 'Y (min)', unit: 'm', default: -1.83 },
            width: { label: 'Width', unit: 'm', default: 3.66 },
            height: { label: 'Height', unit: 'm', default: 3.66 }
        }
    },
    'stay-in-lane': {
        label: 'Stay in Lane',
        icon: 'stay-in-lane',
        adjacentOnly: true,  // Only works between two adjacent waypoints
        params: {
            width: { label: 'Lane Width', unit: 'm', default: 0.5 }
        }
    },
    'heading-tangent': {
        label: 'Follow Tangent',
        icon: 'heading-tangent',
        params: {}  // No additional params needed
    },
    'max-velocity': {
        label: 'Max Velocity',
        icon: 'max-velocity',
        params: {
            v_max: { label: 'Max Velocity', unit: 'm/s', default: 1.5 }
        }
    },
    'max-omega': {
        label: 'Max Omega',
        icon: 'max-omega',
        params: {
            omega_max: { label: 'Max Angular Vel', unit: 'rad/s', default: 5.0 }
        }
    }
};
