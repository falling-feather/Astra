/** Bounded arithmetic grammar matching backend/app/services/template_expression.py. */
export type UnaryOperator = 'positive' | 'negative' | 'sin' | 'cos' | 'abs' | 'sqrt' | 'log' | 'exp';
export type BinaryOperator = '+' | '-' | '*' | '/' | '^';
export type ExpressionNode =
  | { op: 'number'; value: number }
  | { op: 'variable'; name: string }
  | { op: UnaryOperator | BinaryOperator; args: ExpressionNode[] };

const functions = new Set(['sin', 'cos', 'abs', 'sqrt', 'log', 'exp']);
const precedence: Record<string, number> = { '+': 10, '-': 10, '*': 20, '/': 20, '^': 30 };

export function compileExpression(input: string, variables: Set<string>): ExpressionNode {
  if (typeof input !== 'string' || !input.trim() || input.length > 240) throw new Error('公式须为 1—240 个字符');
  const expression = input.trim();
  const tokens: string[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([a-z][a-z0-9_]*)|([+\-*/^()]))/y;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match) throw new Error(`公式第 ${offset + 1} 个字符无法识别`);
    tokens.push(match[1] || match[2] || match[3]);
    offset = pattern.lastIndex;
    if (tokens.length > 100) throw new Error('公式过于复杂');
  }
  let cursor = 0, nodes = 0;
  const parse = (minimum = 0, depth = 0): ExpressionNode => {
    if (depth > 20 || cursor >= tokens.length) throw new Error('公式不完整或嵌套过深');
    const token = tokens[cursor++];
    if (++nodes > 100) throw new Error('公式过于复杂');
    let left: ExpressionNode;
    if (token === '+' || token === '-') left = { op: token === '+' ? 'positive' : 'negative', args: [parse(25, depth + 1)] };
    else if (token === '(') {
      left = parse(0, depth + 1);
      if (tokens[cursor++] !== ')') throw new Error('公式缺少右括号');
    } else if (functions.has(token)) {
      if (tokens[cursor++] !== '(') throw new Error('函数需要使用括号');
      const child = parse(0, depth + 1);
      if (tokens[cursor++] !== ')') throw new Error('函数缺少右括号');
      left = { op: token as UnaryOperator, args: [child] };
    } else if (variables.has(token)) left = { op: 'variable', name: token };
    else if (token === 'pi' || token === 'e') left = { op: 'number', value: token === 'pi' ? Math.PI : Math.E };
    else {
      const value = Number(token);
      if (!/^(?:\d|\.)/.test(token) || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error(`未声明的变量或超出范围的常数：${token}`);
      left = { op: 'number', value };
    }
    while (cursor < tokens.length && Object.hasOwn(precedence, tokens[cursor]) && precedence[tokens[cursor]] >= minimum) {
      const operator = tokens[cursor++] as BinaryOperator;
      const right = parse(precedence[operator] + (operator === '^' ? 0 : 1), depth + 1);
      left = { op: operator, args: [left, right] };
    }
    return left;
  };
  const result = parse();
  if (cursor !== tokens.length) throw new Error('公式存在多余内容；乘法请显式使用 *');
  return result;
}

export function evaluateExpression(node: ExpressionNode, variables: Record<string, number>): number | null {
  const evaluate = (item: ExpressionNode): number => {
    if (item.op === 'number') return item.value;
    if (item.op === 'variable') return variables[item.name];
    const [a, b] = item.args.map(evaluate);
    switch (item.op) {
      case 'positive': return a;
      case 'negative': return -a;
      case 'sin': return Math.sin(a);
      case 'cos': return Math.cos(a);
      case 'abs': return Math.abs(a);
      case 'sqrt': return Math.sqrt(a);
      case 'log': return Math.log(a);
      case 'exp': return Math.abs(a) <= 50 ? Math.exp(a) : NaN;
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case '^': return Math.abs(b) <= 12 ? Math.pow(a, b) : NaN;
    }
  };
  const value = evaluate(node);
  return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
}
