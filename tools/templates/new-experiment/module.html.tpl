<section class="content-section" data-module="__EXPERIMENT_ID__" aria-labelledby="__EXPERIMENT_ID__-title">
    <div class="astra-exp astra-exp--__NAMESPACE__">
        <header class="astra-exp--__NAMESPACE____header">
            <p class="astra-exp--__NAMESPACE____eyebrow">__SUBJECT__ · 独立实验</p>
            <h2 id="__EXPERIMENT_ID__-title">__EXPERIMENT_TITLE__</h2>
        </header>

        <div class="astra-exp--__NAMESPACE____stage">
            <canvas
                class="astra-exp--__NAMESPACE____canvas"
                data-role="canvas"
                role="img"
                aria-label="__EXPERIMENT_TITLE__动态画面"
            ></canvas>

            <output class="astra-exp--__NAMESPACE____readout" data-role="readout" aria-live="polite"></output>
        </div>

        <div class="astra-exp--__NAMESPACE____controls" aria-label="实验控制">
            <label>
                <span>变量</span>
                <input data-control="parameter" type="range" min="0" max="100" value="50">
            </label>
            <button type="button" data-action="toggle" aria-pressed="false">暂停</button>
            <button type="button" data-action="reset">重置</button>
        </div>
    </div>
</section>
