/**
 * Project Linking
 * Allows importing robot parameters and variables from other projects
 */

import { state } from './state.js';
import { markUnsaved } from './project.js';
import { reevaluateAllExpressions, renderVariablesList } from './variables.js';

/**
 * Initialize linking buttons
 */
export function initLinking() {
    const linkRobotBtn = document.getElementById('link-robot-params-btn');
    const linkVarsBtn = document.getElementById('link-variables-btn');

    if (linkRobotBtn) {
        linkRobotBtn.addEventListener('click', linkRobotParamsFromProject);
    }

    if (linkVarsBtn) {
        linkVarsBtn.addEventListener('click', linkVariablesFromProject);
    }
}

/**
 * Show modal to link robot parameters from another project
 */
export async function linkRobotParamsFromProject() {
    // Get list of available projects
    try {
        const response = await fetch('/projects');
        const data = await response.json();

        if (!data.projects || data.projects.length === 0) {
            alert('No other projects available to link from');
            return;
        }

        // Create and show modal
        const modal = createLinkModal('Link Robot Parameters', data.projects);
        document.body.appendChild(modal);

        // Handle selection
        const selectBtn = modal.querySelector('.link-confirm-btn');
        const cancelBtn = modal.querySelector('.link-cancel-btn');
        const select = modal.querySelector('.link-project-select');

        selectBtn.addEventListener('click', async () => {
            const selectedFilename = select.value;
            if (!selectedFilename) {
                alert('Please select a project');
                return;
            }

            // Load the selected project
            const projectResponse = await fetch(`/projects/${selectedFilename}`);
            const projectData = await projectResponse.json();

            if (!projectData.robotParams) {
                alert('Selected project has no robot parameters');
                document.body.removeChild(modal);
                return;
            }

            // Copy robot params to current project
            const rp = projectData.robotParams;
            document.getElementById('param-mass').value = rp.mass ?? 15.0;
            document.getElementById('param-inertia').value = rp.inertia ?? 0.5;
            document.getElementById('param-wheel-radius').value = rp.wheel_radius ?? 0.05;
            document.getElementById('param-lx').value = rp.lx ?? 0.15;
            document.getElementById('param-ly').value = rp.ly ?? 0.15;
            document.getElementById('param-wmax').value = rp.w_max ?? 100;
            document.getElementById('param-tmax').value = rp.t_max ?? 1.0;
            document.getElementById('param-ftraction').value = rp.f_traction_max ?? 20.0;
            document.getElementById('param-intake-distance').value = rp.default_intake_distance ?? 0.5;
            document.getElementById('param-intake-velocity').value = rp.default_intake_velocity ?? 1.0;

            // Set linkedFrom
            state.robotParams.linkedFrom = selectedFilename;

            markUnsaved();
            document.body.removeChild(modal);

            alert(`Robot parameters linked from ${selectedFilename}`);
        });

        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });

    } catch (error) {
        console.error('Failed to load projects:', error);
        alert('Failed to load projects list');
    }
}

/**
 * Show modal to link variables from another project
 */
export async function linkVariablesFromProject() {
    // Get list of available projects
    try {
        const response = await fetch('/projects');
        const data = await response.json();

        if (!data.projects || data.projects.length === 0) {
            alert('No other projects available to link from');
            return;
        }

        // Create and show modal
        const modal = createLinkModal('Link Variables', data.projects);
        document.body.appendChild(modal);

        // Handle selection
        const selectBtn = modal.querySelector('.link-confirm-btn');
        const cancelBtn = modal.querySelector('.link-cancel-btn');
        const select = modal.querySelector('.link-project-select');

        selectBtn.addEventListener('click', async () => {
            const selectedFilename = select.value;
            if (!selectedFilename) {
                alert('Please select a project');
                return;
            }

            // Load the selected project
            const projectResponse = await fetch(`/projects/${selectedFilename}`);
            const projectData = await projectResponse.json();

            if (!projectData.variables || !projectData.variables.vars || projectData.variables.vars.length === 0) {
                alert('Selected project has no variables');
                document.body.removeChild(modal);
                return;
            }

            // Merge variables into current project
            const conflicts = [];
            projectData.variables.vars.forEach(v => {
                if (state.variables.vars.has(v.name)) {
                    conflicts.push(v.name);
                }

                state.variables.vars.set(v.name, {
                    value: v.value,
                    linkedFrom: selectedFilename
                });
            });

            // Set linkedFrom
            state.variables.linkedFrom = selectedFilename;

            // Re-evaluate all expressions
            reevaluateAllExpressions();

            markUnsaved();
            renderVariablesList();
            document.body.removeChild(modal);

            if (conflicts.length > 0) {
                alert(`Variables linked from ${selectedFilename}.\n\nOverwrote existing variables: ${conflicts.join(', ')}`);
            } else {
                alert(`Variables linked from ${selectedFilename}`);
            }
        });

        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });

    } catch (error) {
        console.error('Failed to load projects:', error);
        alert('Failed to load projects list');
    }
}

/**
 * Create a modal for selecting a project to link from
 */
function createLinkModal(title, projects) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';

    // Filter out current project
    const filteredProjects = projects.filter(p => p.filename !== state.projectFilename);

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
            </div>
            <div class="modal-body">
                <label>Select Project:</label>
                <select class="link-project-select">
                    <option value="">-- Select a project --</option>
                    ${filteredProjects.map(p => `
                        <option value="${p.filename}">${p.name || p.filename}</option>
                    `).join('')}
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn-secondary link-cancel-btn">Cancel</button>
                <button class="btn-primary link-confirm-btn">Link</button>
            </div>
        </div>
    `;

    return modal;
}

/**
 * Unlink robot parameters (keep values but remove link reference)
 */
export function unlinkRobotParams() {
    if (state.robotParams.linkedFrom) {
        state.robotParams.linkedFrom = null;
        markUnsaved();
        alert('Robot parameters unlinked. Values have been kept.');
    }
}

/**
 * Unlink variables (keep values but remove link references)
 */
export function unlinkVariables() {
    if (state.variables.linkedFrom) {
        state.variables.linkedFrom = null;

        // Keep variable values but remove linkedFrom on each
        for (const [name, data] of state.variables.vars.entries()) {
            data.linkedFrom = null;
        }

        markUnsaved();
        renderVariablesList();
        alert('Variables unlinked. Values have been kept.');
    }
}
