<section class="content-section" data-module="__EXPERIMENT_ID__" aria-labelledby="__EXPERIMENT_ID__-title">
    <div class="astra-exp astra-exp--__NAMESPACE__" data-state="running">
        <header class="astra-exp--__NAMESPACE____header">
            <div>
                <p class="astra-exp--__NAMESPACE____eyebrow">__SUBJECT__ · 独立实验</p>
                <h2 id="__EXPERIMENT_ID__-title">__EXPERIMENT_TITLE__</h2>
            </div>
            <output
                class="astra-exp--__NAMESPACE____state"
                data-role="state"
                aria-live="polite"
            >运行中</output>
        </header>

        <div class="astra-exp--__NAMESPACE____workspace">
            <div class="astra-exp--__NAMESPACE____stage">
                <canvas
                    class="astra-exp--__NAMESPACE____canvas"
                    data-role="canvas"
                    role="img"
                    aria-label="__EXPERIMENT_TITLE__动态画面"
                ></canvas>

                <div class="astra-exp--__NAMESPACE____telemetry" aria-label="实时读数">
                    <span>实时读数</span>
                    <output
                        class="astra-exp--__NAMESPACE____readout"
                        data-role="readout"
                        aria-live="polite"
                    >__PARAMETER_LABEL__ 50 __PARAMETER_UNIT__</output>
                </div>

                <ul
                    class="astra-exp--__NAMESPACE____legend"
                    data-role="legend"
                    aria-label="画面图例"
                >
                    <li>
                        <span class="astra-exp--__NAMESPACE____swatch" data-tone="primary" aria-hidden="true"></span>
                        <span>__PRIMARY_LEGEND__</span>
                    </li>
                    <li>
                        <span class="astra-exp--__NAMESPACE____swatch" data-tone="secondary" aria-hidden="true"></span>
                        <span>__SECONDARY_LEGEND__</span>
                    </li>
                </ul>
            </div>

            <details
                class="astra-exp--__NAMESPACE____drawer"
                data-role="control-drawer"
                open
            >
                <summary>
                    <span>参数与控制</span>
                    <span aria-hidden="true">展开 / 收起</span>
                </summary>

                <div class="astra-exp--__NAMESPACE____drawer-body">
                    <div class="astra-exp--__NAMESPACE____control-group">
                        <div class="astra-exp--__NAMESPACE____label-row">
                            <label for="__EXPERIMENT_ID__-parameter">__PARAMETER_LABEL__</label>
                            <output
                                for="__EXPERIMENT_ID__-parameter"
                                data-role="parameter-value"
                            >50 __PARAMETER_UNIT__</output>
                        </div>
                        <input
                            id="__EXPERIMENT_ID__-parameter"
                            data-control="parameter"
                            type="range"
                            min="0"
                            max="100"
                            value="50"
                            aria-describedby="__EXPERIMENT_ID__-parameter-hint"
                        >
                        <p id="__EXPERIMENT_ID__-parameter-hint">拖动后，画面与读数同步更新。</p>
                    </div>

                    <div class="astra-exp--__NAMESPACE____actions" role="group" aria-label="播放控制">
                        <button
                            class="astra-exp--__NAMESPACE____action astra-exp--__NAMESPACE____action--primary"
                            type="button"
                            data-action="toggle"
                            aria-pressed="false"
                        >暂停模拟</button>
                        <button
                            class="astra-exp--__NAMESPACE____action"
                            type="button"
                            data-action="reset"
                        >恢复初始</button>
                    </div>

                    <p
                        class="astra-exp--__NAMESPACE____notice"
                        data-role="notice"
                        data-tone="info"
                        role="status"
                        aria-live="polite"
                    >模拟运行中，可直接调整参数。</p>
                </div>
            </details>
        </div>
    </div>
</section>
