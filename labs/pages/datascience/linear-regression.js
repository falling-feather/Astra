// ===== Data Science & AI: Linear Regression Lab =====

(function () {
    const DATASETS = {
        study: {
            label: '学习时长',
            xLabel: '学习时长 h',
            yLabel: '测验分数',
            points: [[1, 44], [2, 50], [3, 58], [4, 63], [5, 72], [6, 78], [7, 82], [8, 90]]
        },
        climate: {
            label: '温度销量',
            xLabel: '正午温度 °C',
            yLabel: '冷饮销量',
            points: [[18, 42], [20, 50], [22, 63], [24, 72], [26, 83], [28, 92], [30, 104], [32, 117]]
        },
        outlier: {
            label: '含异常点',
            xLabel: '投入量',
            yLabel: '产出',
            points: [[1, 22], [2, 28], [3, 33], [4, 39], [5, 44], [6, 51], [7, 98], [8, 59]]
        }
    };

    const LinearRegressionLab = {
        canvas: null,
        ctx: null,
        slopeInput: null,
        interceptInput: null,
        rateInput: null,
        slopeValue: null,
        interceptValue: null,
        rateValue: null,
        infoRoot: null,
        presetButtons: [],
        dpr: 1,
        datasetId: 'study',
        state: {
            slope: 6,
            intercept: 38,
            rate: 0.15,
            steps: 0
        },

        init() {
            this.canvas = document.getElementById('linear-regression-canvas');
            if (!this.canvas) return;
            this.ctx = typeof this.canvas.getContext === 'function'
                ? this.canvas.getContext('2d')
                : null;
            this.slopeInput = document.getElementById('regression-slope');
            this.interceptInput = document.getElementById('regression-intercept');
            this.rateInput = document.getElementById('regression-rate');
            this.slopeValue = document.getElementById('regression-slope-value');
            this.interceptValue = document.getElementById('regression-intercept-value');
            this.rateValue = document.getElementById('regression-rate-value');
            this.infoRoot = document.getElementById('regression-info');
            this.presetButtons = Array.from(document.querySelectorAll('[data-regression-dataset]'));

            this._bindInputs();
            window.addEventListener('resize', this._boundResize || (this._boundResize = () => this.render()));
            this.render();
        },

        destroy() {
            if (this._boundResize) window.removeEventListener('resize', this._boundResize);
        },

        render() {
            this._syncControls();
            const model = this._calculate();
            if (this.canvas && this.ctx) {
                this._resizeCanvas();
                this._draw(model);
            }
            this._updateInfo(model);
        },

        _bindInputs() {
            if (this.slopeInput && !this.slopeInput.dataset.bound) {
                this.slopeInput.dataset.bound = 'true';
                this.slopeInput.addEventListener('input', () => {
                    this.state.slope = Number(this.slopeInput.value) || 0;
                    this.render();
                });
            }
            if (this.interceptInput && !this.interceptInput.dataset.bound) {
                this.interceptInput.dataset.bound = 'true';
                this.interceptInput.addEventListener('input', () => {
                    this.state.intercept = Number(this.interceptInput.value) || 0;
                    this.render();
                });
            }
            if (this.rateInput && !this.rateInput.dataset.bound) {
                this.rateInput.dataset.bound = 'true';
                this.rateInput.addEventListener('input', () => {
                    this.state.rate = Number(this.rateInput.value) || 0.1;
                    this.render();
                });
            }

            this.presetButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.datasetId = button.dataset.regressionDataset || 'study';
                    this._resetModel();
                    this.render();
                });
            });

            const fitButton = document.getElementById('regression-fit');
            if (fitButton && !fitButton.dataset.bound) {
                fitButton.dataset.bound = 'true';
                fitButton.addEventListener('click', () => {
                    const fit = this._leastSquares(DATASETS[this.datasetId].points);
                    this.state.slope = fit.slope;
                    this.state.intercept = fit.intercept;
                    this.state.steps = 0;
                    this.render();
                });
            }

            const stepButton = document.getElementById('regression-step');
            if (stepButton && !stepButton.dataset.bound) {
                stepButton.dataset.bound = 'true';
                stepButton.addEventListener('click', () => {
                    this._gradientStep();
                    this.render();
                });
            }

            const resetButton = document.getElementById('regression-reset');
            if (resetButton && !resetButton.dataset.bound) {
                resetButton.dataset.bound = 'true';
                resetButton.addEventListener('click', () => {
                    this._resetModel();
                    this.render();
                });
            }
        },

        _calculate() {
            const dataset = DATASETS[this.datasetId];
            const points = dataset.points;
            const fit = this._leastSquares(points);
            const current = this._metrics(points, this.state.slope, this.state.intercept);
            const best = this._metrics(points, fit.slope, fit.intercept);
            const gradient = this._gradient(points, this.state.slope, this.state.intercept);
            return { dataset, points, fit, current, best, gradient };
        },

        _draw(model) {
            const ctx = this.ctx;
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            ctx.clearRect(0, 0, w, h);

            const plot = { x: 54, y: 48, w: Math.max(240, w * 0.62), h: Math.max(250, h * 0.68) };
            if (w < 720) {
                plot.x = 38;
                plot.y = 44;
                plot.w = w - 76;
                plot.h = h * 0.58;
            }
            const lossBox = w < 720
                ? { x: 38, y: plot.y + plot.h + 44, w: w - 76, h: Math.max(92, h * 0.2) }
                : { x: plot.x + plot.w + 42, y: plot.y, w: w - plot.x - plot.w - 76, h: plot.h };
            const bounds = this._bounds(model.points, model.fit);
            const toScreen = point => ({
                x: plot.x + ((point[0] - bounds.minX) / (bounds.maxX - bounds.minX)) * plot.w,
                y: plot.y + plot.h - ((point[1] - bounds.minY) / (bounds.maxY - bounds.minY)) * plot.h
            });
            const yFromModel = (x, slope, intercept) => slope * x + intercept;

            this._drawPlotFrame(ctx, plot, model.dataset);
            this._drawRegressionLine(ctx, plot, bounds, model.fit.slope, model.fit.intercept, 'rgba(67,214,176,0.86)', toScreen, yFromModel);
            this._drawRegressionLine(ctx, plot, bounds, this.state.slope, this.state.intercept, 'rgba(138,167,255,0.92)', toScreen, yFromModel);

            model.points.forEach(point => {
                const predicted = yFromModel(point[0], this.state.slope, this.state.intercept);
                const a = toScreen(point);
                const b = toScreen([point[0], predicted]);
                ctx.strokeStyle = 'rgba(242,200,107,0.38)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            });

            model.points.forEach(point => {
                const p = toScreen(point);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(216,220,230,0.88)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(8,9,14,0.8)';
                ctx.lineWidth = 2;
                ctx.stroke();
            });

            this._drawLossBox(ctx, lossBox, model);
            this._drawLegend(ctx, plot);
        },

        _drawPlotFrame(ctx, plot, dataset) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
            ctx.fillStyle = 'rgba(255,255,255,0.035)';
            ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
            for (let i = 1; i < 5; i += 1) {
                const x = plot.x + (i / 5) * plot.w;
                const y = plot.y + (i / 5) * plot.h;
                ctx.strokeStyle = 'rgba(255,255,255,0.055)';
                ctx.beginPath();
                ctx.moveTo(x, plot.y);
                ctx.lineTo(x, plot.y + plot.h);
                ctx.moveTo(plot.x, y);
                ctx.lineTo(plot.x + plot.w, y);
                ctx.stroke();
            }
            ctx.fillStyle = 'rgba(216,220,230,0.76)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText(dataset.xLabel, plot.x, plot.y + plot.h + 24);
            ctx.save();
            ctx.translate(plot.x - 30, plot.y + plot.h);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(dataset.yLabel, 0, 0);
            ctx.restore();
            ctx.restore();
        },

        _drawRegressionLine(ctx, plot, bounds, slope, intercept, color, toScreen, yFromModel) {
            const left = [bounds.minX, yFromModel(bounds.minX, slope, intercept)];
            const right = [bounds.maxX, yFromModel(bounds.maxX, slope, intercept)];
            const a = toScreen(left);
            const b = toScreen(right);
            ctx.save();
            ctx.beginPath();
            ctx.rect(plot.x, plot.y, plot.w, plot.h);
            ctx.clip();
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.restore();
        },

        _drawLossBox(ctx, box, model) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.fillStyle = 'rgba(255,255,255,0.035)';
            ctx.lineWidth = 1;
            ctx.strokeRect(box.x, box.y, box.w, box.h);
            ctx.fillRect(box.x, box.y, box.w, box.h);

            const slopeSpan = 9;
            const samples = [];
            for (let i = 0; i <= 80; i += 1) {
                const slope = model.fit.slope - slopeSpan / 2 + (i / 80) * slopeSpan;
                samples.push({
                    slope,
                    loss: this._metrics(model.points, slope, model.fit.intercept).mse
                });
            }
            const maxLoss = Math.max(...samples.map(item => item.loss));
            const minLoss = Math.min(...samples.map(item => item.loss));
            ctx.beginPath();
            samples.forEach((item, index) => {
                const x = box.x + (index / 80) * box.w;
                const y = box.y + box.h - 24 - ((item.loss - minLoss) / Math.max(1, maxLoss - minLoss)) * (box.h - 54);
                if (index === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = 'rgba(67,214,176,0.68)';
            ctx.lineWidth = 2;
            ctx.stroke();

            const slopeRatio = (this.state.slope - (model.fit.slope - slopeSpan / 2)) / slopeSpan;
            const markerX = box.x + Math.max(0, Math.min(1, slopeRatio)) * box.w;
            ctx.strokeStyle = 'rgba(138,167,255,0.88)';
            ctx.beginPath();
            ctx.moveTo(markerX, box.y + 20);
            ctx.lineTo(markerX, box.y + box.h - 18);
            ctx.stroke();

            ctx.fillStyle = 'rgba(216,220,230,0.8)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText('固定截距时的损失剖面', box.x + 14, box.y + 22);
            ctx.fillText(`MSE ${model.current.mse.toFixed(1)}`, box.x + 14, box.y + box.h - 16);
            ctx.restore();
        },

        _drawLegend(ctx, plot) {
            const items = [
                ['当前模型', 'rgba(138,167,255,0.92)'],
                ['最小二乘线', 'rgba(67,214,176,0.86)'],
                ['残差', 'rgba(242,200,107,0.5)']
            ];
            ctx.save();
            ctx.font = `12px ${this._fontMono()}`;
            let x = plot.x + 12;
            const y = plot.y + 22;
            items.forEach(([label, color]) => {
                ctx.strokeStyle = color;
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(x, y - 4);
                ctx.lineTo(x + 28, y - 4);
                ctx.stroke();
                ctx.fillStyle = 'rgba(216,220,230,0.78)';
                ctx.fillText(label, x + 36, y);
                x += 116;
            });
            ctx.restore();
        },

        _updateInfo(model) {
            if (!this.infoRoot) return;
            const improvement = model.current.mse - model.best.mse;
            const guidance = this._datasetGuidance(model);
            const r2Copy = model.current.r2 < 0
                ? '当前线比只预测均值还差；先把斜率和截距拉回散点附近。'
                : 'R² 越接近 1，表示这组样本中由直线解释的变异比例越高。';
            this.infoRoot.innerHTML = `
                <div class="datascience-panel">
                    <span class="datascience-panel__label">当前模型</span>
                    <strong>ŷ = ${this.state.intercept.toFixed(1)} + ${this.state.slope.toFixed(2)}x</strong>
                    <p>x 是特征，ŷ 是预测标签；残差等于 y - ŷ，也就是每个点到蓝线的竖直差。</p>
                </div>
                <div class="datascience-panel">
                    <span class="datascience-panel__label">损失与解释度</span>
                    <strong>MSE ${model.current.mse.toFixed(1)} · RMSE ${model.current.rmse.toFixed(1)}</strong>
                    <p>平方损失会放大大误差；${r2Copy}</p>
                </div>
                <div class="datascience-panel">
                    <span class="datascience-panel__label">最小二乘线</span>
                    <strong>ŷ = ${model.fit.intercept.toFixed(1)} + ${model.fit.slope.toFixed(2)}x</strong>
                    <p>绿线使残差平方和最小；当前模型还高出 ${Math.max(0, improvement).toFixed(1)} 的平均平方损失。</p>
                </div>
                <div class="datascience-panel">
                    <span class="datascience-panel__label">读图边界</span>
                    <strong>${guidance.title}</strong>
                    <p>${guidance.copy}</p>
                </div>
            `;
        },

        _leastSquares(points) {
            const n = points.length;
            const meanX = points.reduce((sum, item) => sum + item[0], 0) / n;
            const meanY = points.reduce((sum, item) => sum + item[1], 0) / n;
            const numerator = points.reduce((sum, item) => sum + (item[0] - meanX) * (item[1] - meanY), 0);
            const denominator = points.reduce((sum, item) => sum + Math.pow(item[0] - meanX, 2), 0) || 1;
            const slope = numerator / denominator;
            const intercept = meanY - slope * meanX;
            return { slope, intercept };
        },

        _metrics(points, slope, intercept) {
            const predictions = points.map(point => slope * point[0] + intercept);
            const residuals = points.map((point, index) => point[1] - predictions[index]);
            const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
            const sse = residuals.reduce((sum, residual) => sum + Math.pow(residual, 2), 0);
            const sst = points.reduce((sum, point) => sum + Math.pow(point[1] - meanY, 2), 0) || 1;
            const mse = sse / points.length;
            return {
                sse,
                mse,
                rmse: Math.sqrt(mse),
                mae: residuals.reduce((sum, residual) => sum + Math.abs(residual), 0) / points.length,
                maxAbsResidual: Math.max(...residuals.map(residual => Math.abs(residual))),
                r2: 1 - sse / sst
            };
        },

        _datasetGuidance(model) {
            if (this.datasetId === 'outlier') {
                return {
                    title: '异常点会拉动直线',
                    copy: '这组数据故意放入一个远离趋势的点；MSE 会重罚大残差，所以最小二乘线会被明显拉向它。'
                };
            }
            if (this.datasetId === 'climate') {
                return {
                    title: '相关不等于因果',
                    copy: '温度和销量的线性趋势只说明样本内有关联；价格、节假日和促销等变量也可能影响销量。'
                };
            }
            return {
                title: '先看样本范围',
                copy: `当前最大残差约 ${model.current.maxAbsResidual.toFixed(1)}。在样本 x 范围内读趋势更稳妥，向外预测需要额外证据。`
            };
        },

        _gradient(points, slope, intercept) {
            const n = points.length;
            const meanX = points.reduce((sum, point) => sum + point[0], 0) / n;
            const spread = Math.max(1, Math.sqrt(points.reduce((sum, point) => sum + Math.pow(point[0] - meanX, 2), 0) / n));
            let gradSlope = 0;
            let gradIntercept = 0;
            points.forEach(point => {
                const xNorm = (point[0] - meanX) / spread;
                const y = point[1];
                const yHat = slope * point[0] + intercept;
                const err = yHat - y;
                gradSlope += 2 * err * xNorm / n;
                gradIntercept += 2 * err / n;
            });
            return { gradSlope, gradIntercept, spread };
        },

        _gradientStep() {
            const points = DATASETS[this.datasetId].points;
            const gradient = this._gradient(points, this.state.slope, this.state.intercept);
            this.state.slope -= this.state.rate * gradient.gradSlope / gradient.spread;
            this.state.intercept -= this.state.rate * gradient.gradIntercept;
            this.state.steps += 1;
        },

        _bounds(points, fit) {
            const xs = points.map(point => point[0]);
            const ys = points.flatMap(point => [point[1], fit.slope * point[0] + fit.intercept, this.state.slope * point[0] + this.state.intercept]);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const padX = Math.max(1, (maxX - minX) * 0.1);
            const padY = Math.max(8, (maxY - minY) * 0.12);
            return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
        },

        _syncControls() {
            if (this.slopeInput) this.slopeInput.value = String(this.state.slope);
            if (this.interceptInput) this.interceptInput.value = String(this.state.intercept);
            if (this.rateInput) this.rateInput.value = String(this.state.rate);
            if (this.slopeValue) this.slopeValue.textContent = this.state.slope.toFixed(2);
            if (this.interceptValue) this.interceptValue.textContent = this.state.intercept.toFixed(1);
            if (this.rateValue) this.rateValue.textContent = this.state.rate.toFixed(2);
            this.presetButtons.forEach(button => {
                const active = button.dataset.regressionDataset === this.datasetId;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        },

        _resetModel() {
            const fit = this._leastSquares(DATASETS[this.datasetId].points);
            this.state.slope = fit.slope * 0.45;
            this.state.intercept = fit.intercept + 18;
            this.state.steps = 0;
        },

        _resizeCanvas() {
            const rect = this.canvas.getBoundingClientRect();
            const w = Math.max(320, rect.width || this.canvas.offsetWidth || 640);
            const h = Math.max(360, rect.height || this.canvas.offsetHeight || 540);
            this.dpr = window.devicePixelRatio || 1;
            const targetW = Math.round(w * this.dpr);
            const targetH = Math.round(h * this.dpr);
            if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
                this.canvas.width = targetW;
                this.canvas.height = targetH;
                this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            }
        },

        _fontMono() {
            if (window.CF && CF.mono) return CF.mono;
            return 'JetBrains Mono, Consolas, monospace';
        }
    };

    function initLinearRegressionLab() {
        LinearRegressionLab.init();
    }

    function destroyLinearRegressionLab() {
        LinearRegressionLab.destroy();
    }

    window.LinearRegressionLab = LinearRegressionLab;
    window.initLinearRegressionLab = initLinearRegressionLab;
    window.destroyLinearRegressionLab = destroyLinearRegressionLab;
})();
