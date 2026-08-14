# Tomasulo Algorithm Simulator

An interactive, from-scratch simulator of **Tomasulo's dynamic instruction
scheduling algorithm** — reservation stations, register renaming, and the
Common Data Bus — built for a Computer Organization course.

It supports ADD, SUB, MUL, DIV, LOAD, and STORE over an F0–F10
floating-point register file, computes real arithmetic on real values,
correctly resolves RAW/WAR/WAW hazards, and visualizes every cycle live:
instruction status, reservation stations, load/store buffers, register
status/values, a CDB broadcast log, and an animated SVG datapath diagram.

Pure vanilla HTML/CSS/JS — **no build step, no framework, no `npm install`
required to run it.** The browser-facing scripts are plain classic
`<script>` tags (not ES modules), specifically so the page works when
opened directly from `file://` — browsers block cross-file ES module
`import`s from `file://` origins, which would otherwise leave every table
empty with a CORS error in the console.

## Quick Start

Just double-click [`index.html`](index.html), or open it from your
browser's File menu. No server, no `npm install`.

Once it's open:

1. Pick a preset from the **Preset** dropdown (or edit the Program Editor
   yourself — add/remove instructions, change opcodes/registers/offsets).
2. Optionally tweak the **Configuration** panel: number of Add/Sub, Mul/Div,
   Load, and Store stations; per-opcode latencies; initial register values;
   initial memory contents. Click **Apply & Reset** to load your changes.
3. Click **Step** to advance one cycle at a time, or **Run** for
   auto-advance (adjust speed with the slider), **Pause** to stop, and
   **Reset** to restart the current program from cycle 0.
4. Watch the live schematic — a pulse travels along the Common Data Bus
   from a reservation station to the register file (or to memory, for a
   STORE) at the exact moment it broadcasts.

## Running the Tests

The core simulation engine (`js/core/`) has zero DOM dependencies, so it
runs directly under Node's built-in test runner:

```bash
cd tomasulo-simulator
node --test tests/
# or, equivalently:
npm test
```

This exercises real arithmetic correctness, LOAD/STORE against the memory
model, WAR/WAW hazard resolution (register renaming), structural hazards
(limited station counts), strict issue → execute → write ordering, and CDB
single-writer-per-cycle arbitration. See [`docs/REPORT.md`](docs/REPORT.md)
for the full write-up, architecture diagram, and a fully worked example
with cycle-by-cycle tables.

## Folder Structure

```
tomasulo-simulator/
├── index.html               # App shell / DOM structure
├── css/
│   └── styles.css           # "Engineering blueprint" visual theme
├── js/
│   ├── core/                # Pure logic — no DOM access, unit-testable
│   │   ├── simulator.js     #   Tomasulo engine: issue/execute/write, CDB arbitration
│   │   ├── stations.js      #   Reservation station / load-store buffer model
│   │   └── config.js        #   Defaults: latencies, station counts, presets
│   ├── ui/                  # DOM rendering — reads core's namespace, never the reverse
│   │   ├── render.js        #   Status tables (instructions, RS, buffers, registers, CDB log)
│   │   ├── schematic.js     #   Live SVG datapath + CDB pulse animation
│   │   └── editor.js        #   Program editor + configuration editor
│   └── main.js               # Event wiring: Step/Run/Pause/Reset, glue state
├── tests/
│   └── simulator.test.js    # node:test unit tests for js/core
├── docs/
│   └── REPORT.md            # Full project report (architecture, walkthrough, worked example)
├── package.json              # `npm test` convenience script only — no dependencies
└── README.md
```

## Design Highlights

- **`js/core/simulator.js` has no DOM dependency whatsoever** — it can be
  `require()`d directly by a Node test file, which is how correctness is
  actually verified (rather than by eyeballing the UI).
- **No ES `import`/`export`, anywhere.** Every file instead attaches its
  API to a shared `window.Tomasulo.*` namespace via plain `<script src>`
  tags loaded in dependency order, while `js/core/*` also detects
  CommonJS (`module.exports`) so the exact same file works under
  `require()` in tests. This is what lets `index.html` be opened directly
  via `file://` — cross-file ES module imports are blocked by browsers
  under that origin, which is a common source of "the page loads but every
  table is empty" bugs in zero-build projects.
- **Register renaming** is implemented via a Register Status table (`Qi`):
  reading a register at issue time either captures its current value or
  the *tag* of whichever station will produce it next, which is what
  resolves WAR/WAW hazards without ever stalling issue for them.
- **CDB arbitration** picks exactly one writer per cycle (earliest-issued
  instruction wins ties) and forwards the broadcast value to every waiting
  station in that same cycle.
- Two ready-to-run presets are included: a **classic hazard demo** (the
  textbook Hennessy & Patterson example, showing WAR/WAW resolution) and an
  **independent workload** (showing free parallel issue/execution with no
  dependencies).

## License

MIT — built for academic coursework.
