// Graph mode: plots y = f(x) on a canvas using the same parser as the
// calculator. Drag to pan, scroll or use the buttons to zoom, and hover
// (or touch) to read off values.

const grapher = (() => {
   const canvas = document.getElementById('graph-canvas');
   const input = document.getElementById('graph-input');
   const readout = document.getElementById('graph-readout');
   const status = document.getElementById('graph-status');
   const context = canvas.getContext('2d');

   const DEFAULT_VIEW = { centerX: 0, centerY: 0, scale: 16 };
   let view = { ...DEFAULT_VIEW };
   let tree = null;
   let pointer = null;
   let drag = null;
   let width = 0;
   let height = 0;

   const toPixelX = (x) => width / 2 + (x - view.centerX) * view.scale;
   const toPixelY = (y) => height / 2 - (y - view.centerY) * view.scale;
   const toX = (px) => view.centerX + (px - width / 2) / view.scale;
   const toY = (py) => view.centerY - (py - height / 2) / view.scale;

   function evaluateAt(x) {
      try {
         const y = evaluateTree(tree, { x, angleMode: 'rad' });
         return Number.isFinite(y) ? y : NaN;
      } catch (error) {
         return NaN;
      }
   }

   // Grid spacing of 1, 2 or 5 × 10^n that lands roughly every 60px.
   function gridStep() {
      const raw = 60 / view.scale;
      const magnitude = 10 ** Math.floor(Math.log10(raw));
      const normalized = raw / magnitude;
      if (normalized < 1.5) return magnitude;
      if (normalized < 3.5) return 2 * magnitude;
      if (normalized < 7.5) return 5 * magnitude;
      return 10 * magnitude;
   }

   function colors() {
      const styles = getComputedStyle(document.documentElement);
      const read = (name) => styles.getPropertyValue(name).trim();
      return {
         grid: read('--item-border'),
         axis: read('--text-muted'),
         label: read('--text-muted'),
         curve: read('--accent'),
         marker: read('--text-main')
      };
   }

   function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return false;
      const ratio = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      return true;
   }

   function drawGrid(palette) {
      const step = gridStep();
      const label = (value) => formatNumber(Math.round(value / step) * step);

      context.lineWidth = 1;
      context.strokeStyle = palette.grid;
      context.beginPath();
      for (let x = Math.ceil(toX(0) / step) * step; x <= toX(width); x += step) {
         const px = Math.round(toPixelX(x)) + 0.5;
         context.moveTo(px, 0);
         context.lineTo(px, height);
      }
      for (let y = Math.ceil(toY(height) / step) * step; y <= toY(0); y += step) {
         const py = Math.round(toPixelY(y)) + 0.5;
         context.moveTo(0, py);
         context.lineTo(width, py);
      }
      context.stroke();

      // Axes, kept on screen so their labels stay readable while panning.
      const axisX = Math.min(Math.max(toPixelX(0), 0), width);
      const axisY = Math.min(Math.max(toPixelY(0), 0), height);
      context.strokeStyle = palette.axis;
      context.beginPath();
      context.moveTo(0, Math.round(axisY) + 0.5);
      context.lineTo(width, Math.round(axisY) + 0.5);
      context.moveTo(Math.round(axisX) + 0.5, 0);
      context.lineTo(Math.round(axisX) + 0.5, height);
      context.stroke();

      context.fillStyle = palette.label;
      context.font = '11px Poppins, system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = axisY > height - 18 ? 'bottom' : 'top';
      for (let x = Math.ceil(toX(0) / step) * step; x <= toX(width); x += step) {
         if (Math.abs(x) < step / 2) continue;
         if (toPixelX(x) < 14 || toPixelX(x) > width - 14) continue;
         context.fillText(label(x), toPixelX(x), axisY > height - 18 ? axisY - 4 : axisY + 4);
      }
      context.textAlign = axisX > width - 30 ? 'right' : 'left';
      context.textBaseline = 'middle';
      for (let y = Math.ceil(toY(height) / step) * step; y <= toY(0); y += step) {
         if (Math.abs(y) < step / 2) continue;
         if (toPixelY(y) < 10 || toPixelY(y) > height - 10) continue;
         context.fillText(label(y), axisX > width - 30 ? axisX - 4 : axisX + 4, toPixelY(y));
      }
   }

   function drawCurve(palette) {
      context.strokeStyle = palette.curve;
      context.lineWidth = 2.5;
      context.lineJoin = 'round';
      context.beginPath();

      let previous = null;
      for (let px = 0; px <= width; px += 1) {
         const y = evaluateAt(toX(px));
         if (Number.isNaN(y)) {
            previous = null;
            continue;
         }
         const py = toPixelY(y);
         // Break the line at asymptotes such as tan(x) instead of joining them.
         if (previous === null || Math.abs(py - previous) > height * 2) {
            context.moveTo(px, py);
         } else {
            context.lineTo(px, py);
         }
         previous = py;
      }
      context.stroke();
   }

   function drawPointer(palette) {
      if (!pointer || !tree) {
         readout.hidden = true;
         return;
      }
      const x = toX(pointer.x);
      const y = evaluateAt(x);
      if (Number.isNaN(y)) {
         readout.hidden = true;
         return;
      }

      const px = toPixelX(x);
      const py = toPixelY(y);
      context.strokeStyle = palette.grid;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(px, 0);
      context.lineTo(px, height);
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = palette.curve;
      context.beginPath();
      context.arc(px, py, 5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = palette.marker;
      context.lineWidth = 2;
      context.stroke();

      readout.hidden = false;
      readout.textContent = `x = ${formatNumber(Number(x.toPrecision(4)))}, y = ${formatNumber(Number(y.toPrecision(6)))}`;
   }

   function draw() {
      if (!resize()) return;
      const palette = colors();
      context.clearRect(0, 0, width, height);
      drawGrid(palette);
      if (tree) drawCurve(palette);
      drawPointer(palette);
   }

   function compile() {
      const text = input.value.trim();
      canvas.setAttribute('aria-label', text ? `Graph of y = ${text}` : 'Empty graph');

      if (!text) {
         tree = null;
         status.textContent = 'Type a function of x, like x^2 or sin(x).';
      } else {
         try {
            tree = parseExpression(text);
            status.textContent = usesVariable(tree)
               ? 'Drag to pan, scroll to zoom. Angles are in radians.'
               : 'No x in this function, so the graph is a flat line.';
         } catch (error) {
            tree = null;
            status.textContent = `Keep typing… (${error.message})`;
         }
      }
      draw();
   }

   function zoom(factor, originX = width / 2, originY = height / 2) {
      const x = toX(originX);
      const y = toY(originY);
      view.scale = Math.min(Math.max(view.scale * factor, 0.5), 5000);
      view.centerX = x - (originX - width / 2) / view.scale;
      view.centerY = y + (originY - height / 2) / view.scale;
      draw();
   }

   function localPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
   }

   canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      drag = { ...localPoint(event), centerX: view.centerX, centerY: view.centerY };
      pointer = localPoint(event);
      draw();
   });

   canvas.addEventListener('pointermove', (event) => {
      pointer = localPoint(event);
      if (drag) {
         view.centerX = drag.centerX - (pointer.x - drag.x) / view.scale;
         view.centerY = drag.centerY + (pointer.y - drag.y) / view.scale;
      }
      draw();
   });

   canvas.addEventListener('pointerup', () => {
      drag = null;
   });

   canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') {
         pointer = null;
         draw();
      }
   });

   canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const point = localPoint(event);
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, point.x, point.y);
   }, { passive: false });

   document.getElementById('graph-zoom-in').addEventListener('click', () => zoom(1.5));
   document.getElementById('graph-zoom-out').addEventListener('click', () => zoom(1 / 1.5));
   document.getElementById('graph-reset').addEventListener('click', () => {
      view = { ...DEFAULT_VIEW };
      draw();
   });

   document.querySelectorAll('[data-graph-insert]').forEach((button) => {
      button.addEventListener('click', () => {
         const text = button.dataset.graphInsert;
         const start = input.selectionStart ?? input.value.length;
         const end = input.selectionEnd ?? input.value.length;
         input.setRangeText(text, start, end, 'end');
         input.focus();
         compile();
      });
   });

   input.addEventListener('input', compile);

   new ResizeObserver(draw).observe(canvas);
   new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

   compile();

   return { draw };
})();
