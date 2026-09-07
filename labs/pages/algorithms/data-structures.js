// ===== Data Structure Visualizer (v3) =====
// 5 modes: Stack / Queue / LinkedList / BST / MinHeap
// ResizeObserver + DPR + unified event management + interactive nodes + edu panel

const DataStructVis = {
    canvas: null,
    ctx: null,
    W: 0, H: 0,
    mode: 'stack',
    animId: null,
    speed: 500,
    _listeners: [],
    _timers: [],

    // Stack
    stack: [],
    stackMax: 10,
    stackOps: 0,

    // Queue
    queue: [],
    queueMax: 10,
    queueOps: 0,

    // Linked List
    llHead: null,
    llCount: 0,
    llOps: 0,
    _llPositions: [],

    // BST
    bstRoot: null,
    bstNodeCount: 0,
    _bstPositions: null,
    _bstHover: null,

    // Min-Heap
    heap: [],
    heapMax: 15,
    heapOps: 0,
    _heapHighlight: [],
    _heapPositions: [],

    // Animation / highlight
    highlight: null,
    _mouse: { x: -1, y: -1 },

    _resizeObs: null,

    /* helpers */
    _on: function(el, evt, fn) {
        var bound = fn.bind(this);
        el.addEventListener(evt, bound);
        this._listeners.push({ el: el, evt: evt, fn: bound });
    },
    _delay: function(fn, ms) {
        var id = setTimeout(fn.bind(this), ms);
        this._timers.push(id);
        return id;
    },

    init: function() {
        this.canvas = document.getElementById('ds-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this._injectExtraPanels();
        this.bindControls();
        this.draw();
        this.updateEdu();

        if (typeof ResizeObserver !== 'undefined') {
            var self = this;
            this._resizeObs = new ResizeObserver(function() { self.resize(); self.draw(); });
            this._resizeObs.observe(this.canvas.parentElement);
        } else {
            this._on(window, 'resize', function() { this.resize(); this.draw(); });
        }
    },

    destroy: function() {
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        for (var i = 0; i < this._listeners.length; i++) {
            var l = this._listeners[i];
            l.el.removeEventListener(l.evt, l.fn);
        }
        this._listeners.length = 0;
        for (var j = 0; j < this._timers.length; j++) clearTimeout(this._timers[j]);
        this._timers.length = 0;
    },

    resize: function() {
        var wrap = this.canvas ? this.canvas.parentElement : null;
        if (!wrap) return;
        var w = wrap.clientWidth;
        if (w === 0) return;
        var h = Math.min(w * 0.65, 420);
        var dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = w;
        this.H = h;
    },

    bindControls: function() {
        var self = this;
        document.querySelectorAll('.ds-mode-btn').forEach(function(btn) {
            self._on(btn, 'click', function() {
                document.querySelectorAll('.ds-mode-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.highlight = null;
                this._syncPanelVisibility();
                this.draw();
                this.updateEdu();
            });
        });

        // Stack
        this._bind('ds-push', function() { self.pushStack(); });
        this._bind('ds-pop', function() { self.popStack(); });
        this._bind('ds-peek', function() { self.peekStack(); });
        this._bind('ds-stack-input-btn', function() { self.pushStackCustom(); });

        // Queue
        this._bind('ds-enqueue', function() { self.enqueue(); });
        this._bind('ds-dequeue', function() { self.dequeue(); });
        this._bind('ds-peek-q', function() { self.peekQueue(); });
        this._bind('ds-queue-input-btn', function() { self.enqueueCustom(); });

        // Linked List
        this._bind('ds-ll-push-head', function() { self.llInsertHead(); });
        this._bind('ds-ll-push-tail', function() { self.llInsertTail(); });
        this._bind('ds-ll-pop-head', function() { self.llDeleteHead(); });
        this._bind('ds-ll-pop-tail', function() { self.llDeleteTail(); });
        this._bind('ds-ll-reverse', function() { self.llReverse(); });
        this._bind('ds-ll-search', function() { self.llSearch(); });
        this._bind('ds-ll-clear', function() {
            self.llHead = null; self.llCount = 0;
            self.draw(); self.updateInfo('\u94fe\u8868\u5df2\u6e05\u7a7a'); self.updateEdu();
        });

        // BST
        this._bind('ds-bst-insert', function() { self.bstInsert(); });
        this._bind('ds-bst-search', function() { self.bstSearch(); });
        this._bind('ds-bst-delete', function() { self.bstDelete(); });
        this._bind('ds-bst-clear', function() {
            self.bstRoot = null; self.bstNodeCount = 0;
            self.draw(); self.updateInfo('BST \u5df2\u6e05\u7a7a'); self.updateEdu();
        });
        this._bind('ds-bst-preset', function() { self.bstPreset(); });
        document.querySelectorAll('.ds-trav-btn').forEach(function(btn) {
            self._on(btn, 'click', function() { this.bstTraverse(btn.dataset.trav); });
        });

        // Heap
        this._bind('ds-heap-insert', function() { self.heapInsert(); });
        this._bind('ds-heap-extract', function() { self.heapExtract(); });
        this._bind('ds-heap-build', function() { self.heapBuildRandom(); });
        this._bind('ds-heap-clear', function() {
            self.heap = []; self.draw();
            self.updateInfo('\u5806\u5df2\u6e05\u7a7a'); self.updateEdu();
        });

        // Speed
        var speedSlider = document.getElementById('ds-speed');
        if (speedSlider) this._on(speedSlider, 'input', function() {
            this.speed = 1200 - parseInt(speedSlider.value);
        });

        // Canvas mouse
        this._on(this.canvas, 'mousemove', this._handleMouseMove);
        this._on(this.canvas, 'mouseleave', function() {
            this._mouse = { x: -1, y: -1 };
            this._bstHover = null;
            this.draw();
        });
        this._on(this.canvas, 'click', this._handleCanvasClick);
    },

    _bind: function(id, fn) {
        var el = document.getElementById(id);
        if (el) this._on(el, 'click', function() { fn(); });
    },

    _handleMouseMove: function(e) {
        var r = this.canvas.getBoundingClientRect();
        this._mouse.x = e.clientX - r.left;
        this._mouse.y = e.clientY - r.top;
        if (this.mode === 'bst' && this._bstPositions) {
            var found = null;
            this._bstPositions.forEach(function(pos, node) {
                var dx = this._mouse.x - pos.x, dy = this._mouse.y - pos.y;
                if (dx * dx + dy * dy < 400) found = node;
            }.bind(this));
            if (found !== this._bstHover) { this._bstHover = found; this.draw(); }
        } else if (this.mode === 'heap' || this.mode === 'linkedlist') {
            this.draw();
        }
    },

    _handleCanvasClick: function() {
        if (this.mode === 'bst' && this._bstHover) {
            var node = this._bstHover;
            var sc = this._bstCount(node);
            var sd = this._bstDepth(node);
            this.highlight = { val: node.val, color: '#5b8dce' };
            this.draw();
            this.updateInfo(
                '\u8282\u70b9 ' + node.val +
                ' | \u5b50\u6811\u5927\u5c0f: ' + sc +
                ' | \u5b50\u6811\u6df1\u5ea6: ' + sd +
                ' | \u5de6\u5b50: ' + (node.left ? node.left.val : '\u2205') +
                ' | \u53f3\u5b50: ' + (node.right ? node.right.val : '\u2205')
            );
            this._delay(function() { this.highlight = null; this.draw(); }, this.speed * 2);
        }
    },

    /* inject extra panels */
    _injectExtraPanels: function() {
        var controls = document.querySelector('.ds-controls');
        if (!controls) return;

        // LinkedList mode button
        if (!document.querySelector('[data-mode="linkedlist"]')) {
            var llBtn = document.createElement('button');
            llBtn.className = 'ds-mode-btn';
            llBtn.dataset.mode = 'linkedlist';
            llBtn.textContent = '\u94fe\u8868 LinkedList';
            var bstBtn = controls.querySelector('[data-mode="bst"]');
            if (bstBtn) controls.insertBefore(llBtn, bstBtn);
            else controls.appendChild(llBtn);
        }
        // Heap mode button
        if (!document.querySelector('[data-mode="heap"]')) {
            var heapBtn = document.createElement('button');
            heapBtn.className = 'ds-mode-btn';
            heapBtn.dataset.mode = 'heap';
            heapBtn.textContent = '\u6700\u5c0f\u5806 MinHeap';
            controls.appendChild(heapBtn);
        }

        var demo = document.querySelector('#data-struct-section .demo-content');
        var canvasWrap = demo ? demo.querySelector('.ds-canvas-wrap') : null;

        // Linked List panel
        if (demo && !document.getElementById('ds-ll-panel')) {
            var llP = document.createElement('div');
            llP.className = 'ds-panel'; llP.id = 'ds-ll-panel'; llP.style.display = 'none';
            llP.innerHTML =
                '<input type="number" id="ds-ll-val" placeholder="\u503c" min="1" max="99">' +
                '<button class="btn-primary" id="ds-ll-push-head">\u5934\u90e8\u63d2\u5165</button>' +
                '<button class="btn-primary" id="ds-ll-push-tail">\u5c3e\u90e8\u63d2\u5165</button>' +
                '<button class="btn-secondary" id="ds-ll-pop-head">\u5220\u9664\u5934\u90e8</button>' +
                '<button class="btn-secondary" id="ds-ll-pop-tail">\u5220\u9664\u5c3e\u90e8</button>' +
                '<button class="btn-secondary" id="ds-ll-search">\u641c\u7d22</button>' +
                '<button class="btn-secondary" id="ds-ll-reverse">\u53cd\u8f6c</button>' +
                '<button class="btn-secondary" id="ds-ll-clear">\u6e05\u7a7a</button>';
            if (canvasWrap) demo.insertBefore(llP, canvasWrap);
        }

        // Heap panel
        if (demo && !document.getElementById('ds-heap-panel')) {
            var hP = document.createElement('div');
            hP.className = 'ds-panel'; hP.id = 'ds-heap-panel'; hP.style.display = 'none';
            hP.innerHTML =
                '<input type="number" id="ds-heap-val" placeholder="\u503c" min="1" max="99">' +
                '<button class="btn-primary" id="ds-heap-insert">\u63d2\u5165</button>' +
                '<button class="btn-secondary" id="ds-heap-extract">\u53d6\u51fa\u6700\u5c0f\u503c</button>' +
                '<button class="btn-secondary" id="ds-heap-build">\u968f\u673a\u5efa\u5806</button>' +
                '<button class="btn-secondary" id="ds-heap-clear">\u6e05\u7a7a</button>';
            if (canvasWrap) demo.insertBefore(hP, canvasWrap);
        }

        // BST delete button
        var bstPanel = document.getElementById('ds-bst-panel');
        if (bstPanel && !document.getElementById('ds-bst-delete')) {
            var delBtn = document.createElement('button');
            delBtn.className = 'btn-secondary'; delBtn.id = 'ds-bst-delete';
            delBtn.textContent = '\u5220\u9664';
            var sBtn = document.getElementById('ds-bst-search');
            if (sBtn) bstPanel.insertBefore(delBtn, sBtn.nextSibling);
        }

        // Stack peek + custom
        var stkP = document.getElementById('ds-stack-panel');
        if (stkP && !document.getElementById('ds-peek')) {
            var pk = document.createElement('button');
            pk.className = 'btn-secondary'; pk.id = 'ds-peek'; pk.textContent = 'Peek';
            stkP.appendChild(pk);
            var sep1 = document.createElement('span'); sep1.className = 'ds-sep'; sep1.textContent = '|';
            stkP.appendChild(sep1);
            var si = document.createElement('input');
            si.type = 'number'; si.id = 'ds-stack-val'; si.placeholder = '\u81ea\u5b9a\u4e49\u503c'; si.min = '1'; si.max = '99';
            stkP.appendChild(si);
            var spb = document.createElement('button');
            spb.className = 'btn-primary'; spb.id = 'ds-stack-input-btn'; spb.textContent = 'Push';
            stkP.appendChild(spb);
        }

        // Queue peek + custom
        var qP = document.getElementById('ds-queue-panel');
        if (qP && !document.getElementById('ds-peek-q')) {
            var qpk = document.createElement('button');
            qpk.className = 'btn-secondary'; qpk.id = 'ds-peek-q'; qpk.textContent = 'Peek';
            qP.appendChild(qpk);
            var sep2 = document.createElement('span'); sep2.className = 'ds-sep'; sep2.textContent = '|';
            qP.appendChild(sep2);
            var qi = document.createElement('input');
            qi.type = 'number'; qi.id = 'ds-queue-val'; qi.placeholder = '\u81ea\u5b9a\u4e49\u503c'; qi.min = '1'; qi.max = '99';
            qP.appendChild(qi);
            var qpb = document.createElement('button');
            qpb.className = 'btn-primary'; qpb.id = 'ds-queue-input-btn'; qpb.textContent = 'Enqueue';
            qP.appendChild(qpb);
        }
    },

    _syncPanelVisibility: function() {
        var panels = {
            'ds-stack-panel': 'stack',
            'ds-queue-panel': 'queue',
            'ds-ll-panel': 'linkedlist',
            'ds-bst-panel': 'bst',
            'ds-heap-panel': 'heap'
        };
        var self = this;
        Object.keys(panels).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = self.mode === panels[id] ? 'flex' : 'none';
        });
    },

    updatePanelVisibility: function() { this._syncPanelVisibility(); },

    randomVal: function() { return Math.floor(Math.random() * 99) + 1; },

    /* edu panel */
    updateEdu: function() {
        var eduEl = document.getElementById('ds-edu');
        if (!eduEl) {
            var parent = document.getElementById('ds-info');
            if (!parent || !parent.parentElement) return;
            eduEl = document.createElement('div');
            eduEl.id = 'ds-edu';
            eduEl.style.cssText = 'font-size:12px;color:#8b9dc3;margin-top:6px;line-height:1.5;';
            parent.parentElement.appendChild(eduEl);
        }
        var m = this.mode;
        if (m === 'stack') {
            eduEl.innerHTML =
                '<strong>\u6808 (Stack)</strong>\uff1aLIFO \u7ed3\u6784\u3002Push/Pop/Peek \u5747\u4e3a <b>O(1)</b>\u3002' +
                '\u5e94\u7528\uff1a\u51fd\u6570\u8c03\u7528\u6808\u3001\u64a4\u9500\u64cd\u4f5c\u3001\u62ec\u53f7\u5339\u914d\u3001DFS\u3002' +
                '<br>\u5f53\u524d\u5927\u5c0f: ' + this.stack.length + '/' + this.stackMax +
                '\uff0c\u7d2f\u8ba1\u64cd\u4f5c: ' + this.stackOps + ' \u6b21' +
                '<br><span style="color:#666">\u5bb9\u91cf\u4f7f\u7528\u7387: ' +
                (this.stack.length / this.stackMax * 100).toFixed(0) + '%</span>';
        } else if (m === 'queue') {
            eduEl.innerHTML =
                '<strong>\u961f\u5217 (Queue)</strong>\uff1aFIFO \u7ed3\u6784\u3002Enqueue/Dequeue/Peek \u5747\u4e3a <b>O(1)</b>\u3002' +
                '\u5e94\u7528\uff1aBFS\u3001\u4efb\u52a1\u8c03\u5ea6\u3001\u7f13\u51b2\u533a\u3001\u6d88\u606f\u961f\u5217\u3002' +
                '<br>\u5f53\u524d\u5927\u5c0f: ' + this.queue.length + '/' + this.queueMax +
                '\uff0c\u7d2f\u8ba1\u64cd\u4f5c: ' + this.queueOps + ' \u6b21' +
                '<br><span style="color:#666">\u5bb9\u91cf\u4f7f\u7528\u7387: ' +
                (this.queue.length / this.queueMax * 100).toFixed(0) + '%</span>';
        } else if (m === 'linkedlist') {
            eduEl.innerHTML =
                '<strong>\u94fe\u8868 (Linked List)</strong>\uff1a\u52a8\u6001\u7ebf\u6027\u7ed3\u6784\uff0c\u65e0\u9700\u8fde\u7eed\u5185\u5b58\u3002' +
                '\u5934\u90e8\u64cd\u4f5c <b>O(1)</b>\uff0c\u5c3e\u90e8/\u641c\u7d22 <b>O(n)</b>\u3002\u53cd\u8f6c <b>O(n)</b>\u3002' +
                '<br>\u5e94\u7528\uff1aLRU\u7f13\u5b58\u3001\u591a\u9879\u5f0f\u8fd0\u7b97\u3001\u5185\u5b58\u7ba1\u7406\u3001\u54c8\u5e0c\u8868\u94fe\u5730\u5740\u6cd5\u3002' +
                '<br>\u5f53\u524d\u8282\u70b9\u6570: ' + this.llCount + '\uff0c\u7d2f\u8ba1\u64cd\u4f5c: ' + this.llOps + ' \u6b21';
        } else if (m === 'bst') {
            var depth = this.bstRoot ? this._bstDepth(this.bstRoot) : 0;
            eduEl.innerHTML =
                '<strong>\u4e8c\u53c9\u641c\u7d22\u6811 (BST)</strong>\uff1a\u5de6\u5b50\u6811 < \u6839 < \u53f3\u5b50\u6811\u3002' +
                '\u67e5\u627e/\u63d2\u5165/\u5220\u9664\u5e73\u5747 <b>O(log n)</b>\uff0c\u6700\u574f <b>O(n)</b>\uff08\u9000\u5316\u4e3a\u94fe\u8868\uff09\u3002' +
                '<br>\u8282\u70b9\u6570: ' + this.bstNodeCount + '\uff0c\u6811\u9ad8: ' + depth +
                (depth > 0 ? '\uff0c\u7406\u8bba\u6700\u4f18\u9ad8\u5ea6: \u2308log\u2082(' + this.bstNodeCount + '+1)\u2309 = ' + Math.ceil(Math.log2(this.bstNodeCount + 1)) : '') +
                '<br><span style="color:#666">\u70b9\u51fb\u6811\u4e2d\u8282\u70b9\u53ef\u67e5\u770b\u5b50\u6811\u8be6\u60c5</span>';
        } else if (m === 'heap') {
            eduEl.innerHTML =
                '<strong>\u6700\u5c0f\u5806 (Min-Heap)</strong>\uff1a\u5b8c\u5168\u4e8c\u53c9\u6811\uff0c\u7236\u8282\u70b9 \u2264 \u5b50\u8282\u70b9\u3002' +
                '\u63d2\u5165/\u53d6\u51fa <b>O(log n)</b>\uff0c\u67e5\u770b\u6700\u5c0f\u503c <b>O(1)</b>\uff0c\u5efa\u5806 <b>O(n)</b>\u3002' +
                '<br>\u5e94\u7528\uff1a\u4f18\u5148\u961f\u5217\u3001\u5806\u6392\u5e8f\u3001Dijkstra\u7b97\u6cd5\u3001Top-K\u95ee\u9898\u3002' +
                '<br>\u5f53\u524d\u5927\u5c0f: ' + this.heap.length + '/' + this.heapMax +
                '\uff0c\u7d2f\u8ba1\u64cd\u4f5c: ' + this.heapOps + ' \u6b21' +
                '<br><span style="color:#666">\u4e0a\u65b9\u4e3a\u6811\u5f62\u89c6\u56fe\uff0c\u4e0b\u65b9\u4e3a\u6570\u7ec4\u89c6\u56fe</span>';
        }
    },

    _bstDepth: function(node) {
        if (!node) return 0;
        return 1 + Math.max(this._bstDepth(node.left), this._bstDepth(node.right));
    },

    _bstCount: function(node) {
        if (!node) return 0;
        return 1 + this._bstCount(node.left) + this._bstCount(node.right);
    },

    // ========== STACK ==========
    pushStack: function() {
        if (this.stack.length >= this.stackMax) {
            this.updateInfo('\u6808\u5df2\u6ee1! (\u6700\u5927 ' + this.stackMax + ')');
            return;
        }
        this._doPush(this.randomVal());
    },

    pushStackCustom: function() {
        var input = document.getElementById('ds-stack-val');
        var val = input ? parseInt(input.value) : NaN;
        if (isNaN(val) || val < 1 || val > 99) { this.updateInfo('\u8bf7\u8f93\u5165 1-99 \u7684\u503c'); return; }
        if (input) input.value = '';
        if (this.stack.length >= this.stackMax) { this.updateInfo('\u6808\u5df2\u6ee1!'); return; }
        this._doPush(val);
    },

    _doPush: function(val) {
        this.stack.push({ val: val, animY: -40 });
        this.stackOps++;
        this.updateInfo('Push(' + val + ') \u2014 \u6808\u5927\u5c0f: ' + this.stack.length);
        this.updateEdu();
        this.animateEntry('stack', this.stack.length - 1);
    },

    popStack: function() {
        if (this.stack.length === 0) { this.updateInfo('\u6808\u4e3a\u7a7a!'); return; }
        this.highlight = { index: this.stack.length - 1, color: '#c4793a' };
        this.draw();
        this._delay(function() {
            var item = this.stack.pop();
            this.stackOps++;
            this.highlight = null;
            this.updateInfo('Pop() \u2192 ' + item.val + ' \u2014 \u6808\u5927\u5c0f: ' + this.stack.length);
            this.updateEdu();
            this.draw();
        }, this.speed);
    },

    peekStack: function() {
        if (this.stack.length === 0) { this.updateInfo('\u6808\u4e3a\u7a7a!'); return; }
        var top = this.stack[this.stack.length - 1];
        this.highlight = { index: this.stack.length - 1, color: '#5b8dce' };
        this.draw();
        this.updateInfo('Peek() \u2192 ' + top.val + '\uff08\u4e0d\u79fb\u9664\u5143\u7d20\uff09');
        this._delay(function() { this.highlight = null; this.draw(); }, this.speed);
    },

    // ========== QUEUE ==========
    enqueue: function() {
        if (this.queue.length >= this.queueMax) {
            this.updateInfo('\u961f\u5217\u5df2\u6ee1! (\u6700\u5927 ' + this.queueMax + ')');
            return;
        }
        this._doEnqueue(this.randomVal());
    },

    enqueueCustom: function() {
        var input = document.getElementById('ds-queue-val');
        var val = input ? parseInt(input.value) : NaN;
        if (isNaN(val) || val < 1 || val > 99) { this.updateInfo('\u8bf7\u8f93\u5165 1-99 \u7684\u503c'); return; }
        if (input) input.value = '';
        if (this.queue.length >= this.queueMax) { this.updateInfo('\u961f\u5217\u5df2\u6ee1!'); return; }
        this._doEnqueue(val);
    },

    _doEnqueue: function(val) {
        this.queue.push({ val: val, animX: 40 });
        this.queueOps++;
        this.updateInfo('Enqueue(' + val + ') \u2014 \u961f\u5217\u5927\u5c0f: ' + this.queue.length);
        this.updateEdu();
        this.animateEntry('queue', this.queue.length - 1);
    },

    dequeue: function() {
        if (this.queue.length === 0) { this.updateInfo('\u961f\u5217\u4e3a\u7a7a!'); return; }
        this.highlight = { index: 0, color: '#c4793a' };
        this.draw();
        this._delay(function() {
            var item = this.queue.shift();
            this.queueOps++;
            this.highlight = null;
            this.updateInfo('Dequeue() \u2192 ' + item.val + ' \u2014 \u961f\u5217\u5927\u5c0f: ' + this.queue.length);
            this.updateEdu();
            this.draw();
        }, this.speed);
    },

    peekQueue: function() {
        if (this.queue.length === 0) { this.updateInfo('\u961f\u5217\u4e3a\u7a7a!'); return; }
        this.highlight = { index: 0, color: '#5b8dce' };
        this.draw();
        this.updateInfo('Peek() \u2192 ' + this.queue[0].val + '\uff08\u961f\u9996\u5143\u7d20\uff0c\u4e0d\u79fb\u9664\uff09');
        this._delay(function() { this.highlight = null; this.draw(); }, this.speed);
    },

    animateEntry: function(type, idx) {
        var frame = 0, frames = 15;
        var self = this;
        var loop = function() {
            frame++;
            if (type === 'stack') {
                if (self.stack[idx]) self.stack[idx].animY = -40 * (1 - frame / frames);
            } else if (type === 'queue') {
                if (self.queue[idx]) self.queue[idx].animX = 40 * (1 - frame / frames);
            }
            self.draw();
            if (frame < frames) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    },

    // ========== LINKED LIST ==========
    _llNode: function(val, next) { return { val: val, next: next || null }; },

    llInsertHead: function() {
        var input = document.getElementById('ds-ll-val');
        var val = input ? parseInt(input.value) : this.randomVal();
        if (isNaN(val)) val = this.randomVal();
        if (input) input.value = '';
        this.llHead = this._llNode(val, this.llHead);
        this.llCount++; this.llOps++;
        this.updateInfo('InsertHead(' + val + ') \u2014 \u94fe\u8868\u957f\u5ea6: ' + this.llCount);
        this.updateEdu(); this.draw();
    },

    llInsertTail: function() {
        var input = document.getElementById('ds-ll-val');
        var val = input ? parseInt(input.value) : this.randomVal();
        if (isNaN(val)) val = this.randomVal();
        if (input) input.value = '';
        var node = this._llNode(val);
        if (!this.llHead) { this.llHead = node; }
        else { var c = this.llHead; while (c.next) c = c.next; c.next = node; }
        this.llCount++; this.llOps++;
        this.updateInfo('InsertTail(' + val + ') \u2014 \u94fe\u8868\u957f\u5ea6: ' + this.llCount);
        this.updateEdu(); this.draw();
    },

    llDeleteHead: function() {
        if (!this.llHead) { this.updateInfo('\u94fe\u8868\u4e3a\u7a7a!'); return; }
        var val = this.llHead.val;
        this.highlight = { llIndex: 0, color: '#c4793a' };
        this.draw();
        this._delay(function() {
            this.llHead = this.llHead.next;
            this.llCount--; this.llOps++;
            this.highlight = null;
            this.updateInfo('DeleteHead() \u2192 ' + val + ' \u2014 \u94fe\u8868\u957f\u5ea6: ' + this.llCount);
            this.updateEdu(); this.draw();
        }, this.speed);
    },

    llDeleteTail: function() {
        if (!this.llHead) { this.updateInfo('\u94fe\u8868\u4e3a\u7a7a!'); return; }
        if (!this.llHead.next) {
            var v0 = this.llHead.val;
            this.highlight = { llIndex: 0, color: '#c4793a' };
            this.draw();
            this._delay(function() {
                this.llHead = null; this.llCount--; this.llOps++;
                this.highlight = null;
                this.updateInfo('DeleteTail() \u2192 ' + v0 + ' \u2014 \u94fe\u8868\u957f\u5ea6: ' + this.llCount);
                this.updateEdu(); this.draw();
            }, this.speed);
            return;
        }
        var prev = this.llHead, idx = 0;
        while (prev.next && prev.next.next) { prev = prev.next; idx++; }
        var val2 = prev.next.val;
        this.highlight = { llIndex: idx + 1, color: '#c4793a' };
        this.draw();
        this._delay(function() {
            prev.next = null; this.llCount--; this.llOps++;
            this.highlight = null;
            this.updateInfo('DeleteTail() \u2192 ' + val2 + ' \u2014 \u94fe\u8868\u957f\u5ea6: ' + this.llCount);
            this.updateEdu(); this.draw();
        }, this.speed);
    },

    llReverse: function() {
        if (!this.llHead || !this.llHead.next) {
            this.updateInfo('\u94fe\u8868\u592a\u77ed\uff0c\u65e0\u9700\u53cd\u8f6c');
            return;
        }
        var vals = [];
        var cur = this.llHead;
        while (cur) { vals.push(cur.val); cur = cur.next; }

        var step2 = 0, self = this;
        var doStep = function() {
            if (step2 < vals.length) {
                self.highlight = { llIndex: step2, color: '#5b8dce' };
                self.draw();
                step2++;
                self._delay(doStep, self.speed / 2);
            } else {
                var prev2 = null;
                cur = self.llHead;
                while (cur) { var nx = cur.next; cur.next = prev2; prev2 = cur; cur = nx; }
                self.llHead = prev2;
                self.llOps++;
                self.highlight = null;
                var rev = vals.slice().reverse();
                self.updateInfo('Reverse() \u2014 ' + vals.join(' \u2192 ') + ' \u2192 ' + rev.join(' \u2192 '));
                self.updateEdu(); self.draw();
            }
        };
        doStep();
    },

    llSearch: function() {
        var input = document.getElementById('ds-ll-val');
        var val = input ? parseInt(input.value) : NaN;
        if (isNaN(val)) { this.updateInfo('\u8bf7\u8f93\u5165\u641c\u7d22\u503c'); return; }

        var cur = this.llHead, idx = 0, self = this;
        var step = function() {
            if (cur) {
                self.highlight = { llIndex: idx, color: cur.val === val ? '#4d9e7e' : '#c4793a' };
                self.draw();
                if (cur.val === val) {
                    self.updateInfo('\u627e\u5230 ' + val + '! \u4f4d\u4e8e\u7d22\u5f15 ' + idx + '\uff0c\u7ecf\u8fc7 ' + (idx + 1) + ' \u6b21\u6bd4\u8f83');
                    self._delay(function() { self.highlight = null; self.draw(); }, self.speed);
                    return;
                }
                cur = cur.next; idx++;
                self._delay(step, self.speed / 2);
            } else {
                self.highlight = null; self.draw();
                self.updateInfo('\u672a\u627e\u5230 ' + val + '\uff0c\u904d\u5386\u5168\u90e8 ' + idx + ' \u4e2a\u8282\u70b9');
            }
        };
        step();
    },

    // ========== BST ==========
    bstInsert: function() {
        var input = document.getElementById('ds-bst-val');
        var val = input ? parseInt(input.value) : this.randomVal();
        if (isNaN(val)) val = this.randomVal();
        if (input) input.value = '';
        var oldCount = this.bstNodeCount;
        this.bstRoot = this._bstInsert(this.bstRoot, val, 0);
        var isNew = this.bstNodeCount > oldCount;
        this.updateInfo(isNew ? 'BST Insert(' + val + ')' : val + ' \u5df2\u5b58\u5728\u4e8e\u6811\u4e2d');
        this.highlight = { val: val, color: '#4d9e7e' };
        this.updateEdu(); this.draw();
        this._delay(function() { this.highlight = null; this.draw(); }, this.speed);
    },

    _bstInsert: function(node, val, depth) {
        if (!node) { this.bstNodeCount++; return { val: val, left: null, right: null, depth: depth }; }
        if (val < node.val) node.left = this._bstInsert(node.left, val, depth + 1);
        else if (val > node.val) node.right = this._bstInsert(node.right, val, depth + 1);
        return node;
    },

    bstDelete: function() {
        var input = document.getElementById('ds-bst-val');
        var val = input ? parseInt(input.value) : NaN;
        if (isNaN(val)) { this.updateInfo('\u8bf7\u8f93\u5165\u8981\u5220\u9664\u7684\u503c'); return; }
        if (!this.bstRoot) { this.updateInfo('BST \u4e3a\u7a7a'); return; }

        var path = [], n = this.bstRoot, found = false;
        while (n) {
            path.push(n.val);
            if (val === n.val) { found = true; break; }
            else if (val < n.val) n = n.left;
            else n = n.right;
        }
        if (!found) { this.updateInfo('\u672a\u627e\u5230 ' + val + '\uff0c\u65e0\u6cd5\u5220\u9664'); return; }

        var i = 0, self = this;
        var step = function() {
            if (i < path.length) {
                self.highlight = { val: path[i], color: i === path.length - 1 ? '#c4793a' : '#5b8dce' };
                self.draw(); i++;
                self._delay(step, self.speed);
            } else {
                var target = self._bstFind(self.bstRoot, val);
                var desc = '\u53f6\u8282\u70b9';
                if (target && target.left && target.right) desc = '\u53cc\u5b50\u8282\u70b9\uff08\u7528\u540e\u7ee7\u66ff\u6362\uff09';
                else if (target && (target.left || target.right)) desc = '\u5355\u5b50\u8282\u70b9';
                self.bstRoot = self._bstRemove(self.bstRoot, val);
                self.bstNodeCount--;
                self.highlight = null;
                self.updateInfo('BST Delete(' + val + ') \u2014 ' + desc + ' \u2014 \u8def\u5f84: ' + path.join(' \u2192 '));
                self.updateEdu(); self.draw();
            }
        };
        step();
    },

    _bstFind: function(node, val) {
        if (!node) return null;
        if (val === node.val) return node;
        return val < node.val ? this._bstFind(node.left, val) : this._bstFind(node.right, val);
    },

    _bstRemove: function(node, val) {
        if (!node) return null;
        if (val < node.val) { node.left = this._bstRemove(node.left, val); }
        else if (val > node.val) { node.right = this._bstRemove(node.right, val); }
        else {
            if (!node.left && !node.right) return null;
            if (!node.left) return node.right;
            if (!node.right) return node.left;
            var succ = node.right;
            while (succ.left) succ = succ.left;
            node.val = succ.val;
            node.right = this._bstRemove(node.right, succ.val);
        }
        return node;
    },

    bstSearch: function() {
        var input = document.getElementById('ds-bst-val');
        var val = input ? parseInt(input.value) : 0;
        if (isNaN(val)) { this.updateInfo('\u8bf7\u8f93\u5165\u641c\u7d22\u503c'); return; }

        var path = [], node = this.bstRoot;
        while (node) {
            path.push(node.val);
            if (val === node.val) break;
            else if (val < node.val) node = node.left;
            else node = node.right;
        }

        var i = 0, self = this;
        var step = function() {
            if (i < path.length) {
                self.highlight = { val: path[i], color: i === path.length - 1 && path[i] === val ? '#4d9e7e' : '#c4793a' };
                self.draw(); i++;
                self._delay(step, self.speed);
            } else {
                var ok = node && node.val === val;
                self.updateInfo(ok
                    ? '\u627e\u5230 ' + val + '! \u8def\u5f84: ' + path.join(' \u2192 ') + '\uff0c\u6df1\u5ea6 ' + (path.length - 1) + '\uff0c\u6bd4\u8f83 ' + path.length + ' \u6b21'
                    : '\u672a\u627e\u5230 ' + val + ', \u641c\u7d22\u8def\u5f84: ' + path.join(' \u2192 ') + '\uff0c\u6bd4\u8f83 ' + path.length + ' \u6b21');
                self._delay(function() { self.highlight = null; self.draw(); }, self.speed);
            }
        };
        step();
    },

    bstPreset: function() {
        this.bstRoot = null; this.bstNodeCount = 0;
        var vals = [50, 30, 70, 20, 40, 60, 80, 10, 35, 55, 75];
        for (var i = 0; i < vals.length; i++) this.bstRoot = this._bstInsert(this.bstRoot, vals[i], 0);
        this.updateInfo('\u52a0\u8f7d\u9884\u8bbe BST: [' + vals.join(', ') + ']');
        this.updateEdu(); this.draw();
    },

    bstTraverse: function(type) {
        if (!this.bstRoot) { this.updateInfo('BST \u4e3a\u7a7a'); return; }
        var result = [];
        var collect = function(n2) {
            if (!n2) return;
            if (type === 'pre') { result.push(n2.val); collect(n2.left); collect(n2.right); }
            else if (type === 'in') { collect(n2.left); result.push(n2.val); collect(n2.right); }
            else { collect(n2.left); collect(n2.right); result.push(n2.val); }
        };
        collect(this.bstRoot);

        var i = 0, self = this;
        var names = { pre: '\u524d\u5e8f (\u6839\u2192\u5de6\u2192\u53f3)', 'in': '\u4e2d\u5e8f (\u5de6\u2192\u6839\u2192\u53f3)', post: '\u540e\u5e8f (\u5de6\u2192\u53f3\u2192\u6839)' };
        var step = function() {
            if (i < result.length) {
                self.highlight = { val: result[i], color: '#5b8dce' };
                self.draw(); i++;
                self._delay(step, self.speed);
            } else {
                self.highlight = null; self.draw();
                self.updateInfo(names[type] + '\u904d\u5386: ' + result.join(' \u2192 '));
            }
        };
        step();
    },

    // ========== MIN-HEAP ==========
    heapInsert: function() {
        if (this.heap.length >= this.heapMax) {
            this.updateInfo('\u5806\u5df2\u6ee1! (\u6700\u5927 ' + this.heapMax + ')');
            return;
        }
        var input = document.getElementById('ds-heap-val');
        var val = input ? parseInt(input.value) : this.randomVal();
        if (isNaN(val)) val = this.randomVal();
        if (input) input.value = '';

        this.heap.push(val);
        this.heapOps++;
        var idx = this.heap.length - 1;
        this._heapHighlight = [idx];
        this.draw();

        var self = this;
        var bubbleUp = function() {
            if (idx > 0) {
                var parent = Math.floor((idx - 1) / 2);
                if (self.heap[idx] < self.heap[parent]) {
                    self._heapHighlight = [idx, parent];
                    self.draw();
                    self._delay(function() {
                        var tmp = self.heap[idx];
                        self.heap[idx] = self.heap[parent];
                        self.heap[parent] = tmp;
                        idx = parent;
                        self._heapHighlight = [idx];
                        self.draw();
                        self._delay(bubbleUp, self.speed / 2);
                    }, self.speed / 2);
                    return;
                }
            }
            self._heapHighlight = [];
            self.updateInfo('HeapInsert(' + val + ') \u2014 \u5806\u5927\u5c0f: ' + self.heap.length);
            self.updateEdu(); self.draw();
        };
        this._delay(bubbleUp, this.speed / 2);
    },

    heapExtract: function() {
        if (this.heap.length === 0) { this.updateInfo('\u5806\u4e3a\u7a7a!'); return; }
        var min = this.heap[0];
        this._heapHighlight = [0];
        this.draw();

        var self = this;
        this._delay(function() {
            if (self.heap.length === 1) {
                self.heap = []; self._heapHighlight = []; self.heapOps++;
                self.updateInfo('ExtractMin() \u2192 ' + min + ' \u2014 \u5806\u4e3a\u7a7a');
                self.updateEdu(); self.draw();
                return;
            }
            self.heap[0] = self.heap.pop(); self.heapOps++;
            var idx = 0;
            self._heapHighlight = [idx]; self.draw();

            var siftDown = function() {
                var left = 2 * idx + 1, right = 2 * idx + 2, sm = idx;
                if (left < self.heap.length && self.heap[left] < self.heap[sm]) sm = left;
                if (right < self.heap.length && self.heap[right] < self.heap[sm]) sm = right;
                if (sm !== idx) {
                    self._heapHighlight = [idx, sm]; self.draw();
                    self._delay(function() {
                        var tmp = self.heap[idx];
                        self.heap[idx] = self.heap[sm];
                        self.heap[sm] = tmp;
                        idx = sm;
                        self._heapHighlight = [idx]; self.draw();
                        self._delay(siftDown, self.speed / 2);
                    }, self.speed / 2);
                    return;
                }
                self._heapHighlight = [];
                self.updateInfo('ExtractMin() \u2192 ' + min + ' \u2014 \u5806\u5927\u5c0f: ' + self.heap.length);
                self.updateEdu(); self.draw();
            };
            self._delay(siftDown, self.speed / 2);
        }, this.speed);
    },

    heapBuildRandom: function() {
        var n = Math.floor(Math.random() * 8) + 5;
        this.heap = [];
        for (var i = 0; i < n; i++) this.heap.push(this.randomVal());
        var arr = this.heap.slice();
        for (var j = Math.floor(this.heap.length / 2) - 1; j >= 0; j--) this._heapify(j);
        this.heapOps++;
        this.updateInfo('BuildHeap([' + arr.join(', ') + ']) \u2014 \u5927\u5c0f: ' + this.heap.length);
        this.updateEdu(); this.draw();
    },

    _heapify: function(idx) {
        var left = 2 * idx + 1, right = 2 * idx + 2, sm = idx;
        if (left < this.heap.length && this.heap[left] < this.heap[sm]) sm = left;
        if (right < this.heap.length && this.heap[right] < this.heap[sm]) sm = right;
        if (sm !== idx) {
            var tmp = this.heap[idx]; this.heap[idx] = this.heap[sm]; this.heap[sm] = tmp;
            this._heapify(sm);
        }
    },

    // ========== DRAW ==========
    draw: function() {
        var ctx = this.ctx, W = this.W, H = this.H;
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0d1017';
        ctx.fillRect(0, 0, W, H);

        if (this.mode === 'stack') this.drawStack();
        else if (this.mode === 'queue') this.drawQueue();
        else if (this.mode === 'linkedlist') this.drawLinkedList();
        else if (this.mode === 'bst') this.drawBST();
        else if (this.mode === 'heap') this.drawHeap();
    },

    drawStack: function() {
        var ctx = this.ctx, W = this.W, H = this.H;
        var boxW = 60, boxH = 34;
        var baseX = W / 2 - boxW / 2, baseY = H - 40;

        // Capacity ghost slots
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
        for (var g = 0; g < this.stackMax; g++) {
            ctx.strokeRect(baseX, baseY - (g + 1) * boxH, boxW, boxH - 2);
        }

        // Container outline
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
        var cH = this.stackMax * boxH + 10;
        ctx.strokeRect(baseX - 5, baseY - cH - 5, boxW + 10, cH + 15);

        // Bottom label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '16px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('\u5e95\u90e8', baseX + boxW / 2, baseY + 16);

        // Capacity
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '15px ' + CF.mono;
        ctx.textAlign = 'right';
        ctx.fillText(this.stack.length + '/' + this.stackMax, baseX + boxW + 40, baseY - cH);

        // TOP pointer
        if (this.stack.length > 0) {
            var topY = baseY - this.stack.length * boxH;
            ctx.fillStyle = '#c4793a';
            ctx.font = '17px ' + CF.mono;
            ctx.textAlign = 'right';
            ctx.fillText('TOP \u2192', baseX - 12, topY + boxH / 2 + 4);
        }

        // Items
        for (var i = 0; i < this.stack.length; i++) {
            var item = this.stack[i];
            var sy = baseY - (i + 1) * boxH + (item.animY || 0);
            var isHL = this.highlight && this.highlight.index === i;
            var color = isHL ? this.highlight.color : '#c4793a';
            var alpha = isHL ? 0.3 : 0.1;

            ctx.fillStyle = 'rgba(' + this.hexRgb(color) + ',' + alpha + ')';
            ctx.fillRect(baseX, sy, boxW, boxH - 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = isHL ? 2 : 1;
            ctx.strokeRect(baseX, sy, boxW, boxH - 2);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 19px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(item.val, baseX + boxW / 2, sy + (boxH - 2) / 2);

            // Index
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '14px ' + CF.mono;
            ctx.textAlign = 'left';
            ctx.fillText('[' + i + ']', baseX + boxW + 6, sy + (boxH - 2) / 2 + 3);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '18px ' + CF.sans;
        ctx.textAlign = 'center';
        ctx.fillText('LIFO \u2014 \u540e\u8fdb\u5148\u51fa', W / 2, 24);
    },

    drawQueue: function() {
        var ctx = this.ctx, W = this.W, H = this.H;
        var boxW = 50, boxH = 44, midY = H / 2;
        var startX = (W - this.queueMax * (boxW + 4)) / 2;

        // Ghost slots
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
        for (var g = 0; g < this.queueMax; g++) {
            ctx.strokeRect(startX + g * (boxW + 4), midY - boxH / 2, boxW, boxH);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(startX - 6, midY - boxH / 2 - 6, this.queueMax * (boxW + 4) + 8, boxH + 12);

        // Front/Rear labels
        if (this.queue.length > 0) {
            ctx.fillStyle = '#4d9e7e';
            ctx.font = '16px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillText('\u2191 FRONT', startX + boxW / 2, midY + boxH / 2 + 20);
            ctx.fillStyle = '#5b8dce';
            ctx.fillText('\u2191 REAR', startX + (this.queue.length - 1) * (boxW + 4) + boxW / 2, midY + boxH / 2 + 20);
        }

        // Items
        for (var i = 0; i < this.queue.length; i++) {
            var qI = this.queue[i];
            var qx = startX + i * (boxW + 4) + (qI.animX || 0);
            var isHL = this.highlight && this.highlight.index === i;
            var qColor = i === 0 ? '#4d9e7e' : '#5b8dce';
            var dc = isHL ? this.highlight.color : qColor;
            var qa = isHL ? 0.3 : 0.1;

            ctx.fillStyle = 'rgba(' + this.hexRgb(dc) + ',' + qa + ')';
            ctx.fillRect(qx, midY - boxH / 2, boxW, boxH);
            ctx.strokeStyle = dc; ctx.lineWidth = isHL ? 2 : 1;
            ctx.strokeRect(qx, midY - boxH / 2, boxW, boxH);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 19px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(qI.val, qx + boxW / 2, midY);

            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '14px ' + CF.mono;
            ctx.fillText('[' + i + ']', qx + boxW / 2, midY - boxH / 2 - 6);
        }

        // Arrow
        if (this.queue.length > 1) {
            ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
            var ax = startX + boxW / 2;
            var bx = startX + (this.queue.length - 1) * (boxW + 4) + boxW / 2;
            ctx.beginPath(); ctx.moveTo(ax, midY - boxH / 2 - 14); ctx.lineTo(bx, midY - boxH / 2 - 14); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.moveTo(ax, midY - boxH / 2 - 14);
            ctx.lineTo(ax + 8, midY - boxH / 2 - 18);
            ctx.lineTo(ax + 8, midY - boxH / 2 - 10);
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '15px ' + CF.mono; ctx.textAlign = 'right';
        ctx.fillText(this.queue.length + '/' + this.queueMax, W - 10, midY - boxH / 2 - 20);

        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '18px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('FIFO \u2014 \u5148\u8fdb\u5148\u51fa', W / 2, 24);
    },

    drawLinkedList: function() {
        var ctx = this.ctx, W = this.W, H = this.H;
        this._llPositions = [];
        if (!this.llHead) {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '19px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillText('\u7a7a\u94fe\u8868 \u2014 \u4f7f\u7528\u201c\u5934\u90e8\u63d2\u5165\u201d\u6216\u201c\u5c3e\u90e8\u63d2\u5165\u201d\u6dfb\u52a0\u8282\u70b9', W / 2, H / 2);
            return;
        }

        var nW = 56, nH = 36, gap = 26, midY = H / 2;
        var count = 0, c = this.llHead;
        while (c) { count++; c = c.next; }

        var totalW = count * (nW + gap) - gap;
        var sx = Math.max(30, (W - totalW) / 2);
        var uW = W - 60;
        var aGap = totalW > uW ? (uW - count * nW) / Math.max(count - 1, 1) : gap;
        if (totalW > uW) sx = 30;

        c = this.llHead; var idx = 0;
        while (c) {
            var x = sx + idx * (nW + aGap), y = midY - nH / 2;
            this._llPositions.push({ x: x, y: y, w: nW, h: nH, val: c.val });

            var isHL = this.highlight && this.highlight.llIndex === idx;
            var color = isHL ? this.highlight.color : '#c4793a';
            var alpha = isHL ? 0.3 : 0.1;

            ctx.fillStyle = 'rgba(' + this.hexRgb(color) + ',' + alpha + ')';
            ctx.fillRect(x, y, nW, nH);
            ctx.strokeStyle = color; ctx.lineWidth = isHL ? 2.5 : 1.2;
            ctx.strokeRect(x, y, nW, nH);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 19px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(c.val, x + nW * 0.4, midY);

            // Divider
            ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x + nW * 0.7, y); ctx.lineTo(x + nW * 0.7, y + nH); ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '14px ' + CF.mono; ctx.textAlign = 'center';
            ctx.fillText('[' + idx + ']', x + nW / 2, y - 8);

            if (c.next) {
                var as = x + nW, ae = x + nW + aGap;
                ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(as + 2, midY); ctx.lineTo(ae - 2, midY); ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.beginPath(); ctx.moveTo(ae - 2, midY); ctx.lineTo(ae - 8, midY - 4); ctx.lineTo(ae - 8, midY + 4); ctx.fill();
                ctx.fillStyle = '#c4793a';
                ctx.beginPath(); ctx.arc(x + nW * 0.85, midY, 3, 0, Math.PI * 2); ctx.fill();
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.font = '15px ' + CF.mono; ctx.textAlign = 'left';
                ctx.fillText('NULL', x + nW + 6, midY + 3);
            }
            c = c.next; idx++;
        }

        ctx.fillStyle = '#4d9e7e';
        ctx.font = '16px ' + CF.mono; ctx.textAlign = 'center';
        ctx.fillText('HEAD', sx + nW / 2, midY + nH / 2 + 18);

        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '18px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('\u5355\u5411\u94fe\u8868 \u2014 Singly Linked List', W / 2, 24);

        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '15px ' + CF.mono; ctx.textAlign = 'right';
        ctx.fillText('\u8282\u70b9: ' + this.llCount, W - 10, H - 8);
    },

    drawBST: function() {
        var ctx = this.ctx, W = this.W, H = this.H;
        if (!this.bstRoot) {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '19px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillText('\u7a7a\u6811 \u2014 \u70b9\u51fb\u201c\u63d2\u5165\u201d\u6216\u201c\u52a0\u8f7d\u9884\u8bbe\u201d\u6dfb\u52a0\u8282\u70b9', W / 2, H / 2);
            this._bstPositions = null;
            return;
        }
        this._bstPositions = new Map();
        var bIdx = 0, self = this;
        var inorder = function(n) {
            if (!n) return;
            inorder(n.left);
            self._bstPositions.set(n, { order: bIdx++ });
            inorder(n.right);
        };
        inorder(this.bstRoot);

        var total = bIdx, nodeR = 18, padX = 40, padTop = 40;
        var usableW = W - padX * 2;
        var depth = this._bstDepth(this.bstRoot);
        var usableH = H - padTop - 30;
        var levelH = depth > 1 ? Math.min(55, usableH / depth) : 55;

        var assignPos = function(n, d) {
            if (!n) return;
            var pos = self._bstPositions.get(n);
            pos.x = padX + (pos.order / (total - 1 || 1)) * usableW;
            pos.y = padTop + d * levelH;
            assignPos(n.left, d + 1); assignPos(n.right, d + 1);
        };
        assignPos(this.bstRoot, 0);

        // Edges
        var drawEdges = function(n) {
            if (!n) return;
            var p = self._bstPositions.get(n);
            var ch = [n.left, n.right];
            for (var ci = 0; ci < ch.length; ci++) {
                if (ch[ci]) {
                    var cp = self._bstPositions.get(ch[ci]);
                    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cp.x, cp.y); ctx.stroke();
                    drawEdges(ch[ci]);
                }
            }
        };
        drawEdges(this.bstRoot);

        // Nodes
        var drawNodes = function(n) {
            if (!n) return;
            var p = self._bstPositions.get(n);
            var isHL = self.highlight && self.highlight.val === n.val;
            var isHov = self._bstHover === n;
            var color = isHL ? self.highlight.color : (isHov ? '#5b8dce' : '#c4793a');

            ctx.fillStyle = (isHL || isHov) ? 'rgba(' + self.hexRgb(color) + ',0.25)' : 'rgba(196,121,58,0.1)';
            ctx.beginPath(); ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = color; ctx.lineWidth = (isHL || isHov) ? 2.5 : 1.5;
            ctx.beginPath(); ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2); ctx.stroke();

            if (isHL || isHov) {
                ctx.shadowColor = color; ctx.shadowBlur = 12;
                ctx.beginPath(); ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2); ctx.stroke();
                ctx.shadowBlur = 0;
            }

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 18px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(n.val, p.x, p.y);

            drawNodes(n.left); drawNodes(n.right);
        };
        drawNodes(this.bstRoot);

        // Hover tooltip
        if (this._bstHover && this._bstPositions.has(this._bstHover)) {
            var hn = this._bstHover, hp = this._bstPositions.get(hn);
            var info = 'val=' + hn.val + ' L=' + (hn.left ? hn.left.val : '\u2205') + ' R=' + (hn.right ? hn.right.val : '\u2205');
            ctx.fillStyle = 'rgba(0,0,0,0.8)';
            var tw = ctx.measureText(info).width + 16;
            var tx = Math.min(hp.x - tw / 2, W - tw - 4);
            ctx.fillRect(tx, hp.y - nodeR - 28, tw, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '15px ' + CF.mono;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(info, tx + 8, hp.y - nodeR - 18);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '15px ' + CF.mono; ctx.textAlign = 'right';
        ctx.fillText('\u8282\u70b9: ' + this.bstNodeCount + '  \u6df1\u5ea6: ' + depth, W - 10, H - 8);

        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '15px ' + CF.sans; ctx.textAlign = 'left';
        ctx.fillText('\u70b9\u51fb\u8282\u70b9\u67e5\u770b\u5b50\u6811\u4fe1\u606f', 10, H - 8);
    },

    drawHeap: function() {
        var ctx = this.ctx, W = this.W, H = this.H;
        this._heapPositions = [];
        if (this.heap.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '19px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillText('\u7a7a\u5806 \u2014 \u70b9\u51fb\u201c\u63d2\u5165\u201d\u6216\u201c\u968f\u673a\u5efa\u5806\u201d', W / 2, H / 2 - 30);
            return;
        }

        var n = this.heap.length;
        var treeH = H * 0.6, treeTop = 30, nodeR = 16;
        var depth = Math.floor(Math.log2(n)) + 1;
        var levelH = depth > 1 ? Math.min(50, (treeH - 20) / depth) : 50;

        // Positions
        for (var i = 0; i < n; i++) {
            var lv = Math.floor(Math.log2(i + 1));
            var lvStart = Math.pow(2, lv) - 1;
            var pos = i - lvStart;
            this._heapPositions.push({
                x: W * (pos + 0.5) / Math.pow(2, lv),
                y: treeTop + lv * levelH
            });
        }

        // Edges
        for (var ei = 0; ei < n; ei++) {
            var ep = this._heapPositions[ei];
            var ch2 = [2 * ei + 1, 2 * ei + 2];
            for (var ec = 0; ec < ch2.length; ec++) {
                if (ch2[ec] < n) {
                    var ecp = this._heapPositions[ch2[ec]];
                    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.2;
                    ctx.beginPath(); ctx.moveTo(ep.x, ep.y); ctx.lineTo(ecp.x, ecp.y); ctx.stroke();
                }
            }
        }

        // Nodes
        for (var ni = 0; ni < n; ni++) {
            var np = this._heapPositions[ni];
            var isHL = this._heapHighlight.indexOf(ni) >= 0;
            var isRoot = ni === 0;
            var nc = isHL ? '#c4793a' : (isRoot ? '#4d9e7e' : '#5b8dce');

            ctx.fillStyle = 'rgba(' + this.hexRgb(nc) + ',' + (isHL ? 0.3 : 0.1) + ')';
            ctx.beginPath(); ctx.arc(np.x, np.y, nodeR, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = nc; ctx.lineWidth = isHL ? 2.5 : 1.2;
            ctx.beginPath(); ctx.arc(np.x, np.y, nodeR, 0, Math.PI * 2); ctx.stroke();

            if (isHL) {
                ctx.shadowColor = nc; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(np.x, np.y, nodeR, 0, Math.PI * 2); ctx.stroke();
                ctx.shadowBlur = 0;
            }

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 17px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(this.heap[ni], np.x, np.y);
        }

        // Array view
        var aTop = treeTop + treeH + 10;
        var cellW = Math.min(36, (W - 40) / n);
        var aSX = (W - n * cellW) / 2;

        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '15px ' + CF.sans; ctx.textAlign = 'center';
        ctx.fillText('\u6570\u7ec4\u8868\u793a:', W / 2, aTop - 6);

        for (var ai = 0; ai < n; ai++) {
            var ax2 = aSX + ai * cellW;
            var aHL = this._heapHighlight.indexOf(ai) >= 0;
            var ac = aHL ? '#c4793a' : '#5b8dce';

            ctx.fillStyle = 'rgba(' + this.hexRgb(ac) + ',' + (aHL ? 0.2 : 0.06) + ')';
            ctx.fillRect(ax2, aTop, cellW - 2, 28);
            ctx.strokeStyle = 'rgba(' + this.hexRgb(ac) + ',0.4)'; ctx.lineWidth = 1;
            ctx.strokeRect(ax2, aTop, cellW - 2, 28);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 16px ' + CF.mono;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(this.heap[ai], ax2 + (cellW - 2) / 2, aTop + 14);

            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '13px ' + CF.mono;
            ctx.fillText(ai, ax2 + (cellW - 2) / 2, aTop + 38);
        }

        // Formula
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.font = '14px ' + CF.mono; ctx.textAlign = 'center';
        ctx.fillText('parent = \u230a(i-1)/2\u230b    left = 2i+1    right = 2i+2', W / 2, aTop + 52);

        // Min label
        if (n > 0) {
            ctx.fillStyle = '#4d9e7e';
            ctx.font = '15px ' + CF.mono; ctx.textAlign = 'center';
            ctx.fillText('MIN', this._heapPositions[0].x, this._heapPositions[0].y - nodeR - 6);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '15px ' + CF.mono; ctx.textAlign = 'right';
        ctx.fillText('\u5927\u5c0f: ' + n + '  \u6df1\u5ea6: ' + depth, W - 10, 18);
    },

    hexRgb: function(hex) {
        if (hex.charAt(0) === '#') {
            var h = hex.slice(1);
            return parseInt(h.substring(0, 2), 16) + ',' + parseInt(h.substring(2, 4), 16) + ',' + parseInt(h.substring(4, 6), 16);
        }
        return '200,200,200';
    },

    updateInfo: function(msg) {
        var el = document.getElementById('ds-info');
        if (el) el.textContent = msg;
    }
};

function initDataStructVis() {
    DataStructVis.init();
    DataStructVis._syncPanelVisibility();
}
