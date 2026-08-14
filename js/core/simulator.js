/**
 * simulator.js
 * ---------------------------------------------------------------------------
 * Pure Tomasulo's algorithm simulation engine. This module has ZERO
 * dependency on the DOM, browser globals, or any UI code - it can be
 * `import`-ed directly from a Node test file.
 *
 * -------------------------------------------------------------------------
 * PER-CYCLE ORDER OF OPERATIONS (advanceCycle)
 * -------------------------------------------------------------------------
 * A single call to advanceCycle(state) advances the whole machine by one
 * clock cycle, performing these sub-steps in a fixed, carefully chosen
 * order so that timing is unambiguous and testable:
 *
 *   1. Snapshot which busy-but-not-executing stations already had BOTH
 *      operands ready coming INTO this cycle (i.e. before anything that
 *      happens *during* this cycle can affect them). This snapshot is what
 *      makes "you can't execute the same cycle a value is broadcast to you"
 *      hold true, matching the classic textbook convention.
 *   2. WRITE-RESULT stage: among all stations whose execution finished on a
 *      previous cycle and who have not written back yet, pick exactly ONE
 *      winner (ties broken by program order / instruction id - the station
 *      that was issued earliest wins the bus). That winner broadcasts its
 *      value on the Common Data Bus (CDB): every OTHER station currently
 *      waiting on it (Qj/Qk pointing at the winner) latches the value in
 *      the very same cycle, and the Register Status table is cleared for
 *      that destination register (register renaming resolved).
 *   3. STORE-COMMIT stage: stores don't use the CDB (they have no register
 *      destination) so any store whose execution just finished commits
 *      straight to memory this same cycle - no arbitration required.
 *   4. EXECUTE-START stage: using the step-1 snapshot (NOT any value that
 *      was just broadcast in step 2), any station that was already fully
 *      ready begins execution this cycle.
 *   5. ISSUE stage: at most one new instruction, taken strictly in program
 *      order, is issued into a free matching reservation station / buffer.
 *      Register renaming happens here: source operands either capture the
 *      current register value (Qj = null) or the tag of whichever station
 *      currently owns that register (Qj = stationName), and the
 *      destination register's status entry is updated to point at this
 *      new station (resolving WAW/WAR for any later instruction that reads
 *      or writes the same register).
 * ---------------------------------------------------------------------------
 */

import { createStationPools, poolForOp, findFreeStation, allStations, freeStation, operandsReady } from './stations.js';
import { STATION_TYPE_BY_OP, isArithmeticOp } from './config.js';

/** Builds a fresh simulation state from a program + configuration. */
export function createInitialState(program, config) {
  const registerStatus = {};
  Object.keys(config.registers).forEach((r) => (registerStatus[r] = null));

  const instructions = program.map((instr, index) => ({
    id: index,
    op: instr.op,
    dest: instr.dest ?? null,
    src1: instr.src1 ?? null,
    src2: instr.src2 ?? null,
    base: instr.base ?? null,
    offset: instr.offset ?? null,
    // Lifecycle timestamps (null until reached).
    issueCycle: null,
    execStartCycle: null,
    execEndCycle: null,
    writeCycle: null,
    address: null,
    result: null,
  }));

  return {
    cycle: 0,
    config,
    program: instructions,
    nextIssueIndex: 0,
    pools: createStationPools(config),
    registerStatus,
    registerFile: { ...config.registers },
    baseRegisters: { ...config.baseRegisters },
    memory: { ...config.memory },
    cdbLog: [], // { cycle, station, dest, value }
    finished: false,
  };
}

/** True once every instruction has completed its write-back stage. */
export function isSimulationDone(state) {
  return state.program.every((instr) => instr.writeCycle !== null);
}

function computeResult(op, vj, vk) {
  switch (op) {
    case 'ADD':
      return vj + vk;
    case 'SUB':
      return vj - vk;
    case 'MUL':
      return vj * vk;
    case 'DIV':
      return vj / vk;
    default:
      throw new Error(`computeResult: unsupported opcode ${op}`);
  }
}

/**
 * Advances the simulation by exactly one clock cycle, mutating and
 * returning `state`. Safe to call repeatedly until isSimulationDone(state).
 */
export function advanceCycle(state) {
  if (state.finished) return state;
  state.cycle += 1;

  // ---- Step 1: snapshot pre-cycle readiness -----------------------------
  const preCycleReady = new Map();
  for (const station of allStations(state.pools)) {
    if (station.busy && !station.execStarted) {
      preCycleReady.set(station.name, operandsReady(station));
    }
  }

  // ---- Step 2: write-result / CDB arbitration ----------------------------
  runWriteBackStage(state);

  // ---- Step 3: store commit (no CDB / no arbitration needed) ------------
  runStoreCommitStage(state);

  // ---- Step 4: execute-start using the PRE-cycle snapshot ----------------
  for (const station of allStations(state.pools)) {
    if (station.busy && !station.execStarted && preCycleReady.get(station.name)) {
      startExecution(state, station);
    }
  }

  // ---- Step 5: issue (at most one instruction, in program order) --------
  runIssueStage(state);

  state.finished = isSimulationDone(state);
  return state;
}

function startExecution(state, station) {
  const latency = state.config.latencies[station.op];
  station.execStarted = true;
  station.execStart = state.cycle;
  station.execEnd = state.cycle + latency - 1;
  const instr = state.program[station.instrId];
  instr.execStartCycle = state.cycle;
  instr.execEndCycle = station.execEnd;
}

function runWriteBackStage(state) {
  // Candidates: execution finished on a previous cycle, not yet written,
  // and this station actually needs the CDB (arithmetic + load; stores are
  // handled separately in runStoreCommitStage).
  const candidates = allStations(state.pools).filter(
    (s) =>
      s.busy &&
      s.execStarted &&
      s.kind !== 'store' &&
      !s.writtenBack &&
      s.execEnd !== null &&
      s.execEnd < state.cycle
  );
  if (candidates.length === 0) return;

  // Only one instruction may use the CDB per cycle - arbitrate by program
  // order (lowest instruction id issued earliest wins).
  candidates.sort((a, b) => a.instrId - b.instrId);
  const winner = candidates[0];

  const instr = state.program[winner.instrId];
  const value = winner.result;

  instr.writeCycle = state.cycle;
  instr.result = value;
  winner.writtenBack = true;

  state.cdbLog.push({
    cycle: state.cycle,
    station: winner.name,
    dest: winner.dest,
    value,
  });

  // Broadcast: forward to every other waiting station in this same cycle.
  // Any station whose last outstanding operand just resolved can now have
  // its result computed (it will actually be consumed later, at its own
  // execEnd, but nothing prevents computing it as soon as it's knowable).
  for (const s of allStations(state.pools)) {
    if (s === winner) continue;
    let resolvedSomething = false;
    if (s.Qj === winner.name) {
      s.Qj = null;
      s.Vj = value;
      resolvedSomething = true;
    }
    if (s.Qk === winner.name) {
      s.Qk = null;
      s.Vk = value;
      resolvedSomething = true;
    }
    if (resolvedSomething) fillResultIfReady(state, s);
  }

  // Resolve the register status table (register renaming complete) and
  // commit the value to the register file - but ONLY if this station is
  // still the most-recently-issued producer of that register. If a later
  // (WAW) instruction has since re-pointed registerStatus at itself, that
  // later instruction is the program-order-authoritative writer, so this
  // (older, possibly slower) write-back must not clobber the register
  // file with a stale value even if it completes out of order.
  if (winner.dest !== null && state.registerStatus[winner.dest] === winner.name) {
    state.registerStatus[winner.dest] = null;
    state.registerFile[winner.dest] = value;
  }

  freeStation(winner);
}

function runStoreCommitStage(state) {
  for (const s of state.pools.store) {
    if (s.busy && s.execStarted && !s.writtenBack && s.execEnd !== null && s.execEnd < state.cycle) {
      const instr = state.program[s.instrId];
      state.memory[s.A] = s.Vj;
      instr.writeCycle = state.cycle;
      instr.result = s.Vj;
      s.writtenBack = true;
      state.cdbLog.push({
        cycle: state.cycle,
        station: s.name,
        dest: `mem[${s.A}]`,
        value: s.Vj,
      });
      freeStation(s);
    }
  }
}

function runIssueStage(state) {
  if (state.nextIssueIndex >= state.program.length) return;
  const instr = state.program[state.nextIssueIndex];
  const pool = poolForOp(state.pools, instr.op);
  const station = findFreeStation(pool);
  if (!station) return; // structural hazard: stall issue until a slot frees

  station.busy = true;
  station.op = instr.op;
  station.instrId = instr.id;
  station.execStarted = false;
  station.execStart = null;
  station.execEnd = null;
  station.writtenBack = false;

  if (isArithmeticOp(instr.op)) {
    resolveOperand(state, station, 'j', instr.src1);
    resolveOperand(state, station, 'k', instr.src2);
    station.dest = instr.dest;
    state.registerStatus[instr.dest] = station.name;
    // If both operands happen to already be ready, pre-compute the result
    // now (values are fixed at issue time); it is only *used* once
    // execution finishes, keeping the timing model unaffected.
  } else if (instr.op === 'LOAD') {
    station.A = state.baseRegisters[instr.base] + instr.offset;
    station.dest = instr.dest;
    state.registerStatus[instr.dest] = station.name;
    instr.address = station.A;
  } else if (instr.op === 'STORE') {
    station.A = state.baseRegisters[instr.base] + instr.offset;
    station.dest = null;
    resolveOperand(state, station, 'j', instr.src1);
    instr.address = station.A;
  }

  instr.issueCycle = state.cycle;
  state.nextIssueIndex += 1;

  // Result computation: for arithmetic/load we compute the value as soon
  // as it is knowable and stash it on the station; runWriteBackStage /
  // execution-completion simply reads station.result at execEnd time.
  // For arithmetic ops whose operands are not yet ready, the value is
  // filled in lazily right before it is needed (see fillResultIfReady).
  fillResultIfReady(state, station);
}

/**
 * Computes and stores a station's result value as soon as both operands
 * are resolvable. For LOAD this happens immediately at issue (reads
 * memory using the address computed at issue time). For arithmetic ops it
 * may need to wait until a CDB broadcast resolves the last operand, so
 * this helper is also invoked from the write-back stage's broadcast loop
 * whenever a waiting station's Qj/Qk just got resolved.
 */
function fillResultIfReady(state, station) {
  if (station.kind === 'load') {
    const raw = state.memory[station.A];
    station.result = raw === undefined ? 0 : raw;
  } else if (station.kind === 'addSub' || station.kind === 'mulDiv') {
    if (station.Qj === null && station.Qk === null) {
      station.result = computeResult(station.op, station.Vj, station.Vk);
    }
  }
  // STORE has no "result" of its own beyond Vj, read directly at commit time.
}

function resolveOperand(state, station, slot, regName) {
  const producingStation = state.registerStatus[regName];
  const qKey = slot === 'j' ? 'Qj' : 'Qk';
  const vKey = slot === 'j' ? 'Vj' : 'Vk';
  if (producingStation) {
    station[qKey] = producingStation;
    station[vKey] = null;
  } else {
    station[qKey] = null;
    station[vKey] = state.registerFile[regName];
  }
}

export { computeResult };

/** Runs the whole program to completion (or until a safety cycle cap). */
export function runToCompletion(state, maxCycles = 1000) {
  while (!state.finished && state.cycle < maxCycles) {
    advanceCycle(state);
  }
  return state;
}
