/**
 * Canvas sizing and coordinate transforms
 */

import { state } from './state.js';

// Canvas and context references (set during init)
export let canvas = null;
export let ctx = null;
export let canvasContainer = null;

export function initCanvas() {
    canvas = document.getElementById('field-canvas');
    ctx = canvas.getContext('2d');
    canvasContainer = document.getElementById('canvas-container');
}

export function resizeCanvas(render) {
    const wrapper = document.querySelector('.canvas-wrapper');
    const maxSize = Math.min(wrapper.clientWidth - 32, wrapper.clientHeight - 32, 800);
    const size = Math.max(400, maxSize);

    canvas.width = size;
    canvas.height = size;

    render();
}

export function getScale() {
    return (canvas.width / state.fieldSize) * state.view.scale;
}

export function canvasToField(canvasX, canvasY) {
    const scale = getScale();
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // 0,0 is at center of field
    const x = (canvasX - centerX - state.view.x) / scale;
    const y = (centerY - canvasY + state.view.y) / scale;

    return { x, y };
}

export function fieldToCanvas(fieldX, fieldY) {
    const scale = getScale();
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // 0,0 is at center of field
    const x = fieldX * scale + centerX + state.view.x;
    const y = centerY - fieldY * scale + state.view.y;

    return { x, y };
}

export function zoom(factor, centerX, centerY, render) {
    if (centerX === undefined) centerX = canvas.width / 2;
    if (centerY === undefined) centerY = canvas.height / 2;

    const newScale = Math.max(state.view.minScale, Math.min(state.view.maxScale, state.view.scale * factor));

    if (newScale !== state.view.scale) {
        // Zoom towards mouse position
        const dx = centerX - canvas.width / 2 - state.view.x;
        const dy = centerY - canvas.height / 2 - state.view.y;

        state.view.x -= dx * (factor - 1);
        state.view.y -= dy * (factor - 1);
        state.view.scale = newScale;

        render();
    }
}

export function fitToView(render) {
    state.view.x = 0;
    state.view.y = 0;
    state.view.scale = 1.0;
    render();
}
