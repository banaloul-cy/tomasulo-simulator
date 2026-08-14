/**
 * config.js
 * ---------------------------------------------------------------------------
 * Central place for default simulator configuration: register file layout,
 * reservation-station pool sizes, per-opcode latencies, initial memory
 * contents, and two ready-to-run example programs.
 *
 * Nothing in this file touches the DOM - it is plain data + small pure
 * helper functions so it can be safely shared by both the core engine and
 * the UI layer.
 *
 * MODULE FORMAT NOTE: this file (and the rest of js/core, js/ui, js/main.js)
 * deliberately avoids ES `import`/`export` syntax. Browsers only allow
 * cross-file `import`s for scripts loaded as `type="module"`, and those are
 * fetched with the same CORS rules as `fetch()` - which blocks loading a
 * sibling file when the page is opened straight from `file://` (double-
 * clicking index.html). Since the spec for this project requires it to run
 * with zero build step and zero server, every file instead exposes its
 * public API on a shared `window.Tomasulo` namespace (populated by plain,
 * CORS-exempt `<script src="...">` tags in dependency order - see
 * index.html), while ALSO supporting Node's CommonJS `require()` so the
 * exact same file can be unit-tested directly. See the closing lines below.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // Floating point register file: F0..F10 (11 registers), per spec.
  var FP_REGISTERS = Array.from({ length: 11 }, function (_, i) { return 'F' + i; });

  // Integer "base" registers used only for effective-address calculation.
  // They are treated as fixed values (never renamed / never written by the
  // instructions the simulator executes) - a standard simplification used in
  // the classic Hennessy & Patterson Tomasulo examples.
  var BASE_REGISTERS = ['R1', 'R2', 'R3'];

  var OPCODES = ['ADD', 'SUB', 'MUL', 'DIV', 'LOAD', 'STORE'];

  // Which physical station pool handles a given opcode.
  var STATION_TYPE_BY_OP = {
    ADD: 'addSub',
    SUB: 'addSub',
    MUL: 'mulDiv',
    DIV: 'mulDiv',
    LOAD: 'load',
    STORE: 'store',
  };

  function isArithmeticOp(op) {
    return op === 'ADD' || op === 'SUB' || op === 'MUL' || op === 'DIV';
  }

  function needsTwoRegisterOperands(op) {
    return isArithmeticOp(op);
  }

  /**
   * Deep-clones the default configuration so callers can freely mutate their
   * own copy (e.g. from the configuration editor) without corrupting the
   * shared defaults.
   */
  function createDefaultConfig() {
    return structuredCloneCompat({
      stationCounts: {
        addSub: 3,
        mulDiv: 2,
        load: 3,
        store: 3,
      },
      latencies: {
        ADD: 2,
        SUB: 2,
        MUL: 4,
        DIV: 8,
        LOAD: 2,
        STORE: 2,
      },
      registers: {
        F0: 0, F1: 0, F2: 0, F3: 0, F4: 5, F5: 0,
        F6: 0, F7: 0, F8: 0, F9: 0, F10: 0,
      },
      baseRegisters: {
        R1: 0,
        R2: 100,
        R3: 200,
      },
      // Simple key-value memory model. Keys are numeric byte addresses
      // (effective address = base-register value + offset), values are
      // numbers. Pre-populated so the two preset programs' LOADs resolve to
      // meaningful, non-zero values.
      memory: {
        100: 45.0,  // R2 + 0    (preset 2, LOAD F0)
        108: 22.0,  // R2 + 8    (preset 2, LOAD F2)
        134: 12.5,  // R2 + 34   (preset 1, LOAD F6)
        245: 7.5,   // R3 + 45   (preset 1, LOAD F2)
      },
    });
  }

  function structuredCloneCompat(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Two ready-to-run example programs.
   * Instruction shape:
   *   Arithmetic: { op, dest, src1, src2 }
   *   LOAD:       { op, dest, base, offset }
   *   STORE:      { op, src1, base, offset }
   */
  var PRESET_PROGRAMS = [
    {
      name: 'Classic Hazard Demo (Hennessy & Patterson)',
      description:
        'The canonical Tomasulo example. F6 and F2 are each written twice, ' +
        'forcing WAW/WAR hazards that must be resolved purely through ' +
        'register renaming (the Qi status table) rather than by stalling.',
      instructions: [
        { op: 'LOAD', dest: 'F6', base: 'R2', offset: 34 },
        { op: 'LOAD', dest: 'F2', base: 'R3', offset: 45 },
        { op: 'MUL', dest: 'F0', src1: 'F2', src2: 'F4' },
        { op: 'SUB', dest: 'F8', src1: 'F6', src2: 'F2' },
        { op: 'DIV', dest: 'F10', src1: 'F0', src2: 'F6' },
        { op: 'ADD', dest: 'F6', src1: 'F8', src2: 'F2' },
      ],
    },
    {
      name: 'Independent Workload (Parallel Issue)',
      description:
        'Mostly independent instructions that exercise multiple reservation ' +
        'stations in parallel and finish with a STORE, showing that unrelated ' +
        'work overlaps freely when there are no data dependencies.',
      instructions: [
        { op: 'LOAD', dest: 'F0', base: 'R2', offset: 0 },
        { op: 'LOAD', dest: 'F2', base: 'R2', offset: 8 },
        { op: 'ADD', dest: 'F4', src1: 'F0', src2: 'F2' },
        { op: 'MUL', dest: 'F6', src1: 'F0', src2: 'F2' },
        { op: 'SUB', dest: 'F8', src1: 'F2', src2: 'F0' },
        { op: 'STORE', src1: 'F4', base: 'R3', offset: 16 },
      ],
    },
  ];

  var ConfigModule = {
    FP_REGISTERS: FP_REGISTERS,
    BASE_REGISTERS: BASE_REGISTERS,
    OPCODES: OPCODES,
    STATION_TYPE_BY_OP: STATION_TYPE_BY_OP,
    isArithmeticOp: isArithmeticOp,
    needsTwoRegisterOperands: needsTwoRegisterOperands,
    createDefaultConfig: createDefaultConfig,
    PRESET_PROGRAMS: PRESET_PROGRAMS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConfigModule;
  } else {
    global.Tomasulo = global.Tomasulo || {};
    global.Tomasulo.config = ConfigModule;
  }
})(typeof window !== 'undefined' ? window : globalThis);
