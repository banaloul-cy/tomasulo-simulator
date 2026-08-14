/**
 * render.js
 * ---------------------------------------------------------------------------
 * Renders the simulation state into the status tables defined in
 * index.html. Pure "read the state, paint the DOM" code - it never mutates
 * simulator state, and all element lookups are cached once at module load.
 *
 * See the MODULE FORMAT NOTE at the top of js/core/config.js for why this
 * attaches to window.Tomasulo instead of using import/export (this file is
 * browser-only, so it skips the CommonJS branch used by js/core).
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var FP_REGISTERS = global.Tomasulo.config.FP_REGISTERS;
  var BASE_REGISTERS = global.Tomasulo.config.BASE_REGISTERS;

  var el = {
    cycleCounter: document.getElementById('cycle-counter'),
    instrBody: document.getElementById('instruction-status-body'),
    addSubBody: document.getElementById('rs-addsub-body'),
    mulDivBody: document.getElementById('rs-muldiv-body'),
    loadBody: document.getElementById('lb-body'),
    storeBody: document.getElementById('sb-body'),
    registerBody: document.getElementById('register-body'),
    cdbLogBody: document.getElementById('cdb-log-body'),
    statusPill: document.getElementById('status-pill'),
  };

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function td(text, className) {
    var cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function fmtNum(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v !== 'number') return String(v);
    var rounded = Math.round(v * 1000) / 1000;
    // Force Western (ASCII 0-9) digits regardless of the page/OS locale -
    // Number#toString() is always locale-independent, unlike
    // toLocaleString()/Intl.NumberFormat(), so plain String() is correct
    // and intentional here.
    return String(rounded);
  }

  function instructionLabel(instr) {
    switch (instr.op) {
      case 'ADD':
      case 'SUB':
      case 'MUL':
      case 'DIV':
        return instr.op + ' ' + instr.dest + ', ' + instr.src1 + ', ' + instr.src2;
      case 'LOAD':
        return 'LOAD ' + instr.dest + ', ' + instr.offset + '(' + instr.base + ')';
      case 'STORE':
        return 'STORE ' + instr.src1 + ', ' + instr.offset + '(' + instr.base + ')';
      default:
        return instr.op;
    }
  }

  /** Returns 'broadcast' | 'executing' | 'waiting' | 'free' for a station this cycle. */
  function stationVisualState(state, station) {
    var broadcastThisCycle = state.cdbLog.some(function (e) {
      return e.cycle === state.cycle && e.station === station.name;
    });
    if (broadcastThisCycle) return 'broadcast';
    if (!station.busy) return 'free';
    if (station.execStarted) return 'executing';
    return 'waiting';
  }

  function rowClassFor(visualState) {
    if (visualState === 'broadcast') return 'row-busy--broadcast';
    if (visualState === 'executing') return 'row-busy--executing';
    if (visualState === 'waiting') return 'row-busy--waiting';
    return '';
  }

  function stateCellClass(visualState) {
    if (visualState === 'broadcast') return 'state-broadcast';
    if (visualState === 'executing') return 'state-executing';
    if (visualState === 'waiting') return 'state-waiting';
    return 'state-free';
  }

  function renderCycle(state) {
    el.cycleCounter.textContent = String(state.cycle);
    if (state.finished) {
      el.statusPill.textContent = 'Done in ' + state.cycle + ' cycles';
      el.statusPill.className = 'status-pill status-pill--done';
    } else if (state.cycle === 0) {
      el.statusPill.textContent = 'Ready';
      el.statusPill.className = 'status-pill';
    } else {
      el.statusPill.textContent = 'Running';
      el.statusPill.className = 'status-pill status-pill--running';
    }
  }

  function renderInstructionStatus(state) {
    clear(el.instrBody);
    state.program.forEach(function (instr) {
      var tr = document.createElement('tr');
      if (instr.id === state.nextIssueIndex && instr.issueCycle === null && !state.finished) {
        tr.classList.add('row-busy--waiting');
      }
      tr.appendChild(td(instr.id + 1));
      tr.appendChild(td(instructionLabel(instr)));
      tr.appendChild(td(fmtNum(instr.issueCycle)));
      tr.appendChild(td(fmtNum(instr.execStartCycle)));
      tr.appendChild(td(fmtNum(instr.execEndCycle)));
      tr.appendChild(td(fmtNum(instr.writeCycle), instr.writeCycle === state.cycle ? 'state-broadcast' : undefined));
      el.instrBody.appendChild(tr);
    });
  }

  function renderStationPool(tbody, stations, state, kind) {
    clear(tbody);
    stations.forEach(function (s) {
      var visual = stationVisualState(state, s);
      var tr = document.createElement('tr');
      var rowClass = rowClassFor(visual);
      if (rowClass) tr.classList.add(rowClass);

      tr.appendChild(td(s.name));
      tr.appendChild(td(s.busy ? 'yes' : 'no', stateCellClass(visual)));

      if (kind === 'arith') {
        tr.appendChild(td(s.op ?? '—'));
        tr.appendChild(td(fmtNum(s.Vj)));
        tr.appendChild(td(fmtNum(s.Vk)));
        tr.appendChild(td(s.Qj ?? '—'));
        tr.appendChild(td(s.Qk ?? '—'));
      } else if (kind === 'load') {
        tr.appendChild(td(fmtNum(s.A)));
        tr.appendChild(td(s.dest ?? '—'));
      } else if (kind === 'store') {
        tr.appendChild(td(fmtNum(s.A)));
        tr.appendChild(td(fmtNum(s.Vj)));
        tr.appendChild(td(s.Qj ?? '—'));
      }
      tbody.appendChild(tr);
    });
  }

  function renderRegisters(state) {
    clear(el.registerBody);
    var rows = [].concat(FP_REGISTERS, BASE_REGISTERS);
    rows.forEach(function (reg) {
      var tr = document.createElement('tr');
      tr.appendChild(td(reg));
      var isBase = BASE_REGISTERS.includes(reg);
      if (isBase) {
        tr.appendChild(td('—', 'state-free'));
        tr.appendChild(td(fmtNum(state.baseRegisters[reg])));
      } else {
        var qi = state.registerStatus[reg];
        tr.appendChild(td(qi ?? '—', qi ? 'state-waiting' : 'state-free'));
        tr.appendChild(td(fmtNum(state.registerFile[reg])));
      }
      el.registerBody.appendChild(tr);
    });
  }

  function renderCdbLog(state) {
    clear(el.cdbLogBody);
    // Most recent first, so the newest broadcast is always visible without scrolling.
    var entries = state.cdbLog.slice().reverse();
    entries.forEach(function (entry) {
      var tr = document.createElement('tr');
      if (entry.cycle === state.cycle) tr.classList.add('row-busy--broadcast');
      tr.appendChild(td(entry.cycle));
      tr.appendChild(td(entry.station));
      tr.appendChild(td(entry.dest));
      tr.appendChild(td(fmtNum(entry.value)));
      el.cdbLogBody.appendChild(tr);
    });
  }

  /** Renders every status table for the given simulation state. */
  function renderState(state) {
    renderCycle(state);
    renderInstructionStatus(state);
    renderStationPool(el.addSubBody, state.pools.addSub, state, 'arith');
    renderStationPool(el.mulDivBody, state.pools.mulDiv, state, 'arith');
    renderStationPool(el.loadBody, state.pools.load, state, 'load');
    renderStationPool(el.storeBody, state.pools.store, state, 'store');
    renderRegisters(state);
    renderCdbLog(state);
  }

  global.Tomasulo = global.Tomasulo || {};
  global.Tomasulo.render = {
    renderState: renderState,
    stationVisualState: stationVisualState,
    instructionLabel: instructionLabel,
  };
})(window);
