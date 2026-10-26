const STORAGE_KEYS = {
   theme: 'calc-theme',
   showWork: 'calc-show-work',
   scientific: 'calc-scientific',
   angleMode: 'calc-angle-mode',
   view: 'calc-view',
   history: 'calc-history'
};
const HISTORY_LIMIT = 8;
const FUNCTION_SUFFIX = /(asin|acos|atan|sin|cos|tan|log|ln)\($/;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const form = document.getElementById('calculator-form');
const display = document.getElementById('display');
const displayPreview = document.getElementById('display-preview');
const announcer = document.getElementById('announcer');
const historyList = document.getElementById('history-list');
const historyClear = document.getElementById('history-clear');
const sidePanels = document.getElementById('side-panels');
const workPanel = document.getElementById('work-panel');
const workSteps = document.getElementById('work-steps');
const workToggle = document.getElementById('work-toggle');
const scientificToggle = document.getElementById('scientific-toggle');
const scientificPanel = document.getElementById('scientific-panel');
const angleToggle = document.getElementById('angle-toggle');
const themeToggle = document.getElementById('theme-toggle');
const viewTabs = [...document.querySelectorAll('[role="tab"][data-view]')];

let history = loadHistory();
let angleMode = readStorage(STORAGE_KEYS.angleMode) === 'rad' ? 'rad' : 'deg';
// True while the display shows an error message, so the next key starts fresh.
let displayIsError = false;
// True right after "=", so typing a number starts a new calculation.
let justEvaluated = false;
let countUpFrame = null;
let countUpTarget = '';

function readStorage(key) {
   try {
      return localStorage.getItem(key);
   } catch (error) {
      return null;
   }
}

function writeStorage(key, value) {
   try {
      localStorage.setItem(key, value);
   } catch (error) {}
}

function announce(message) {
   announcer.textContent = message;
}

// Jumps a running count-up straight to its final value.
function stopCountUp() {
   if (countUpFrame !== null) {
      cancelAnimationFrame(countUpFrame);
      countUpFrame = null;
      display.value = countUpTarget;
   }
}

function setDisplayValue(value, animate = true) {
   stopCountUp();
   display.value = value;
   display.scrollLeft = display.scrollWidth;
   if (!animate) return;

   display.classList.remove('slide-in', 'pulse-evaluate', 'shake-error');
   void display.offsetWidth;
   display.classList.add('slide-in');
}

// Counts up to the result like a slot machine settling, then shows the exact text.
function showResult(resultText, value) {
   setDisplayValue(resultText, false);
   if (prefersReducedMotion.matches || /e/i.test(resultText) || Math.abs(value) < 1e-9) return;

   const decimals = (resultText.split('.')[1] || '').length;
   const duration = 450;
   const start = performance.now();
   countUpTarget = resultText;

   const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      if (progress < 1) {
         display.value = (value * eased).toFixed(decimals);
         countUpFrame = requestAnimationFrame(tick);
      } else {
         display.value = resultText;
         countUpFrame = null;
      }
   };
   countUpFrame = requestAnimationFrame(tick);
}

function appendToDisplay(value) {
   stopCountUp();
   const startsNewValue = /^[\d.π√(a-z]/i.test(value);
   if (displayIsError || (justEvaluated && startsNewValue)) {
      display.value = '';
   }
   displayIsError = false;
   justEvaluated = false;

   setDisplayValue(display.value + value);
   renderWork(display.value);
}

function clearDisplay() {
   displayIsError = false;
   justEvaluated = false;
   setDisplayValue('');
   renderWork('');
}

function deleteLastCharacter() {
   if (displayIsError) {
      clearDisplay();
      return;
   }
   justEvaluated = false;
   stopCountUp();
   const current = display.value;
   // Remove "sin(" and friends in one go rather than leaving "sin" behind.
   const functionMatch = current.match(FUNCTION_SUFFIX);
   setDisplayValue(functionMatch ? current.slice(0, -functionMatch[0].length) : current.slice(0, -1));
   renderWork(display.value);
}

// ---------- History ----------

function loadHistory() {
   try {
      const saved = JSON.parse(readStorage(STORAGE_KEYS.history));
      if (Array.isArray(saved)) {
         return saved
            .filter((entry) => entry && typeof entry.expression === 'string' && typeof entry.result === 'string')
            .slice(0, HISTORY_LIMIT);
      }
   } catch (error) {}
   return [];
}

function addHistoryEntry(expression, result) {
   history.unshift({ expression, result, angleMode });
   if (history.length > HISTORY_LIMIT) {
      history.length = HISTORY_LIMIT;
   }
   writeStorage(STORAGE_KEYS.history, JSON.stringify(history));
   renderHistory();
}

function renderHistory() {
   historyList.replaceChildren();
   historyClear.hidden = history.length === 0;

   if (history.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'history-empty';
      emptyItem.textContent = 'No calculations yet';
      historyList.appendChild(emptyItem);
      return;
   }

   history.forEach((entry) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.setAttribute('aria-label', `Use result ${entry.result} from ${entry.expression}`);

      const expression = document.createElement('span');
      expression.className = 'history-expression';
      expression.textContent = entry.expression;

      const result = document.createElement('span');
      result.className = 'history-result';
      result.textContent = `= ${entry.result}`;

      button.append(expression, result);
      button.addEventListener('click', () => {
         displayIsError = false;
         justEvaluated = true;
         setDisplayValue(entry.result);
         renderWork(entry.expression, { final: true, mode: entry.angleMode || angleMode });
         announce(`Loaded ${entry.result}`);
      });

      item.appendChild(button);
      historyList.appendChild(item);
   });
}

historyClear.addEventListener('click', () => {
   history = [];
   writeStorage(STORAGE_KEYS.history, JSON.stringify(history));
   renderHistory();
   announce('History cleared');
});

// ---------- Toggles ----------

function applyTheme(theme) {
   document.documentElement.dataset.theme = theme;
   const next = theme === 'dark' ? 'light' : 'dark';
   themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
   themeToggle.title = `Switch to ${next} theme`;
}

themeToggle.addEventListener('click', () => {
   const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
   applyTheme(theme);
   writeStorage(STORAGE_KEYS.theme, theme);
});

function applyShowWork(enabled) {
   workPanel.hidden = !enabled;
   workToggle.setAttribute('aria-pressed', String(enabled));
}

workToggle.addEventListener('click', () => {
   const enabled = workPanel.hidden;
   applyShowWork(enabled);
   writeStorage(STORAGE_KEYS.showWork, String(enabled));
});

function applyScientific(open) {
   scientificPanel.classList.toggle('open', open);
   scientificPanel.inert = !open;
   scientificPanel.setAttribute('aria-hidden', String(!open));
   scientificToggle.setAttribute('aria-pressed', String(open));
}

scientificToggle.addEventListener('click', () => {
   const open = !scientificPanel.classList.contains('open');
   applyScientific(open);
   writeStorage(STORAGE_KEYS.scientific, String(open));
});

function applyAngleMode(mode) {
   angleMode = mode;
   angleToggle.textContent = mode.toUpperCase();
   angleToggle.setAttribute('aria-label', `Angles in ${mode === 'deg' ? 'degrees' : 'radians'}. Switch to ${mode === 'deg' ? 'radians' : 'degrees'}`);
}

angleToggle.addEventListener('click', () => {
   applyAngleMode(angleMode === 'deg' ? 'rad' : 'deg');
   writeStorage(STORAGE_KEYS.angleMode, angleMode);
   if (!justEvaluated && !displayIsError) renderWork(display.value);
   announce(`Angles in ${angleMode === 'deg' ? 'degrees' : 'radians'}`);
});

function showView(name) {
   viewTabs.forEach((tab) => {
      const selected = tab.dataset.view === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
   });
   sidePanels.hidden = name !== 'calc';
   document.body.dataset.view = name;
   if (name === 'graph') grapher.draw();
}

viewTabs.forEach((tab, index) => {
   tab.addEventListener('click', () => {
      showView(tab.dataset.view);
      writeStorage(STORAGE_KEYS.view, tab.dataset.view);
   });
   // Arrow keys move between tabs, as screen-reader users expect from a tab list.
   tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = viewTabs[(index + step + viewTabs.length) % viewTabs.length];
      next.focus();
      next.click();
   });
});

// ---------- Input ----------

function handleAction(action) {
   if (action === 'clear') {
      clearDisplay();
      return;
   }

   if (action === 'delete') {
      deleteLastCharacter();
      return;
   }

   if (action === 'sqrt') {
      appendToDisplay('√(');
      return;
   }

   if (action === 'evaluate') {
      evaluateExpression();
   }
}

function flashButton(button) {
   if (!button) return;
   button.classList.remove('pressed');
   void button.offsetWidth;
   button.classList.add('pressed');
}

// Keep mouse clicks from focusing the calculator's buttons, so Enter always
// means "=" instead of pressing whichever button was clicked last.
document.addEventListener('mousedown', (event) => {
   if (event.target.closest('.calculator button, .calculator input[type="button"]')) {
      event.preventDefault();
   }
});

form.addEventListener('click', (event) => {
   const target = event.target;
   if (target.tagName !== 'INPUT' || target.type !== 'button') return;

   flashButton(target);
   const action = target.dataset.action;
   const value = target.dataset.value;

   if (action) {
      handleAction(action);
      return;
   }

   if (value) {
      appendToDisplay(value);
   }
});

function keypadButtonFor(key) {
   const selector = {
      Enter: '[data-action="evaluate"]',
      '=': '[data-action="evaluate"]',
      Backspace: '[data-action="delete"]',
      Escape: '[data-action="clear"]'
   }[key] || `[data-value="${CSS.escape(key)}"]`;
   return form.querySelector(selector);
}

document.addEventListener('keydown', (event) => {
   const { key } = event;

   if (event.ctrlKey || event.metaKey || event.altKey) return;
   if (document.body.dataset.view !== 'calc') return;

   // Typing in a text field or menu belongs to that field.
   const target = event.target;
   if (target.matches && target.matches('input:not([type="button"]):not([readonly]), select, textarea')) return;

   // Let Enter and Space activate whichever button has keyboard focus.
   const focusedButton = target.closest && target.closest('button, input[type="button"]');
   if (focusedButton && (key === 'Enter' || key === ' ')) return;

   if (/^[0-9]$/.test(key) || ['+', '-', '*', '/', '.', '%', '(', ')', '^', '!'].includes(key)) {
      event.preventDefault();
      flashButton(keypadButtonFor(key));
      appendToDisplay(key);
      return;
   }

   if (key === 'Enter' || key === '=') {
      event.preventDefault();
      flashButton(keypadButtonFor(key));
      evaluateExpression();
      return;
   }

   if (key === 'Backspace') {
      event.preventDefault();
      flashButton(keypadButtonFor(key));
      deleteLastCharacter();
      return;
   }

   if (key === 'Escape') {
      flashButton(keypadButtonFor(key));
      clearDisplay();
      return;
   }

   if (key.toLowerCase() === 'r') {
      appendToDisplay('√(');
      return;
   }

   if (key.toLowerCase() === 'p') {
      flashButton(keypadButtonFor('π'));
      appendToDisplay('π');
   }
});

function triggerDisplayAnimation(className) {
   display.classList.remove(className);
   void display.offsetWidth;
   display.classList.add(className);
}

function evaluateExpression() {
   if (displayIsError) return;
   stopCountUp();

   const expression = display.value.trim();

   try {
      if (!expression) {
         throw new Error('Enter an expression');
      }

      const solution = solve(expression, { angleMode });
      if (solution.error) {
         throw solution.error;
      }

      const result = formatNumber(solution.result);
      showResult(result, Number(result));
      triggerDisplayAnimation('pulse-evaluate');
      announce(`Equals ${result}`);

      if (expression !== result) {
         addHistoryEntry(expression, result);
         renderWork(expression, { final: true });
      }
      justEvaluated = true;
   } catch (error) {
      setDisplayValue(`Error: ${error.message}`, false);
      triggerDisplayAnimation('shake-error');
      announce(`Error: ${error.message}`);
      renderWork(expression, { final: true });
      displayIsError = true;
   }
}

// ---------- Show-your-work panel ----------

function appendMarkedText(parent, text) {
   const [before, marked, after] = text.split(new RegExp(`[${MARK_START}${MARK_END}]`));
   parent.append(before);
   if (marked !== undefined) {
      const mark = document.createElement('mark');
      mark.textContent = marked;
      parent.append(mark, after);
   }
}

function addWorkRow(className, build) {
   const item = document.createElement('li');
   item.className = className;
   build(item);
   workSteps.appendChild(item);
}

function showWorkMessage(message) {
   addWorkRow('work-message', (item) => {
      item.textContent = message;
   });
}

function renderWork(expression, { final = false, mode = angleMode } = {}) {
   workSteps.replaceChildren();
   displayPreview.textContent = '';
   // Steps slide in one after another for a final answer, but not on every keystroke.
   workSteps.classList.toggle('animate-steps', final);

   if (!expression.trim()) {
      showWorkMessage('Type an expression and each step will appear here.');
      return;
   }

   let solution;
   try {
      solution = solve(expression, { angleMode: mode });
   } catch (error) {
      showWorkMessage(final ? `Can't read this yet: ${error.message}.` : 'Keep typing…');
      return;
   }

   solution.steps.forEach((step, index) => {
      addWorkRow('work-step', (item) => {
         item.style.setProperty('--step-index', index);

         const number = document.createElement('span');
         number.className = 'work-number';
         number.textContent = index + 1;
         number.setAttribute('aria-hidden', 'true');

         const expressionLine = document.createElement('span');
         expressionLine.className = 'work-expression';
         appendMarkedText(expressionLine, step.before);

         const detail = document.createElement('span');
         detail.className = 'work-detail';
         detail.textContent = step.detail;

         item.append(number, expressionLine, detail);
      });
   });

   if (solution.error) {
      addWorkRow('work-error', (item) => {
         const expressionLine = document.createElement('span');
         expressionLine.className = 'work-expression';
         appendMarkedText(expressionLine, solution.failedAt);

         const detail = document.createElement('span');
         detail.className = 'work-detail';
         detail.textContent = `Stopped: ${solution.error.message}`;

         item.append(expressionLine, detail);
      });
      return;
   }

   if (solution.steps.length === 0) {
      showWorkMessage('Nothing to simplify yet.');
      return;
   }

   // A quiet live answer under the display while typing.
   if (!final) {
      displayPreview.textContent = `= ${formatNumber(solution.result)}`;
   }

   addWorkRow('work-answer', (item) => {
      item.style.setProperty('--step-index', solution.steps.length);
      item.textContent = `Answer: ${formatNumber(solution.result)}`;
   });
}

// ---------- Start-up ----------

applyTheme(document.documentElement.dataset.theme);
applyShowWork(readStorage(STORAGE_KEYS.showWork) !== 'false');
applyScientific(readStorage(STORAGE_KEYS.scientific) === 'true');
applyAngleMode(angleMode);
showView(['calc', 'graph', 'convert'].includes(readStorage(STORAGE_KEYS.view)) ? readStorage(STORAGE_KEYS.view) : 'calc');
renderHistory();
renderWork('');
