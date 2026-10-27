// The graph of all pages and their links, drawn on a canvas with a small force simulation:
// linked pages pull together, all pages push each other apart. Scrolling zooms, dragging moves,
// hovering highlights neighbours, a click opens the page (Shift+click: in the sidebar).

import { h } from './dom.js';
import { searchTitles } from '../core/search.js';

const CELL = 140; // repulsion is computed only between nearby nodes (grid cells)
const LINK_LENGTH = 70;

export class GraphCanvas {
  /**
   * @param {object} app
   * @param {{focusId?: string, local?: boolean, hideDaily?: boolean, hideOrphans?: boolean}} [options]
   *   local: only the focus page and its direct neighbours
   */
  constructor(app, { focusId = null, local = false, hideDaily = false, hideOrphans = false } = {}) {
    this.app = app;
    this.focusId = focusId;
    this.local = local;
    this.hideDaily = hideDaily;
    this.hideOrphans = hideOrphans;
    this.canvas = h('canvas', { class: 'graph-canvas', 'aria-label': 'Graph of pages and links', role: 'img' });
    this.hint = h('div', { class: 'graph-hint' }, 'Scroll to zoom · drag to move · click a page to open it');
    this.element = h('div', { class: ['graph-wrap', local && 'local'] }, this.canvas, this.hint);
    this.view = { scale: 1, x: 0, y: 0 };
    this.hovered = null;
    this.highlighted = null;
    this.frame = null;
    this.size = { width: 0, height: 0 };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
    this.bindPointer();
    this.load();
  }

  /** Builds nodes and links from the page index and starts the simulation. */
  load() {
    const graph = this.app.store.index.graph();
    let nodes = graph.nodes;
    let links = graph.links;
    if (this.local && this.focusId) {
      const keep = new Set([this.focusId]);
      for (const link of links) {
        if (link.source === this.focusId) keep.add(link.target);
        if (link.target === this.focusId) keep.add(link.source);
      }
      nodes = nodes.filter((node) => keep.has(node.id));
    }
    if (this.hideDaily) nodes = nodes.filter((node) => !node.daily || node.id === this.focusId);
    let ids = new Set(nodes.map((node) => node.id));
    links = links.filter((link) => ids.has(link.source) && ids.has(link.target));
    if (this.hideOrphans) {
      const linked = new Set(links.flatMap((link) => [link.source, link.target]));
      nodes = nodes.filter((node) => linked.has(node.id));
      ids = new Set(nodes.map((node) => node.id));
    }

    const previous = new Map((this.nodes ?? []).map((node) => [node.id, node]));
    const spread = Math.sqrt(nodes.length) * 40 + 40;
    this.nodes = nodes.map((node, i) => {
      const old = previous.get(node.id);
      const angle = i * 2.399963; // golden angle: an even first layout
      const radius = spread * Math.sqrt((i + 0.5) / nodes.length);
      return {
        ...node,
        x: old?.x ?? Math.cos(angle) * radius,
        y: old?.y ?? Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        neighbours: new Set(),
      };
    });
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    this.links = links.map((link) => ({ source: this.byId.get(link.source), target: this.byId.get(link.target) }));
    for (const link of this.links) {
      link.source.neighbours.add(link.target);
      link.target.neighbours.add(link.source);
    }
    if (this.focusId && this.byId.has(this.focusId)) {
      const focus = this.byId.get(this.focusId);
      focus.x = 0;
      focus.y = 0;
      focus.fixed = true;
      this.highlighted = focus;
    }
    this.alpha = 1;
    this.start();
  }

  start() {
    if (this.frame) return;
    const step = () => {
      for (let i = 0; i < 3 && this.alpha > 0.005; i += 1) this.tick();
      // Until the user zooms or drags, keep the whole graph in view.
      if (!this.userMoved) this.fit();
      this.draw();
      this.frame = this.alpha > 0.005 ? requestAnimationFrame(step) : null;
    };
    this.frame = requestAnimationFrame(step);
  }

  /** One step of the simulation. */
  tick() {
    const nodes = this.nodes;
    const alpha = this.alpha;
    const grid = new Map();
    for (const node of nodes) {
      const key = `${Math.floor(node.x / CELL)},${Math.floor(node.y / CELL)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(node);
    }
    for (const node of nodes) {
      const cx = Math.floor(node.x / CELL);
      const cy = Math.floor(node.y / CELL);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (other === node) continue;
            let x = node.x - other.x;
            let y = node.y - other.y;
            let distance2 = x * x + y * y;
            if (distance2 === 0) {
              x = Math.random() - 0.5;
              y = Math.random() - 0.5;
              distance2 = 0.25;
            }
            if (distance2 > CELL * CELL) continue;
            const force = (900 * alpha) / distance2;
            node.vx += x * force;
            node.vy += y * force;
          }
        }
      }
      // A gentle pull towards the middle keeps unconnected pages in view.
      node.vx -= node.x * 0.008 * alpha;
      node.vy -= node.y * 0.008 * alpha;
    }
    for (const { source, target } of this.links) {
      const x = target.x - source.x;
      const y = target.y - source.y;
      const distance = Math.sqrt(x * x + y * y) || 1;
      const force = ((distance - LINK_LENGTH) / distance) * 0.06 * alpha;
      source.vx += x * force;
      source.vy += y * force;
      target.vx -= x * force;
      target.vy -= y * force;
    }
    for (const node of nodes) {
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= 0.6;
      node.vy *= 0.6;
      node.x += Math.max(-30, Math.min(30, node.vx));
      node.y += Math.max(-30, Math.min(30, node.vy));
    }
    this.alpha *= 0.985;
  }

  resize() {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const firstTime = this.size.width === 0;
    this.size = { width: rect.width, height: rect.height };
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    if (firstTime) {
      this.view.x = rect.width / 2;
      this.view.y = rect.height / 2;
    }
    this.draw();
  }

  colors() {
    const style = getComputedStyle(this.element);
    const get = (name) => style.getPropertyValue(name).trim();
    return { node: get('--ink-3'), link: get('--rule'), accent: get('--thread'), label: get('--ink-2'), ink: get('--ink'), paper: get('--paper'), font: get('--font-ui') };
  }

  draw() {
    const context = this.canvas.getContext('2d');
    if (!context || this.size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const colors = this.colors();
    const { scale, x, y } = this.view;
    const active = this.hovered ?? this.highlighted;
    const near = active ? new Set([active, ...active.neighbours]) : null;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, this.size.width, this.size.height);
    context.translate(x, y);
    context.scale(scale, scale);

    context.lineWidth = 1 / scale;
    for (const link of this.links) {
      const lit = active && (link.source === active || link.target === active);
      context.strokeStyle = lit ? colors.accent : colors.link;
      context.globalAlpha = lit ? 0.7 : 1;
      context.beginPath();
      context.moveTo(link.source.x, link.source.y);
      context.lineTo(link.target.x, link.target.y);
      context.stroke();
    }
    context.globalAlpha = 1;

    for (const node of this.nodes) {
      const radius = nodeRadius(node);
      context.fillStyle = near?.has(node) ? colors.accent : colors.node;
      context.globalAlpha = near && !near.has(node) ? 0.45 : node.virtual ? 0.7 : 1;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.font = `${12 / scale}px ${colors.font}`;
    context.textBaseline = 'middle';
    for (const node of this.nodes) {
      const isActive = node === active;
      const showLabel = isActive || near?.has(node) || scale > 1.4 || (scale > 0.7 && node.degree >= 3) || this.nodes.length < 40;
      if (!showLabel) continue;
      context.globalAlpha = near && !near.has(node) ? 0.4 : 1;
      context.fillStyle = isActive ? colors.ink : colors.label;
      context.font = `${isActive ? '600 ' : ''}${12 / scale}px ${colors.font}`;
      context.fillText(node.title, node.x + nodeRadius(node) + 4 / scale, node.y);
    }
    context.globalAlpha = 1;
  }

  /** Scales and centres the view so every node is visible. */
  fit() {
    if (this.nodes.length === 0 || this.size.width === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }
    const margin = 60;
    const scale = Math.min(2, (this.size.width - margin * 2) / Math.max(1, maxX - minX), (this.size.height - margin * 2) / Math.max(1, maxY - minY));
    this.view.scale = Math.max(0.15, scale);
    this.view.x = this.size.width / 2 - ((minX + maxX) / 2) * this.view.scale;
    this.view.y = this.size.height / 2 - ((minY + maxY) / 2) * this.view.scale;
  }

  /** The node under a point in canvas pixels. */
  nodeAt(px, py) {
    const { scale, x, y } = this.view;
    const gx = (px - x) / scale;
    const gy = (py - y) / scale;
    let best = null;
    let bestDistance = Infinity;
    for (const node of this.nodes) {
      const distance = Math.hypot(node.x - gx, node.y - gy);
      if (distance < Math.max(nodeRadius(node) + 4, 8 / scale) && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  bindPointer() {
    let drag = null;
    const point = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const { x, y } = point(event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      const scale = Math.max(0.15, Math.min(5, this.view.scale * factor));
      this.view.x = x - ((x - this.view.x) * scale) / this.view.scale;
      this.view.y = y - ((y - this.view.y) * scale) / this.view.scale;
      this.view.scale = scale;
      this.userMoved = true;
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      drag = { start: point(event), view: { ...this.view }, moved: false };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      const p = point(event);
      if (drag) {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          this.userMoved = true;
        }
        this.view.x = drag.view.x + dx;
        this.view.y = drag.view.y + dy;
        this.draw();
        return;
      }
      const node = this.nodeAt(p.x, p.y);
      if (node !== this.hovered) {
        this.hovered = node;
        this.canvas.style.cursor = node ? 'pointer' : 'grab';
        this.draw();
      }
    });
    this.canvas.addEventListener('pointerup', (event) => {
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;
      const p = point(event);
      const node = this.nodeAt(p.x, p.y);
      if (!node) return;
      if (event.shiftKey) this.app.sidebar.open(node.id);
      else this.app.openPage(node.id);
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.draw();
    });
  }

  /** Highlights a node and moves it to the middle. */
  focusNode(id) {
    const node = this.byId.get(id);
    if (!node) return;
    this.highlighted = node;
    this.userMoved = true;
    this.view.x = this.size.width / 2 - node.x * this.view.scale;
    this.view.y = this.size.height / 2 - node.y * this.view.scale;
    this.draw();
  }

  update(ids, origin) {
    if (origin === 'typing' || origin === 'commit') return;
    this.load();
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
  }
}

function nodeRadius(node) {
  return 3 + Math.min(9, Math.sqrt(node.degree) * 1.6);
}

/** The full-page graph with its toolbar. */
export class GraphView {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.graph = new GraphCanvas(app, { hideDaily: false, hideOrphans: false });
    const toggle = (label, property) => h('label', { class: 'toggle-label' },
      h('input', {
        type: 'checkbox',
        class: 'switch-input',
        onchange: (event) => {
          this.graph[property] = event.target.checked;
          this.graph.load();
        },
      }),
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
      label);
    const find = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Find a page',
      'aria-label': 'Find a page in the graph',
      oninput: (event) => {
        const [match] = searchTitles(app.store.index, event.target.value, 1);
        if (match) this.graph.focusNode(match.id);
      },
    });
    this.element = h('div', { class: 'graph-page' },
      h('div', { class: 'graph-bar' }, h('h1', null, 'Graph'), toggle('Hide daily notes', 'hideDaily'), toggle('Hide pages without links', 'hideOrphans'), find),
      this.graph.element);
  }

  update(ids, origin) {
    this.graph.update(ids, origin);
  }

  destroy() {
    this.graph.destroy();
  }
}
