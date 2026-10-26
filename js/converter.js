// Unit and currency converter. Units convert through a base unit per
// category; currencies use live rates (US dollar base) cached for 12 hours,
// with approximate built-in rates when the network is unavailable.

const UNIT_CATEGORIES = {
   length: {
      label: 'Length',
      defaults: ['km', 'mi'],
      units: {
         mm: { name: 'Millimetres', factor: 0.001 },
         cm: { name: 'Centimetres', factor: 0.01 },
         m: { name: 'Metres', factor: 1 },
         km: { name: 'Kilometres', factor: 1000 },
         in: { name: 'Inches', factor: 0.0254 },
         ft: { name: 'Feet', factor: 0.3048 },
         yd: { name: 'Yards', factor: 0.9144 },
         mi: { name: 'Miles', factor: 1609.344 }
      }
   },
   mass: {
      label: 'Mass',
      defaults: ['kg', 'lb'],
      units: {
         mg: { name: 'Milligrams', factor: 0.000001 },
         g: { name: 'Grams', factor: 0.001 },
         kg: { name: 'Kilograms', factor: 1 },
         t: { name: 'Tonnes', factor: 1000 },
         oz: { name: 'Ounces', factor: 0.028349523125 },
         lb: { name: 'Pounds', factor: 0.45359237 },
         st: { name: 'Stones', factor: 6.35029318 }
      }
   },
   temperature: {
      label: 'Temp',
      defaults: ['C', 'F'],
      units: {
         C: { name: 'Celsius', symbol: '°C', toBase: (v) => v, fromBase: (v) => v },
         F: { name: 'Fahrenheit', symbol: '°F', toBase: (v) => (v - 32) * 5 / 9, fromBase: (v) => v * 9 / 5 + 32 },
         K: { name: 'Kelvin', symbol: 'K', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 }
      }
   },
   volume: {
      label: 'Volume',
      defaults: ['l', 'gal'],
      units: {
         ml: { name: 'Millilitres', factor: 0.001 },
         l: { name: 'Litres', symbol: 'L', factor: 1 },
         m3: { name: 'Cubic metres', symbol: 'm³', factor: 1000 },
         tsp: { name: 'Teaspoons (US)', factor: 0.00492892159375 },
         tbsp: { name: 'Tablespoons (US)', factor: 0.01478676478125 },
         floz: { name: 'Fluid ounces (US)', symbol: 'fl oz', factor: 0.0295735295625 },
         cup: { name: 'Cups (US)', factor: 0.2365882365 },
         gal: { name: 'Gallons (US)', factor: 3.785411784 }
      }
   },
   speed: {
      label: 'Speed',
      defaults: ['kmh', 'mph'],
      units: {
         ms: { name: 'Metres per second', symbol: 'm/s', factor: 1 },
         kmh: { name: 'Kilometres per hour', symbol: 'km/h', factor: 1 / 3.6 },
         mph: { name: 'Miles per hour', symbol: 'mph', factor: 0.44704 },
         fts: { name: 'Feet per second', symbol: 'ft/s', factor: 0.3048 },
         kn: { name: 'Knots', symbol: 'kn', factor: 1852 / 3600 }
      }
   },
   data: {
      label: 'Data',
      defaults: ['GB', 'MB'],
      units: {
         bit: { name: 'Bits', factor: 0.125 },
         B: { name: 'Bytes', factor: 1 },
         KB: { name: 'Kilobytes', factor: 1e3 },
         MB: { name: 'Megabytes', factor: 1e6 },
         GB: { name: 'Gigabytes', factor: 1e9 },
         TB: { name: 'Terabytes', factor: 1e12 },
         KiB: { name: 'Kibibytes', factor: 1024 },
         MiB: { name: 'Mebibytes', factor: 1024 ** 2 },
         GiB: { name: 'Gibibytes', factor: 1024 ** 3 }
      }
   },
   currency: {
      label: 'Currency',
      defaults: ['USD', 'EUR'],
      units: {}
   }
};

// Approximate US dollar rates, used only when live rates cannot be loaded.
const FALLBACK_RATES = {
   USD: 1, EUR: 0.92, GBP: 0.79, JPY: 150, CNY: 7.2, INR: 84, CAD: 1.37, AUD: 1.52,
   CHF: 0.88, ZAR: 18, NGN: 1600, KES: 129, MWK: 1735, ZMW: 26, TZS: 2700, BRL: 5.5
};

const RATE_SOURCES = [
   {
      url: 'https://open.er-api.com/v6/latest/USD',
      name: 'ExchangeRate-API',
      read: (data) => data.result === 'success' && {
         rates: data.rates,
         date: new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10)
      }
   },
   {
      url: 'https://api.frankfurter.dev/v1/latest?base=USD',
      name: 'Frankfurter (ECB)',
      read: (data) => data.rates && { rates: { USD: 1, ...data.rates }, date: data.date }
   }
];
const RATE_CACHE_KEY = 'calc-rates';
const RATE_CACHE_HOURS = 12;

const converter = (() => {
   const categoryList = document.getElementById('convert-categories');
   const amountInput = document.getElementById('convert-amount');
   const fromSelect = document.getElementById('convert-from');
   const toSelect = document.getElementById('convert-to');
   const swapButton = document.getElementById('convert-swap');
   const resultOutput = document.getElementById('convert-result');
   const rateLine = document.getElementById('convert-rate');
   const statusLine = document.getElementById('convert-status');

   const currencyNames = typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames(['en'], { type: 'currency' })
      : null;

   let category = 'length';
   let ratesRequest = null;

   function unitSymbol(code) {
      const unit = UNIT_CATEGORIES[category].units[code];
      return (unit && unit.symbol) || code;
   }

   function setCurrencyUnits(newRates) {
      const units = {};
      Object.keys(newRates).sort().forEach((code) => {
         let name = code;
         try {
            name = currencyNames ? currencyNames.of(code) : code;
         } catch (error) {}
         units[code] = { name, factor: 1 / newRates[code] };
      });
      UNIT_CATEGORIES.currency.units = units;
   }

   function readCachedRates() {
      try {
         const cached = JSON.parse(localStorage.getItem(RATE_CACHE_KEY));
         if (cached && cached.rates && Date.now() - cached.fetchedAt < RATE_CACHE_HOURS * 3600 * 1000) {
            return cached;
         }
      } catch (error) {}
      return null;
   }

   async function fetchRates() {
      for (const source of RATE_SOURCES) {
         try {
            const response = await fetch(source.url);
            if (!response.ok) continue;
            const parsed = source.read(await response.json());
            if (parsed && parsed.rates && parsed.rates.EUR) {
               return { ...parsed, source: source.name, fetchedAt: Date.now() };
            }
         } catch (error) {}
      }
      return null;
   }

   function loadRates() {
      if (ratesRequest) return ratesRequest;

      const cached = readCachedRates();
      if (cached) {
         applyRates(cached, false);
         ratesRequest = Promise.resolve();
         return ratesRequest;
      }

      setCurrencyUnits(FALLBACK_RATES);
      statusLine.textContent = 'Loading live exchange rates…';

      ratesRequest = fetchRates().then((live) => {
         if (live) {
            try {
               localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(live));
            } catch (error) {}
            applyRates(live, false);
         } else {
            applyRates({ rates: FALLBACK_RATES }, true);
         }
      });
      return ratesRequest;
   }

   function applyRates(info, offline) {
      setCurrencyUnits(info.rates);
      statusLine.textContent = offline
         ? 'Offline: showing approximate built-in rates.'
         : `Live rates from ${info.source}, updated ${info.date}.`;
      if (category === 'currency') {
         fillUnitSelects(fromSelect.value, toSelect.value);
         update();
      }
   }

   function fillUnitSelects(fromCode, toCode) {
      const { units, defaults } = UNIT_CATEGORIES[category];
      const codes = Object.keys(units);

      [fromSelect, toSelect].forEach((select) => {
         select.replaceChildren(...codes.map((code) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = category === 'currency' ? `${code} · ${units[code].name}` : units[code].name;
            return option;
         }));
      });

      fromSelect.value = codes.includes(fromCode) ? fromCode : defaults[0];
      toSelect.value = codes.includes(toCode) ? toCode : defaults[1];
   }

   function convert(value, fromCode, toCode) {
      const { units } = UNIT_CATEGORIES[category];
      const from = units[fromCode];
      const to = units[toCode];
      const base = from.toBase ? from.toBase(value) : value * from.factor;
      return to.fromBase ? to.fromBase(base) : base / to.factor;
   }

   function prettyNumber(value) {
      if (value !== 0 && Math.abs(value) < 0.001) return formatNumber(Number(value.toPrecision(4)));
      return new Intl.NumberFormat('en', { maximumFractionDigits: 4 }).format(value);
   }

   function formatAmount(value, code) {
      if (category === 'currency') {
         try {
            return new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(value);
         } catch (error) {
            return `${value.toFixed(2)} ${code}`;
         }
      }
      return `${prettyNumber(value)} ${unitSymbol(code)}`;
   }

   function readAmount() {
      const text = amountInput.value.trim();
      if (!text) return null;
      // The amount box accepts expressions too, so "12 * 3" works.
      return evaluateTree(parseExpression(text));
   }

   function update() {
      let amount;
      try {
         amount = readAmount();
      } catch (error) {
         amount = NaN;
      }

      if (amount === null) {
         resultOutput.textContent = '—';
         rateLine.textContent = '';
         return;
      }

      if (!Number.isFinite(amount)) {
         resultOutput.textContent = 'Enter a number';
         rateLine.textContent = '';
         return;
      }

      const fromCode = fromSelect.value;
      const toCode = toSelect.value;
      const result = convert(amount, fromCode, toCode);
      resultOutput.textContent = formatAmount(result, toCode);
      resultOutput.classList.remove('result-pop');
      void resultOutput.offsetWidth;
      resultOutput.classList.add('result-pop');

      if (category === 'temperature') {
         rateLine.textContent = `${formatAmount(amount, fromCode)} = ${formatAmount(result, toCode)}`;
      } else {
         const unitRate = prettyNumber(convert(1, fromCode, toCode));
         rateLine.textContent = `1 ${unitSymbol(fromCode)} = ${unitRate} ${unitSymbol(toCode)}`;
      }
   }

   function selectCategory(name) {
      category = name;
      categoryList.querySelectorAll('[data-category]').forEach((button) => {
         button.setAttribute('aria-pressed', String(button.dataset.category === name));
      });

      statusLine.hidden = name !== 'currency';
      if (name === 'currency') loadRates();

      fillUnitSelects();
      update();
   }

   Object.entries(UNIT_CATEGORIES).forEach(([name, info]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.category = name;
      button.textContent = info.label;
      button.addEventListener('click', () => selectCategory(name));
      categoryList.appendChild(button);
   });

   amountInput.addEventListener('input', update);
   fromSelect.addEventListener('change', update);
   toSelect.addEventListener('change', update);
   swapButton.addEventListener('click', () => {
      const from = fromSelect.value;
      fromSelect.value = toSelect.value;
      toSelect.value = from;
      update();
   });

   selectCategory(category);

   return { selectCategory };
})();
