const SHELL_ENTRY_PATHS = Object.freeze(['index.html', 'shared/js/main.js', 'shared/js/router.js']);
const SHELL_GLOBALS = {
  'index.html': new Set(['__englabCache', '__astraBoot', '__loadProgress', '__dismissEnglabLoading']),
  'shared/js/main.js': new Set(['sortSpeed', 'updateFooterVisibility', '__englabCache', 'warmGalaxyCache', '__warmedGalaxies']),
  'shared/js/router.js': new Set(['__astraGalaxyCache', 'navigate', 'Router']),
};

function inlineCode(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]))
    .map((match) => match[2]);
  const handlers = [...html.matchAll(/\bon[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  return scripts.concat(handlers).join('\n');
}

// A lightweight lexical screen for ordinary architecture changes, not a JS sandbox.
// Preserve literal member names but exclude comments and display text from call checks.
function executableCode(source) {
  const literals = [];
  const code = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token, offset) => {
    if (!token.startsWith('/')) {
      literals.push(token.slice(1, -1));
      if (/\[\s*$/.test(source.slice(0, offset)) && /^\s*\]/.test(source.slice(offset + token.length))) return token;
    }
    return token.replace(/[^\r\n]/g, ' ');
  }).replace(/\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/g, '.$1');
  return { code, literals };
}

function shellBoundaryViolations(relativePath, source) {
  if (!SHELL_GLOBALS[relativePath]) throw new Error(`Unknown shell entry: ${relativePath}`);
  const { code, literals } = executableCode(relativePath === 'index.html' ? inlineCode(source) : source);
  const violations = [];
  // Bootstrap may call module entry points; business transport belongs to its owning client.
  if (literals.some((value) => /^\/api(?:\/|\?|$)/.test(value))
      || /\bAstraApiClient\s*\.\s*(?:request|get|post|put|patch|delete)\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\.\s*sendBeacon\s*\(/.test(code)) {
    violations.push('business-network-authority');
  }
  // Only the existing static-asset warmer may use fetch from a shell entry.
  // Its requested URLs are also exercised by shell-entry-contract.cjs.
  const outsideWarmer = relativePath === 'shared/js/main.js'
    ? code.replace(/^function warmHttpCacheFallback\([^)]*\)\s*\{[\s\S]*?^\}/m, '')
    : code;
  if (/\bfetch\s*(?:\(|\.\s*(?:call|apply)\s*\()/.test(outsideWarmer)) violations.push('network-outside-cache-warmer');

  const assignments = [...code.matchAll(/(?:globalThis|global|window)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])\s*(?:=(?!=)|\|\|=|&&=|\?\?=)/g)];
  const indirectRegistration = /(?:Object\s*\.\s*(?:assign|defineProperty|defineProperties)|Reflect\s*\.\s*(?:set|defineProperty))\s*\(\s*(?:globalThis|global|window)\s*[,)]/;
  if (assignments.some((match) => !SHELL_GLOBALS[relativePath].has(match[1] || match[2]))
      || indirectRegistration.test(code)) {
    violations.push('feature-global-owner');
  }
  return violations;
}

module.exports = { SHELL_ENTRY_PATHS, shellBoundaryViolations };
