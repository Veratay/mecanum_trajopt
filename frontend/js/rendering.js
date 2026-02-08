/**
 * Canvas rendering functions
 */

import { WAYPOINT_RADIUS, HEADING_LINE_LENGTH, HEADING_HANDLE_RADIUS } from './constants.js';
import { state, getActiveTrajectory, getTrajectoryById } from './state.js';
import { canvas, ctx, getScale, fieldToCanvas } from './canvas.js';
import { getChainRobotStateAtTime } from './playback.js';
import { getRobotParams } from './solver.js';

export function render() {
    const size = canvas.width;

    // Get robot params once for the entire render
    const robotParams = getRobotParams();

    // Clear
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(0, 0, size, size);

    // Draw background image
    if (state.backgroundImage) {
        drawBackgroundImage();
    }

    // Draw grid
    drawGrid();

    // Draw constraints (before waypoints so they appear behind)
    drawConstraints();

    // Chain playback mode - show all trajectories in the chain
    if (state.isChainPlaying && state.chainPlaybackData) {
        const { chain } = state.chainPlaybackData;

        // Draw all trajectories in the chain
        chain.forEach(traj => {
            if (traj.trajectory) {
                drawTrajectory(traj.trajectory, robotParams);
            }
        });

        // Draw event markers for all trajectories in chain
        chain.forEach(traj => {
            if (traj.trajectory) {
                drawEventMarkers(traj);
            }
        });

        // Draw waypoints for the active trajectory
        drawWaypoints();

        // Draw robot at chain playback position
        const robotState = getChainRobotStateAtTime(state.playbackTime);
        if (robotState) {
            drawRobotAt(robotState.x, robotState.y, robotState.theta, robotParams);
        }
        return;
    }

    // Normal mode - draw inactive trajectories (greyed position trace only)
    state.trajectories.forEach(traj => {
        if (traj.id !== state.activeTrajectoryId) {
            drawInactiveTrajectory(traj);
        }
    });

    // Draw active trajectory
    const activeTraj = getActiveTrajectory();
    if (activeTraj && activeTraj.trajectory) {
        drawTrajectory(activeTraj.trajectory, robotParams);
    }

    // Draw waypoints for active trajectory
    drawWaypoints();

    // Draw event markers for active trajectory
    if (activeTraj && activeTraj.trajectory) {
        drawEventMarkers(activeTraj);
    }

    // Draw robot at playback time
    if (activeTraj && activeTraj.trajectory) {
        drawRobotAtTime(state.playbackTime, robotParams);
    }
}

function drawInactiveTrajectory(traj) {
    if (!traj.trajectory?.states?.length) return;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const states = traj.trajectory.states;
    const start = fieldToCanvas(states[0][3], states[0][4]);
    ctx.moveTo(start.x, start.y);

    for (let i = 1; i < states.length; i++) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        ctx.lineTo(pos.x, pos.y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawBackgroundImage() {
    const img = state.backgroundImage;
    const settings = state.backgroundSettings;
    const scale = getScale();

    ctx.save();
    ctx.globalAlpha = settings.opacity;

    // Move to center (0,0 in field coordinates)
    const center = fieldToCanvas(0, 0);
    ctx.translate(center.x, center.y);
    ctx.rotate(settings.rotation * Math.PI / 180);

    const scaleX = settings.mirrorH ? -1 : 1;
    const scaleY = settings.mirrorV ? -1 : 1;
    ctx.scale(scaleX * settings.scale, scaleY * settings.scale);

    const imgW = img.width || canvas.width;
    const imgH = img.height || canvas.height;
    const imgAspect = imgW / imgH;

    const drawSize = state.fieldSize * scale;
    let drawW, drawH;
    if (imgAspect > 1) {
        drawW = drawSize;
        drawH = drawSize / imgAspect;
    } else {
        drawH = drawSize;
        drawW = drawSize * imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
}

function drawGrid() {
    const scale = getScale();
    const halfField = state.fieldSize / 2;

    // Calculate grid spacing
    let gridSpacingM = 0.5;
    if (state.fieldSize > 10) gridSpacingM = 1.0;
    if (state.fieldSize > 15) gridSpacingM = 2.0;
    if (state.fieldSize < 2) gridSpacingM = 0.25;

    ctx.strokeStyle = '#2a2f3a';
    ctx.lineWidth = 1;

    // Draw grid lines (centered at 0,0)
    // Vertical lines
    for (let x = -halfField; x <= halfField; x += gridSpacingM) {
        const p1 = fieldToCanvas(x, -halfField);
        const p2 = fieldToCanvas(x, halfField);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }

    // Horizontal lines
    for (let y = -halfField; y <= halfField; y += gridSpacingM) {
        const p1 = fieldToCanvas(-halfField, y);
        const p2 = fieldToCanvas(halfField, y);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }

    // Draw center lines (axes at 0,0)
    ctx.strokeStyle = '#363c4a';
    ctx.lineWidth = 2;

    // Y-axis (vertical line at x=0)
    let p1 = fieldToCanvas(0, -halfField);
    let p2 = fieldToCanvas(0, halfField);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // X-axis (horizontal line at y=0)
    p1 = fieldToCanvas(-halfField, 0);
    p2 = fieldToCanvas(halfField, 0);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = '#4b5563';
    ctx.font = '11px "JetBrains Mono", monospace';

    const origin = fieldToCanvas(0, 0);
    const maxX = fieldToCanvas(halfField, 0);
    const maxY = fieldToCanvas(0, halfField);
    const minX = fieldToCanvas(-halfField, 0);
    const minY = fieldToCanvas(0, -halfField);

    ctx.fillText('0', origin.x + 4, origin.y - 4);
    ctx.fillText(`${halfField.toFixed(1)}`, maxX.x - 25, maxX.y - 4);
    ctx.fillText(`${(-halfField).toFixed(1)}`, minX.x + 4, minX.y - 4);
    ctx.fillText(`${halfField.toFixed(1)}`, maxY.x + 4, maxY.y + 14);
    ctx.fillText(`${(-halfField).toFixed(1)}`, minY.x + 4, minY.y + 14);
}

function drawConstraints() {
    const traj = getActiveTrajectory();
    if (!traj || !traj.constraints) return;

    traj.constraints.forEach((con, i) => {
        if (!con.enabled) return;

        const isSelected = state.selectedConstraintIndex === i;
        const alpha = isSelected ? 0.4 : 0.2;

        switch (con.type) {
            case 'circle-obstacle':
                drawCircleObstacle(con, isSelected, alpha);
                break;
            case 'stay-in-rect':
                drawStayInRect(con, isSelected, alpha);
                break;
            case 'stay-in-lane':
                drawStayInLane(con, traj.waypoints, isSelected, alpha);
                break;
            case 'heading-tangent':
                drawHeadingTangent(con, traj.waypoints, isSelected);
                break;
            case 'max-velocity':
                drawMaxVelocity(con, traj.waypoints, isSelected);
                break;
            case 'max-omega':
                drawMaxOmega(con, traj.waypoints, isSelected);
                break;
        }
    });

    // Draw constraint placement preview
    if (state.constraintPlacementStart !== null) {
        drawConstraintPlacementPreview();
    }
}

function drawCircleObstacle(con, isSelected, alpha) {
    const center = fieldToCanvas(con.params.cx, con.params.cy);
    const scale = getScale();
    const radiusPx = con.params.radius * scale;

    // Fill
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
    ctx.fill();

    // Border
    ctx.strokeStyle = isSelected ? '#ef4444' : 'rgba(239, 68, 68, 0.6)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Cross
    ctx.beginPath();
    ctx.moveTo(center.x - radiusPx * 0.5, center.y - radiusPx * 0.5);
    ctx.lineTo(center.x + radiusPx * 0.5, center.y + radiusPx * 0.5);
    ctx.moveTo(center.x + radiusPx * 0.5, center.y - radiusPx * 0.5);
    ctx.lineTo(center.x - radiusPx * 0.5, center.y + radiusPx * 0.5);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function drawStayInRect(con, isSelected, alpha) {
    const topLeft = fieldToCanvas(con.params.x, con.params.y + con.params.height);
    const scale = getScale();
    const widthPx = con.params.width * scale;
    const heightPx = con.params.height * scale;

    // Fill (green for allowed area)
    ctx.fillStyle = `rgba(34, 197, 94, ${alpha * 0.5})`;
    ctx.fillRect(topLeft.x, topLeft.y, widthPx, heightPx);

    // Dashed border
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = isSelected ? '#22c55e' : 'rgba(34, 197, 94, 0.6)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(topLeft.x, topLeft.y, widthPx, heightPx);
    ctx.setLineDash([]);
}

function drawStayInLane(con, waypoints, isSelected, alpha) {
    if (con.fromWaypoint >= waypoints.length || con.toWaypoint >= waypoints.length) return;

    const from = waypoints[con.fromWaypoint];
    const to = waypoints[con.toWaypoint];
    const fromPos = fieldToCanvas(from.x, from.y);
    const toPos = fieldToCanvas(to.x, to.y);

    // Calculate perpendicular direction
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const perpX = -dy / len;
    const perpY = dx / len;
    const scale = getScale();
    const halfWidth = con.params.width * scale / 2;

    // Draw lane as polygon
    ctx.beginPath();
    ctx.moveTo(fromPos.x + perpX * halfWidth, fromPos.y + perpY * halfWidth);
    ctx.lineTo(toPos.x + perpX * halfWidth, toPos.y + perpY * halfWidth);
    ctx.lineTo(toPos.x - perpX * halfWidth, toPos.y - perpY * halfWidth);
    ctx.lineTo(fromPos.x - perpX * halfWidth, fromPos.y - perpY * halfWidth);
    ctx.closePath();

    ctx.fillStyle = `rgba(59, 130, 246, ${alpha * 0.5})`;
    ctx.fill();

    // Dashed border
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = isSelected ? '#3b82f6' : 'rgba(59, 130, 246, 0.6)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawHeadingTangent(con, waypoints, isSelected) {
    // Draw small arrows on each waypoint in range to indicate heading follows tangent
    for (let i = con.fromWaypoint; i <= con.toWaypoint && i < waypoints.length; i++) {
        const wp = waypoints[i];
        const pos = fieldToCanvas(wp.x, wp.y);

        // Draw tangent indicator (small arrow)
        const arrowLen = 15;
        ctx.save();
        ctx.translate(pos.x, pos.y);

        // Purple arrow
        ctx.strokeStyle = isSelected ? '#a855f7' : 'rgba(168, 85, 247, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-arrowLen, 0);
        ctx.lineTo(arrowLen, 0);
        ctx.lineTo(arrowLen - 5, -5);
        ctx.moveTo(arrowLen, 0);
        ctx.lineTo(arrowLen - 5, 5);
        ctx.stroke();

        ctx.restore();
    }
}

function drawMaxVelocity(con, waypoints, isSelected) {
    // Draw a speed indicator on waypoints in range
    for (let i = con.fromWaypoint; i <= con.toWaypoint && i < waypoints.length; i++) {
        const wp = waypoints[i];
        const pos = fieldToCanvas(wp.x, wp.y);

        ctx.save();
        ctx.translate(pos.x, pos.y - 22);

        // Orange bolt icon for velocity
        ctx.strokeStyle = isSelected ? '#f97316' : 'rgba(249, 115, 22, 0.6)';
        ctx.fillStyle = isSelected ? '#f97316' : 'rgba(249, 115, 22, 0.4)';
        ctx.lineWidth = 1.5;

        // Lightning bolt shape
        ctx.beginPath();
        ctx.moveTo(2, -6);
        ctx.lineTo(-3, 0);
        ctx.lineTo(0, 0);
        ctx.lineTo(-2, 6);
        ctx.lineTo(3, 0);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }
}

function drawMaxOmega(con, waypoints, isSelected) {
    // Draw a rotation indicator on waypoints in range
    for (let i = con.fromWaypoint; i <= con.toWaypoint && i < waypoints.length; i++) {
        const wp = waypoints[i];
        const pos = fieldToCanvas(wp.x, wp.y);

        ctx.save();
        ctx.translate(pos.x + 22, pos.y);

        // Cyan rotation arc for angular velocity
        ctx.strokeStyle = isSelected ? '#06b6d4' : 'rgba(6, 182, 212, 0.6)';
        ctx.lineWidth = 2;

        // Arc with arrow
        ctx.beginPath();
        ctx.arc(0, 0, 6, -Math.PI * 0.7, Math.PI * 0.5);
        ctx.stroke();

        // Arrow head
        ctx.beginPath();
        ctx.moveTo(3, 5);
        ctx.lineTo(6, 3);
        ctx.lineTo(3, 1);
        ctx.stroke();

        ctx.restore();
    }
}

function drawConstraintPlacementPreview() {
    // Show preview for rectangle-based constraints during placement
    // This will be implemented when we handle two-click placement
}

function drawWaypoints() {
    const traj = getActiveTrajectory();
    if (!traj) return;

    traj.waypoints.forEach((wp, i) => {
        if (wp.type === undefined) wp.type = 'constrained';

        const isSelected = state.selectedWaypointIndex === i;
        const isLockedFirst = i === 0 && traj.followsTrajectoryId;

        if (wp.type === 'intake') {
            drawIntakeWaypoint(wp, i, isSelected);
        } else if (wp.type === 'unconstrained') {
            drawUnconstrainedWaypoint(wp, i, isSelected);
        } else {
            drawConstrainedWaypoint(wp, i, isSelected, isLockedFirst);
        }
    });
}

function drawConstrainedWaypoint(wp, index, isSelected, isLocked = false) {
    const pos = fieldToCanvas(wp.x, wp.y);

    // Waypoint circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = isSelected ? '#3b82f6' : (wp.stop ? '#f0f2f5' : '#9ca3af');
    ctx.fill();

    if (isSelected) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Draw dashed border for locked waypoints
    if (isLocked) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS + 4, 0, 2 * Math.PI);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Heading line
    const headingEndX = pos.x + Math.cos(-wp.heading) * HEADING_LINE_LENGTH;
    const headingEndY = pos.y + Math.sin(-wp.heading) * HEADING_LINE_LENGTH;

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(headingEndX, headingEndY);
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Heading handle
    ctx.beginPath();
    ctx.arc(headingEndX, headingEndY, HEADING_HANDLE_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = '#6b7280';
    ctx.fill();
    ctx.strokeStyle = '#f0f2f5';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Index number
    ctx.fillStyle = isSelected ? '#ffffff' : '#0a0b0f';
    ctx.font = 'bold 12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), pos.x, pos.y);
}

function drawUnconstrainedWaypoint(wp, index, isSelected) {
    const pos = fieldToCanvas(wp.x, wp.y);

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, WAYPOINT_RADIUS, 0, 2 * Math.PI);
    ctx.strokeStyle = isSelected ? '#3b82f6' : (wp.stop ? '#f0f2f5' : '#9ca3af');
    ctx.lineWidth = 3;
    ctx.stroke();

    if (isSelected) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 5;
        ctx.stroke();
    }

    // Index number
    ctx.fillStyle = isSelected ? '#3b82f6' : '#f0f2f5';
    ctx.font = 'bold 12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), pos.x, pos.y);
}

function drawIntakeWaypoint(wp, index, isSelected) {
    const intakePos = fieldToCanvas(wp.intake_x, wp.intake_y);
    const scale = getScale();
    const distPixels = wp.intake_distance * scale;

    // Distance circle
    ctx.beginPath();
    ctx.arc(intakePos.x, intakePos.y, distPixels, 0, 2 * Math.PI);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = isSelected ? '#f59e0b' : '#6b7280';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // X marker
    const markerSize = 10;
    ctx.beginPath();
    ctx.moveTo(intakePos.x - markerSize, intakePos.y - markerSize);
    ctx.lineTo(intakePos.x + markerSize, intakePos.y + markerSize);
    ctx.moveTo(intakePos.x + markerSize, intakePos.y - markerSize);
    ctx.lineTo(intakePos.x - markerSize, intakePos.y + markerSize);
    ctx.strokeStyle = isSelected ? '#fbbf24' : '#f59e0b';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (isSelected) {
        ctx.beginPath();
        ctx.arc(intakePos.x, intakePos.y, markerSize + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Index number
    ctx.fillStyle = isSelected ? '#fbbf24' : '#f59e0b';
    ctx.font = 'bold 12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), intakePos.x, intakePos.y - markerSize - 12);
}

export function drawTrajectory(trajectory, robotParams) {
    if (!trajectory || trajectory.states.length < 2) return;

    const states = trajectory.states;

    // Draw path
    ctx.beginPath();
    const firstPos = fieldToCanvas(states[0][3], states[0][4]);
    ctx.moveTo(firstPos.x, firstPos.y);

    for (let i = 1; i < states.length; i++) {
        const pos = fieldToCanvas(states[i][3], states[i][4]);
        ctx.lineTo(pos.x, pos.y);
    }

    ctx.strokeStyle = '#f0f2f5';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw robot poses
    for (let i = 0; i < states.length; i++) {
        drawRobotPose(states[i][3], states[i][4], states[i][5], 0.25, robotParams);
    }
}

function drawRobotPose(x, y, theta, alpha = 1.0, robotParams) {
    const pos = fieldToCanvas(x, y);
    const scale = getScale();
    const halfW = robotParams.ly * scale;  // ly is half-width
    const halfL = robotParams.lx * scale;  // lx is half-length

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(-theta);

    ctx.strokeStyle = `rgba(240, 242, 245, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-halfL, -halfW, 2 * halfL, 2 * halfW);

    // Front indicator
    ctx.beginPath();
    ctx.moveTo(halfL, -halfW * 0.5);
    ctx.lineTo(halfL + 4, 0);
    ctx.lineTo(halfL, halfW * 0.5);
    ctx.stroke();

    ctx.restore();
}

export function drawRobotAtTime(time, robotParams) {
    const traj = getActiveTrajectory();
    if (!traj || !traj.trajectory) return;

    const times = traj.trajectory.times;
    const states = traj.trajectory.states;

    let idx = 0;
    for (let i = 0; i < times.length - 1; i++) {
        if (times[i + 1] >= time) {
            idx = i;
            break;
        }
    }

    const t0 = times[idx];
    const t1 = times[idx + 1] || times[idx];
    const alpha = t1 > t0 ? (time - t0) / (t1 - t0) : 0;

    const s0 = states[idx];
    const s1 = states[idx + 1] || states[idx];

    const px = s0[3] + alpha * (s1[3] - s0[3]);
    const py = s0[4] + alpha * (s1[4] - s0[4]);
    const theta = s0[5] + alpha * (s1[5] - s0[5]);

    drawRobotAt(px, py, theta, robotParams);
}

export function drawRobotAt(px, py, theta, robotParams) {
    const pos = fieldToCanvas(px, py);
    const scale = getScale();
    const halfW = robotParams.ly * scale;  // ly is half-width
    const halfL = robotParams.lx * scale;  // lx is half-length

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(-theta);

    ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';
    ctx.fillRect(-halfL, -halfW, 2 * halfL, 2 * halfW);

    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.strokeRect(-halfL, -halfW, 2 * halfL, 2 * halfW);

    // Front indicator
    ctx.beginPath();
    ctx.moveTo(halfL, -halfW * 0.5);
    ctx.lineTo(halfL + 6, 0);
    ctx.lineTo(halfL, halfW * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#3b82f6';
    ctx.fill();

    ctx.restore();
}

function drawEventMarkers(traj) {
    if (!traj.eventMarkers || !traj.trajectory) return;

    const times = traj.trajectory.times;
    const states = traj.trajectory.states;

    for (const marker of traj.eventMarkers) {
        if (marker.timestamp === null || marker.timestamp === undefined) continue;

        // Find position at marker timestamp by interpolating trajectory states
        let idx = 0;
        for (let i = 0; i < times.length - 1; i++) {
            if (times[i + 1] >= marker.timestamp) {
                idx = i;
                break;
            }
            idx = i;
        }

        const t0 = times[idx];
        const t1 = times[idx + 1] || times[idx];
        const alpha = t1 > t0 ? (marker.timestamp - t0) / (t1 - t0) : 0;

        const s0 = states[idx];
        const s1 = states[idx + 1] || states[idx];

        const mx = s0[3] + alpha * (s1[3] - s0[3]);
        const my = s0[4] + alpha * (s1[4] - s0[4]);

        const pos = fieldToCanvas(mx, my);

        // Draw diamond marker
        const size = 7;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(Math.PI / 4);

        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-size / 2, -size / 2, size, size);

        ctx.restore();

        // Draw label
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(marker.name, pos.x + size + 2, pos.y - 2);
    }
}
