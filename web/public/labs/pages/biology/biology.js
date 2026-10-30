// ===== Biology Module Bootstrap =====
// Initializes all biology sub-modules

function initBiology() {
    if (typeof initCellStructure === 'function') initCellStructure();
    if (typeof initDNAHelix === 'function') initDNAHelix();
    if (typeof initPhotosynthesis === 'function') initPhotosynthesis();
    if (typeof initGenetics === 'function') initGenetics();
}
