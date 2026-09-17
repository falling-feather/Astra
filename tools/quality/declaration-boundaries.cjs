const DECLARATION_PATHS = Object.freeze(['backend/app/models/course.py', 'backend/app/schemas/course.py']);

function declarationBoundaryViolations(relativePath, source) {
  if (!DECLARATION_PATHS.includes(relativePath)) throw new Error(`Unknown declaration module: ${relativePath}`);
  // Inspect imports and calls, not prose in comments, field descriptions or docstrings.
  const code = source.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\r\n]*/g,
    (token) => token.replace(/[^\r\n]/g, ' ')).replace(/;/g, '\n');
  const forbidden = relativePath.includes('/models/') ? 'api|schemas|services' : 'api|models|services';
  const forbiddenModule = new RegExp(`^(?:app\\.|\\.+)(?:${forbidden})(?:\\.|$)`);
  const forbiddenName = new RegExp(`\\b(?:${forbidden})\\b`);
  const imports = [...code.matchAll(/^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import[ \t]+(\([\s\S]*?\)|[^\r\n]+)|import[ \t]+([^\r\n]+))/gm)];
  const violations = [];
  if (imports.some((match) => {
    const [, namespace, names, modules] = match;
    if (modules) return modules.split(',').some((value) => forbiddenModule.test(value.trim().split(/\s+/)[0]));
    return forbiddenModule.test(namespace)
      || ((namespace === 'app' || /^\.+$/.test(namespace)) && forbiddenName.test(names));
  })) violations.push('cross-layer-import');
  if (/\b(?:requests|httpx|urllib\s*\.\s*request)\s*\.|\.\s*(?:commit|flush|execute|executemany|rollback|query|add|add_all|delete|merge|read_text|write_text|read_bytes|write_bytes)\s*\(|\b(?:Session|AsyncSession|open)\s*\(/.test(code)) {
    violations.push('io-authority');
  }
  return violations;
}

module.exports = { DECLARATION_PATHS, declarationBoundaryViolations };
