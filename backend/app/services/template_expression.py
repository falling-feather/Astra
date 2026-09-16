"""A bounded arithmetic language shared by teaching templates.

No Python evaluation, attribute access, statements or user-provided callables.
The wire AST contains only finite numbers, declared variables and this whitelist.
"""

from __future__ import annotations

import math
import re
from typing import Any

FUNCTIONS = {"sin": math.sin, "cos": math.cos, "abs": abs, "sqrt": math.sqrt, "log": math.log, "exp": math.exp}
_TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([a-z][a-z0-9_]*)|([+\-*/^()]))")
_PRECEDENCE = {"+": 10, "-": 10, "*": 20, "/": 20, "^": 30}


def compile_expression(expression: str, variables: set[str]) -> dict[str, Any]:
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 240:
        raise ValueError("公式须为 1—240 个字符")
    tokens: list[str] = []
    offset = 0
    expression = expression.strip()
    while offset < len(expression):
        match = _TOKEN.match(expression, offset)
        if not match:
            raise ValueError(f"公式第 {offset + 1} 个字符无法识别")
        tokens.append(next(group for group in match.groups() if group is not None))
        offset = match.end()
        if len(tokens) > 100:
            raise ValueError("公式过于复杂")
    cursor, nodes = 0, 0

    def parse(minimum: int = 0, depth: int = 0) -> dict[str, Any]:
        nonlocal cursor, nodes
        if depth > 20 or cursor >= len(tokens):
            raise ValueError("公式不完整或嵌套过深")
        token = tokens[cursor]
        cursor += 1
        nodes += 1
        if nodes > 100:
            raise ValueError("公式过于复杂")
        if token in {"+", "-"}:
            left = {"op": "positive" if token == "+" else "negative", "args": [parse(25, depth + 1)]}
        elif token == "(":
            left = parse(0, depth + 1)
            if cursor >= len(tokens) or tokens[cursor] != ")":
                raise ValueError("公式缺少右括号")
            cursor += 1
        elif token in FUNCTIONS:
            if cursor >= len(tokens) or tokens[cursor] != "(":
                raise ValueError("函数需要使用括号")
            cursor += 1
            child = parse(0, depth + 1)
            if cursor >= len(tokens) or tokens[cursor] != ")":
                raise ValueError("函数缺少右括号")
            cursor += 1
            left = {"op": token, "args": [child]}
        elif token in variables:
            left = {"op": "variable", "name": token}
        elif token in {"pi", "e"}:
            left = {"op": "number", "value": math.pi if token == "pi" else math.e}
        else:
            try:
                number = float(token)
            except ValueError as exc:
                raise ValueError(f"未声明的变量或运算：{token}") from exc
            if not math.isfinite(number) or abs(number) > 1e12:
                raise ValueError("公式中的常数超出范围")
            left = {"op": "number", "value": number}
        while cursor < len(tokens) and tokens[cursor] in _PRECEDENCE and _PRECEDENCE[tokens[cursor]] >= minimum:
            operator = tokens[cursor]
            cursor += 1
            right = parse(_PRECEDENCE[operator] + (0 if operator == "^" else 1), depth + 1)
            left = {"op": operator, "args": [left, right]}
        return left

    result = parse()
    if cursor != len(tokens):
        raise ValueError("公式存在多余内容；乘法请显式使用 *")
    return result


def evaluate_expression(node: dict[str, Any], variables: dict[str, float]) -> float | None:
    def evaluate(item):
        op = item["op"]
        if op == "number":
            return item["value"]
        if op == "variable":
            return variables[item["name"]]
        args = [evaluate(child) for child in item["args"]]
        if op == "positive":
            return args[0]
        if op == "negative":
            return -args[0]
        if op in FUNCTIONS:
            if op == "exp" and abs(args[0]) > 50:
                raise ValueError("exp domain limit")
            return FUNCTIONS[op](args[0])
        a, b = args
        if op == "+": return a + b
        if op == "-": return a - b
        if op == "*": return a * b
        if op == "/": return a / b
        if op == "^" and abs(b) <= 12: return math.pow(a, b)
        raise ValueError("power domain limit")

    try:
        result = float(evaluate(node))
        return result if math.isfinite(result) and abs(result) <= 1e12 else None
    except (ValueError, OverflowError, ZeroDivisionError, KeyError):
        return None
