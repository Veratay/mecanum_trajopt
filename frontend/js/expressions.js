/**
 * Expression Parser and Evaluator
 * Safely evaluates mathematical expressions with variables without using eval()
 */

export class ExpressionEvaluator {
    constructor(variablesMap) {
        this.variables = variablesMap;
    }

    /**
     * Evaluate an expression
     * @param {string} expression - The expression to evaluate
     * @returns {{success: boolean, value?: number, error?: string}}
     */
    evaluate(expression) {
        try {
            const trimmed = expression.trim();
            if (trimmed === '') {
                return { success: false, error: 'Empty expression' };
            }

            const tokens = this.tokenize(trimmed);
            if (tokens.error) {
                return { success: false, error: tokens.error };
            }

            const parser = new Parser(tokens.tokens, this.variables);
            const result = parser.parse();

            if (result.error) {
                return { success: false, error: result.error };
            }

            if (isNaN(result.value) || !isFinite(result.value)) {
                return { success: false, error: 'Result is not a valid number' };
            }

            return { success: true, value: result.value };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract variable names from an expression
     * @param {string} expression - The expression to analyze
     * @returns {Set<string>} Set of variable names used
     */
    extractVariables(expression) {
        const variables = new Set();
        const trimmed = expression.trim();

        if (trimmed === '') {
            return variables;
        }

        const tokens = this.tokenize(trimmed);
        if (tokens.error) {
            return variables;
        }

        for (const token of tokens.tokens) {
            if (token.type === 'VARIABLE') {
                variables.add(token.value);
            }
        }

        return variables;
    }

    /**
     * Tokenize an expression into tokens
     * @param {string} expression - The expression to tokenize
     * @returns {{tokens?: Array, error?: string}}
     */
    tokenize(expression) {
        const tokens = [];
        let i = 0;

        while (i < expression.length) {
            const char = expression[i];

            // Skip whitespace
            if (/\s/.test(char)) {
                i++;
                continue;
            }

            // Operators and parentheses
            if ('+-*/()'.includes(char)) {
                tokens.push({ type: 'OPERATOR', value: char });
                i++;
                continue;
            }

            // Numbers (including decimals)
            if (/\d/.test(char) || (char === '.' && i + 1 < expression.length && /\d/.test(expression[i + 1]))) {
                let num = '';
                let hasDot = false;

                while (i < expression.length) {
                    const c = expression[i];
                    if (/\d/.test(c)) {
                        num += c;
                        i++;
                    } else if (c === '.' && !hasDot) {
                        hasDot = true;
                        num += c;
                        i++;
                    } else {
                        break;
                    }
                }

                const value = parseFloat(num);
                if (isNaN(value)) {
                    return { error: `Invalid number: ${num}` };
                }
                tokens.push({ type: 'NUMBER', value });
                continue;
            }

            // Variable names (alphanumeric + underscore, must start with letter or underscore)
            if (/[a-zA-Z_]/.test(char)) {
                let name = '';
                while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
                    name += expression[i];
                    i++;
                }
                tokens.push({ type: 'VARIABLE', value: name });
                continue;
            }

            return { error: `Unexpected character: ${char}` };
        }

        return { tokens };
    }
}

/**
 * Recursive descent parser for mathematical expressions
 * Grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := NUMBER | VARIABLE | '(' expression ')' | '-' factor | '+' factor
 */
class Parser {
    constructor(tokens, variables) {
        this.tokens = tokens;
        this.variables = variables;
        this.pos = 0;
    }

    parse() {
        try {
            const value = this.parseExpression();

            if (this.pos < this.tokens.length) {
                return { error: 'Unexpected token after expression' };
            }

            return { value };
        } catch (error) {
            return { error: error.message };
        }
    }

    parseExpression() {
        let left = this.parseTerm();

        while (this.pos < this.tokens.length) {
            const token = this.tokens[this.pos];
            if (token.type === 'OPERATOR' && (token.value === '+' || token.value === '-')) {
                this.pos++;
                const right = this.parseTerm();
                if (token.value === '+') {
                    left = left + right;
                } else {
                    left = left - right;
                }
            } else {
                break;
            }
        }

        return left;
    }

    parseTerm() {
        let left = this.parseFactor();

        while (this.pos < this.tokens.length) {
            const token = this.tokens[this.pos];
            if (token.type === 'OPERATOR' && (token.value === '*' || token.value === '/')) {
                this.pos++;
                const right = this.parseFactor();
                if (token.value === '*') {
                    left = left * right;
                } else {
                    if (right === 0) {
                        throw new Error('Division by zero');
                    }
                    left = left / right;
                }
            } else {
                break;
            }
        }

        return left;
    }

    parseFactor() {
        if (this.pos >= this.tokens.length) {
            throw new Error('Unexpected end of expression');
        }

        const token = this.tokens[this.pos];

        // Unary plus or minus
        if (token.type === 'OPERATOR' && (token.value === '+' || token.value === '-')) {
            this.pos++;
            const factor = this.parseFactor();
            return token.value === '-' ? -factor : factor;
        }

        // Number literal
        if (token.type === 'NUMBER') {
            this.pos++;
            return token.value;
        }

        // Variable reference
        if (token.type === 'VARIABLE') {
            this.pos++;
            const varName = token.value;

            if (!this.variables.has(varName)) {
                throw new Error(`Variable '${varName}' not found`);
            }

            const varData = this.variables.get(varName);
            return varData.value;
        }

        // Parenthesized expression
        if (token.type === 'OPERATOR' && token.value === '(') {
            this.pos++;
            const value = this.parseExpression();

            if (this.pos >= this.tokens.length) {
                throw new Error('Missing closing parenthesis');
            }

            const closeParen = this.tokens[this.pos];
            if (closeParen.type !== 'OPERATOR' || closeParen.value !== ')') {
                throw new Error('Expected closing parenthesis');
            }

            this.pos++;
            return value;
        }

        throw new Error(`Unexpected token: ${token.value}`);
    }
}

/**
 * Validate a variable name
 * @param {string} name - The variable name to validate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateVariableName(name) {
    if (!name || name.trim() === '') {
        return { valid: false, error: 'Variable name cannot be empty' };
    }

    const trimmed = name.trim();

    // Must match pattern: start with letter or underscore, followed by alphanumeric or underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        return { valid: false, error: 'Variable name must start with a letter or underscore and contain only letters, numbers, and underscores' };
    }

    // Reserved names (for future math constants)
    const reserved = ['e', 'E', 'pi', 'PI', 'inf', 'Infinity', 'NaN'];
    if (reserved.includes(trimmed)) {
        return { valid: false, error: `'${trimmed}' is a reserved name` };
    }

    return { valid: true };
}
