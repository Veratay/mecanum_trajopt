/**
 * Background image handling
 */

import { state } from './state.js';

// UI update callbacks (set during init)
let renderFn = null;
let markUnsavedFn = null;

// DOM elements
let bgImageInput = null;
let bgControls = null;
let bgScaleSlider = null;
let bgRotationSlider = null;
let bgOpacitySlider = null;
let bgMirrorH = null;
let bgMirrorV = null;

export function initBackground(callbacks, elements) {
    renderFn = callbacks.render;
    markUnsavedFn = callbacks.markUnsaved;

    bgImageInput = elements.bgImageInput;
    bgControls = elements.bgControls;
    bgScaleSlider = elements.bgScaleSlider;
    bgRotationSlider = elements.bgRotationSlider;
    bgOpacitySlider = elements.bgOpacitySlider;
    bgMirrorH = elements.bgMirrorH;
    bgMirrorV = elements.bgMirrorV;
}

export async function handleBackgroundImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Upload to server
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/images/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Failed to upload image');

        const data = await response.json();
        state.backgroundImageFilename = data.filename;

        // Load the image from server
        const img = new Image();
        img.onload = () => {
            state.backgroundImage = img;
            bgControls.style.display = 'block';
            markUnsavedFn();
            renderFn();
        };
        img.src = `/images/${data.filename}`;
    } catch (error) {
        alert(`Error uploading image: ${error.message}`);
        // Fallback to local display (but won't be saved with project)
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                state.backgroundImage = img;
                bgControls.style.display = 'block';
                renderFn();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
}

export function clearBackgroundImage() {
    state.backgroundImage = null;
    state.backgroundImageFilename = null;
    bgControls.style.display = 'none';
    bgImageInput.value = '';
    markUnsavedFn();
    renderFn();
}

export function handleBgSettingChange() {
    state.backgroundSettings.scale = parseFloat(bgScaleSlider.value);
    state.backgroundSettings.rotation = parseFloat(bgRotationSlider.value);
    state.backgroundSettings.opacity = parseFloat(bgOpacitySlider.value);
    state.backgroundSettings.mirrorH = bgMirrorH.checked;
    state.backgroundSettings.mirrorV = bgMirrorV.checked;

    document.getElementById('bg-scale-value').textContent = state.backgroundSettings.scale.toFixed(2);
    document.getElementById('bg-rotation-value').textContent = state.backgroundSettings.rotation + '°';
    document.getElementById('bg-opacity-value').textContent = state.backgroundSettings.opacity.toFixed(2);

    markUnsavedFn();
    renderFn();
}

export function handleFieldSizeChange(e) {
    const newSize = parseFloat(e.target.value);
    if (newSize > 0 && newSize <= 20) {
        state.fieldSize = newSize;
        markUnsavedFn();
        renderFn();
    }
}
