/**
 * Playback controls and animation
 */

import { state, getActiveTrajectory } from './state.js';
import { getTrajectoryChain } from './trajectories.js';

// UI update callbacks (set during init)
let renderFn = null;

// DOM elements
let playBtn = null;
let chainPlayBtn = null;
let resetBtn = null;
let timeSlider = null;
let timeDisplay = null;
let playbackProgress = null;

export function initPlayback(callbacks, elements) {
    renderFn = callbacks.render;

    playBtn = elements.playBtn;
    chainPlayBtn = elements.chainPlayBtn;
    resetBtn = elements.resetBtn;
    timeSlider = elements.timeSlider;
    timeDisplay = elements.timeDisplay;
    playbackProgress = elements.playbackProgress;
}

export function updatePlaybackControls() {
    const traj = getActiveTrajectory();
    const hasTrajectory = traj && traj.trajectory !== null;
    playBtn.disabled = !hasTrajectory;
    resetBtn.disabled = !hasTrajectory;
    timeSlider.disabled = !hasTrajectory;

    // Check if there's a chain with solved trajectories
    const chain = traj ? getTrajectoryChain(traj.id) : [];
    const hasChain = chain.length > 1 && chain.every(t => t.trajectory !== null);
    chainPlayBtn.disabled = !hasChain;

    if (hasTrajectory) {
        timeSlider.max = 1000;
        timeSlider.value = 0;
        state.playbackTime = 0;
        timeDisplay.textContent = '0.00s';
        playbackProgress.style.width = '0%';
    }
}

export function togglePlayback() {
    const traj = getActiveTrajectory();
    if (state.isPlaying) {
        stopPlayback();
    } else {
        if (traj && traj.trajectory && state.playbackTime >= traj.trajectory.totalTime) {
            state.playbackTime = 0;
            timeSlider.value = 0;
            timeDisplay.textContent = '0.00s';
            playbackProgress.style.width = '0%';
        }
        startPlayback();
    }
}

export function startPlayback() {
    const traj = getActiveTrajectory();
    if (!traj || !traj.trajectory) return;

    state.isPlaying = true;
    playBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
        </svg>
    `;
    playBtn.classList.add('playing');

    const totalTime = traj.trajectory.totalTime;
    const startRealTime = performance.now();
    const startPlaybackTime = state.playbackTime;

    function animate() {
        if (!state.isPlaying) return;

        const elapsed = (performance.now() - startRealTime) / 1000;
        state.playbackTime = startPlaybackTime + elapsed;

        if (state.playbackTime >= totalTime) {
            state.playbackTime = totalTime;
            stopPlayback();
        }

        const progress = state.playbackTime / totalTime;
        timeSlider.value = Math.round(progress * 1000);
        timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';
        playbackProgress.style.width = `${progress * 100}%`;

        renderFn();

        if (state.isPlaying) {
            state.animationId = requestAnimationFrame(animate);
        }
    }

    state.animationId = requestAnimationFrame(animate);
}

export function stopPlayback() {
    state.isPlaying = false;
    playBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
    `;
    playBtn.classList.remove('playing');

    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }
    renderFn();
}

export function resetPlayback() {
    stopPlayback();
    if (state.isChainPlaying) {
        stopChainPlayback();
    }
    state.playbackTime = 0;
    timeSlider.value = 0;
    timeDisplay.textContent = '0.00s';
    playbackProgress.style.width = '0%';
    renderFn();
}

export function handleSliderChange(e) {
    const traj = getActiveTrajectory();
    if (!traj || !traj.trajectory) return;

    const progress = e.target.value / 1000;
    state.playbackTime = progress * traj.trajectory.totalTime;
    timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';
    playbackProgress.style.width = `${progress * 100}%`;

    if (!state.isPlaying) {
        renderFn();
    }
}

// Chain playback
export function toggleChainPlayback() {
    if (state.isChainPlaying) {
        stopChainPlayback();
    } else {
        startChainPlayback();
    }
}

export function startChainPlayback() {
    const traj = getActiveTrajectory();
    if (!traj) return;

    const chain = getTrajectoryChain(traj.id);
    if (chain.length === 0 || !chain.every(t => t.trajectory !== null)) return;

    // Calculate total time for all trajectories in chain
    let totalTime = 0;
    const timings = [];
    chain.forEach(t => {
        timings.push({ start: totalTime, traj: t });
        totalTime += t.trajectory.totalTime;
    });

    state.isChainPlaying = true;
    state.isPlaying = false;
    state.chainPlaybackData = {
        chain: chain,
        timings: timings,
        totalTime: totalTime,
        currentIndex: 0
    };
    state.playbackTime = 0;

    chainPlayBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
        </svg>
    `;
    chainPlayBtn.classList.add('playing');
    playBtn.disabled = true;
    timeSlider.disabled = true;

    const startRealTime = performance.now();

    function animateChain() {
        if (!state.isChainPlaying) return;

        const elapsed = (performance.now() - startRealTime) / 1000;
        state.playbackTime = elapsed;

        if (state.playbackTime >= totalTime) {
            state.playbackTime = totalTime;
            stopChainPlayback();
        }

        const progress = state.playbackTime / totalTime;
        timeDisplay.textContent = state.playbackTime.toFixed(2) + 's';
        playbackProgress.style.width = `${progress * 100}%`;

        renderFn();

        if (state.isChainPlaying) {
            state.animationId = requestAnimationFrame(animateChain);
        }
    }

    state.animationId = requestAnimationFrame(animateChain);
}

export function stopChainPlayback() {
    state.isChainPlaying = false;
    state.chainPlaybackData = null;

    chainPlayBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="3 3 13 12 3 21 3 3"/>
            <polygon points="13 3 23 12 13 21 13 3"/>
        </svg>
    `;
    chainPlayBtn.classList.remove('playing');

    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }

    updatePlaybackControls();
    renderFn();
}

export function getChainRobotStateAtTime(time) {
    if (!state.chainPlaybackData) return null;

    const { timings, totalTime } = state.chainPlaybackData;

    // Find which trajectory we're in
    let currentTraj = null;
    let localTime = 0;

    for (let i = 0; i < timings.length; i++) {
        const timing = timings[i];
        const trajDuration = timing.traj.trajectory.totalTime;
        const trajEnd = timing.start + trajDuration;

        if (time <= trajEnd || i === timings.length - 1) {
            currentTraj = timing.traj;
            localTime = Math.max(0, Math.min(time - timing.start, trajDuration));
            break;
        }
    }

    if (!currentTraj || !currentTraj.trajectory) return null;

    const times = currentTraj.trajectory.times;
    const states = currentTraj.trajectory.states;

    let idx = 0;
    for (let i = 0; i < times.length - 1; i++) {
        if (times[i + 1] >= localTime) {
            idx = i;
            break;
        }
        idx = i;
    }

    const t0 = times[idx];
    const t1 = times[idx + 1] || times[idx];
    const alpha = t1 > t0 ? (localTime - t0) / (t1 - t0) : 0;

    const s0 = states[idx];
    const s1 = states[idx + 1] || states[idx];

    return {
        x: s0[3] + alpha * (s1[3] - s0[3]),
        y: s0[4] + alpha * (s1[4] - s0[4]),
        theta: s0[5] + alpha * (s1[5] - s0[5]),
        trajectoryId: currentTraj.id
    };
}
