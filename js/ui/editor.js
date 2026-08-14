/**
 * editor.js
 * ---------------------------------------------------------------------------
 * Interactive Program Editor (add/remove/edit instructions) and
 * Configuration Editor (station counts, latencies, initial register &
 * memory values). Operates on plain data objects that main.js owns; this
 * module only knows how to paint/read the DOM for those objects.
 *
 * See the MODULE FORMAT NOTE at the top of js/core/config.js for why this
 * attaches to window.Tomasulo instead of using import/export.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var Config = global.Tomasulo.config;
  var OPCODES = Config.OPCODES;
  var FP_REGISTERS = Config.FP_REGISTERS;
  var BASE_REGISTERS = Config.BASE_REGISTERS;
  var isArithmeticOp = Config.isArithmeticOp;
  var PRESET_PROGRAMS = Config.PRESET_PROGRAMS;

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function td() {
    return document.createElement('td');
  }

  function makeSelect(options, value, onChange) {
    const select = document.createElement('select');
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function makeDisabledSelect() {
    const select = document.createElement('select');
    select.disabled = true;
    const o = document.createElement('option');
    o.textContent = '—';
    select.appendChild(o);
    return select;
  }

  // ---------------------------------------------------------------------------
  // Numeric input fields deliberately use type="text" + inputmode="decimal"
  // rather than type="number". Chromium's native <input type="number"> spin
  // control renders its digits using the page/OS's ICU numbering system, so
  // on a system set to Arabic it silently displays Arabic-Indic numerals
  // (٠١٢٣...) even though the underlying `.value` string is still plain
  // ASCII. A plain text input never reformats what's in `.value`, so it
  // always displays exactly the Western digits we put there. The listener
  // below additionally normalizes Arabic-Indic / Extended Arabic-Indic
  // digits back to ASCII in case an IME inserts them while typing.
  // ---------------------------------------------------------------------------

  function toWesternDigits(str) {
    return String(str).replace(/[٠-٩۰-۹]/g, function (ch) {
      const code = ch.codePointAt(0);
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    });
  }

  /** Strips everything but digits/one leading minus/one decimal point. */
  function sanitizeNumericText(raw, allowDecimal) {
    let out = toWesternDigits(raw);
    out = allowDecimal ? out.replace(/[^0-9.\-]/g, '') : out.replace(/[^0-9\-]/g, '');
    const negative = out.startsWith('-');
    out = out.replace(/-/g, '');
    if (allowDecimal) {
      const firstDot = out.indexOf('.');
      if (firstDot !== -1) {
        out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '');
      }
    } else {
      out = out.replace(/\./g, '');
    }
    return (negative ? '-' : '') + out;
  }

  /** Attaches live Western-digit sanitization to an already-existing text input. */
  function attachNumericSanitizer(input, allowDecimal) {
    input.setAttribute('dir', 'ltr');
    input.setAttribute('lang', 'en');
    input.addEventListener('input', () => {
      const sanitized = sanitizeNumericText(input.value, allowDecimal);
      if (sanitized !== input.value) input.value = sanitized;
    });
  }

  function makeNumberInput(value, onChange, disabled) {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    attachNumericSanitizer(input, true);
    input.value = disabled ? '' : String(value);
    input.disabled = !!disabled;
    input.addEventListener('change', () => onChange(Number(input.value) || 0));
    return input;
  }

  /** Resets fields that don't apply to the new opcode, filling sane defaults. */
  function applyOpDefaults(instr, newOp) {
    instr.op = newOp;
    if (isArithmeticOp(newOp)) {
      instr.dest = instr.dest ?? 'F0';
      instr.src1 = instr.src1 ?? 'F0';
      instr.src2 = instr.src2 ?? 'F0';
      instr.base = null;
      instr.offset = null;
    } else if (newOp === 'LOAD') {
      instr.dest = instr.dest ?? 'F0';
      instr.base = instr.base ?? 'R2';
      instr.offset = instr.offset ?? 0;
      instr.src1 = null;
      instr.src2 = null;
    } else if (newOp === 'STORE') {
      instr.src1 = instr.src1 ?? 'F0';
      instr.base = instr.base ?? 'R2';
      instr.offset = instr.offset ?? 0;
      instr.dest = null;
      instr.src2 = null;
    }
  }

  function createDefaultInstruction() {
    return { op: 'ADD', dest: 'F0', src1: 'F0', src2: 'F0', base: null, offset: null };
  }

  /**
   * Renders the program editor table. `program` is mutated in place; `rerender`
   * is called after any structural change (opcode change, add, delete) so the
   * row's available fields stay consistent with its current opcode.
   */
  function renderProgramTable(tbody, program, rerender) {
    clear(tbody);
    program.forEach((instr, idx) => {
      const tr = document.createElement('tr');

      const indexCell = td();
      indexCell.textContent = String(idx + 1);
      tr.appendChild(indexCell);

      const opCell = td();
      opCell.appendChild(
        makeSelect(OPCODES, instr.op, (v) => {
          applyOpDefaults(instr, v);
          rerender();
        })
      );
      tr.appendChild(opCell);

      const destCell = td();
      destCell.appendChild(
        instr.op === 'STORE'
          ? makeDisabledSelect()
          : makeSelect(FP_REGISTERS, instr.dest, (v) => (instr.dest = v))
      );
      tr.appendChild(destCell);

      const src1Cell = td();
      src1Cell.appendChild(
        instr.op === 'LOAD'
          ? makeDisabledSelect()
          : makeSelect(FP_REGISTERS, instr.src1, (v) => (instr.src1 = v))
      );
      tr.appendChild(src1Cell);

      const src2BaseCell = td();
      if (instr.op === 'LOAD' || instr.op === 'STORE') {
        src2BaseCell.appendChild(makeSelect(BASE_REGISTERS, instr.base, (v) => (instr.base = v)));
      } else {
        src2BaseCell.appendChild(makeSelect(FP_REGISTERS, instr.src2, (v) => (instr.src2 = v)));
      }
      tr.appendChild(src2BaseCell);

      const offsetCell = td();
      if (instr.op === 'LOAD' || instr.op === 'STORE') {
        offsetCell.appendChild(makeNumberInput(instr.offset ?? 0, (v) => (instr.offset = v)));
      } else {
        offsetCell.appendChild(makeNumberInput(0, () => {}, true));
      }
      tr.appendChild(offsetCell);

      const delCell = td();
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn';
      delBtn.title = 'Remove instruction';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        program.splice(idx, 1);
        rerender();
      });
      delCell.appendChild(delBtn);
      tr.appendChild(delCell);

      tbody.appendChild(tr);
    });
  }

  function addInstruction(program, rerender) {
    program.push(createDefaultInstruction());
    rerender();
  }

  /** Populates the preset <select>; `onLoad(instructions)` fires on choice. */
  function populatePresetSelect(selectEl, onLoad) {
    clear(selectEl);
    const placeholder = document.createElement('option');
    placeholder.textContent = 'Load preset…';
    placeholder.value = '';
    selectEl.appendChild(placeholder);

    PRESET_PROGRAMS.forEach((preset, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = preset.name;
      opt.title = preset.description;
      selectEl.appendChild(opt);
    });

    selectEl.addEventListener('change', () => {
      if (selectEl.value === '') return;
      const preset = PRESET_PROGRAMS[Number(selectEl.value)];
      onLoad(preset.instructions.map((i) => ({ ...i })));
      selectEl.value = '';
    });
  }

  // ---------------------------------------------------------------------------
  // Configuration editor: station counts, latencies, initial registers/memory
  // ---------------------------------------------------------------------------

  const CONFIG_COUNT_IDS = ['cfg-count-addSub', 'cfg-count-mulDiv', 'cfg-count-load', 'cfg-count-store'];
  const LATENCY_OPS = ['ADD', 'SUB', 'MUL', 'DIV', 'LOAD', 'STORE'];

  function populateConfigForm(config) {
    document.getElementById('cfg-count-addSub').value = config.stationCounts.addSub;
    document.getElementById('cfg-count-mulDiv').value = config.stationCounts.mulDiv;
    document.getElementById('cfg-count-load').value = config.stationCounts.load;
    document.getElementById('cfg-count-store').value = config.stationCounts.store;

    for (const op of LATENCY_OPS) {
      document.getElementById(`cfg-lat-${op}`).value = config.latencies[op];
    }

    // These fields are plain markup in index.html (not built via
    // makeNumberInput), so they need the same digit-locale guard wired up
    // once here.
    CONFIG_COUNT_IDS.forEach((id) => attachNumericSanitizer(document.getElementById(id), false));
    LATENCY_OPS.forEach((op) => attachNumericSanitizer(document.getElementById(`cfg-lat-${op}`), false));
  }

  /** Reads the config form's current input values back into `config`. */
  function readConfigForm(config) {
    config.stationCounts.addSub = clampInt(document.getElementById('cfg-count-addSub').value, 1, 8);
    config.stationCounts.mulDiv = clampInt(document.getElementById('cfg-count-mulDiv').value, 1, 8);
    config.stationCounts.load = clampInt(document.getElementById('cfg-count-load').value, 1, 8);
    config.stationCounts.store = clampInt(document.getElementById('cfg-count-store').value, 1, 8);

    for (const op of LATENCY_OPS) {
      config.latencies[op] = clampInt(document.getElementById(`cfg-lat-${op}`).value, 1, 20);
    }
    return config;
  }

  function clampInt(raw, min, max) {
    const n = Math.round(Number(toWesternDigits(raw)));
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /** Renders the single-row "initial register values" mini-table. */
  function renderRegisterInitEditor(config) {
    const headerRow = document.getElementById('reg-init-header');
    const bodyRow = document.getElementById('reg-init-body');
    clear(headerRow);
    clear(bodyRow);

    const allRegs = [...FP_REGISTERS, ...BASE_REGISTERS];
    for (const reg of allRegs) {
      const th = document.createElement('th');
      th.textContent = reg;
      headerRow.appendChild(th);

      const cell = document.createElement('td');
      const isBase = BASE_REGISTERS.includes(reg);
      const source = isBase ? config.baseRegisters : config.registers;
      cell.appendChild(
        makeNumberInput(source[reg], (v) => {
          source[reg] = v;
        })
      );
      bodyRow.appendChild(cell);
    }
  }

  /** Renders the editable (address, value) memory table. */
  function renderMemoryInitEditor(config, rerender) {
    const body = document.getElementById('mem-init-body');
    clear(body);

    Object.keys(config.memory)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((address) => {
        const tr = document.createElement('tr');

        const addrCell = td();
        addrCell.appendChild(
          makeNumberInput(address, (newAddr) => {
            const value = config.memory[address];
            delete config.memory[address];
            config.memory[newAddr] = value;
            rerender();
          })
        );
        tr.appendChild(addrCell);

        const valCell = td();
        valCell.appendChild(
          makeNumberInput(config.memory[address], (v) => {
            config.memory[address] = v;
          })
        );
        tr.appendChild(valCell);

        const delCell = td();
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'icon-btn';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => {
          delete config.memory[address];
          rerender();
        });
        delCell.appendChild(delBtn);
        tr.appendChild(delCell);

        body.appendChild(tr);
      });
  }

  function addMemoryCell(config, rerender) {
    let addr = 0;
    const existing = new Set(Object.keys(config.memory).map(Number));
    while (existing.has(addr)) addr += 4;
    config.memory[addr] = 0;
    rerender();
  }

  global.Tomasulo = global.Tomasulo || {};
  global.Tomasulo.editor = {
    createDefaultInstruction: createDefaultInstruction,
    renderProgramTable: renderProgramTable,
    addInstruction: addInstruction,
    populatePresetSelect: populatePresetSelect,
    populateConfigForm: populateConfigForm,
    readConfigForm: readConfigForm,
    renderRegisterInitEditor: renderRegisterInitEditor,
    renderMemoryInitEditor: renderMemoryInitEditor,
    addMemoryCell: addMemoryCell,
  };
})(window);
