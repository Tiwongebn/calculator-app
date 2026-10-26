// Expression parsing and evaluation, shared by the calculator and the grapher.
//
// The parser builds a syntax tree instead of computing the answer directly.
// `solve` reduces that tree one operation at a time to record each step for
// the "Show your work" panel, and `evaluateTree` computes it in one pass,
// which is what the grapher calls hundreds of times per frame.

const OPERATOR_SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^' };
const MARK_START = '\u0001';
const MARK_END = '\u0002';

const CONSTANTS = {
   π: Math.PI,
   pi: Math.PI,
   e: Math.E
};

const FUNCTIONS = {
   sin: { trig: true, apply: Math.sin },
   cos: { trig: true, apply: Math.cos },
   tan: { trig: true, apply: Math.tan },
   asin: { inverseTrig: true, apply: Math.asin },
   acos: { inverseTrig: true, apply: Math.acos },
   atan: { inverseTrig: true, apply: Math.atan },
   log: { apply: Math.log10 },
   ln: { apply: Math.log }
};

// Longest names first so "asin" is not read as "a" + "sin".
const NAMES = [...Object.keys(FUNCTIONS), 'pi', 'e', 'x'].sort((a, b) => b.length - a.length);

function formatNumber(value) {
   return String(Number(value.toPrecision(12)));
}

class ExpressionParser {
   constructor(input) {
      this.tokens = this.tokenize(input);
      this.position = 0;
   }

   tokenize(input) {
      const tokens = [];
      const normalized = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
      let i = 0;

      while (i < normalized.length) {
         const char = normalized[i];

         if (char === ' ') {
            i += 1;
            continue;
         }

         if ('+-*/()%√^!'.includes(char)) {
            tokens.push({ type: 'operator', value: char });
            i += 1;
            continue;
         }

         if (char === 'π') {
            tokens.push({ type: 'constant', value: 'π' });
            i += 1;
            continue;
         }

         if (/[a-z]/i.test(char)) {
            const rest = normalized.slice(i).toLowerCase();
            const name = NAMES.find((candidate) => rest.startsWith(candidate));
            if (!name) {
               const word = rest.match(/^[a-z]+/)[0];
               throw new Error(`Unknown name: ${word}`);
            }

            if (FUNCTIONS[name]) {
               tokens.push({ type: 'function', value: name });
            } else if (name === 'x') {
               tokens.push({ type: 'variable', value: 'x' });
            } else {
               tokens.push({ type: 'constant', value: name === 'pi' ? 'π' : name });
            }
            i += name.length;
            continue;
         }

         if (/\d|\./.test(char)) {
            let number = '';
            let dots = 0;

            while (i < normalized.length && /\d|\./.test(normalized[i])) {
               if (normalized[i] === '.') dots += 1;
               number += normalized[i];
               i += 1;
            }

            if (dots > 1 || number === '.') {
               throw new Error('Malformed number');
            }

            // Big and tiny results display as 1.5e+20 or 3e-7; read them back
            // the same way. A sign is required, so "2e" still means 2 × e.
            const exponent = normalized.slice(i).match(/^e[+-]\d+/i);
            if (exponent) {
               number += exponent[0];
               i += exponent[0].length;
            }

            const value = parseFloat(number);
            if (!Number.isFinite(value)) {
               throw new Error('Number is too large');
            }

            tokens.push({ type: 'number', value, label: number });
            continue;
         }

         throw new Error(`Invalid character: ${char}`);
      }

      return tokens;
   }

   parse() {
      if (this.tokens.length === 0) {
         throw new Error('Enter an expression');
      }
      const node = this.parseExpression();
      if (this.position < this.tokens.length) {
         throw new Error('Malformed input');
      }
      return node;
   }

   parseExpression() {
      let node = this.parseTerm();

      while (this.match('+') || this.match('-')) {
         const op = this.previous().value;
         node = { type: 'binary', op, left: node, right: this.parseTerm() };
      }

      return node;
   }

   parseTerm() {
      let node = this.parseUnary();

      while (true) {
         let op;
         if (this.match('*') || this.match('/')) {
            op = this.previous().value;
         } else if (this.startsImplicitFactor()) {
            // 2π, 2x, 2sin(30), 2(3 + 4) and 2√9 mean multiplication.
            op = '*';
         } else {
            break;
         }
         node = { type: 'binary', op, left: node, right: this.parseUnary() };
      }

      return node;
   }

   parseUnary() {
      if (this.match('+')) return { type: 'unary', op: '+', operand: this.parseUnary() };
      if (this.match('-')) return { type: 'unary', op: '-', operand: this.parseUnary() };
      if (this.match('√')) return { type: 'sqrt', operand: this.parseUnary() };
      if (this.checkType('function') && !this.nextIsOpenParen()) {
         // Without parentheses a function takes what follows: sin 30, ln 2x.
         this.position += 1;
         return { type: 'function', name: this.previous().value, operand: this.parseUnary() };
      }

      return this.parsePower();
   }

   parsePower() {
      const base = this.parsePostfix();

      if (this.match('^')) {
         // Right-associative: 2^3^2 is 2^(3^2).
         return { type: 'binary', op: '^', left: base, right: this.parseUnary() };
      }

      return base;
   }

   parsePostfix() {
      let node = this.parsePrimary();

      while (this.match('%') || this.match('!')) {
         const type = this.previous().value === '%' ? 'percent' : 'factorial';
         node = { type, operand: node };
      }

      return node;
   }

   parsePrimary() {
      if (this.matchType('number')) {
         const token = this.previous();
         return { type: 'number', value: token.value, label: token.label };
      }

      if (this.matchType('constant')) {
         const name = this.previous().value;
         return { type: 'constant', name, value: CONSTANTS[name] };
      }

      if (this.matchType('variable')) {
         return { type: 'variable', name: 'x' };
      }

      if (this.matchType('function')) {
         // With parentheses the call is a unit, so sin(30)^2 squares the sine.
         const name = this.previous().value;
         return { type: 'function', name, operand: this.parsePrimary() };
      }

      if (this.match('(')) {
         const inner = this.parseExpression();
         if (!this.match(')')) {
            throw new Error('Missing closing parenthesis');
         }
         return { type: 'group', inner };
      }

      throw new Error('Malformed input');
   }

   startsImplicitFactor() {
      if (this.isAtEnd()) return false;
      const token = this.tokens[this.position];
      if (['constant', 'variable', 'function'].includes(token.type)) return true;
      return token.type === 'operator' && (token.value === '(' || token.value === '√');
   }

   match(expected) {
      if (this.isAtEnd()) return false;
      const token = this.tokens[this.position];
      if (token.type === 'operator' && token.value === expected) {
         this.position += 1;
         return true;
      }
      return false;
   }

   checkType(type) {
      return !this.isAtEnd() && this.tokens[this.position].type === type;
   }

   nextIsOpenParen() {
      const next = this.tokens[this.position + 1];
      return Boolean(next) && next.type === 'operator' && next.value === '(';
   }

   matchType(type) {
      if (this.isAtEnd()) return false;
      if (this.tokens[this.position].type === type) {
         this.position += 1;
         return true;
      }
      return false;
   }

   previous() {
      return this.tokens[this.position - 1];
   }

   isAtEnd() {
      return this.position >= this.tokens.length;
   }
}

function parseExpression(expression) {
   return new ExpressionParser(expression).parse();
}

// ---------- Applying a single operation ----------

function factorial(value) {
   if (!Number.isInteger(value) || value < 0) {
      throw new Error('Factorial needs a whole number ≥ 0');
   }
   if (value > 170) {
      throw new Error('Factorial is too large');
   }
   let result = 1;
   for (let n = 2; n <= value; n += 1) result *= n;
   return result;
}

function applyFunction(name, value, angleMode) {
   const fn = FUNCTIONS[name];
   const toRadians = angleMode === 'deg' ? Math.PI / 180 : 1;

   if (fn.trig) {
      const result = fn.apply(value * toRadians);
      // sin(180°) is 1.2e-16 in floating point; call anything that small zero.
      return Math.abs(result) < 1e-12 ? 0 : result;
   }

   if (fn.inverseTrig) {
      const result = fn.apply(value);
      if (Number.isNaN(result)) throw new Error(`${name} needs a value from -1 to 1`);
      return result / toRadians;
   }

   if (value <= 0) throw new Error(`${name} needs a positive number`);
   return fn.apply(value);
}

function applyBinary(op, left, right) {
   switch (op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/':
         if (right === 0) throw new Error('Division by zero');
         return left / right;
      case '^': {
         const value = Math.pow(left, right);
         if (Number.isNaN(value)) throw new Error('Result is not a real number');
         return value;
      }
      default:
         throw new Error('Malformed input');
   }
}

function applySqrt(value) {
   if (value < 0) throw new Error('Square root of negative number');
   return Math.sqrt(value);
}

// ---------- One-pass evaluation (used by the grapher) ----------

function evaluateTree(node, scope = {}) {
   switch (node.type) {
      case 'number': return node.value;
      case 'constant': return node.value;
      case 'variable':
         if (!(node.name in scope)) throw new Error(`No value for ${node.name}`);
         return scope[node.name];
      case 'group': return evaluateTree(node.inner, scope);
      case 'unary': {
         const value = evaluateTree(node.operand, scope);
         return node.op === '-' ? -value : value;
      }
      case 'sqrt': return applySqrt(evaluateTree(node.operand, scope));
      case 'percent': return evaluateTree(node.operand, scope) / 100;
      case 'factorial': return factorial(evaluateTree(node.operand, scope));
      case 'function': return applyFunction(node.name, evaluateTree(node.operand, scope), scope.angleMode);
      case 'binary':
         return applyBinary(node.op, evaluateTree(node.left, scope), evaluateTree(node.right, scope));
      default:
         throw new Error('Malformed input');
   }
}

function usesVariable(node) {
   if (node.type === 'variable') return true;
   return childrenOf(node).some(usesVariable);
}

// ---------- Step-by-step evaluation ----------

function childrenOf(node) {
   if (node.type === 'binary') return [node.left, node.right];
   if (node.type === 'group') return [node.inner];
   if (node.operand) return [node.operand];
   return [];
}

// The leftmost, innermost operation whose inputs are already plain numbers.
function findNextReducible(node) {
   for (const child of childrenOf(node)) {
      const found = findNextReducible(child);
      if (found) return found;
   }
   return node.type === 'number' ? null : node;
}

function computeReduction(node, angleMode) {
   switch (node.type) {
      case 'constant':
         return { value: node.value, approximate: true };
      case 'variable':
         throw new Error('x only works in Graph mode');
      case 'group':
         return { value: node.inner.value, silent: true };
      case 'unary':
         return { value: node.op === '-' ? -node.operand.value : node.operand.value, silent: true };
      case 'sqrt':
         return { value: applySqrt(node.operand.value) };
      case 'percent':
         return { value: node.operand.value / 100 };
      case 'factorial':
         return { value: factorial(node.operand.value) };
      case 'function':
         return { value: applyFunction(node.name, node.operand.value, angleMode) };
      case 'binary':
         return { value: applyBinary(node.op, node.left.value, node.right.value) };
      default:
         throw new Error('Malformed input');
   }
}

function renderNode(node, target, context = 'top', angleMode = 'rad') {
   const child = (childNode, childContext) => renderNode(childNode, target, childContext, angleMode);
   let text;

   switch (node.type) {
      case 'number': {
         const negative = node.value < 0;
         text = negative ? `−${node.label.replace(/^-/, '')}` : node.label;
         if (negative && context !== 'top' && context !== 'left') {
            text = `(${text})`;
         }
         break;
      }
      case 'constant':
      case 'variable':
         text = node.name;
         break;
      case 'binary': {
         const left = child(node.left, node.op === '^' ? 'operand' : 'left');
         const right = child(node.right, 'operand');
         text = node.op === '^'
            ? `${left}^${right}`
            : `${left} ${OPERATOR_SYMBOLS[node.op]} ${right}`;
         break;
      }
      case 'unary':
         text = `${OPERATOR_SYMBOLS[node.op]}${child(node.operand, 'operand')}`;
         break;
      case 'sqrt':
         text = `√${child(node.operand, 'operand')}`;
         break;
      case 'percent':
         text = `${child(node.operand, 'operand')}%`;
         break;
      case 'factorial':
         text = `${child(node.operand, 'operand')}!`;
         break;
      case 'function': {
         const inner = node.operand.type === 'group'
            ? child(node.operand.inner, 'top')
            : child(node.operand, 'top');
         const degrees = angleMode === 'deg' && FUNCTIONS[node.name].trig && node.operand.type === 'number' ? '°' : '';
         text = `${node.name}(${inner}${degrees})`;
         break;
      }
      case 'group':
         text = `(${child(node.inner, 'top')})`;
         break;
      default:
         text = '';
   }

   return node === target ? `${MARK_START}${text}${MARK_END}` : text;
}

// Parses the expression (throwing on syntax errors) and reduces it one
// operation at a time. Math errors such as division by zero are returned
// with the steps that came before them.
function solve(expression, { angleMode = 'deg' } = {}) {
   const root = parseExpression(expression);
   const render = (target) => renderNode(root, target, 'top', angleMode);
   const start = render(null);
   const steps = [];

   let node = findNextReducible(root);
   while (node) {
      const before = render(node);
      const operation = renderNode(node, null, 'top', angleMode);
      let reduction;

      try {
         reduction = computeReduction(node, angleMode);
         if (!Number.isFinite(reduction.value)) {
            throw new Error('Result is not finite');
         }
      } catch (error) {
         return { start, steps, error, failedAt: before };
      }

      const label = formatNumber(reduction.value);
      Object.keys(node).forEach((key) => delete node[key]);
      Object.assign(node, { type: 'number', value: reduction.value, label });

      if (!reduction.silent) {
         const sign = reduction.approximate ? '≈' : '=';
         steps.push({ before, detail: `${operation} ${sign} ${label}` });
      }

      node = findNextReducible(root);
   }

   if (!Number.isFinite(root.value)) {
      return { start, steps, error: new Error('Result is not finite'), failedAt: start };
   }

   return { start, steps, result: root.value };
}
