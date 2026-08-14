/**
 * schematic.js
 * ---------------------------------------------------------------------------
 * Builds and updates the live SVG datapath diagram: reservation-station /
 * buffer boxes on the left, a vertical Common Data Bus in the middle, and
 * the Register File + Memory boxes on the right. On every cycle that
 * produces a CDB broadcast, a small pulse travels along the bus from the
 * producing station to its destination box.
 * ---------------------------------------------------------------------------
 */

import { stationVisualState } from './render.js';

const NS = 'http://www.w3.org/2000/svg';
const ROW_H = 24;
const ROW_GAP = 5;
const GROUP_HEADER_H = 16;
const GROUP_GAP = 12;
const COL1_X = 12;
const COL1_W = 168;
const BUS_X = 214;
const COL2_X = 250;
const COL2_W = 140;
const MARGIN_TOP = 16;

let container = null;
let svg = null;
let boxLayer = null;
let pulseLayer = null;
/** name -> { x, y, w, h } for every station box currently drawn. */
let boxRects = new Map();
let registerBoxRect = null;
let memoryBoxRect = null;
let lastAnimatedCycle = -1;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const GROUP_DEFS = [
  { key: 'addSub', label: 'ADD / SUB RS' },
  { key: 'mulDiv', label: 'MUL / DIV RS' },
  { key: 'load', label: 'LOAD BUFFERS' },
  { key: 'store', label: 'STORE BUFFERS' },
];

/** (Re)builds the static schematic layout for the given station counts. */
export function initSchematic(hostElement, config) {
  container = hostElement;
  boxRects = new Map();

  let y = MARGIN_TOP;
  const groupLayout = GROUP_DEFS.map((g) => {
    const count = config.stationCounts[g.key];
    const groupTop = y;
    y += GROUP_HEADER_H;
    const rowsTop = y;
    y += count * (ROW_H + ROW_GAP);
    y += GROUP_GAP;
    return { ...g, count, groupTop, rowsTop };
  });
  const leftColHeight = y;

  const registerH = 70;
  const memoryH = 70;
  const rightColHeight = MARGIN_TOP + registerH + 40 + memoryH + MARGIN_TOP;

  const totalHeight = Math.max(leftColHeight, rightColHeight) + MARGIN_TOP;
  const totalWidth = COL2_X + COL2_W + 20;

  svg = svgEl('svg', {
    viewBox: `0 0 ${totalWidth} ${totalHeight}`,
    role: 'img',
    'aria-label': 'Tomasulo datapath schematic',
  });

  // ---- Bus line -----------------------------------------------------------
  svg.appendChild(
    svgEl('line', {
      class: 'sch-bus',
      x1: BUS_X,
      y1: MARGIN_TOP,
      x2: BUS_X,
      y2: totalHeight - MARGIN_TOP,
    })
  );
  const busLabel = svgEl('text', { class: 'sch-label', x: BUS_X - 10, y: MARGIN_TOP - 4 });
  busLabel.textContent = 'CDB';
  svg.appendChild(busLabel);

  boxLayer = svgEl('g', { class: 'sch-box-layer' });
  svg.appendChild(boxLayer);

  // ---- Left column: station groups ----------------------------------------
  const namePrefixByKey = { addSub: 'Add', mulDiv: 'Mul', load: 'Load', store: 'Store' };
  for (const group of groupLayout) {
    const header = svgEl('text', { class: 'sch-label', x: COL1_X, y: group.groupTop + 11 });
    header.textContent = group.label;
    boxLayer.appendChild(header);

    for (let i = 0; i < group.count; i++) {
      const name = `${namePrefixByKey[group.key]}${i + 1}`;
      const rowY = group.rowsTop + i * (ROW_H + ROW_GAP);
      const rect = { x: COL1_X, y: rowY, w: COL1_W, h: ROW_H };
      boxRects.set(name, rect);

      const g = svgEl('g', { 'data-station': name });
      const box = svgEl('rect', {
        class: 'sch-box',
        x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: 4,
      });
      const label = svgEl('text', {
        class: 'sch-label', x: rect.x + 6, y: rect.y + rect.h / 2 + 3,
      });
      label.textContent = name;
      g.appendChild(box);
      g.appendChild(label);
      boxLayer.appendChild(g);

      // Wire stub from box to bus.
      boxLayer.appendChild(
        svgEl('line', {
          class: 'sch-bus',
          x1: rect.x + rect.w, y1: rect.y + rect.h / 2,
          x2: BUS_X, y2: rect.y + rect.h / 2,
          opacity: 0.35,
        })
      );
    }
  }

  // ---- Right column: Register File + Memory -------------------------------
  registerBoxRect = { x: COL2_X, y: MARGIN_TOP + 14, w: COL2_W, h: registerH };
  memoryBoxRect = { x: COL2_X, y: registerBoxRect.y + registerH + 40, w: COL2_W, h: memoryH };

  boxLayer.appendChild(makeNamedBox('register-file', registerBoxRect, 'REGISTER FILE\n(F0–F10)'));
  boxLayer.appendChild(makeNamedBox('memory', memoryBoxRect, 'MEMORY'));

  boxLayer.appendChild(
    svgEl('line', {
      class: 'sch-bus',
      x1: BUS_X, y1: registerBoxRect.y + registerBoxRect.h / 2,
      x2: registerBoxRect.x, y2: registerBoxRect.y + registerBoxRect.h / 2,
      opacity: 0.35,
    })
  );
  boxLayer.appendChild(
    svgEl('line', {
      class: 'sch-bus',
      x1: BUS_X, y1: memoryBoxRect.y + memoryBoxRect.h / 2,
      x2: memoryBoxRect.x, y2: memoryBoxRect.y + memoryBoxRect.h / 2,
      opacity: 0.35,
    })
  );

  pulseLayer = svgEl('g', { class: 'sch-pulse-layer' });
  svg.appendChild(pulseLayer);

  clearNode(container);
  container.appendChild(svg);
  lastAnimatedCycle = -1;
}

function makeNamedBox(dataName, rect, multilineLabel) {
  const g = svgEl('g', { 'data-station': dataName });
  const box = svgEl('rect', { class: 'sch-box', x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: 4 });
  g.appendChild(box);
  const lines = multilineLabel.split('\n');
  lines.forEach((line, idx) => {
    const t = svgEl('text', {
      class: 'sch-label',
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2 - (lines.length - 1) * 6 + idx * 12 + 3,
      'text-anchor': 'middle',
    });
    t.textContent = line;
    g.appendChild(t);
  });
  return g;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setBoxState(name, visualState) {
  const g = boxLayer.querySelector(`g[data-station="${cssEscape(name)}"]`);
  if (!g) return;
  const rect = g.querySelector('rect');
  rect.classList.remove('sch-box--active', 'sch-box--broadcast');
  if (visualState === 'executing') rect.classList.add('sch-box--active');
  if (visualState === 'broadcast') rect.classList.add('sch-box--broadcast');
}

function cssEscape(name) {
  return name.replace(/"/g, '\\"');
}

function spawnPulse(fromRect, toRect) {
  const startX = fromRect.x + fromRect.w;
  const startY = fromRect.y + fromRect.h / 2;
  const endX = toRect.x;
  const endY = toRect.y + toRect.h / 2;
  const pathD = `M ${startX} ${startY} L ${BUS_X} ${startY} L ${BUS_X} ${endY} L ${endX} ${endY}`;

  const path = svgEl('path', { d: pathD, fill: 'none', stroke: 'none' });
  pulseLayer.appendChild(path);

  const dot = svgEl('circle', { class: 'sch-pulse', r: 4 });
  const motion = svgEl('animateMotion', {
    dur: '0.9s',
    begin: '0s',
    fill: 'freeze',
    path: pathD,
    rotate: 'auto',
  });
  dot.appendChild(motion);
  pulseLayer.appendChild(dot);

  window.setTimeout(() => {
    path.remove();
    dot.remove();
  }, 950);
}

/** Repaints box states and (once per new cycle) spawns CDB pulse animations. */
export function updateSchematic(state) {
  if (!svg) return;

  for (const pool of Object.values(state.pools)) {
    for (const station of pool) {
      setBoxState(station.name, stationVisualState(state, station));
    }
  }

  const broadcastsThisCycle = state.cdbLog.filter((e) => e.cycle === state.cycle);
  const registerHit = broadcastsThisCycle.some((e) => !String(e.dest).startsWith('mem['));
  const memoryHit = broadcastsThisCycle.some((e) => String(e.dest).startsWith('mem['));
  flashBox('register-file', registerHit);
  flashBox('memory', memoryHit);

  if (state.cycle !== lastAnimatedCycle && state.cycle > 0) {
    lastAnimatedCycle = state.cycle;
    for (const entry of broadcastsThisCycle) {
      const fromRect = boxRects.get(entry.station);
      if (!fromRect) continue;
      const toRect = String(entry.dest).startsWith('mem[') ? memoryBoxRect : registerBoxRect;
      spawnPulse(fromRect, toRect);
    }
  }
}

function flashBox(dataName, active) {
  const g = boxLayer.querySelector(`g[data-station="${dataName}"]`);
  if (!g) return;
  const rect = g.querySelector('rect');
  rect.classList.toggle('sch-box--broadcast', active);
}
