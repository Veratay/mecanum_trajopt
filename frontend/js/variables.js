/**
 * Variables Panel Management
 * Handles user-defined variables that can be used in expressions
 */

import { state } from './state.js';
import { ExpressionEvaluator, validateVariableName } from './expressions.js';
import { markUnsaved } from './project.js';

/**
 * Initialize the variables panel
 */
export function initVariablesPanel() {
    const addBtn = document.getElementById('add-variable-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => addVariable());
    }

    renderVariablesList();
}

/**
 * Render the list of variables
 */
export function renderVariablesList() {
    const container = document.getElementById('variables-list');
    if (!container) return;

    container.innerHTML = '';

    if (state.variables.vars.size === 0) {
        container.innerHTML = '<div class="empty-state">No variables defined</div>';
        return;
    }

    // Show linked indicator if variables are linked
    if (state.variables.linkedFrom) {
        const linkedDiv = document.createElement('div');
        linkedDiv.className = 'linked-indicator';
        linkedDiv.innerHTML = `
            <span class="linked-text">Linked from: ${state.variables.linkedFrom}</span>
            <button class="btn-icon btn-small" onclick="window.unlinkVariables()" title="Unlink">
                <i class="icon-unlink"></i>
            </button>
        `;
        container.appendChild(linkedDiv);
    }

    // Render each variable
    const sortedVars = Array.from(state.variables.vars.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
    );

    for (const [name, data] of sortedVars) {
        const varDiv = document.createElement('div');
        varDiv.className = 'variable-item';

        const isLinked = data.linkedFrom !== null;

        varDiv.innerHTML = `
            <div class="variable-name ${isLinked ? 'linked' : ''}" title="${isLinked ? `From: ${data.linkedFrom}` : ''}">${name}</div>
            <input type="number"
                   class="variable-value ${isLinked ? 'linked-input' : ''}"
                   value="${data.value}"
                   step="0.1"
                   ${isLinked ? 'readonly' : ''}
                   data-varname="${name}">
            <button class="btn-icon btn-small"
                    onclick="window.deleteVariable('${name}')"
                    title="Delete Variable"
                    ${isLinked ? 'disabled' : ''}>
                <i class="icon-trash"></i>
            </button>
        `;

        // Add event listener for value changes
        const input = varDiv.querySelector('.variable-value');
        if (!isLinked) {
            input.addEventListener('change', (e) => {
                const newValue = parseFloat(e.target.value);
                if (!isNaN(newValue) && isFinite(newValue)) {
                    updateVariable(name, newValue);
                } else {
                    // Revert to previous value
                    e.target.value = data.value;
                }
            });
        }

        container.appendChild(varDiv);
    }
}

/**
 * Add a new variable
 */
export function addVariable() {
    const name = prompt('Enter variable name (letters, numbers, underscore):');
    if (!name) return;

    const trimmed = name.trim();

    // Validate name
    const validation = validateVariableName(trimmed);
    if (!validation.valid) {
        alert(validation.error);
        return;
    }

    // Check for duplicates
    if (state.variables.vars.has(trimmed)) {
        alert(`Variable '${trimmed}' already exists`);
        return;
    }

    // Add variable with default value 0
    state.variables.vars.set(trimmed, {
        value: 0,
        linkedFrom: null
    });

    markUnsaved();
    renderVariablesList();
}

/**
 * Update a variable's value and re-evaluate all expressions that use it
 */
export function updateVariable(name, newValue) {
    if (!state.variables.vars.has(name)) {
        console.error(`Variable '${name}' not found`);
        return;
    }

    const varData = state.variables.vars.get(name);

    // Don't update if linked
    if (varData.linkedFrom !== null) {
        alert('Cannot modify linked variable. Unlink first to edit.');
        return;
    }

    const oldValue = varData.value;
    if (oldValue === newValue) {
        return; // No change
    }

    varData.value = newValue;
    markUnsaved();

    // Re-evaluate all expressions that use this variable
    reevaluateAllExpressions();

    // Update the UI
    renderVariablesList();
}

/**
 * Delete a variable
 */
export function deleteVariable(name) {
    if (!state.variables.vars.has(name)) {
        return;
    }

    const varData = state.variables.vars.get(name);

    // Don't delete if linked
    if (varData.linkedFrom !== null) {
        alert('Cannot delete linked variable. Unlink first to delete.');
        return;
    }

    // Check if variable is used in any expression
    const usedIn = findVariableUsage(name);

    if (usedIn.length > 0) {
        const locations = usedIn.map(u => `  • ${u}`).join('\n');
        const confirmed = confirm(
            `Variable '${name}' is used in ${usedIn.length} location(s):\n\n${locations}\n\nDeleting will revert these fields to their computed values. Continue?`
        );

        if (!confirmed) {
            return;
        }

        // Remove all expressions that use this variable
        for (const [key, expr] of state.expressionMap.entries()) {
            const evaluator = new ExpressionEvaluator(state.variables.vars);
            const vars = evaluator.extractVariables(expr);
            if (vars.has(name)) {
                state.expressionMap.delete(key);
            }
        }
    }

    // Delete the variable
    state.variables.vars.delete(name);
    markUnsaved();

    // Re-render everything
    renderVariablesList();

    // Notify other modules to update (will be called by reevaluateAllExpressions)
    reevaluateAllExpressions();
}

/**
 * Find all expressions that use a variable
 */
function findVariableUsage(varName) {
    const evaluator = new ExpressionEvaluator(state.variables.vars);
    const locations = [];

    for (const [key, expr] of state.expressionMap.entries()) {
        const vars = evaluator.extractVariables(expr);
        if (vars.has(varName)) {
            locations.push(formatExpressionKey(key));
        }
    }

    return locations;
}

/**
 * Format an expression key for display
 */
function formatExpressionKey(key) {
    const parts = key.split(':');

    if (parts[0] === 'waypoint') {
        return `Waypoint ${parseInt(parts[2]) + 1} - ${parts[3]}`;
    } else if (parts[0] === 'constraint') {
        return `Constraint - ${parts[3]}`;
    } else if (parts[0] === 'robotParam') {
        return `Robot Parameter - ${parts[1]}`;
    } else if (parts[0] === 'solverSetting') {
        return `Solver Setting - ${parts[2]}`;
    }

    return key;
}

/**
 * Re-evaluate all expressions in the application
 * This should be called when variables change
 */
export function reevaluateAllExpressions() {
    const evaluator = new ExpressionEvaluator(state.variables.vars);
    let hasErrors = false;
    const errors = [];

    for (const [key, expr] of state.expressionMap.entries()) {
        const result = evaluator.evaluate(expr);

        if (result.success) {
            // Update the value based on the key type
            updateValueFromExpression(key, result.value);
        } else {
            hasErrors = true;
            errors.push(`${formatExpressionKey(key)}: ${result.error}`);
        }
    }

    if (hasErrors) {
        console.warn('Expression evaluation errors:', errors);
    }

    // Trigger UI updates
    notifyExpressionsChanged();
}

/**
 * Update a value based on its expression key
 */
function updateValueFromExpression(key, value) {
    const parts = key.split(':');

    if (parts[0] === 'waypoint') {
        const trajId = parts[1];
        const wpIndex = parseInt(parts[2]);
        const field = parts[3];

        const traj = state.trajectories.find(t => t.id === trajId);
        if (traj && traj.waypoints[wpIndex]) {
            const wp = traj.waypoints[wpIndex];
            const oldValue = wp[field];

            switch (field) {
                case 'x': wp.x = value; break;
                case 'y': wp.y = value; break;
                case 'heading': wp.heading = value; break;
                case 'v_max': wp.v_max = value; break;
                case 'omega_max': wp.omega_max = value; break;
            }

            // Only mark trajectory as needing re-solve if value actually changed
            const epsilon = 1e-9;
            if (Math.abs(value - oldValue) > epsilon) {
                traj.trajectory = null;
            }
        }
    } else if (parts[0] === 'constraint') {
        const trajId = parts[1];
        const constraintId = parts[2];
        const field = parts[3];

        const traj = state.trajectories.find(t => t.id === trajId);
        if (traj) {
            const constraint = traj.constraints.find(c => c.id === constraintId);
            if (constraint && constraint.params) {
                const oldValue = constraint.params[field];
                constraint.params[field] = value;

                // Only mark trajectory as needing re-solve if value actually changed
                const epsilon = 1e-9;
                if (Math.abs(value - oldValue) > epsilon) {
                    traj.trajectory = null;
                }
            }
        }
    }
    // Add more cases for robotParam, solverSetting as needed
}

/**
 * Notify other modules that expressions have changed
 */
function notifyExpressionsChanged() {
    // Trigger re-render of waypoints panel
    if (window.renderWaypointsList) {
        window.renderWaypointsList();
    }

    // Trigger re-render of constraints panel
    if (window.renderConstraintsList) {
        window.renderConstraintsList();
    }

    // Trigger canvas redraw
    if (window.render) {
        window.render();
    }
}

// Expose functions to window for onclick handlers and other modules
window.deleteVariable = deleteVariable;
window.reevaluateAllExpressions = reevaluateAllExpressions;
window.renderVariablesPanel = renderVariablesList;
window.unlinkVariables = function() {
    if (state.variables.linkedFrom) {
        state.variables.linkedFrom = null;

        // Keep variable values but remove linkedFrom on each
        for (const [name, data] of state.variables.vars.entries()) {
            data.linkedFrom = null;
        }

        markUnsaved();
        renderVariablesList();
    }
};
