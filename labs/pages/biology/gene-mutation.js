/* ═══════════════════════════════════════════════════
   Gene Mutation v2 – Base Substitution / Insertion / Deletion
   dt-driven · ResizeObserver · DPR · hover tooltip · education panel
   ═══════════════════════════════════════════════════ */
const GeneMutation = (() => {
    'use strict';

    /* ── state ── */
    let cvs, ctx, W, H, dpr = 1;
    let animId = null, lastT = 0, paused = false, speed = 1;
    let mode = 0; // 0=substitution 1=insertion 2=deletion
    let mutated = false, progress = 0;
    let hoverBase = null; // {strand,idx,px,py}
    let infoEl = null, ro = null;

    /* ── DNA data ── */
    const origBases = ['T','A','C','C','A','A','T','G','G','C','T','A','A','C','T'];
    const comp = { A:'T', T:'A', G:'C', C:'G' };
    const rna  = { A:'U', T:'A', G:'C', C:'G' };

    const aa = {
        'AUG':'Met','UUU':'Phe','UUC':'Phe','UUA':'Leu','UUG':'Leu',
        'CUU':'Leu','CUC':'Leu','CUA':'Leu','CUG':'Leu',
        'AUU':'Ile','AUC':'Ile','AUA':'Ile',
        'GUU':'Val','GUC':'Val','GUA':'Val','GUG':'Val',
        'UCU':'Ser','UCC':'Ser','UCA':'Ser','UCG':'Ser',
        'CCU':'Pro','CCC':'Pro','CCA':'Pro','CCG':'Pro',
        'ACU':'Thr','ACC':'Thr','ACA':'Thr','ACG':'Thr',
        'GCU':'Ala','GCC':'Ala','GCA':'Ala','GCG':'Ala',
        'UAU':'Tyr','UAC':'Tyr','CAU':'His','CAC':'His',
        'CAA':'Gln','CAG':'Gln','AAU':'Asn','AAC':'Asn',
        'AAA':'Lys','AAG':'Lys','GAU':'Asp','GAC':'Asp',
        'GAA':'Glu','GAG':'Glu','UGU':'Cys','UGC':'Cys',
        'UGG':'Trp','CGU':'Arg','CGC':'Arg','CGA':'Arg','CGG':'Arg',
        'AGU':'Ser','AGC':'Ser','AGA':'Arg','AGG':'Arg',
        'GGU':'Gly','GGC':'Gly','GGA':'Gly','GGG':'Gly',
        'UAA':'Stop','UAG':'Stop','UGA':'Stop'
    };

    const bCol = { A:'#4ade80', T:'#f87171', G:'#facc15', C:'#60a5fa', U:'#c084fc' };
    const modes = [
        { name:'碱基替换', desc:'第5位 A → G（本例为错义替换）', color:'#f59e0b' },
        { name:'插入突变', desc:'第5位后插入 C（本例为非 3 倍数插入）', color:'#ef4444' },
        { name:'缺失突变', desc:'缺失第5位 A（本例为非 3 倍数缺失）', color:'#8b5cf6' }
    ];
    let mutBases = [];

    /* ── helpers ── */
    function doMut() {
        const a = [...origBases];
        if (mode === 0) a[4] = 'G';
        else if (mode === 1) a.splice(5, 0, 'C');
        else a.splice(4, 1);
        mutBases = a;
    }
    function toRNA(b)   { return b.map(x => rna[x]); }
    function codons(mr) { const c=[]; for(let i=0;i+2<mr.length;i+=3) c.push(mr[i]+mr[i+1]+mr[i+2]); return c; }
    function aas(cs)    { return cs.map(c => aa[c] || '?'); }

    /* ── layout ── */
    function bLayout(bases, yC) {
        const mx = Math.max(origBases.length, 16);
        const bw = Math.min(38, (W - 90) / mx);
        const bh = bw * 0.82, gap = 3;
        const tw = bases.length * (bw + gap) - gap;
        const sx = (W - tw) / 2;
        return bases.map((b, i) => ({ x: sx + i * (bw + gap), y: yC - bh / 2, w: bw, h: bh, base: b, idx: i }));
    }

    /* ── draw primitives ── */
    function rr(x, y, w, h, r, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
        ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r);
        ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
        ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r);
        ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.stroke(); }
    }
    function hexRgb(h) { return `${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)}`; }

    function drawBox(bx, by, bw, bh, base, alpha, hl, hover) {
        const fs = Math.max(13, W * 0.012);
        const c = bCol[base] || '#aaa';
        ctx.globalAlpha = alpha;
        if (hl)    { ctx.shadowColor = modes[mode].color; ctx.shadowBlur = 12; }
        if (hover) { ctx.shadowColor = '#fff';            ctx.shadowBlur = 8; }
        rr(bx, by, bw, bh, 4,
           hl ? modes[mode].color + '40' : `rgba(${hexRgb(c)},0.15)`,
           hl ? modes[mode].color : c);
        ctx.shadowBlur = 0;
        ctx.font = 'bold ' + (fs + 5) + 'px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = c;
        ctx.fillText(base, bx + bw / 2, by + bh / 2);
        ctx.globalAlpha = 1;
    }

    function drawHB(top, bot, alpha) {
        ctx.globalAlpha = alpha * 0.4;
        ctx.setLineDash([3,3]); ctx.strokeStyle = 'rgba(200,200,200,0.5)'; ctx.lineWidth = 1;
        const len = Math.min(top.length, bot.length);
        for (let i = 0; i < len; i++) {
            ctx.beginPath();
            ctx.moveTo(top[i].x + top[i].w/2, top[i].y + top[i].h + 2);
            ctx.lineTo(bot[i].x + bot[i].w/2, bot[i].y - 2);
            ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    function drawCB(boxes, yB, mrna, alpha) {
        if (!boxes.length) return;
        ctx.globalAlpha = alpha;
        const cs = codons(mrna), a2 = aas(cs);
        ctx.strokeStyle = 'rgba(200,200,200,0.3)'; ctx.lineWidth = 0.8;
        const fs = Math.max(16, boxes[0].w * 0.24);
        ctx.font = `${fs}px ${CF.sans}`; ctx.textAlign = 'center';
        for (let c = 0; c < cs.length; c++) {
            const si = c * 3;
            if (si + 2 >= boxes.length) break;
            const x1 = boxes[si].x, x2 = boxes[si+2].x + boxes[si+2].w, y = yB + 4;
            ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x1,y+6); ctx.lineTo(x2,y+6); ctx.lineTo(x2,y); ctx.stroke();
            ctx.fillStyle = 'rgba(192,132,252,0.7)';
            ctx.fillText(cs[c], (x1+x2)/2, y+16);
            ctx.fillStyle = a2[c]==='Stop' ? '#ef4444' : a2[c]==='Met' ? '#22c55e' : '#e2e8f0';
            ctx.fillText(a2[c], (x1+x2)/2, y+28);
        }
        ctx.globalAlpha = 1;
    }

    function drawLabel(t, x, y, c, a) {
        const fs = Math.max(13, W * 0.012);
        ctx.globalAlpha = a; ctx.font = fs + 'px ' + CF.sans;
        ctx.textAlign = 'right'; ctx.fillStyle = c || '#94a3b8';
        ctx.fillText(t, x - 8, y); ctx.globalAlpha = 1;
    }
    function drawFitText(text, x, y, maxSize, color, weight = '') {
        let size = maxSize;
        do {
            ctx.font = weight + size + 'px ' + CF.sans;
            if (ctx.measureText(text).width <= W - 24 || size <= 10) break;
            size -= 1;
        } while (size > 10);
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
    }
    function drawArrow(x1, y1, x2, y2, c, a) {
        ctx.globalAlpha = a; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.setLineDash([]);
        const ang = Math.atan2(y2-y1,x2-x1);
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x2,y2);
        ctx.lineTo(x2-8*Math.cos(ang-0.4),y2-8*Math.sin(ang-0.4));
        ctx.lineTo(x2-8*Math.cos(ang+0.4),y2-8*Math.sin(ang+0.4));
        ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }

    /* ── highlight indices ── */
    function hlIdx(isOrig) {
        if (!mutated) return [];
        if (isOrig) return [4];
        if (mode === 0) return [4];
        if (mode === 1) return Array.from({length: mutBases.length - 5}, (_,i) => i+5);
        return Array.from({length: mutBases.length - 4}, (_,i) => i+4);
    }

    /* ── draw strand pair ── */
    function drawStrand(bases, yT, label, lCol, isOrig, alpha) {
        const bx = bLayout(bases, yT);
        const cb = bases.map(b => comp[b]);
        const cY = yT + bx[0].h + 14;
        const cbx = bLayout(cb, cY);
        const hl = hlIdx(isOrig);
        drawLabel(label+" 3'→5'", bx[0].x, yT+3, lCol, alpha);
        bx.forEach(b => drawBox(b.x,b.y,b.w,b.h,b.base,alpha,hl.includes(b.idx),
            hoverBase&&hoverBase.strand===(isOrig?'orig':'mut')&&hoverBase.idx===b.idx));
        drawLabel("编码链 5'→3'", cbx[0].x, cY+3, '#64748b', alpha*0.7);
        cbx.forEach(b => drawBox(b.x,b.y,b.w,b.h,b.base,alpha*0.7,false,false));
        drawHB(bx, cbx, alpha*0.5);
        return { bx, cbx, bot: cbx[0].y + cbx[0].h };
    }

    /* ── main draw ── */
    function draw(now) {
        const dt = Math.min((now - lastT)/1000, 0.1) * speed;
        lastT = now;
        if (!paused && mutated) progress = Math.min(1, progress + dt * 0.8);
        ctx.clearRect(0, 0, W, H);
        const fs = Math.max(13, W * 0.012);
        const m = modes[mode];
        ctx.font = 'bold ' + (fs + 8) + 'px ' + CF.sans;
        ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(58,158,143,0.9)';
        ctx.fillText('基因突变 — '+m.name, W/2, 22);

        const oY = mutated ? H*0.14 : H*0.28;
        const mY = H*0.52;
        const oA = mutated ? Math.max(0.5, 1-progress*0.3) : 1;
        const o = drawStrand(origBases, oY, '模板链', '#94a3b8', true, oA);
        if (!mutated) drawCB(o.bx, o.bot, toRNA(origBases), 0.8);

        if (mutated && progress > 0.05) {
            const mA = Math.min(1, (progress-0.05)/0.6);
            drawArrow(W/2, o.bot+6, W/2, mY-o.bx[0].h/2-8, m.color, mA*0.6);
            const mt = drawStrand(mutBases, mY, '突变链', m.color, false, mA);
            if (progress > 0.35) {
                const ca = Math.min(1, (progress-0.35)/0.4);
                drawCB(o.bx, o.bot, toRNA(origBases), ca*0.5);
                drawCB(mt.bx, mt.bot, toRNA(mutBases), ca*0.8);
            }
            if ((mode===1||mode===2)&&progress>0.55) {
                ctx.globalAlpha = Math.min(1,(progress-0.55)/0.3);
                const warning = W < 520 ? '移码：后续密码子分组改变' : '本例移码：突变位点后密码子分组改变，后续氨基酸序列随之改写';
                drawFitText(warning, W/2, H-34, fs + 3, '#fbbf24', 'bold ');
                ctx.globalAlpha = 1;
            }
            if (progress > 0.25) {
                ctx.globalAlpha = Math.min(1,(progress-0.25)/0.3);
                drawFitText(m.desc, W/2, H-12, fs, m.color);
                ctx.globalAlpha = 1;
            }
        }
        if (!mutated) {
            ctx.font = fs + 'px ' + CF.sans; ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(200,200,200,0.4)';
            ctx.fillText('点击“触发突变”比较读码框与氨基酸序列', W/2, H-12);
        }
        if (hoverBase) drawTip();
    }

    /* ── tooltip ── */
    function drawTip() {
        const hb = hoverBase;
        const bases = hb.strand==='orig' ? origBases : mutBases;
        if (hb.idx >= bases.length) return;
        const b = bases[hb.idx], mr = toRNA(bases);
        const ci = Math.floor(hb.idx/3);
        const cdn = ci*3+2 < mr.length ? mr[ci*3]+mr[ci*3+1]+mr[ci*3+2] : '—';
        const aaStr = aa[cdn] || '—';
        const lbl = hb.strand==='orig' ? '原始' : '突变后';
        const t = `${lbl} #${hb.idx+1} | 碱基: ${b} | mRNA密码子: ${cdn} | 氨基酸: ${aaStr}`;
        const fs = Math.max(13, W * 0.012);
        ctx.font = fs + 'px ' + CF.sans;
        const tw = ctx.measureText(t).width+16, th = 22;
        let tx = hb.px-tw/2, ty = hb.py-th-10;
        if (tx<4) tx=4; if (tx+tw>W-4) tx=W-4-tw; if (ty<4) ty=hb.py+14;
        rr(tx,ty,tw,th,4,'rgba(15,23,42,0.92)','rgba(100,116,139,0.5)');
        ctx.fillStyle='#e2e8f0'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(t, tx+tw/2, ty+th/2);
    }

    /* ── hit test ── */
    function hitTest(mx, my) {
        const oY = mutated ? H*0.14 : H*0.28;
        for (const b of bLayout(origBases, oY))
            if (mx>=b.x && mx<=b.x+b.w && my>=b.y && my<=b.y+b.h)
                return {strand:'orig',idx:b.idx,px:mx,py:my};
        if (mutated && mutBases.length)
            for (const b of bLayout(mutBases, H*0.52))
                if (mx>=b.x && mx<=b.x+b.w && my>=b.y && my<=b.y+b.h)
                    return {strand:'mut',idx:b.idx,px:mx,py:my};
        return null;
    }

    /* ── education panel ── */
    function updInfo() {
        if (!infoEl) return;
        const m = modes[mode];
        const oMR = toRNA(origBases), oC = codons(oMR), oA = aas(oC);
        let h = '<div class="gmut-info__hd">基因突变、点突变与移码</div>';
        h += '<div class="gmut-info__grid">';
        h += `<div class="gmut-info__block">
            <div class="gmut-info__sub">${m.name}</div>
            <div class="gmut-info__val" style="color:${m.color}">${m.desc}</div>
            <div class="gmut-info__desc">${mode===0?'单个核苷酸被另一个替换，读码框保持不变；结果可能是同义、错义或无义。':
            mode===1?'本例插入 1 个碱基，后续密码子重新分组；插入数若为 3 的倍数，通常不会造成移码。':
            '本例缺失 1 个碱基，后续密码子重新分组；缺失数若为 3 的倍数，通常不会造成移码。'}</div></div>`;
        h += `<div class="gmut-info__block"><div class="gmut-info__sub">原始氨基酸序列</div>
            <p class="gmut-aa-seq">${oA.map(a=>`<span class="${a==='Stop'?'gmut-stop':a==='Met'?'gmut-start':''}">${a}</span>`).join(' → ')}</p>
            <div class="gmut-info__desc">示例使用一个短编码片段，展示每 3 个 mRNA 碱基构成 1 个密码子的判读方式。</div></div>`;
        if (mutated) {
            const mMR = toRNA(mutBases), mC = codons(mMR), mA = aas(mC);
            h += `<div class="gmut-info__block"><div class="gmut-info__sub">突变后氨基酸序列</div>
                <p class="gmut-aa-seq">${mA.map((a,i)=>{
                const ch=i>=oA.length||a!==oA[i];
                return `<span class="${a==='Stop'?'gmut-stop':a==='Met'?'gmut-start':''} ${ch?'gmut-changed':''}">${a}</span>`;
            }).join(' → ')}</p></div>`;
            const chg = mA.filter((a,i)=>i>=oA.length||a!==oA[i]).length;
            h += `<div class="gmut-info__block gmut-summary">
                <div class="gmut-info__sub">突变总结</div>
                <div class="gmut-info__val">共 ${mA.length} 个密码子，<strong>${chg}</strong> 个氨基酸改变</div>
                <div class="gmut-info__desc">${mode===0?'本例为错义突变：一个密码子对应的氨基酸发生改变，但阅读框没有移动。':'本例为移码突变：非 3 倍数插入或缺失改变后续读码框，可能提前遇到终止密码子或改变蛋白质功能。'}</div></div>`;
        }
        h += `<div class="gmut-info__block"><div class="gmut-info__sub">结果判读</div>
            <table class="gmut-table"><tr><th>类型</th><th>机制</th><th>影响</th></tr>
            <tr><td>同义/沉默</td><td>密码子改变但氨基酸不变</td><td>蛋白序列不变，但仍可能影响表达或剪接等过程</td></tr>
            <tr><td>错义</td><td>密码子改为另一种氨基酸</td><td>可能无明显影响，也可能改变蛋白结构或功能</td></tr>
            <tr><td>无义</td><td>密码子变成终止密码子</td><td>常产生较短、可能无功能的蛋白</td></tr>
            <tr><td>移码</td><td>非 3 倍数插入或缺失</td><td>突变位点后的密码子分组整体改变</td></tr>
            </table></div>
            <div class="gmut-info__block">
                <div class="gmut-info__sub">模型边界</div>
                <div class="gmut-info__note">画布只演示编码片段中的替换、插入和缺失如何影响 mRNA 密码子；未模拟 DNA 修复、非编码区变异、剪接、表达调控、染色体大片段变异或表型与环境的关系。</div>
            </div></div>
            <div class="gmut-info__source">资料依据：NHGRI Talking Glossary 的 Mutation、Point Mutation、Substitution、Missense Mutation、Nonsense Mutation 与 Frameshift Mutation 条目。</div>`;
        infoEl.innerHTML = h;
    }

    /* ── events ── */
    function onMove(e) {
        const r = cvs.getBoundingClientRect();
        hoverBase = hitTest(e.clientX-r.left, e.clientY-r.top);
        cvs.style.cursor = hoverBase ? 'pointer' : 'default';
    }
    function onLeave() { hoverBase = null; cvs.style.cursor = 'default'; }
    function loop(now) { draw(now); animId = requestAnimationFrame(loop); }

    /* ── resize ── */
    function resize() {
        const p = cvs.parentElement; if (!p) return;
        dpr = window.devicePixelRatio || 1;
        W = p.clientWidth;
        H = Math.min(Math.max(W * 0.48, 300), 460);
        cvs.width = W * dpr; cvs.height = H * dpr;
        cvs.style.width = W+'px'; cvs.style.height = H+'px';
        ctx.setTransform(dpr,0,0,dpr,0,0);
    }

    /* ── API ── */
    function init() {
        cvs = document.getElementById('gene-mutation-canvas');
        if (!cvs) return;
        ctx = cvs.getContext('2d');
        infoEl = document.getElementById('gmut-info');
        const ctrl = document.getElementById('gene-mutation-controls');
        if (ctrl) ctrl.querySelectorAll('.gmut-btn[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('active')) return;
                mode = parseInt(btn.dataset.mode);
                ctrl.querySelectorAll('.gmut-btn[data-mode]').forEach(b => {
                    b.classList.toggle('active', b===btn);
                    b.setAttribute('aria-pressed', b===btn?'true':'false');
                });
                rst();
            });
        });
        const tBtn = document.getElementById('gmut-trigger');
        if (tBtn) tBtn.addEventListener('click', () => {
            if (mutated) return; doMut(); mutated=true; progress=0; updInfo();
        });
        const rBtn = document.getElementById('gmut-reset');
        if (rBtn) rBtn.addEventListener('click', rst);
        const spd = document.getElementById('gmut-speed');
        if (spd) spd.addEventListener('input', e => { speed = parseFloat(e.target.value); });
        const pBtn = document.getElementById('gmut-pause');
        if (pBtn) pBtn.addEventListener('click', () => {
            paused=!paused; pBtn.textContent=paused?'▶':'⏸';
            pBtn.setAttribute('aria-label', paused?'继续':'暂停');
            pBtn.setAttribute('aria-pressed', String(paused));
        });
        cvs.setAttribute('role', 'img');
        cvs.setAttribute('aria-label', '基因突变可视化：比较碱基替换、插入和缺失对读码框与氨基酸序列的影响');
        cvs.addEventListener('mousemove', onMove);
        cvs.addEventListener('mouseleave', onLeave);
        ro = new ResizeObserver(() => resize());
        ro.observe(cvs.parentElement);
        resize(); rst();
        lastT = performance.now(); loop(lastT);
    }
    function rst() { mutated=false; progress=0; mutBases=[]; hoverBase=null; updInfo(); }
    function destroy() {
        if (animId) { cancelAnimationFrame(animId); animId=null; }
        if (ro) { ro.disconnect(); ro=null; }
        if (cvs) { cvs.removeEventListener('mousemove',onMove); cvs.removeEventListener('mouseleave',onLeave); }
        paused=false; speed=1; mode=0; mutated=false; progress=0; mutBases=[]; hoverBase=null;
    }
    return { init, destroy };
})();

function initGeneMutation() { GeneMutation.init(); }
window.GeneMutation = GeneMutation;
window.initGeneMutation = initGeneMutation;
