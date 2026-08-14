/**
 * main.js
 * ---------------------------------------------------------------------------
 * Wires the pure simulation engine (js/core) to the DOM (js/ui). This is the
 * only file that owns mutable, "live" application state - which program is
 * loaded, which configuration is active, whether auto-run is going - and
 * the only file that reaches into the browser (setInterval, event
 * listeners). Everything it calls into is otherwise DOM-agnostic.
 * ---------------------------------------------------------------------------
 */

import { createDefaultConfig, PRESET_PROGRAMS } from './core/config.js';
import { createInitialState, advanceCycle } from './core/simulator.js';
import { renderState } from './ui/render.js';
import { initSchematic, updateSchematic } from './ui/schematic.js';
import * as editor from './ui/editor.js';

let config = createDefaultConfig();
let program = PRESET_PROGRAMS[0].instructions.map((i) => ({ ...i }));
let state = null;
let runIntervalId = null;

const dom = {
  step: document.getElementById('btn-step'),
  run: document.getElementById('btn-run'),
  pause: document.getElementById('btn-pause'),
  reset: document.getElementById('btn-reset'),
  speed: document.getElementById('speed-slider'),
  speedLabel: document.getElementById('speed-label'),
  presetSelect: document.getElementById('preset-select'),
  programBody: document.getElementById('program-table-body'),
  addInstrBtn: document.getElementById('btn-add-instruction'),
  applyConfigBtn: document.getElementById('btn-apply-config'),
  addMemBtn: document.getElementById('btn-add-mem'),
  schematicContainer: document.getElementById('schematic-container'),
};

function rerenderProgramTable() {
  editor.renderProgramTable(dom.programBody, program, rerenderProgramTable);
}

function rerenderMemTable() {
  editor.renderMemoryInitEditor(config, rerenderMemTable);
}

/** Rebuilds the whole simulation from the current program + config. */
function resetSimulation() {
  stopRun();
  state = createInitialState(program, config);
  initSchematic(dom.schematicContainer, config);
  paint();
}

function paint() {
  renderState(state);
  updateSchematic(state);
  updateControlAvailability();
}

function updateControlAvailability() {
  const running = runIntervalId !== null;
  dom.run.disabled = running || state.finished;
  dom.pause.disabled = !running;
  dom.step.disabled = running || state.finished;
}

function stepOnce() {
  if (state.finished) {
    stopRun();
    return;
  }
  advanceCycle(state);
  paint();
  if (state.finished) stopRun();
}

function speedToDelayMs(speed) {
  const min = 80;
  const max = 1200;
  const t = (speed - 1) / 9;
  return Math.round(max - t * (max - min));
}

function startRun() {
  if (runIntervalId !== null || state.finished) return;
  runIntervalId = window.setInterval(stepOnce, speedToDelayMs(Number(dom.speed.value)));
  updateControlAvailability();
}

function stopRun() {
  if (runIntervalId !== null) {
    window.clearInterval(runIntervalId);
    runIntervalId = null;
  }
  updateControlAvailability();
}

// --------------------------------- Wiring ----------------------------------

dom.step.addEventListener('click', stepOnce);
dom.run.addEventListener('click', startRun);
dom.pause.addEventListener('click', stopRun);
dom.reset.addEventListener('click', resetSimulation);

dom.speed.addEventListener('input', () => {
  dom.speedLabel.textContent = dom.speed.value;
  if (runIntervalId !== null) {
    stopRun();
    startRun();
  }
});

dom.addInstrBtn.addEventListener('click', () => editor.addInstruction(program, rerenderProgramTable));
dom.addMemBtn.addEventListener('click', () => editor.addMemoryCell(config, rerenderMemTable));

dom.applyConfigBtn.addEventListener('click', () => {
  editor.readConfigForm(config);
  resetSimulation();
});

editor.populatePresetSelect(dom.presetSelect, (instructions) => {
  program.length = 0;
  program.push(...instructions);
  rerenderProgramTable();
  resetSimulation();
});

// --------------------------------- Boot -------------------------------------

dom.speedLabel.textContent = dom.speed.value;
rerenderProgramTable();
editor.populateConfigForm(config);
editor.renderRegisterInitEditor(config);
rerenderMemTable();
resetSimulation();
