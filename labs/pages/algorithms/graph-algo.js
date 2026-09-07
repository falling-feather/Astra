// ===== Graph Algorithm Visualizer (v3) =====
// 4 algorithms: Dijkstra / Prim / BFS / DFS
// Directed/undirected toggle, node dragging, edge editing, unified event management

const GraphAlgo = {
    canvas: null,
    ctx: null,
    nodes: [],
    edges: [],
    isRunning: false,
    isPaused: false,
    speed: 500,
    mode: 'dijkstra',
    startNode: 0,
    directed: false,

    W: 0, H: 0,

    // Algorithm state
    dist: {},
    prev: {},
    visited: null,
    mstEdges: [],
    currentEdge: null,
    currentNode: null,
    frontier: [],
    pqSnapshot: [],
    stepCount: 0,
    traversalOrder: [],

    // BFS/DFS specific
    bfsQueue: [],
    dfsStack: [],
    parentMap: {},
    treeEdges: [],

    // Pause/step
    _resolve: null,
    _resizeObs: null,
    _listeners: [],
    _timers: [],
    _aborted: false,

    // Interaction
    hoverNode: -1,
    dragNode: -1,
    isDragging: false,
    _dragStartPos: null,
    editingEdge: null,

    presets: {
        weighted: {
            label: '\u52a0\u6743\u56fe',
            nodes: [
                { id: 0, x: 0.12, y: 0.15, label: 'A' },
                { id: 1, x: 0.40, y: 0.08, label: 'B' },
                { id: 2, x: 0.70, y: 0.12, label: 'C' },
                { id: 3, x: 0.90, y: 0.35, label: 'D' },
                { id: 4, x: 0.08, y: 0.55, label: 'E' },
                { id: 5, x: 0.35, y: 0.45, label: 'F' },
                { id: 6, x: 0.62, y: 0.50, label: 'G' },
                { id: 7, x: 0.88, y: 0.70, label: 'H' },
                { id: 8, x: 0.20, y: 0.85, label: 'I' },
                { id: 9, x: 0.55, y: 0.85, label: 'J' }
            ],
            edges: [
                [0,1,4],[0,4,2],[1,2,6],[1,5,3],[2,3,3],[2,6,5],
                [3,7,2],[4,5,7],[4,8,8],[5,6,1],[5,8,5],[5,9,9],
                [6,7,4],[6,9,6],[7,9,3],[8,9,10]
            ]
        },
        small: {
            label: '\u7b80\u5355\u56fe',
            nodes: [
                { id: 0, x: 0.20, y: 0.20, label: 'S' },
                { id: 1, x: 0.50, y: 0.10, label: 'A' },
                { id: 2, x: 0.80, y: 0.25, label: 'B' },
                { id: 3, x: 0.15, y: 0.65, label: 'C' },
                { id: 4, x: 0.50, y: 0.55, label: 'D' },
                { id: 5, x: 0.85, y: 0.65, label: 'E' },
                { id: 6, x: 0.50, y: 0.90, label: 'T' }
            ],
            edges: [
                [0,1,2],[0,3,6],[1,2,3],[1,4,5],[2,5,7],
                [3,4,1],[4,5,4],[3,6,8],[4,6,3],[5,6,2]
            ]
        },
        dense: {
            label: '\u7a20\u5bc6\u56fe',
            nodes: (function() {
                var n = [], labels = 'ABCDEFGH', count = 8;
                for (var i = 0; i < count; i++) {
                    var angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                    n.push({
                        id: i,
                        x: 0.5 + Math.cos(angle) * 0.36,
                        y: 0.50 + Math.sin(angle) * 0.38,
                        label: labels[i]
                    });
                }
                return n;
            })(),
            edges: [
                [0,1,3],[1,2,5],[2,3,2],[3,4,7],[4,5,4],[5,6,6],[6,7,1],[7,0,8],
                [0,3,5],[1,4,7],[2,5,3],[3,6,4],[0,5,9],[1,6,6],[2,7,8]
            ]
        },
        dag: {
            label: 'DAG',
            directed: true,
            nodes: [
                { id: 0, x: 0.10, y: 0.50, label: 'A' },
                { id: 1, x: 0.30, y: 0.20, label: 'B' },
                { id: 2, x: 0.30, y: 0.80, label: 'C' },
                { id: 3, x: 0.55, y: 0.40, label: 'D' },
                { id: 4, x: 0.55, y: 0.70, label: 'E' },
                { id: 5, x: 0.80, y: 0.30, label: 'F' },
                { id: 6, x: 0.80, y: 0.70, label: 'G' },
                { id: 7, x: 0.95, y: 0.50, label: 'H' }
            ],
            edges: [
                [0,1,2],[0,2,3],[1,3,4],[2,4,1],[3,5,2],
                [3,6,5],[4,6,3],[5,7,1],[6,7,4]
            ]
        }
    },

    _on: function(el, evt, fn, opts) {
        var bound = fn.bind(this);
        el.addEventListener(evt, bound, opts || false);
        this._listeners.push({ el: el, evt: evt, fn: bound });
    },

    _delay: function(fn, ms) {
        var id = setTimeout(fn.bind(this), ms);
        this._timers.push(id);
        return id;
    },

    init: function() {
        this.canvas = document.getElementById('graph-algo-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.visited = new Set();
        this.sizeCanvas();
        this._injectExtraPanels();
        this.bindControls();
        this.bindCanvasInteraction();
        this.loadPreset('weighted');

        if (typeof ResizeObserver !== 'undefined') {
            var self = this;
            this._resizeObs = new ResizeObserver(function() { self.sizeCanvas(); self.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', function() { this.sizeCanvas(); this.draw(); });
        }
    },

    destroy: function() {
        this._aborted = true;
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        for (var i = 0; i < this._listeners.length; i++) {
            var l = this._listeners[i];
            l.el.removeEventListener(l.evt, l.fn);
        }
        this._listeners.length = 0;
        for (var j = 0; j < this._timers.length; j++) clearTimeout(this._timers[j]);
        this._timers.length = 0;
    },

    sizeCanvas: function() {
        var container = this.canvas ? this.canvas.parentElement : null;
        if (!container) return;
        var rect = container.getBoundingClientRect();
        var w = Math.round(rect.width);
        if (w === 0) return;
        var h = Math.round(Math.max(w * 0.6, 300));
        var dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    _injectExtraPanels: function() {
        var controls = document.getElementById('ga-controls');
        if (!controls) return;

        // BFS/DFS buttons
        if (!document.getElementById('ga-bfs')) {
            var dijBtn = controls.querySelector('[onclick*="Dijkstra"]');
            if (!dijBtn) return;
            var bfsBtn = document.createElement('button');
            bfsBtn.className = 'btn btn--orange'; bfsBtn.id = 'ga-bfs';
            bfsBtn.textContent = 'BFS \u5e7f\u5ea6\u4f18\u5148';
            var dfsBtn = document.createElement('button');
            dfsBtn.className = 'btn btn--orange'; dfsBtn.id = 'ga-dfs';
            dfsBtn.textContent = 'DFS \u6df1\u5ea6\u4f18\u5148';

            var pauseBtn = document.getElementById('ga-pause');
            if (pauseBtn) {
                controls.insertBefore(dfsBtn, pauseBtn);
                controls.insertBefore(bfsBtn, dfsBtn);
            }
        }

        // DAG preset button
        var presetsDiv = controls.querySelector('.ga-presets');
        if (presetsDiv && !document.getElementById('ga-preset-dag')) {
            var dagBtn = document.createElement('button');
            dagBtn.className = 'btn btn--ghost'; dagBtn.id = 'ga-preset-dag';
            dagBtn.textContent = 'DAG (\u6709\u5411)';
            presetsDiv.appendChild(dagBtn);
        }

        // Directed toggle
        if (controls && !document.getElementById('ga-directed-toggle')) {
            var toggleDiv = document.createElement('div');
            toggleDiv.className = 'ga-directed-toggle';
            toggleDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:8px;font-size:12px;color:rgba(255,255,255,0.5);';
            toggleDiv.innerHTML = '<label style="cursor:pointer;display:flex;align-items:center;gap:4px;">' +
                '<input type="checkbox" id="ga-directed-toggle" style="accent-color:#c4793a;">' +
                ' \u6709\u5411\u56fe</label>';
            var speedDiv = controls.querySelector('.ga-speed');
            if (speedDiv) controls.insertBefore(toggleDiv, speedDiv);
        }

        // Node info tooltip area
        if (!document.getElementById('ga-node-info')) {
            var legend = controls.parentElement.querySelector('.ga-legend');
            if (legend) {
                var infoDiv = document.createElement('div');
                infoDiv.id = 'ga-node-info';
                infoDiv.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);min-height:16px;margin-top:4px;';
                legend.parentElement.insertBefore(infoDiv, legend.nextSibling);
            }
        }
    },

    bindControls: function() {
        var speedEl = document.getElementById('ga-speed');
        if (speedEl) {
            this._on(speedEl, 'input', function() {
                this.speed = parseInt(speedEl.value);
                var lbl = document.getElementById('ga-speed-value');
                if (lbl) lbl.textContent = this.speed + 'ms';
            });
        }

        // BFS/DFS
        this._bind('ga-bfs', function() { GraphAlgo.startBFS(); });
        this._bind('ga-dfs', function() { GraphAlgo.startDFS(); });
        this._bind('ga-preset-dag', function() { GraphAlgo.loadPreset('dag'); });

        // Directed toggle
        var dirToggle = document.getElementById('ga-directed-toggle');
        if (dirToggle) {
            this._on(dirToggle, 'change', function() {
                this.directed = dirToggle.checked;
                this.resetState();
                this.draw();
                this.setInfo(this.directed ? '\u5df2\u5207\u6362\u4e3a\u6709\u5411\u56fe' : '\u5df2\u5207\u6362\u4e3a\u65e0\u5411\u56fe');
            });
        }
    },

    _bind: function(id, fn) {
        var el = document.getElementById(id);
        if (el) this._on(el, 'click', function() { fn(); });
    },

    bindCanvasInteraction: function() {
        if (!this.canvas) return;
        var self = this;

        var getRelPos = function(e) {
            var rect = self.canvas.getBoundingClientRect();
            var cx = e.touches ? e.touches[0].clientX : e.clientX;
            var cy = e.touches ? e.touches[0].clientY : e.clientY;
            return { rx: (cx - rect.left) / rect.width, ry: (cy - rect.top) / rect.height };
        };

        var findClosest = function(rx, ry) {
            var closest = -1, minD = Infinity;
            for (var i = 0; i < self.nodes.length; i++) {
                var d = Math.hypot(self.nodes[i].x - rx, self.nodes[i].y - ry);
                if (d < minD) { minD = d; closest = i; }
            }
            return (closest >= 0 && minD < 0.08) ? closest : -1;
        };

        // Mouse down for drag
        this._on(this.canvas, 'mousedown', function(e) {
            if (self.isRunning) return;
            var pos = getRelPos(e);
            var idx = findClosest(pos.rx, pos.ry);
            if (idx >= 0) {
                self.dragNode = idx;
                self.isDragging = false;
                self._dragStartPos = { x: pos.rx, y: pos.ry };
                e.preventDefault();
            }
        });

        this._on(this.canvas, 'mousemove', function(e) {
            var pos = getRelPos(e);
            if (self.dragNode >= 0 && self._dragStartPos) {
                var dx = pos.rx - self._dragStartPos.x;
                var dy = pos.ry - self._dragStartPos.y;
                if (Math.hypot(dx, dy) > 0.01) self.isDragging = true;
                if (self.isDragging) {
                    self.nodes[self.dragNode].x = Math.max(0.05, Math.min(0.95, pos.rx));
                    self.nodes[self.dragNode].y = Math.max(0.05, Math.min(0.95, pos.ry));
                    self.draw();
                }
            } else {
                var idx = findClosest(pos.rx, pos.ry);
                if (idx !== self.hoverNode) {
                    self.hoverNode = idx;
                    self.canvas.style.cursor = idx >= 0 && !self.isRunning ? 'pointer' : 'default';
                    self.draw();
                    self._updateNodeInfo(idx);
                }
            }
        });

        this._on(this.canvas, 'mouseup', function(e) {
            if (self.dragNode >= 0 && !self.isDragging) {
                if (!self.isRunning) {
                    self.startNode = self.dragNode;
                    self.resetState();
                    self.draw();
                    self.setInfo('\u8d77\u70b9\u8bbe\u4e3a ' + self.nodes[self.dragNode].label + '\uff0c\u9009\u62e9\u7b97\u6cd5\u5e76\u5f00\u59cb');
                }
            }
            self.dragNode = -1;
            self.isDragging = false;
            self._dragStartPos = null;
        });

        this._on(this.canvas, 'mouseleave', function() {
            self.dragNode = -1;
            self.isDragging = false;
            self._dragStartPos = null;
            if (self.hoverNode !== -1) {
                self.hoverNode = -1;
                self.canvas.style.cursor = 'default';
                self.draw();
            }
        });

        // Touch support
        this._on(this.canvas, 'touchstart', function(e) {
            if (self.isRunning) return;
            var pos = getRelPos(e);
            var idx = findClosest(pos.rx, pos.ry);
            if (idx >= 0) {
                self.dragNode = idx;
                self.isDragging = false;
                self._dragStartPos = { x: pos.rx, y: pos.ry };
            }
        }, { passive: true });

        this._on(this.canvas, 'touchmove', function(e) {
            if (self.dragNode >= 0) {
                var rect = self.canvas.getBoundingClientRect();
                var rx = (e.touches[0].clientX - rect.left) / rect.width;
                var ry = (e.touches[0].clientY - rect.top) / rect.height;
                self.isDragging = true;
                self.nodes[self.dragNode].x = Math.max(0.05, Math.min(0.95, rx));
                self.nodes[self.dragNode].y = Math.max(0.05, Math.min(0.95, ry));
                self.draw();
                e.preventDefault();
            }
        });

        this._on(this.canvas, 'touchend', function(e) {
            if (self.dragNode >= 0 && !self.isDragging) {
                if (!self.isRunning) {
                    self.startNode = self.dragNode;
                    self.resetState();
                    self.draw();
                    self.setInfo('\u8d77\u70b9\u8bbe\u4e3a ' + self.nodes[self.dragNode].label);
                }
            }
            self.dragNode = -1;
            self.isDragging = false;
            self._dragStartPos = null;
        }, { passive: true });

        // Double click to add node
        this._on(this.canvas, 'dblclick', function(e) {
            if (self.isRunning) return;
            var pos = getRelPos(e);
            var idx = findClosest(pos.rx, pos.ry);
            if (idx >= 0) return;
            var newId = self.nodes.length;
            var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            var used = {};
            self.nodes.forEach(function(n) { used[n.label] = true; });
            var lbl = '';
            for (var c = 0; c < labels.length; c++) {
                if (!used[labels[c]]) { lbl = labels[c]; break; }
            }
            if (!lbl) lbl = 'N' + newId;
            self.nodes.push({ id: newId, x: pos.rx, y: pos.ry, label: lbl });
            self.resetState();
            self.draw();
            self.setInfo('\u6dfb\u52a0\u8282\u70b9 ' + lbl + '\uff08\u53cc\u51fb\u7a7a\u767d\u5904\u6dfb\u52a0\uff0c\u62d6\u62fd\u8282\u70b9\u79fb\u52a8\uff09');
        });
    },

    _updateNodeInfo: function(idx) {
        var el = document.getElementById('ga-node-info');
        if (!el) return;
        if (idx < 0) { el.textContent = ''; return; }
        var n = this.nodes[idx];
        var adj = this.buildAdj();
        var neighbors = adj[idx] || [];
        var nList = neighbors.map(function(a) { return a.label + '(w=' + a.w + ')'; }).join(', ');
        el.textContent = '\u8282\u70b9 ' + n.label + ' | \u5ea6: ' + neighbors.length +
            ' | \u90bb\u5c45: ' + (nList || '\u65e0') +
            (this.dist[idx] !== undefined ? ' | dist=' + (this.dist[idx] === Infinity ? '\u221e' : this.dist[idx]) : '');
    },

    loadPreset: function(name) {
        if (this.isRunning) return;
        var p = this.presets[name];
        if (!p) return;
        this.nodes = p.nodes.map(function(n) { return { id: n.id, x: n.x, y: n.y, label: n.label }; });
        this.edges = p.edges.map(function(e) { return { from: e[0], to: e[1], weight: e[2] }; });
        this.startNode = 0;

        if (p.directed !== undefined) {
            this.directed = p.directed;
            var toggle = document.getElementById('ga-directed-toggle');
            if (toggle) toggle.checked = this.directed;
        }

        this.resetState();
        this.draw();
        this.setInfo('\u5df2\u52a0\u8f7d\u300c' + p.label + '\u300d(' + this.nodes.length + ' \u8282\u70b9 ' + this.edges.length + ' \u8fb9)\uff0c\u70b9\u51fb\u8282\u70b9\u9009\u62e9\u8d77\u70b9');
        this.updateEducation('idle');
        document.querySelectorAll('.ga-presets .btn--ghost').forEach(function(b) {
            b.classList.remove('active');
        });
    },

    resetState: function() {
        this.visited = new Set();
        this.dist = {};
        this.prev = {};
        this.mstEdges = [];
        this.currentEdge = null;
        this.currentNode = null;
        this.frontier = [];
        this.pqSnapshot = [];
        this.stepCount = 0;
        this.isPaused = false;
        this.traversalOrder = [];
        this.bfsQueue = [];
        this.dfsStack = [];
        this.parentMap = {};
        this.treeEdges = [];
    },

    reset: function() {
        if (this.isRunning) return;
        this.resetState();
        this.draw();
        this.setInfo('\u5df2\u91cd\u7f6e');
        this.updateEducation('idle');
    },

    togglePause: function() {
        if (!this.isRunning) return;
        this.isPaused = !this.isPaused;
        var btn = document.getElementById('ga-pause');
        if (btn) btn.textContent = this.isPaused ? '\u7ee7\u7eed' : '\u6682\u505c';
        if (!this.isPaused && this._resolve) {
            this._resolve();
            this._resolve = null;
        }
    },

    stepOnce: function() {
        if (!this.isRunning || !this.isPaused) return;
        if (this._resolve) {
            this._resolve();
            this._resolve = null;
        }
    },

    sleep: function(ms) {
        var self = this;
        return new Promise(function(resolve) {
            var timer = setTimeout(function() {
                if (self._aborted) { resolve(); return; }
                if (self.isPaused) {
                    self._resolve = resolve;
                } else {
                    resolve();
                }
            }, ms);
        });
    },

    buildAdj: function() {
        var adj = {};
        var self = this;
        this.nodes.forEach(function(n) { adj[n.id] = []; });
        this.edges.forEach(function(e) {
            adj[e.from].push({ to: e.to, w: e.weight, label: self.nodes[e.to].label });
            if (!self.directed) {
                adj[e.to].push({ to: e.from, w: e.weight, label: self.nodes[e.from].label });
            }
        });
        return adj;
    },

    /* ====== DRAW ====== */
    draw: function() {
        if (!this.ctx) return;
        var ctx = this.ctx;
        var w = this.W, h = this.H;

        ctx.fillStyle = '#151822';
        ctx.fillRect(0, 0, w, h);

        var r = Math.min(w, h) * 0.035;
        var self = this;

        // Directed indicator
        if (this.directed) {
            ctx.fillStyle = 'rgba(196,121,58,0.15)';
            ctx.font = '15px ' + CF.sans;
            ctx.textAlign = 'right';
            ctx.fillText('\u6709\u5411\u56fe', w - 10, 16);
        }

        // Edges
        this.edges.forEach(function(e) {
            var na = self.nodes[e.from], nb = self.nodes[e.to];
            var ax = na.x * w, ay = na.y * h;
            var bx = nb.x * w, by = nb.y * h;

            var isMST = self.mstEdges.some(function(me) {
                return (me.from === e.from && me.to === e.to) || (me.from === e.to && me.to === e.from);
            });
            var isTreeEdge = self.treeEdges.some(function(te) {
                return (te.from === e.from && te.to === e.to) || (!self.directed && te.from === e.to && te.to === e.from);
            });
            var isPathEdge = self.mode === 'dijkstra' &&
                ((self.prev[e.to] === e.from) || (!self.directed && self.prev[e.from] === e.to));
            var isCurr = self.currentEdge &&
                ((self.currentEdge.from === e.from && self.currentEdge.to === e.to) ||
                 (!self.directed && self.currentEdge.from === e.to && self.currentEdge.to === e.from));
            var isFront = self.frontier.some(function(fe) {
                return (fe.from === e.from && fe.to === e.to) || (!self.directed && fe.from === e.to && fe.to === e.from);
            });

            if (isCurr) {
                ctx.strokeStyle = '#c4793a'; ctx.lineWidth = 3.5;
            } else if (isMST || isPathEdge || isTreeEdge) {
                ctx.strokeStyle = '#4d9e7e'; ctx.lineWidth = 3;
            } else if (isFront) {
                ctx.strokeStyle = 'rgba(91,141,206,0.5)'; ctx.lineWidth = 2;
            } else {
                ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5;
            }

            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

            // Arrow for directed
            if (self.directed) {
                var dx = bx - ax, dy = by - ay;
                var len = Math.hypot(dx, dy) || 1;
                var ux = dx / len, uy = dy / len;
                var tipX = bx - ux * r, tipY = by - uy * r;
                var aSize = 8;
                ctx.fillStyle = ctx.strokeStyle;
                ctx.beginPath();
                ctx.moveTo(tipX, tipY);
                ctx.lineTo(tipX - ux * aSize + uy * aSize * 0.4, tipY - uy * aSize - ux * aSize * 0.4);
                ctx.lineTo(tipX - ux * aSize - uy * aSize * 0.4, tipY - uy * aSize + ux * aSize * 0.4);
                ctx.fill();
            }

            // Weight label
            var mx = (ax + bx) / 2, my = (ay + by) / 2;
            var ed = bx - ax, edy = by - ay;
            var elen = Math.hypot(ed, edy) || 1;
            var ox = -edy / elen * 12, oy = ed / elen * 12;

            ctx.fillStyle = isCurr ? '#c4793a' : isMST || isPathEdge || isTreeEdge ? '#4d9e7e' : 'rgba(255,255,255,0.3)';
            ctx.font = (isCurr || isMST ? 'bold ' : '') + '11px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(e.weight, mx + ox, my + oy);
        });

        // Nodes
        this.nodes.forEach(function(n, i) {
            var nx = n.x * w, ny = n.y * h;
            var isCurr = self.currentNode === i;
            var isVis = self.visited.has(i);
            var isStart = i === self.startNode && !isVis && !isCurr;
            var isHov = self.hoverNode === i && !self.isRunning;
            var isDrag = self.dragNode === i && self.isDragging;

            ctx.beginPath();
            ctx.arc(nx, ny, r, 0, Math.PI * 2);

            if (isDrag) {
                ctx.fillStyle = '#c4793a';
                ctx.shadowColor = '#c4793a'; ctx.shadowBlur = 20;
            } else if (isCurr) {
                ctx.fillStyle = '#c4793a';
                ctx.shadowColor = '#c4793a'; ctx.shadowBlur = 16;
            } else if (isVis) {
                ctx.fillStyle = '#4d9e7e';
                ctx.shadowColor = '#4d9e7e'; ctx.shadowBlur = 8;
            } else if (isHov) {
                ctx.fillStyle = '#5b8dce';
                ctx.shadowColor = '#5b8dce'; ctx.shadowBlur = 12;
            } else if (isStart) {
                ctx.fillStyle = '#8b6fc0';
                ctx.shadowColor = '#8b6fc0'; ctx.shadowBlur = 8;
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.shadowBlur = 0;
            }
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.strokeStyle = isCurr || isDrag ? '#e8a050' : isVis ? '#6cc09a'
                : isHov ? '#7ba8d8' : isStart ? '#a58ad0' : 'rgba(255,255,255,0.12)';
            ctx.lineWidth = (isCurr || isHov || isDrag) ? 2.5 : 1.5;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#fff';
            ctx.font = '600 ' + Math.max(13, Math.round(r * 0.85)) + 'px ' + CF.sans;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(n.label, nx, ny);

            // Dist label (Dijkstra)
            if (self.mode === 'dijkstra' && self.dist[i] !== undefined) {
                ctx.fillStyle = isVis ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
                ctx.font = '15px ' + CF.mono;
                ctx.fillText(self.dist[i] === Infinity ? '\u221e' : self.dist[i], nx, ny + r + 12);
            }

            // BFS/DFS visit order label
            if ((self.mode === 'bfs' || self.mode === 'dfs') && self.traversalOrder.length > 0) {
                var orderIdx = self.traversalOrder.indexOf(i);
                if (orderIdx >= 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    ctx.font = '14px ' + CF.mono;
                    ctx.fillText('#' + (orderIdx + 1), nx, ny + r + 12);
                }
            }
        });

        // Bottom info
        this.drawBottomInfo(w, h);

        // PQ panel
        if (this.isRunning && this.pqSnapshot.length > 0) {
            this.drawPQPanel(w, h);
        }
    },

    drawBottomInfo: function(w, h) {
        if (this.visited.size === 0) return;
        var ctx = this.ctx;
        var self = this;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'left';

        var order = [];
        if (this.traversalOrder.length > 0) {
            order = this.traversalOrder.map(function(i) { return self.nodes[i].label; });
        } else {
            this.visited.forEach(function(i) { order.push(self.nodes[i].label); });
        }
        ctx.fillText('\u8bbf\u95ee\u987a\u5e8f: ' + order.join(' \u2192 '), 10, h - 10);

        if (this.mode === 'prim' && this.mstEdges.length > 0) {
            var total = this.mstEdges.reduce(function(s, e) { return s + e.weight; }, 0);
            ctx.textAlign = 'right';
            ctx.fillText('MST \u603b\u6743\u503c: ' + total, w - 10, h - 10);
        }
    },

    drawPQPanel: function(w, h) {
        var ctx = this.ctx;
        var items = this.pqSnapshot.slice(0, 8);
        if (items.length === 0) return;

        var panelW = Math.min(w * 0.35, 200);
        var itemH = 18;
        var panelH = items.length * itemH + 24;
        var px = w - panelW - 8, py = 8;

        ctx.fillStyle = 'rgba(13,16,23,0.85)';
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        var rr = 6;
        ctx.beginPath();
        ctx.moveTo(px + rr, py);
        ctx.lineTo(px + panelW - rr, py);
        ctx.arcTo(px + panelW, py, px + panelW, py + rr, rr);
        ctx.lineTo(px + panelW, py + panelH - rr);
        ctx.arcTo(px + panelW, py + panelH, px + panelW - rr, py + panelH, rr);
        ctx.lineTo(px + rr, py + panelH);
        ctx.arcTo(px, py + panelH, px, py + panelH - rr, rr);
        ctx.lineTo(px, py + rr);
        ctx.arcTo(px, py, px + rr, py, rr);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '500 15px ' + CF.sans;
        ctx.textAlign = 'left';
        var title = this.mode === 'dijkstra' ? '\u4f18\u5148\u961f\u5217 (dist)' :
                    this.mode === 'bfs' ? '\u961f\u5217 (Queue)' :
                    this.mode === 'dfs' ? '\u6808 (Stack)' : '\u5019\u9009\u8fb9 (weight)';
        ctx.fillText(title, px + 8, py + 14);

        ctx.font = '15px ' + CF.mono;
        items.forEach(function(item, i) {
            ctx.fillStyle = i === 0 ? '#c4793a' : 'rgba(255,255,255,0.4)';
            ctx.fillText(item.text, px + 8, py + 22 + i * itemH + 10);
        });
    },

    updateEducation: function(phase) {
        var container = document.getElementById('ga-info');
        if (!container) return;

        var eduEl = document.getElementById('ga-edu');
        if (!eduEl) {
            eduEl = document.createElement('div');
            eduEl.id = 'ga-edu';
            eduEl.style.cssText = 'font-size:12px;color:#8b9dc3;margin-top:6px;line-height:1.5;';
            container.parentElement.appendChild(eduEl);
        }

        var tips = {
            idle: '<strong>\u63d0\u793a</strong>\uff1a\u70b9\u51fb\u8282\u70b9\u9009\u62e9\u8d77\u70b9\uff0c\u53cc\u51fb\u7a7a\u767d\u5904\u6dfb\u52a0\u8282\u70b9\uff0c\u62d6\u62fd\u8282\u70b9\u79fb\u52a8\u4f4d\u7f6e\u3002\u652f\u6301 Dijkstra\u3001Prim\u3001BFS\u3001DFS \u56db\u79cd\u7b97\u6cd5\u3002',
            'dijkstra-start': '<strong>Dijkstra</strong>\uff1a\u65f6\u95f4\u590d\u6742\u5ea6 O((V+E) log V)\uff08\u4e8c\u53c9\u5806\uff09\u3002\u6bcf\u6b65\u9009 dist \u6700\u5c0f\u7684\u672a\u786e\u8ba4\u8282\u70b9\uff0c\u677e\u5f1b\u90bb\u5c45\u3002',
            'dijkstra-relax': '<strong>\u677e\u5f1b</strong>\uff1a\u82e5\u7ecf\u7531\u5f53\u524d\u8282\u70b9\u5230\u8fbe\u90bb\u5c45\u7684\u8ddd\u79bb\u66f4\u77ed\uff0c\u5219\u66f4\u65b0\u8ddd\u79bb\u4f30\u8ba1\u5e76\u52a0\u5165\u4f18\u5148\u961f\u5217\u3002',
            'dijkstra-done': '<strong>\u5b8c\u6210</strong>\uff1a\u6240\u6709\u53ef\u8fbe\u8282\u70b9\u7684\u6700\u77ed\u8ddd\u79bb\u5df2\u786e\u5b9a\u3002Dijkstra \u4e0d\u9002\u7528\u4e8e\u8d1f\u6743\u8fb9\uff08\u53ef\u7528 Bellman-Ford\uff09\u3002',
            'prim-start': '<strong>Prim</strong>\uff1a\u65f6\u95f4\u590d\u6742\u5ea6 O((V+E) log V)\uff08\u4e8c\u53c9\u5806\uff09\u3002\u6bcf\u6b65\u9009\u6743\u503c\u6700\u5c0f\u7684\u8de8\u5207\u5272\u8fb9\u52a0\u5165 MST\u3002',
            'prim-step': '<strong>\u5207\u5272\u6027\u8d28</strong>\uff1a\u8de8\u8d8a\u5df2\u9009/\u672a\u9009\u96c6\u5408\u7684\u6700\u5c0f\u6743\u8fb9\u4e00\u5b9a\u5c5e\u4e8e\u67d0\u68e3 MST\u3002Prim \u6bcf\u6b65\u4fdd\u8bc1\u5c40\u90e8\u6700\u4f18\u3002',
            'prim-done': '<strong>\u5b8c\u6210</strong>\uff1aMST \u5305\u542b V-1 \u6761\u8fb9\u3002\u7a20\u5bc6\u56fe\u9002\u5408 Prim\uff0c\u7a00\u758f\u56fe\u53ef\u8003\u8651 Kruskal (O(E log E))\u3002',
            'bfs-start': '<strong>BFS</strong>\uff1a\u65f6\u95f4\u590d\u6742\u5ea6 O(V+E)\u3002\u4f7f\u7528\u961f\u5217\u6309\u5c42\u904d\u5386\uff0c\u4fdd\u8bc1\u65e0\u6743\u56fe\u4e2d\u6700\u77ed\u8def\u5f84\u3002',
            'bfs-step': '<strong>\u961f\u5217</strong>\uff1a\u5f53\u524d\u8282\u70b9\u7684\u6240\u6709\u672a\u8bbf\u95ee\u90bb\u5c45\u5165\u961f\u3002\u5148\u8fdb\u5148\u51fa (FIFO) \u4fdd\u8bc1\u5c42\u5e8f\u3002',
            'bfs-done': '<strong>\u5b8c\u6210</strong>\uff1aBFS \u6811\u7684\u8fb9\u662f\u4ece\u8d77\u70b9\u5230\u6bcf\u4e2a\u8282\u70b9\u7684\u6700\u5c11\u8fb9\u8def\u5f84\uff08\u65e0\u6743\u56fe\u4e2d\u7b49\u4ef7\u4e8e\u6700\u77ed\u8def\u5f84\uff09\u3002',
            'dfs-start': '<strong>DFS</strong>\uff1a\u65f6\u95f4\u590d\u6742\u5ea6 O(V+E)\u3002\u4f7f\u7528\u6808\u6df1\u5165\u63a2\u7d22\u6bcf\u4e2a\u5206\u652f\uff0c\u7528\u4e8e\u62d3\u6251\u6392\u5e8f\u3001\u8fde\u901a\u5206\u91cf\u3001\u73af\u68c0\u6d4b\u3002',
            'dfs-step': '<strong>\u6808</strong>\uff1a\u8bbf\u95ee\u5f53\u524d\u8282\u70b9\u540e\u5c06\u90bb\u5c45\u538b\u6808\u3002\u540e\u8fdb\u5148\u51fa (LIFO) \u4fdd\u8bc1\u6df1\u5ea6\u4f18\u5148\u3002',
            'dfs-done': '<strong>\u5b8c\u6210</strong>\uff1aDFS \u6811\u53ef\u68c0\u6d4b\u56de\u8fb9\uff08\u5224\u73af\uff09\u3002\u540e\u5e8f\u53cd\u8f6c\u5373\u4e3a\u62d3\u6251\u5e8f\uff08DAG\uff09\u3002\u4e0e BFS \u5bf9\u6bd4\uff1aDFS \u7528\u6808\uff0cBFS \u7528\u961f\u5217\u3002'
        };
        eduEl.innerHTML = tips[phase] || '';
    },

    setInfo: function(text) {
        var el = document.getElementById('ga-info');
        if (el) el.textContent = text;
    },

    setButtons: function(enabled) {
        document.querySelectorAll('#ga-controls .btn').forEach(function(b) {
            if (b.id === 'ga-pause' || b.id === 'ga-step') return;
            b.disabled = !enabled;
        });
    },

    /* ====== Dijkstra ====== */
    startDijkstra: async function() {
        if (this.isRunning) return;
        this.mode = 'dijkstra';
        this.isRunning = true;
        this.isPaused = false;
        this._aborted = false;
        this.setButtons(false);
        this.resetState();

        var adj = this.buildAdj();
        var n = this.nodes.length;
        var self = this;

        for (var i = 0; i < n; i++) {
            this.dist[i] = i === this.startNode ? 0 : Infinity;
            this.prev[i] = null;
        }

        var pq = [{ node: this.startNode, d: 0 }];

        this.draw();
        this.setInfo('Dijkstra \u5f00\u59cb\uff0c\u8d77\u70b9 ' + this.nodes[this.startNode].label);
        this.updateEducation('dijkstra-start');
        await this.sleep(this.speed);

        while (pq.length > 0 && !this._aborted) {
            pq.sort(function(a, b) { return a.d - b.d; });
            var cur = pq.shift();
            var u = cur.node, d = cur.d;
            if (this.visited.has(u)) continue;

            this.stepCount++;
            this.currentNode = u;
            this.visited.add(u);
            this.traversalOrder.push(u);

            this.pqSnapshot = pq
                .filter(function(it) { return !self.visited.has(it.node); })
                .sort(function(a, b) { return a.d - b.d; })
                .map(function(it) {
                    return { text: self.nodes[it.node].label + ': dist=' + (it.d === Infinity ? '\u221e' : it.d) };
                });

            this.draw();
            this.setInfo('\u7b2c ' + this.stepCount + ' \u6b65\uff1a\u786e\u8ba4 ' + this.nodes[u].label + '\uff0c\u8ddd\u79bb = ' + d);
            await this.sleep(this.speed);

            this.frontier = [];
            var neighbors = adj[u] || [];
            for (var j = 0; j < neighbors.length; j++) {
                if (!this.visited.has(neighbors[j].to)) {
                    this.frontier.push({ from: u, to: neighbors[j].to, weight: neighbors[j].w });
                }
            }
            this.currentNode = u;
            this.draw();
            await this.sleep(this.speed / 2);

            for (var k = 0; k < neighbors.length; k++) {
                var v = neighbors[k].to, w = neighbors[k].w;
                if (this.visited.has(v)) continue;
                var nd = d + w;
                if (nd < this.dist[v]) {
                    this.currentEdge = { from: u, to: v, weight: w };
                    this.dist[v] = nd;
                    this.prev[v] = u;
                    pq.push({ node: v, d: nd });

                    this.pqSnapshot = pq
                        .filter(function(it) { return !self.visited.has(it.node); })
                        .sort(function(a, b) { return a.d - b.d; })
                        .map(function(it) {
                            return { text: self.nodes[it.node].label + ': dist=' + (it.d === Infinity ? '\u221e' : it.d) };
                        });

                    this.draw();
                    this.setInfo('\u677e\u5f1b ' + this.nodes[u].label + '\u2192' + this.nodes[v].label + '\uff1a' + d + '+' + w + '=' + nd);
                    this.updateEducation('dijkstra-relax');
                    await this.sleep(this.speed / 2);
                }
            }
            this.currentEdge = null;
            this.frontier = [];
        }

        this.currentNode = null;
        this.pqSnapshot = [];
        this.draw();
        var result = this.nodes.map(function(nd) {
            return nd.label + ':' + (self.dist[nd.id] === Infinity ? '\u221e' : self.dist[nd.id]);
        }).join('  ');
        this.setInfo('Dijkstra \u5b8c\u6210\uff01 ' + result);
        this.updateEducation('dijkstra-done');
        this.isRunning = false;
        this.setButtons(true);
    },

    /* ====== Prim ====== */
    startPrim: async function() {
        if (this.isRunning) return;
        if (this.directed) {
            this.setInfo('Prim \u7b97\u6cd5\u4ec5\u9002\u7528\u4e8e\u65e0\u5411\u56fe\uff0c\u8bf7\u53d6\u6d88\u6709\u5411\u6a21\u5f0f');
            return;
        }
        this.mode = 'prim';
        this.isRunning = true;
        this.isPaused = false;
        this._aborted = false;
        this.setButtons(false);
        this.resetState();

        var adj = this.buildAdj();
        var self = this;

        this.visited.add(this.startNode);
        this.traversalOrder.push(this.startNode);
        this.currentNode = this.startNode;
        this.draw();
        this.setInfo('Prim \u5f00\u59cb\uff0c\u8d77\u70b9 ' + this.nodes[this.startNode].label);
        this.updateEducation('prim-start');
        await this.sleep(this.speed);

        while (this.visited.size < this.nodes.length && !this._aborted) {
            var minEdge = null, minW = Infinity;
            this.frontier = [];
            this.visited.forEach(function(u) {
                var nb = adj[u] || [];
                for (var j = 0; j < nb.length; j++) {
                    if (!self.visited.has(nb[j].to)) {
                        self.frontier.push({ from: u, to: nb[j].to, weight: nb[j].w });
                        if (nb[j].w < minW) {
                            minW = nb[j].w;
                            minEdge = { from: u, to: nb[j].to, weight: nb[j].w };
                        }
                    }
                }
            });
            if (!minEdge) break;

            this.pqSnapshot = this.frontier
                .sort(function(a, b) { return a.weight - b.weight; })
                .map(function(e) {
                    return { text: self.nodes[e.from].label + '\u2192' + self.nodes[e.to].label + ': w=' + e.weight };
                });

            this.stepCount++;
            this.currentEdge = minEdge;
            this.draw();
            this.setInfo('\u7b2c ' + this.stepCount + ' \u6b65\uff1a\u8003\u8651 ' + this.frontier.length + ' \u6761\u5019\u9009\u8fb9\u2026');
            this.updateEducation('prim-step');
            await this.sleep(this.speed);

            this.mstEdges.push(minEdge);
            this.visited.add(minEdge.to);
            this.traversalOrder.push(minEdge.to);
            this.currentNode = minEdge.to;
            this.frontier = [];
            this.currentEdge = null;
            this.draw();

            var total = this.mstEdges.reduce(function(s, e) { return s + e.weight; }, 0);
            this.setInfo('\u7b2c ' + this.stepCount + ' \u6b65\uff1a\u6dfb\u52a0 ' +
                this.nodes[minEdge.from].label + '\u2192' + this.nodes[minEdge.to].label +
                ' (\u6743\u503c ' + minEdge.weight + ')\uff0cMST \u603b\u6743 = ' + total);
            await this.sleep(this.speed);
        }

        this.currentNode = null;
        this.pqSnapshot = [];
        var total2 = this.mstEdges.reduce(function(s, e) { return s + e.weight; }, 0);
        this.draw();
        this.setInfo('Prim \u5b8c\u6210\uff01\u6700\u5c0f\u751f\u6210\u6811\u603b\u6743\u503c = ' + total2 + '\uff0c\u5171 ' + this.mstEdges.length + ' \u6761\u8fb9');
        this.updateEducation('prim-done');
        this.isRunning = false;
        this.setButtons(true);
    },

    /* ====== BFS ====== */
    startBFS: async function() {
        if (this.isRunning) return;
        this.mode = 'bfs';
        this.isRunning = true;
        this.isPaused = false;
        this._aborted = false;
        this.setButtons(false);
        this.resetState();

        var adj = this.buildAdj();
        var self = this;
        var queue = [this.startNode];
        this.visited.add(this.startNode);
        this.traversalOrder.push(this.startNode);
        this.bfsQueue = queue.slice();

        this.currentNode = this.startNode;
        this.draw();
        this.setInfo('BFS \u5f00\u59cb\uff0c\u8d77\u70b9 ' + this.nodes[this.startNode].label);
        this.updateEducation('bfs-start');
        await this.sleep(this.speed);

        while (queue.length > 0 && !this._aborted) {
            var u = queue.shift();
            this.stepCount++;
            this.currentNode = u;
            this.bfsQueue = queue.slice();

            this.pqSnapshot = queue.map(function(qi) {
                return { text: self.nodes[qi].label };
            });

            this.draw();
            this.setInfo('\u7b2c ' + this.stepCount + ' \u6b65\uff1a\u8bbf\u95ee ' + this.nodes[u].label +
                '\uff0c\u961f\u5217: [' + queue.map(function(qi) { return self.nodes[qi].label; }).join(', ') + ']');
            this.updateEducation('bfs-step');
            await this.sleep(this.speed);

            var neighbors = adj[u] || [];
            for (var j = 0; j < neighbors.length; j++) {
                var v = neighbors[j].to;
                if (!this.visited.has(v)) {
                    this.visited.add(v);
                    this.traversalOrder.push(v);
                    queue.push(v);
                    this.parentMap[v] = u;
                    this.treeEdges.push({ from: u, to: v });

                    this.currentEdge = { from: u, to: v, weight: neighbors[j].w };
                    this.draw();
                    await this.sleep(this.speed / 3);
                }
            }
            this.currentEdge = null;
            this.frontier = [];
        }

        this.currentNode = null;
        this.pqSnapshot = [];
        this.bfsQueue = [];
        this.draw();
        var ord = this.traversalOrder.map(function(i) { return self.nodes[i].label; });
        this.setInfo('BFS \u5b8c\u6210\uff01\u8bbf\u95ee\u987a\u5e8f: ' + ord.join(' \u2192 ') +
            '\uff0c\u8bbf\u95ee ' + this.traversalOrder.length + '/' + this.nodes.length + ' \u4e2a\u8282\u70b9');
        this.updateEducation('bfs-done');
        this.isRunning = false;
        this.setButtons(true);
    },

    /* ====== DFS ====== */
    startDFS: async function() {
        if (this.isRunning) return;
        this.mode = 'dfs';
        this.isRunning = true;
        this.isPaused = false;
        this._aborted = false;
        this.setButtons(false);
        this.resetState();

        var adj = this.buildAdj();
        var self = this;
        var stack = [this.startNode];

        this.currentNode = this.startNode;
        this.draw();
        this.setInfo('DFS \u5f00\u59cb\uff0c\u8d77\u70b9 ' + this.nodes[this.startNode].label);
        this.updateEducation('dfs-start');
        await this.sleep(this.speed);

        while (stack.length > 0 && !this._aborted) {
            var u = stack.pop();
            if (this.visited.has(u)) continue;

            this.stepCount++;
            this.visited.add(u);
            this.traversalOrder.push(u);
            this.currentNode = u;
            this.dfsStack = stack.slice();

            this.pqSnapshot = stack.filter(function(si) {
                return !self.visited.has(si);
            }).reverse().map(function(si) {
                return { text: self.nodes[si].label };
            });

            this.draw();
            this.setInfo('\u7b2c ' + this.stepCount + ' \u6b65\uff1a\u8bbf\u95ee ' + this.nodes[u].label +
                '\uff0c\u6808: [' + stack.filter(function(si) { return !self.visited.has(si); }).map(function(si) { return self.nodes[si].label; }).join(', ') + ']');
            this.updateEducation('dfs-step');
            await this.sleep(this.speed);

            var neighbors = adj[u] || [];
            // Push in reverse order so leftmost neighbor is visited first
            for (var j = neighbors.length - 1; j >= 0; j--) {
                var v = neighbors[j].to;
                if (!this.visited.has(v)) {
                    stack.push(v);
                    if (this.parentMap[v] === undefined) {
                        this.parentMap[v] = u;
                        this.treeEdges.push({ from: u, to: v });
                    }

                    this.currentEdge = { from: u, to: v, weight: neighbors[j].w };
                    this.draw();
                    await this.sleep(this.speed / 4);
                }
            }
            this.currentEdge = null;
        }

        this.currentNode = null;
        this.pqSnapshot = [];
        this.dfsStack = [];
        this.draw();
        var ord = this.traversalOrder.map(function(i) { return self.nodes[i].label; });
        this.setInfo('DFS \u5b8c\u6210\uff01\u8bbf\u95ee\u987a\u5e8f: ' + ord.join(' \u2192 ') +
            '\uff0c\u8bbf\u95ee ' + this.traversalOrder.length + '/' + this.nodes.length + ' \u4e2a\u8282\u70b9');
        this.updateEducation('dfs-done');
        this.isRunning = false;
        this.setButtons(true);
    }
};

function initGraphAlgo() {
    GraphAlgo.init();
}

window.GraphAlgo = GraphAlgo;
window.initGraphAlgo = initGraphAlgo;