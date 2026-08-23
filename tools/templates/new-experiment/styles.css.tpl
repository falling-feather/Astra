#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__ {
    display: grid;
    gap: 18px;
    width: min(100%, 1180px);
    margin: 0 auto;
    padding: clamp(16px, 3vw, 30px);
    color: var(--text-primary);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header h2,
#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header p {
    margin: 0;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____eyebrow {
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____stage {
    position: relative;
    min-height: clamp(300px, 55vh, 620px);
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: #0b1730;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____readout {
    position: absolute;
    inset: 14px auto auto 14px;
    padding: 8px 11px;
    border-radius: var(--radius-md);
    color: #eafcff;
    background: rgba(4, 15, 36, 0.78);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: end;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____controls label {
    display: grid;
    flex: 1 1 240px;
    gap: 6px;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____controls button {
    min-height: 44px;
}

@media (max-width: 640px) {
    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__ {
        gap: 12px;
        padding: 12px;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____stage {
        min-height: 340px;
    }
}

@media (prefers-reduced-motion: reduce) {
    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__ {
        scroll-behavior: auto;
    }
}
