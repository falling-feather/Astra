#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__ {
    --astra-exp-accent: var(__ACCENT_TOKEN__, #5b8dce);
    --astra-exp-accent-soft: rgba(__ACCENT_RGB__, 0.14);
    --astra-exp-panel: rgba(14, 16, 25, 0.96);
    --astra-exp-stage: #081221;
    display: grid;
    gap: 18px;
    width: min(100%, 1240px);
    margin: 0 auto;
    padding: clamp(16px, 3vw, 30px);
    color: var(--text-primary, #d8dce6);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header {
    display: flex;
    gap: 18px;
    align-items: end;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-default, rgba(255, 255, 255, 0.07));
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header h2,
#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header p {
    margin: 0;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header h2 {
    margin-top: 4px;
    font-size: clamp(1.35rem, 2.4vw, 2rem);
    line-height: 1.2;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____eyebrow {
    color: var(--astra-exp-accent);
    font-size: var(--text-sm, 0.875rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____state {
    flex: 0 0 auto;
    min-height: 30px;
    padding: 5px 10px;
    border: 1px solid rgba(__ACCENT_RGB__, 0.42);
    border-radius: var(--radius-default, 4px);
    color: var(--astra-exp-accent);
    background: var(--astra-exp-accent-soft);
    font-size: var(--text-sm, 0.875rem);
    line-height: 18px;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
    gap: 16px;
    align-items: stretch;
    min-width: 0;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____stage {
    position: relative;
    min-width: 0;
    height: clamp(380px, 58vh, 650px);
    overflow: hidden;
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.07));
    border-radius: var(--radius-lg, 8px);
    background: var(--astra-exp-stage);
    box-shadow: inset 0 0 0 1px rgba(__ACCENT_RGB__, 0.05);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____stage::before {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(135deg, rgba(__ACCENT_RGB__, 0.08), transparent 42%);
    content: '';
    pointer-events: none;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____canvas {
    position: relative;
    z-index: 0;
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____telemetry {
    position: absolute;
    inset: 14px auto auto 14px;
    z-index: 2;
    display: grid;
    gap: 2px;
    max-width: calc(100% - 28px);
    padding: 9px 12px;
    border-left: 2px solid var(--astra-exp-accent);
    border-radius: 0 var(--radius-default, 4px) var(--radius-default, 4px) 0;
    color: #edf6ff;
    background: rgba(4, 11, 24, 0.82);
    backdrop-filter: blur(8px);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____telemetry > span {
    color: rgba(237, 246, 255, 0.66);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____readout {
    overflow: hidden;
    color: #edf6ff;
    font-family: var(--font-mono, monospace);
    font-size: clamp(0.82rem, 1.8vw, 1rem);
    text-overflow: ellipsis;
    white-space: nowrap;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____legend {
    position: absolute;
    inset: auto 14px 14px auto;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    max-width: calc(100% - 28px);
    margin: 0;
    padding: 8px 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-default, 4px);
    color: rgba(237, 246, 255, 0.78);
    background: rgba(4, 11, 24, 0.78);
    font-size: 0.76rem;
    list-style: none;
    backdrop-filter: blur(8px);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____legend li {
    display: inline-flex;
    gap: 6px;
    align-items: center;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____swatch {
    width: 10px;
    height: 10px;
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 50%;
    background: var(--text-secondary, #8a90a0);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____swatch[data-tone="primary"] {
    background: var(--astra-exp-accent);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____swatch[data-tone="secondary"] {
    background: #f2a14a;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer {
    min-width: 0;
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.07));
    border-radius: var(--radius-lg, 8px);
    background: var(--astra-exp-panel);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer > summary {
    display: none;
    min-height: 44px;
    padding: 10px 12px;
    cursor: pointer;
    user-select: none;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer > summary::-webkit-details-marker {
    display: none;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer:not([open]) > .astra-exp--__NAMESPACE____drawer-body {
    display: grid;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer-body {
    display: grid;
    align-content: start;
    gap: 18px;
    min-height: 100%;
    padding: 18px;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____control-group {
    display: grid;
    gap: 10px;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____label-row {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____label-row label {
    color: var(--text-primary, #d8dce6);
    font-weight: 600;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____label-row output {
    color: var(--astra-exp-accent);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm, 0.875rem);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____control-group input[type="range"] {
    width: 100%;
    min-height: 44px;
    margin: 0;
    accent-color: var(--astra-exp-accent);
    cursor: pointer;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____control-group input[type="range"]:focus-visible {
    border-radius: var(--radius-sm, 2px);
    outline: 2px solid var(--astra-exp-accent);
    outline-offset: 3px;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____control-group p {
    margin: 0;
    color: var(--text-secondary, #8a90a0);
    font-size: var(--text-sm, 0.875rem);
    line-height: 1.5;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____action {
    min-width: 44px;
    min-height: 44px;
    padding: 9px 12px;
    border: 1px solid var(--border-hover, rgba(255, 255, 255, 0.12));
    border-radius: var(--radius-default, 4px);
    color: var(--text-primary, #d8dce6);
    background: var(--surface-2, #151822);
    font: inherit;
    cursor: pointer;
    transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____action--primary {
    border-color: rgba(__ACCENT_RGB__, 0.52);
    color: #f4fbff;
    background: rgba(__ACCENT_RGB__, 0.2);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____action:hover:not(:disabled) {
    border-color: var(--astra-exp-accent);
    background: rgba(__ACCENT_RGB__, 0.26);
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____action:focus-visible {
    outline: 2px solid var(--astra-exp-accent);
    outline-offset: 3px;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____action:disabled {
    cursor: not-allowed;
    opacity: 0.58;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____notice {
    margin: auto 0 0;
    padding: 10px 11px;
    border-left: 2px solid var(--astra-exp-accent);
    color: var(--text-secondary, #8a90a0);
    background: var(--surface-1, #0e1019);
    font-size: var(--text-sm, 0.875rem);
    line-height: 1.5;
}

#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__[data-state="paused"] .astra-exp--__NAMESPACE____state,
#page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__[data-state="reduced-motion"] .astra-exp--__NAMESPACE____state {
    border-color: rgba(242, 161, 74, 0.46);
    color: #f2b56b;
    background: rgba(242, 161, 74, 0.1);
}

@media (max-width: 980px) {
    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____workspace {
        grid-template-columns: minmax(0, 1fr) minmax(250px, 290px);
    }
}

@media (max-width: 760px) {
    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__ {
        gap: 12px;
        padding: 12px;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header {
        align-items: start;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____workspace {
        grid-template-columns: minmax(0, 1fr);
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____stage {
        height: clamp(340px, 54vh, 520px);
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer > summary {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid transparent;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer[open] > summary {
        border-bottom-color: var(--border-default, rgba(255, 255, 255, 0.07));
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer > summary span:last-child {
        color: var(--text-secondary, #8a90a0);
        font-size: 0.75rem;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____drawer:not([open]) > .astra-exp--__NAMESPACE____drawer-body {
        display: none;
    }
}

@media (max-width: 480px) {
    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____header {
        display: grid;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____state {
        justify-self: start;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____actions {
        grid-template-columns: 1fr;
    }
}

@media (prefers-reduced-motion: reduce) {
    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__,
    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE__ * {
        scroll-behavior: auto;
        transition-duration: 0.01ms !important;
        animation: none !important;
    }

    #page-__SUBJECT__ [data-module="__EXPERIMENT_ID__"] .astra-exp--__NAMESPACE____stage::before {
        background: none;
    }
}
