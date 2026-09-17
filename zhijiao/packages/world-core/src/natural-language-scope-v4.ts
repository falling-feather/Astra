const CLAUSE_BOUNDARIES = new Set([",", "，", ".", "。", "!", "！", "?", "？", ";", "；", ":", "：", "\n"]);
const HYPOTHESIS_PATTERN = /(?:如果|若|假设|假如|设想|万一|倘若|即使)/gu;
const REPORTING_PREFIX_PATTERN = /(?:(?:资料|材料|原文|原句|案例|报道|文章)(?:里面|里|中|上|内|的|所){0,2}(?:说|称|写|要求|建议|提到|指出|记载|显示|描述|包含|使用|有)|有人|他说|她说|对方说|听说|据说|所谓|提到|写着|指出|称|引用|转述|复述|举例|例子|讨论|关于|这个说法).{0,6}$/u;
const NONCOMMITTAL_REQUEST_PREFIX = /(?:以后|将来|有机会|也许|可能|改天)/u;
const REPORTING_SUFFIX_PATTERN = /^(?:是(?:违规|错误|风险|不当|不行|不可以)|属于(?:违规|风险|问题)|只是(?:风险|案例|说法|例子)|指的是|这一(?:说法|做法|词)|一(?:词|种说法)|有(?:风险|问题)|不要|别|不能|不应|不应当|不可|不行|不该|不允许|禁止|拒绝|避免|并非|不是|我(?:不会|拒绝|不(?:会|要|能|应|想|愿))|我会(?:拒绝|核对|确认|说明|改为|改成|保留|停止))/u;
const NEGATION_PATTERN = /(?:不(?:要|会|能|应|该|应该|想|愿|愿意|再|用|准|同意|允许|考虑|通过|采用|使用|支持|准备|打算|必|拍|进入|冒充|假装|伪造|编造|删除|删|去掉|移除|隐藏|发布|写|放|谈|接受|录|拍摄|处理|做|让|代表|只|需要|可以|可能)?|没(?:有)?|未|无|别|勿|莫|拒绝|反对|避免|禁止|严禁|无需|不用|无意|从不|没有)(?:让|令|叫|真的|再|去|主动|直接|继续|去做|进行|通过|来)?$/u;
const SAFE_HYPOTHESIS_PATTERN = /(?:拒绝|不会|不能|不应|不得|不该|避免|阻止|制止|报告|提醒|警告|核对|核验|查证|确认|说明风险|了解后果|只是|改为|改成|保留|选择|不采用|不使用|停用)/u;
const ACTIVE_RISK_FOLLOW_UP_PATTERN = /(?:我(?:也)?(?:会|要|将|准备|打算|计划|就)|直接|然后|再去|继续|仍然|照常|进入|闯入|偷拍|偷录|伪造|编造|捏造|删除|移除|去掉|隐藏|绕过|跳过|不经|不用(?:说明|授权|核验))/u;
const ACTIVE_REPORTED_FOLLOW_UP_PATTERN = /(?:我(?:也)?(?:会|要|将|准备|打算|计划|就).{0,12}(?:冒充|假装|进入|闯入|偷拍|偷录|伪造|编造|捏造|删除|移除|去掉|隐藏|绕过|跳过|照做|照办|执行|实施|采用)|直接(?:进入|闯入|偷拍|偷录|伪造|编造|删除|移除|去掉|隐藏|绕过|跳过|照做|执行)|(?:照做|照办|执行|实施|采用))/u;
const FIRST_PERSON_REFUSAL_PATTERN = /^(?:我|本人|学生记者)(?:不愿|拒绝|不会|不能|不再|不想)/u;

function normalizeNaturalLanguage(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[“”「」『』]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

function withGlobalFlag(pattern: RegExp): RegExp {
  const flags = `${pattern.flags.replace(/[gy]/gu, "")}g`;
  return new RegExp(pattern.source, flags);
}

function isClauseBoundary(character: string): boolean {
  return CLAUSE_BOUNDARIES.has(character);
}

function clauseStart(text: string, index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (isClauseBoundary(text[cursor] ?? "")) return cursor + 1;
  }
  return 0;
}

function clauseEnd(text: string, index: number): number {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (isClauseBoundary(text[cursor] ?? "")) return cursor;
  }
  return text.length;
}

function sentenceEnd(text: string, index: number): number {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (/[。！？!?；;\n]/u.test(text[cursor] ?? "")) return cursor;
  }
  return text.length;
}

function quoteAt(text: string, index: number, quote: string): number {
  let count = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === quote && text[cursor - 1] !== "\\") count += 1;
  }
  return count;
}

function isQuoted(text: string, start: number, end: number): boolean {
  for (const quote of ['"', "'"]) {
    if (quoteAt(text, start, quote) % 2 === 1) {
      for (let cursor = end; cursor < text.length; cursor += 1) {
        if (text[cursor] === quote && text[cursor - 1] !== "\\") return true;
      }
    }
  }
  return false;
}

function latestHypothesisIndex(prefix: string): number {
  const matcher = withGlobalFlag(HYPOTHESIS_PATTERN);
  let latest = -1;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(prefix)) !== null) {
    latest = match.index;
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return latest;
}

function hasNegatedPrefix(prefix: string): boolean {
  const tail = prefix.slice(-24)
    .replace(/(?:能不能|可不可以|是否能|是否可以|可以不可以)/gu, "")
    .replace(/把[^，。！？；,.;!?]{1,12}$/u, "")
    .replace(/(?:给|替|帮|向|为)(?:我们|你们|他们|她们|我|你|您|他|她)$/u, "");
  return NEGATION_PATTERN.test(tail);
}

function hasReportingContext(prefix: string, suffix: string, quoted: boolean): boolean {
  return quoted
    || REPORTING_PREFIX_PATTERN.test(prefix.slice(-32))
    || REPORTING_SUFFIX_PATTERN.test(suffix.slice(0, 32));
}

function hasRiskPlanAfterHypothesis(context: string): boolean {
  return ACTIVE_RISK_FOLLOW_UP_PATTERN.test(context)
    && !SAFE_HYPOTHESIS_PATTERN.test(context);
}

function isAffirmedMatch(
  text: string,
  start: number,
  end: number,
  allowHypothesis: boolean,
  currentRequest = false,
): boolean {
  const startOfClause = clauseStart(text, start);
  const endOfClause = clauseEnd(text, end);
  const prefix = text.slice(startOfClause, start);
  const suffix = text.slice(end, endOfClause);
  const matchText = text.slice(start, end);
  if (currentRequest && NONCOMMITTAL_REQUEST_PREFIX.test(prefix)) return false;

  if (!allowHypothesis && FIRST_PERSON_REFUSAL_PATTERN.test(`${prefix}${matchText}`)) {
    return false;
  }
  if (hasNegatedPrefix(prefix)) return false;

  const hypothesis = latestHypothesisIndex(prefix);
  if (hypothesis >= 0 && !allowHypothesis) {
    const hypothesisContext = text.slice(hypothesis, sentenceEnd(text, hypothesis));
    if (hasRiskPlanAfterHypothesis(hypothesisContext)) return true;
    return false;
  }

  const quoted = isQuoted(text, start, end);
  if (hasReportingContext(prefix, suffix, quoted)) {
    return ACTIVE_REPORTED_FOLLOW_UP_PATTERN.test(suffix)
      && !SAFE_HYPOTHESIS_PATTERN.test(suffix)
      && !REPORTING_SUFFIX_PATTERN.test(suffix.slice(0, 32));
  }

  return true;
}

function hasScopedPatternMatch(
  text: string,
  pattern: RegExp,
  allowHypothesis: boolean,
  isolateClauses: boolean,
  currentRequest = false,
): boolean {
  // A bounded `.{0,n}` policy expression must not greedily consume a
  // separate sentence clause and hide a later active mention. The second
  // pass below still permits patterns whose business meaning intentionally
  // spans a comma (for example, a withdrawal followed by continued recording).
  const candidateText = isolateClauses
    ? text.replace(/[，,；;]/gu, "\n")
    : text;
  const matcher = withGlobalFlag(pattern);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(candidateText)) !== null) {
    const end = match.index + match[0].length;
    if (isAffirmedMatch(candidateText, match.index, end, allowHypothesis, currentRequest)) return true;
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return false;
}

/**
 * Tests a natural-language pattern only when the matched mention is an
 * affirmed action, rather than a negated, reported, quoted, or non-committal
 * hypothetical mention.
 *
 * The predicate intentionally returns no interpretation object: callers keep
 * their existing domain-specific schemas and use it only as a scope gate.
 */
export function hasAffirmedNaturalLanguageMatchV4(
  utterance: string,
  pattern: RegExp,
): boolean {
  const text = normalizeNaturalLanguage(utterance);
  return hasScopedPatternMatch(text, pattern, false, true)
    || hasScopedPatternMatch(text, pattern, false, false);
}

/**
 * Matches an intent phrase outside direct negation or reported/quoted text.
 * Conditional language remains an intent because it can describe a valid
 * professional contingency; the stricter predicate above is reserved for
 * safety and quality risk gates.
 */
export function hasNaturalLanguageIntentMatchV4(
  utterance: string,
  pattern: RegExp,
): boolean {
  const text = normalizeNaturalLanguage(utterance);
  return hasScopedPatternMatch(text, pattern, true, true)
    || hasScopedPatternMatch(text, pattern, true, false);
}

/** A present request may arrange a later delivery; a merely possible future intention is not a request. */
export function hasCurrentNaturalLanguageRequestMatchV4(utterance: string, pattern: RegExp): boolean {
  const text = normalizeNaturalLanguage(utterance);
  return hasScopedPatternMatch(text, pattern, false, true, true)
    || hasScopedPatternMatch(text, pattern, false, false, true);
}
