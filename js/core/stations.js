/**
 * stations.js
 * ---------------------------------------------------------------------------
 * Reservation Station / Load-Store Buffer data model and small pure helper
 * functions. No DOM access, no simulation "policy" (issue/execute/write
 * ordering lives in simulator.js) - this file only knows how to create,
 * reset and query station pools.
 * ---------------------------------------------------------------------------
 */

import { STATION_TYPE_BY_OP } from './config.js';

/**
 * Creates one empty station of the given kind.
 * kind: 'addSub' | 'mulDiv' | 'load' | 'store'
 */
function createEmptyStation(kind, name) {
  const base = {
    name,
    kind,
    busy: false,
    op: null,
    instrId: null,
    // Operand values (already resolved) and their producing-station tags.
    // Qj/Qk === null means the operand is ready and its value is in Vj/Vk.
    Vj: null,
    Vk: null,
    Qj: null,
    Qk: null,
    // Effective address for LOAD/STORE (computed at issue time).
    A: null,
    // Destination register name (arithmetic + LOAD only; null for STORE).
    dest: null,
    // Timing bookkeeping.
    execStarted: false,
    execStart: null,
    execEnd: null,
    result: null,
    writtenBack: false,
  };
  return base;
}

/** Builds the four station pools according to the configured counts. */
export function createStationPools(config) {
  const pools = { addSub: [], mulDiv: [], load: [], store: [] };
  for (let i = 0; i < config.stationCounts.addSub; i++) {
    pools.addSub.push(createEmptyStation('addSub', `Add${i + 1}`));
  }
  for (let i = 0; i < config.stationCounts.mulDiv; i++) {
    pools.mulDiv.push(createEmptyStation('mulDiv', `Mul${i + 1}`));
  }
  for (let i = 0; i < config.stationCounts.load; i++) {
    pools.load.push(createEmptyStation('load', `Load${i + 1}`));
  }
  for (let i = 0; i < config.stationCounts.store; i++) {
    pools.store.push(createEmptyStation('store', `Store${i + 1}`));
  }
  return pools;
}

/** Returns the pool array (from `pools`) that services the given opcode. */
export function poolForOp(pools, op) {
  return pools[STATION_TYPE_BY_OP[op]];
}

/** Finds the first free (non-busy) station in a pool, or null. */
export function findFreeStation(pool) {
  return pool.find((s) => !s.busy) || null;
}

/** Flattens all pools into a single array, useful for iteration/rendering. */
export function allStations(pools) {
  return [...pools.addSub, ...pools.mulDiv, ...pools.load, ...pools.store];
}

/** Finds a station by its unique name across all pools. */
export function findStationByName(pools, name) {
  return allStations(pools).find((s) => s.name === name) || null;
}

/** Resets a station back to its empty/free state, ready for reuse. */
export function freeStation(station) {
  station.busy = false;
  station.op = null;
  station.instrId = null;
  station.Vj = null;
  station.Vk = null;
  station.Qj = null;
  station.Qk = null;
  station.A = null;
  station.dest = null;
  station.execStarted = false;
  station.execStart = null;
  station.execEnd = null;
  station.result = null;
  station.writtenBack = false;
}

/** True when a station has both operands available (ready to execute). */
export function operandsReady(station) {
  if (station.kind === 'load') return true; // address is all a load needs
  if (station.kind === 'store') return station.Qj === null;
  return station.Qj === null && station.Qk === null;
}
