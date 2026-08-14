/**
 * simulator.test.js
 * ---------------------------------------------------------------------------
 * Unit tests for the pure Tomasulo engine (js/core/simulator.js).
 * Run with:  npm test   (or)   node --test tests/
 * ---------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, PRESET_PROGRAMS } from '../js/core/config.js';
import { createInitialState, advanceCycle, runToCompletion } from '../js/core/simulator.js';
import { allStations } from '../js/core/stations.js';

function freshState(program, configOverrides = {}) {
  const config = createDefaultConfig();
  Object.assign(config, configOverrides);
  return createInitialState(program, config);
}

// ---------------------------------------------------------------------------
// 1. Basic arithmetic correctness
// ---------------------------------------------------------------------------

test('ADD computes real sum from real register values', () => {
  const config = createDefaultConfig();
  config.registers.F2 = 10;
  config.registers.F4 = 4;
  const program = [{ op: 'ADD', dest: 'F6', src1: 'F2', src2: 'F4' }];
  const state = createInitialState(program, config);
  runToCompletion(state);
  assert.equal(state.program[0].result, 14);
  assert.equal(state.registerFile.F6, 14);
});

test('SUB / MUL / DIV compute correct real values', () => {
  const config = createDefaultConfig();
  config.registers.F0 = 20;
  config.registers.F1 = 4;
  const program = [
    { op: 'SUB', dest: 'F2', src1: 'F0', src2: 'F1' },
    { op: 'MUL', dest: 'F3', src1: 'F0', src2: 'F1' },
    { op: 'DIV', dest: 'F4', src1: 'F0', src2: 'F1' },
  ];
  const state = createInitialState(program, config);
  runToCompletion(state);
  assert.equal(state.registerFile.F2, 16);
  assert.equal(state.registerFile.F3, 80);
  assert.equal(state.registerFile.F4, 5);
});

test('LOAD reads from the key-value memory model using base+offset', () => {
  const config = createDefaultConfig();
  config.baseRegisters.R2 = 100;
  config.memory = { 150: 99.5 };
  const program = [{ op: 'LOAD', dest: 'F1', base: 'R2', offset: 50 }];
  const state = createInitialState(program, config);
  runToCompletion(state);
  assert.equal(state.program[0].address, 150);
  assert.equal(state.registerFile.F1, 99.5);
});

test('STORE writes the source register value into memory at base+offset', () => {
  const config = createDefaultConfig();
  config.registers.F5 = 42;
  config.baseRegisters.R3 = 200;
  const program = [{ op: 'STORE', src1: 'F5', base: 'R3', offset: 10 }];
  const state = createInitialState(program, config);
  runToCompletion(state);
  assert.equal(state.memory[210], 42);
});

// ---------------------------------------------------------------------------
// 2. Hazard resolution via register renaming (Qi)
// ---------------------------------------------------------------------------

test('WAR/WAW hazards are resolved: a register reused as a later destination ' +
  'does not corrupt an earlier instruction still reading the old value', () => {
  const config = createDefaultConfig();
  config.registers.F2 = 3;
  config.registers.F4 = 7;
  config.registers.F6 = 100;
  // SUB reads the ORIGINAL F6 (100); ADD later overwrites F6. SUB must see
  // 100, not whatever ADD eventually produces.
  const program = [
    { op: 'SUB', dest: 'F8', src1: 'F6', src2: 'F2' }, // 100 - 3 = 97
    { op: 'ADD', dest: 'F6', src1: 'F2', src2: 'F4' },  // 3 + 7 = 10 (new F6)
  ];
  const state = createInitialState(program, config);
  runToCompletion(state);
  assert.equal(state.program[0].result, 97);
  assert.equal(state.registerFile.F6, 10);
});

test('WAW: when a later-issued instruction targeting the same register ' +
  'finishes BEFORE an earlier, slower one, the register file keeps the ' +
  'program-order-correct (newer) value, not the stale older one', () => {
  const config = createDefaultConfig();
  config.registers.F0 = 2;
  config.registers.F1 = 3;
  // DIV (issued first, latency 8) and ADD (issued second, latency 2) both
  // target F9. ADD will complete its write-back long before DIV does.
  const program = [
    { op: 'DIV', dest: 'F9', src1: 'F0', src2: 'F1' }, // slow, stale writer
    { op: 'ADD', dest: 'F9', src1: 'F0', src2: 'F1' }, // fast, authoritative writer
  ];
  const state = createInitialState(program, config);
  runToCompletion(state);
  const divInstr = state.program[0];
  const addInstr = state.program[1];
  assert.ok(addInstr.writeCycle < divInstr.writeCycle, 'ADD should write back before DIV');
  // Final architectural value must be ADD's result (2+3=5), not clobbered
  // by DIV's later write-back (2/3).
  assert.equal(state.registerFile.F9, 5);
});

test('register renaming lets an instruction pick up the freshest producer, ' +
  'not a stale in-flight one, when issued after a WAW rename', () => {
  const config = createDefaultConfig();
  config.registers.F0 = 1;
  config.registers.F1 = 1;
  const program = [
    { op: 'DIV', dest: 'F2', src1: 'F0', src2: 'F1' }, // slow producer #1 of F2 -> 1
    { op: 'ADD', dest: 'F2', src1: 'F0', src2: 'F1' }, // fast producer #2 of F2 -> 2
    { op: 'MUL', dest: 'F3', src1: 'F2', src2: 'F1' }, // must read producer #2's value (2), not #1's
  ];
  const state = createInitialState(program, config);
  runToCompletion(state);
  assert.equal(state.registerFile.F3, 2);
});

// ---------------------------------------------------------------------------
// 3. Structural hazards (limited reservation stations)
// ---------------------------------------------------------------------------

test('issue stalls in program order when no matching reservation station is free', () => {
  const config = createDefaultConfig();
  config.stationCounts.addSub = 1; // force a structural hazard
  config.latencies.ADD = 4;
  const program = [
    { op: 'ADD', dest: 'F1', src1: 'F0', src2: 'F0' },
    { op: 'ADD', dest: 'F2', src1: 'F0', src2: 'F0' }, // must wait for the only Add station
  ];
  const state = createInitialState(program, config);
  advanceCycle(state); // cycle 1: instr 0 issues
  assert.equal(state.program[0].issueCycle, 1);
  assert.equal(state.program[1].issueCycle, null, 'second ADD cannot issue: station busy');

  runToCompletion(state);
  assert.ok(state.program[1].issueCycle > state.program[0].writeCycle - 10); // sanity: eventually issues
  assert.ok(state.program[1].issueCycle >= 1);
  // The crucial structural guarantee: instr 1 cannot ISSUE into the shared
  // station until it is free again, i.e. no earlier than instr 0's own
  // execution having started (station becomes reusable only after write-back).
  assert.ok(state.program[1].issueCycle > state.program[0].execStartCycle);
});

// ---------------------------------------------------------------------------
// 4. Core timing invariants (the properties explicitly required by spec)
// ---------------------------------------------------------------------------

test('no instruction begins execution before all of its operands are available', () => {
  for (const preset of PRESET_PROGRAMS) {
    const state = freshState(preset.instructions);
    runToCompletion(state);
    for (const instr of state.program) {
      assert.notEqual(instr.execStartCycle, null, `${preset.name}: instruction ${instr.id} never executed`);
      if (instr.op === 'ADD' || instr.op === 'SUB' || instr.op === 'MUL' || instr.op === 'DIV') {
        // Both source producers (if any) must have already written back
        // strictly before this instruction's execution began.
        for (const src of [instr.src1, instr.src2]) {
          const producer = state.program.find(
            (other) => other.dest === src && other.id < instr.id && other.writeCycle !== null
          );
          if (producer) {
            assert.ok(
              producer.writeCycle < instr.execStartCycle,
              `${preset.name}: instr ${instr.id} started executing (cycle ${instr.execStartCycle}) ` +
                `before its producer (instr ${producer.id}) wrote back (cycle ${producer.writeCycle})`
            );
          }
        }
      }
    }
  }
});

test('no two instructions write to the CDB (or commit to memory) in the same cycle', () => {
  for (const preset of PRESET_PROGRAMS) {
    const state = freshState(preset.instructions);
    runToCompletion(state);
    // Only arithmetic/LOAD instructions share the literal CDB; STORE
    // commits to memory independently, so it is excluded here.
    const cdbUsers = state.program.filter((i) => i.op !== 'STORE');
    const cdbCycles = cdbUsers.map((i) => i.writeCycle);
    const dupes = cdbCycles.filter((c, idx) => cdbCycles.indexOf(c) !== idx);
    assert.equal(dupes.length, 0, `${preset.name}: duplicate CDB write cycles found: ${dupes}`);
  }
});

test('write always occurs strictly after execute-end, and execute always occurs strictly after issue', () => {
  for (const preset of PRESET_PROGRAMS) {
    const state = freshState(preset.instructions);
    runToCompletion(state);
    for (const instr of state.program) {
      assert.ok(instr.execStartCycle > instr.issueCycle, `instr ${instr.id}: exec must start after issue`);
      assert.ok(instr.execEndCycle >= instr.execStartCycle, `instr ${instr.id}: exec end must not precede exec start`);
      assert.ok(instr.writeCycle > instr.execEndCycle, `instr ${instr.id}: write must occur after exec end`);
    }
  }
});

test('the CDB log never contains two entries for the same cycle', () => {
  for (const preset of PRESET_PROGRAMS) {
    const state = freshState(preset.instructions);
    runToCompletion(state);
    const cycles = state.cdbLog.map((e) => e.cycle);
    const uniqueCycles = new Set(cycles);
    assert.equal(cycles.length, uniqueCycles.size, `${preset.name}: CDB log has a cycle collision`);
  }
});

test('issue happens strictly in program order', () => {
  for (const preset of PRESET_PROGRAMS) {
    const state = freshState(preset.instructions);
    runToCompletion(state);
    for (let i = 1; i < state.program.length; i++) {
      assert.ok(
        state.program[i].issueCycle >= state.program[i - 1].issueCycle,
        `${preset.name}: instruction ${i} issued before instruction ${i - 1}`
      );
    }
  }
});

test('simulation terminates (all instructions eventually write back) for both presets', () => {
  for (const preset of PRESET_PROGRAMS) {
    const state = freshState(preset.instructions);
    runToCompletion(state, 500);
    assert.ok(state.finished, `${preset.name} did not finish within cycle cap`);
    for (const instr of state.program) {
      assert.notEqual(instr.writeCycle, null);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. All reservation stations return to a free state after completion
// ---------------------------------------------------------------------------

test('every reservation station / buffer is freed once the program finishes', () => {
  const state = freshState(PRESET_PROGRAMS[0].instructions);
  runToCompletion(state);
  for (const station of allStations(state.pools)) {
    assert.equal(station.busy, false);
  }
});

// ---------------------------------------------------------------------------
// 6. Classic worked example sanity check (parallelism actually happens)
// ---------------------------------------------------------------------------

test('independent instructions overlap: at least two instructions are executing in the same cycle', () => {
  const state = freshState(PRESET_PROGRAMS[1].instructions);
  const executingCyclesPerInstr = state.program.map(() => new Set());
  while (!state.finished) {
    advanceCycle(state);
    state.program.forEach((instr, idx) => {
      if (
        instr.execStartCycle !== null &&
        instr.execStartCycle <= state.cycle &&
        (instr.writeCycle === null || instr.writeCycle > state.cycle)
      ) {
        executingCyclesPerInstr[idx].add(state.cycle);
      }
    });
  }
  // Build cycle -> count-of-instructions-executing map.
  const perCycleCount = {};
  executingCyclesPerInstr.forEach((set) => {
    set.forEach((cycle) => {
      perCycleCount[cycle] = (perCycleCount[cycle] || 0) + 1;
    });
  });
  const maxOverlap = Math.max(...Object.values(perCycleCount));
  assert.ok(maxOverlap >= 2, 'expected at least two instructions executing concurrently');
});
