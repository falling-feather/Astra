// ===== 算法页面逻辑 =====

// ===== 桶排序 =====
let sortArray = [], isSorting = false;
let sortSpeed = 500; // 全局变量，供main.js使用
let sortEpoch = 0;
const sortTimeouts = new Map();

// 确保sortSpeed是全局的
window.sortSpeed = sortSpeed;

function isCurrentSort(epoch) {
    return epoch === sortEpoch;
}

function sleep(ms, epoch) {
    return new Promise((resolve) => {
        if (!isCurrentSort(epoch)) { resolve(false); return; }
        const timer = setTimeout(() => {
            sortTimeouts.delete(timer);
            resolve(isCurrentSort(epoch));
        }, ms);
        sortTimeouts.set(timer, () => resolve(false));
    });
}

function scheduleSortTask(callback, ms, epoch) {
    if (!isCurrentSort(epoch)) return null;
    const timer = setTimeout(() => {
        sortTimeouts.delete(timer);
        if (isCurrentSort(epoch)) callback();
    }, ms);
    sortTimeouts.set(timer, null);
    return timer;
}

function cancelSortTasks() {
    sortTimeouts.forEach((cancel, timer) => {
        clearTimeout(timer);
        if (typeof cancel === 'function') cancel();
    });
    sortTimeouts.clear();
}

function setSortToolbarDisabled(disabled) {
    document.querySelectorAll('.sort-toolbar .btn').forEach(b => { b.disabled = disabled; });
}

function updateSortInfo(t) { 
    const el = document.getElementById('sort-info'); 
    if(el) el.textContent = t; 
}

function clearBuckets() { 
    const el = document.getElementById('buckets-container'); 
    if(el) el.innerHTML = ''; 
}

function generateRandomArray() {
    if(isSorting) return;
    cancelSortTasks();
    sortArray = Array.from({length:15}, () => Math.floor(Math.random()*100)+1);
    renderArray('original-array', sortArray);
    renderArray('sorted-array', []);
    clearBuckets();
    updateSortInfo('点击"开始排序"');
}

function renderArray(id, arr) {
    const c = document.getElementById(id);
    if(!c) return;
    c.innerHTML = '';
    const max = Math.max(...arr, 1);
    arr.forEach(v => {
        const b = document.createElement('div');
        b.className = 'array-bar';
        b.style.height = (v/max*180)+'px';
        b.textContent = v;
        c.appendChild(b);
    });
}

function renderBuckets(buckets) {
    const c = document.getElementById('buckets-container');
    if(!c) return;
    c.innerHTML = '';
    buckets.forEach((b, i) => {
        const el = document.createElement('div');
        el.className = 'bucket';
        el.innerHTML = `<div class="bucket-label">桶 ${i+1}</div><div class="bucket-items">${b.map((v,j)=>`<div class="bucket-item" style="animation-delay:${j*0.1}s">${v}</div>`).join('')}</div>`;
        c.appendChild(el);
    });
}

function highlightBar(id, idx, on) {
    const bars = document.querySelectorAll(`#${id} .array-bar`);
    if(bars[idx]) on ? bars[idx].classList.add('active') : bars[idx].classList.remove('active');
}

async function startBucketSort() {
    if (isSorting) return;
    cancelSortTasks();
    const generated = !sortArray.length;
    if (generated) generateRandomArray();
    const epoch = sortEpoch;
    if (!isCurrentSort(epoch)) return;
    isSorting = true;
    setSortToolbarDisabled(true);
    
    const arr = [...sortArray];
    const buckets = Array(10).fill(null).map(()=>[]);
    const max = Math.max(...arr);
    const currentSpeed = sortSpeed;

    try {
        if (generated && !await sleep(500, epoch)) return;
        updateSortInfo('步骤1: 分配到桶...');
        for(let i=0; i<arr.length; i++) {
            const v = arr[i];
            const bi = Math.floor((v/(max+1))*10);
            buckets[bi].push(v);
            highlightBar('original-array', i, true);
            if (!await sleep(currentSpeed, epoch)) return;
            renderBuckets(buckets);
            updateSortInfo(`将 ${v} 放入桶 ${bi+1}`);
            if (!await sleep(currentSpeed, epoch)) return;
            highlightBar('original-array', i, false);
        }

        updateSortInfo('步骤2: 桶内排序...');
        for(let i=0; i<buckets.length; i++) {
            if(buckets[i].length) {
                buckets[i].sort((a,b)=>a-b);
                renderBuckets(buckets);
                updateSortInfo(`桶 ${i+1} 排序完成`);
                if (!await sleep(currentSpeed, epoch)) return;
            }
        }

        updateSortInfo('步骤3: 合并...');
        const sorted = [];
        for(let b of buckets) {
            for(let v of b) {
                sorted.push(v);
                renderArray('sorted-array', sorted);
                if (!await sleep(currentSpeed/2, epoch)) return;
            }
        }
        updateSortInfo('完成！');
        updateSortEdu(arr.length, buckets);
        document.querySelectorAll('#sorted-array .array-bar').forEach((b,i) => {
            scheduleSortTask(() => b.classList.add('sorted'), i * 50, epoch);
        });
    } finally {
        if (isCurrentSort(epoch)) {
            isSorting = false;
            setSortToolbarDisabled(false);
        }
    }
}

function updateSortEdu(n, buckets) {
    let eduEl = document.getElementById('sort-edu');
    if (!eduEl) {
        const parent = document.getElementById('sort-info');
        if (!parent || !parent.parentElement) return;
        eduEl = document.createElement('div');
        eduEl.id = 'sort-edu';
        eduEl.style.cssText = 'font-size:12px;color:#c4793a;margin-top:8px;line-height:1.6;opacity:0.85;';
        parent.parentElement.appendChild(eduEl);
    }
    const k = buckets.filter(b => b.length > 0).length;
    const maxBucket = Math.max(...buckets.map(b => b.length));
    eduEl.innerHTML =
        `<strong>桶排序 (Bucket Sort)</strong>` +
        `<br>时间复杂度：平均 O(n + k)，最坏 O(n²)（所有元素落入同一个桶）` +
        `<br>空间复杂度：O(n + k)，k = 桶数` +
        `<br>本次：n=${n} 个元素 → ${k} 个非空桶，最大桶含 ${maxBucket} 个元素` +
        `<br>💡 桶排序适合数据均匀分布的场景。数据越均匀，桶内排序越快。`;
}

function resetBucketSort() {
    if(isSorting) return;
    cancelSortTasks();
    sortArray = [];
    renderArray('original-array', []); 
    renderArray('sorted-array', []); 
    clearBuckets();
    updateSortInfo('已重置');
}

// ===== 算法页面初始化 =====
function initAlgorithms() {
    destroyAlgorithms();
    const speedInput = document.getElementById('sort-speed');
    if (speedInput) {
        sortSpeed = parseInt(speedInput.value, 10) || 500;
        window.sortSpeed = sortSpeed;
    }
    setSortToolbarDisabled(false);
}

function destroyAlgorithms() {
    sortEpoch += 1;
    cancelSortTasks();
    isSorting = false;
    setSortToolbarDisabled(false);
    document.querySelectorAll('#original-array .array-bar.active').forEach(b => b.classList.remove('active'));
}

const SortingLab = {
    init: initAlgorithms,
    destroy: destroyAlgorithms
};

// 导出全局
window.generateRandomArray = generateRandomArray;
window.startBucketSort = startBucketSort;
window.resetBucketSort = resetBucketSort;
window.initAlgorithms = initAlgorithms;
window.SortingLab = SortingLab;

