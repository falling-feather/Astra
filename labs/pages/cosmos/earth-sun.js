// ===== Earth & Space Science: Seasons Lab =====

(function () {
    const DEG = Math.PI / 180;
    const TILT = 23.44;

    const CosmosSeasons = {
        canvas: null,
        ctx: null,
        dayInput: null,
        dayValue: null,
        latInput: null,
        latValue: null,
        hourInput: null,
        hourValue: null,
        latButtons: [],
        infoRoot: null,
        dpr: 1,
        rafId: 0,
        state: {
            day: 172,
            latitude: 39.9,
            hour: 12
        },

        init() {
            this.canvas = document.getElementById('earth-sun-canvas');
            if (!this.canvas) return;
            this.ctx = typeof this.canvas.getContext === 'function'
                ? this.canvas.getContext('2d')
                : null;
            this.dayInput = document.getElementById('cosmos-day');
            this.dayValue = document.getElementById('cosmos-day-value');
            this.latInput = document.getElementById('cosmos-latitude');
            this.latValue = document.getElementById('cosmos-latitude-value');
            this.hourInput = document.getElementById('cosmos-hour');
            this.hourValue = document.getElementById('cosmos-hour-value');
            this.latButtons = Array.from(document.querySelectorAll('[data-cosmos-lat]'));
            this.infoRoot = document.getElementById('cosmos-info');

            if (this.dayInput && !this.dayInput.dataset.bound) {
                this.dayInput.dataset.bound = 'true';
                this.dayInput.addEventListener('input', () => {
                    this.state.day = Number(this.dayInput.value) || 172;
                    this.render();
                });
            }

            if (this.latInput && !this.latInput.dataset.bound) {
                this.latInput.dataset.bound = 'true';
                this.latInput.addEventListener('input', () => {
                    this.state.latitude = Number(this.latInput.value) || 0;
                    this.render();
                });
            }

            if (this.hourInput && !this.hourInput.dataset.bound) {
                this.hourInput.dataset.bound = 'true';
                this.hourInput.addEventListener('input', () => {
                    this.state.hour = Number(this.hourInput.value) || 12;
                    this.render();
                });
            }

            this.latButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.state.latitude = Number(button.dataset.cosmosLat) || 0;
                    this.render();
                });
            });

            window.addEventListener('resize', this._boundResize || (this._boundResize = () => this.render()));
            this.render();
        },

        destroy() {
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
            if (this._boundResize) window.removeEventListener('resize', this._boundResize);
        },

        render() {
            if (this.dayInput) this.dayInput.value = String(this.state.day);
            if (this.latInput) this.latInput.value = String(this.state.latitude);
            if (this.hourInput) this.hourInput.value = String(this.state.hour);
            if (this.dayValue) this.dayValue.textContent = this._formatDate(this.state.day);
            if (this.latValue) this.latValue.textContent = this._formatLatitude(this.state.latitude);
            if (this.hourValue) this.hourValue.textContent = this._formatClock(this.state.hour);
            this.latButtons.forEach(button => {
                const active = Math.abs(Number(button.dataset.cosmosLat) - this.state.latitude) < 0.2;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            const data = this._calculate();
            if (this.canvas && this.ctx) {
                this._resizeCanvas();
                this._draw(data);
            }
            this._updateInfo(data);
        },

        _calculate() {
            const day = this.state.day;
            const lat = this.state.latitude;
            const declination = TILT * Math.sin((2 * Math.PI * (day - 80)) / 365);
            const noonAltitude = 90 - Math.abs(lat - declination);
            const phi = lat * DEG;
            const delta = declination * DEG;
            const cosH = -Math.tan(phi) * Math.tan(delta);
            let dayLength;
            if (cosH >= 1) dayLength = 0;
            else if (cosH <= -1) dayLength = 24;
            else dayLength = (2 * Math.acos(cosH) / (15 * DEG));
            const noonEnergy = Math.max(0, Math.sin(noonAltitude * DEG));
            const hourAngle = (this.state.hour - 12) * 15 * DEG;
            const currentAltitude = Math.asin(
                Math.sin(phi) * Math.sin(delta)
                + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle)
            ) / DEG;
            const shadowRatio = currentAltitude <= 0.5 ? null : 1 / Math.tan(currentAltitude * DEG);
            return {
                day,
                lat,
                declination,
                noonAltitude,
                dayLength,
                noonEnergy,
                hour: this.state.hour,
                currentAltitude,
                shadowRatio,
                season: this._seasonLabel(lat, declination)
            };
        },

        _draw(data) {
            const ctx = this.ctx;
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            ctx.clearRect(0, 0, w, h);

            const sun = { x: w * 0.18, y: h * 0.32, r: Math.max(34, Math.min(58, w * 0.07)) };
            const orbit = { cx: w * 0.57, cy: h * 0.35, rx: w * 0.27, ry: h * 0.16 };
            const angle = ((data.day - 80) / 365) * Math.PI * 2;
            const earth = {
                x: orbit.cx + Math.cos(angle) * orbit.rx,
                y: orbit.cy + Math.sin(angle) * orbit.ry,
                r: Math.max(34, Math.min(52, w * 0.06))
            };
            const chart = { x: w * 0.09, y: h * 0.72, w: w * 0.82, h: h * 0.16 };

            this._drawStars(ctx, w, h);
            this._drawSun(ctx, sun);
            this._drawOrbit(ctx, orbit, earth);
            this._drawEarth(ctx, earth, data);
            this._drawSolarChart(ctx, chart, data);
        },

        _updateInfo(data) {
            if (!this.infoRoot) return;
            const daylight = this._formatHours(data.dayLength);
            const shadow = data.shadowRatio === null ? '太阳在地平线下或接近地平线' : `${data.shadowRatio.toFixed(2)} 倍物高`;
            this.infoRoot.innerHTML = `
                <div class="cosmos-panel">
                    <span class="cosmos-panel__label">太阳赤纬</span>
                    <strong>${this._signed(data.declination)}°</strong>
                    <p>赤纬表示太阳直射点相对赤道的纬度；它在南北回归线之间随日期移动。</p>
                </div>
                <div class="cosmos-panel">
                    <span class="cosmos-panel__label">正午太阳高度</span>
                    <strong>${data.noonAltitude.toFixed(1)}°</strong>
                    <p>高度越大，单位面积接收的阳光越集中；这里用 sin(h) 表示相对强弱。</p>
                </div>
                <div class="cosmos-panel">
                    <span class="cosmos-panel__label">理论昼长</span>
                    <strong>${daylight}</strong>
                    <p>由纬度和太阳赤纬估算；实测日出日落还会受大气折射、地形和天气影响。</p>
                </div>
                <div class="cosmos-panel">
                    <span class="cosmos-panel__label">${this._formatClock(data.hour)} 太阳高度</span>
                    <strong>${data.currentAltitude.toFixed(1)}°</strong>
                    <p>同一地点把观察时刻从上午移到下午，太阳高度和影长会改变；当前估计影长为 ${shadow}。</p>
                </div>
                <div class="cosmos-panel">
                    <span class="cosmos-panel__label">季节判断</span>
                    <strong>${data.season}</strong>
                    <p>季节主要由地轴倾角改变直射纬度引起，不是因为北半球夏季离太阳更近。</p>
                </div>
            `;
        },

        _drawStars(ctx, w, h) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            for (let i = 0; i < 46; i += 1) {
                const x = (Math.sin(i * 71.3) * 0.5 + 0.5) * w;
                const y = (Math.cos(i * 47.7) * 0.5 + 0.5) * h * 0.9;
                const r = 0.7 + (i % 4) * 0.22;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        },

        _drawSun(ctx, sun) {
            const glow = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.18, sun.x, sun.y, sun.r * 2.3);
            glow.addColorStop(0, 'rgba(242,200,107,0.74)');
            glow.addColorStop(0.45, 'rgba(242,200,107,0.12)');
            glow.addColorStop(1, 'rgba(242,200,107,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(sun.x, sun.y, sun.r * 2.3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#f2c86b';
            ctx.beginPath();
            ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(242,200,107,0.32)';
            ctx.lineWidth = 1;
            for (let i = -2; i <= 2; i += 1) {
                ctx.beginPath();
                ctx.moveTo(sun.x + sun.r * 1.4, sun.y + i * 24);
                ctx.lineTo(sun.x + sun.r * 6.2, sun.y + i * 16);
                ctx.stroke();
            }
        },

        _drawOrbit(ctx, orbit, earth) {
            ctx.save();
            ctx.strokeStyle = 'rgba(116,185,255,0.18)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.ellipse(orbit.cx, orbit.cy, orbit.rx, orbit.ry, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(116,185,255,0.18)';
            ctx.beginPath();
            ctx.arc(earth.x, earth.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        _drawEarth(ctx, earth, data) {
            ctx.save();
            const gradient = ctx.createRadialGradient(earth.x - earth.r * 0.35, earth.y - earth.r * 0.35, earth.r * 0.2, earth.x, earth.y, earth.r);
            gradient.addColorStop(0, '#8dd7ff');
            gradient.addColorStop(0.58, '#2f89c5');
            gradient.addColorStop(1, '#14345c');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(earth.x, earth.y, earth.r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = 'rgba(63,196,151,0.5)';
            [
                [-0.26, -0.12, 0.22, 0.1],
                [0.18, 0.08, 0.26, 0.12],
                [-0.1, 0.26, 0.18, 0.08]
            ].forEach(([x, y, rx, ry]) => {
                ctx.beginPath();
                ctx.ellipse(earth.x + earth.r * x, earth.y + earth.r * y, earth.r * rx, earth.r * ry, 0.4, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.save();
            ctx.beginPath();
            ctx.arc(earth.x, earth.y, earth.r, 0, Math.PI * 2);
            ctx.clip();
            const shade = ctx.createLinearGradient(earth.x - earth.r, earth.y, earth.x + earth.r, earth.y);
            shade.addColorStop(0, 'rgba(0,0,0,0)');
            shade.addColorStop(0.56, 'rgba(0,0,0,0.1)');
            shade.addColorStop(1, 'rgba(0,0,0,0.58)');
            ctx.fillStyle = shade;
            ctx.fillRect(earth.x - earth.r, earth.y - earth.r, earth.r * 2, earth.r * 2);
            ctx.restore();

            const axis = TILT * DEG;
            const axisLen = earth.r * 1.42;
            ctx.strokeStyle = 'rgba(216,220,230,0.74)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(earth.x - Math.sin(axis) * axisLen, earth.y + Math.cos(axis) * axisLen);
            ctx.lineTo(earth.x + Math.sin(axis) * axisLen, earth.y - Math.cos(axis) * axisLen);
            ctx.stroke();

            const latY = earth.y - (data.lat / 90) * earth.r * 0.78;
            ctx.strokeStyle = 'rgba(242,200,107,0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(earth.x, latY, earth.r * 0.82, Math.max(3, earth.r * 0.09), 0, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = 'rgba(216,220,230,0.8)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'center';
            ctx.fillText(`纬度 ${this._formatLatitude(data.lat)}`, earth.x, earth.y + earth.r + 28);
            ctx.restore();
        },

        _drawSolarChart(ctx, chart, data) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.strokeRect(chart.x, chart.y, chart.w, chart.h);
            ctx.fillStyle = 'rgba(255,255,255,0.045)';
            ctx.fillRect(chart.x, chart.y, chart.w, chart.h);

            const baseY = chart.y + chart.h * 0.78;
            const peak = Math.max(0.05, Math.sin(Math.max(0, data.noonAltitude) * DEG));
            ctx.beginPath();
            for (let i = 0; i <= 80; i += 1) {
                const x = chart.x + (i / 80) * chart.w;
                const phase = i / 80;
                const y = baseY - Math.sin(Math.PI * phase) * chart.h * 0.62 * peak;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(242,200,107,0.9)';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            const daylightRatio = data.dayLength / 24;
            ctx.fillStyle = 'rgba(116,185,255,0.2)';
            ctx.fillRect(chart.x, chart.y + chart.h - 12, chart.w * daylightRatio, 7);
            const hourX = chart.x + (data.hour / 24) * chart.w;
            const altitudeRatio = Math.max(0, Math.sin(Math.max(0, data.currentAltitude) * DEG));
            const hourY = baseY - altitudeRatio * chart.h * 0.62;
            ctx.beginPath();
            ctx.arc(hourX, hourY, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = '#8dd7ff';
            ctx.fill();
            ctx.fillStyle = 'rgba(216,220,230,0.78)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.fillText('日出', chart.x, chart.y + chart.h + 18);
            ctx.textAlign = 'center';
            ctx.fillText('正午太阳高度', chart.x + chart.w / 2, chart.y - 10);
            ctx.textAlign = 'right';
            ctx.fillText('日落', chart.x + chart.w, chart.y + chart.h + 18);
            ctx.restore();
        },

        _resizeCanvas() {
            const rect = this.canvas.getBoundingClientRect();
            const w = Math.max(320, rect.width || this.canvas.offsetWidth || 640);
            const h = Math.max(360, rect.height || this.canvas.offsetHeight || 520);
            this.dpr = window.devicePixelRatio || 1;
            const targetW = Math.round(w * this.dpr);
            const targetH = Math.round(h * this.dpr);
            if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
                this.canvas.width = targetW;
                this.canvas.height = targetH;
                this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            }
        },

        _formatDate(day) {
            const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            let n = Math.max(1, Math.min(365, Math.round(day)));
            let month = 0;
            while (month < monthDays.length && n > monthDays[month]) {
                n -= monthDays[month];
                month += 1;
            }
            return `${month + 1}月${n}日`;
        },

        _formatLatitude(lat) {
            if (Math.abs(lat) < 0.05) return '0°';
            return `${Math.abs(lat).toFixed(1)}°${lat > 0 ? 'N' : 'S'}`;
        },

        _formatHours(hours) {
            if (hours <= 0.05) return '极夜附近';
            if (hours >= 23.95) return '极昼附近';
            const h = Math.floor(hours);
            const m = Math.round((hours - h) * 60);
            return `${h}小时${String(m).padStart(2, '0')}分`;
        },

        _formatClock(hour) {
            const normalized = Math.max(0, Math.min(24, Number(hour) || 0));
            const whole = Math.floor(normalized);
            const minutes = Math.round((normalized - whole) * 60);
            return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        },

        _seasonLabel(lat, declination) {
            if (Math.abs(declination) < 1.5) return '昼夜接近等长';
            if (Math.abs(lat) < 1.5) return '赤道附近季节差异较小';
            const sameHemisphere = lat * declination > 0;
            return sameHemisphere ? '本半球太阳更直接' : '本半球太阳更倾斜';
        },

        _signed(value) {
            return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
        },

        _fontMono() {
            if (window.CF && CF.mono) return CF.mono;
            return 'JetBrains Mono, Consolas, monospace';
        }
    };

    function initCosmosSeasons() {
        CosmosSeasons.init();
    }

    function destroyCosmosSeasons() {
        CosmosSeasons.destroy();
    }

    window.CosmosSeasons = CosmosSeasons;
    window.initCosmosSeasons = initCosmosSeasons;
    window.destroyCosmosSeasons = destroyCosmosSeasons;
})();
