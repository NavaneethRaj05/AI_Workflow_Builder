/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
type Token = { type: 'string' | 'number' | 'ident' | 'op' | 'paren'; value: string };
type Ctx = { input: unknown; output: unknown };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string) => /[0-9]/.test(c);
  const isIdentStart = (c: string) => /[a-zA-Z_$]/.test(c);
  const isIdentChar = (c: string) => /[a-zA-Z0-9_$]/.test(c);

  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1, str = '';
      while (j < expr.length && expr[j] !== quote) {
        if (expr[j] === '\\' && j + 1 < expr.length) { str += expr[j + 1]; j += 2; continue; }
        str += expr[j]; j++;
      }
      if (expr[j] !== quote) throw new Error('Unterminated string literal');
      tokens.push({ type: 'string', value: str });
      i = j + 1;
      continue;
    }

    if (isDigit(c)) {
      let j = i + 1;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push({ type: 'number', value: expr.slice(i, j) });
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < expr.length && (isIdentChar(expr[j]) || expr[j] === '.')) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }

    const three = expr.slice(i, i + 3);
    const two = expr.slice(i, i + 2);
    if (three === '===' || three === '!==') { tokens.push({ type: 'op', value: three }); i += 3; continue; }
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { tokens.push({ type: 'op', value: two }); i += 2; continue; }
    if (c === '(' || c === ')') { tokens.push({ type: 'paren', value: c }); i++; continue; }
    if (['<', '>', '!'].includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }

    throw new Error(`Unexpected character in condition: "${c}"`);
  }
  return tokens;
}

function resolvePath(ctx: Ctx, path: string): unknown {
  const parts = path.split('.');
  const root = parts[0];
  if (root === 'true') return true;
  if (root === 'false') return false;
  if (root === 'null') return null;
  if (root !== 'input' && root !== 'output') {
    throw new Error(`Unknown identifier "${root}" — only "input" and "output" are allowed`);
  }
  let value: unknown = ctx[root as 'input' | 'output'];
  for (let i = 1; i < parts.length; i++) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[parts[i]];
  }
  return value;
}

class ConditionParser {
  private pos = 0;
  constructor(private tokens: Token[], private ctx: Ctx) {}
  private peek() { return this.tokens[this.pos]; }
  private next() { return this.tokens[this.pos++]; }

  parse(): boolean {
    const result = this.parseOr();
    if (this.pos !== this.tokens.length) throw new Error('Unexpected trailing tokens in condition');
    return !!result;
  }
  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peek()?.value === '||') { this.next(); left = !!left || !!this.parseAnd(); }
    return left;
  }
  private parseAnd(): unknown {
    let left = this.parseEquality();
    while (this.peek()?.value === '&&') { this.next(); left = !!left && !!this.parseEquality(); }
    return left;
  }
  private parseEquality(): unknown {
    let left = this.parseRelational();
    while (['===', '!==', '==', '!='].includes(this.peek()?.value)) {
      const op = this.next().value;
      const right = this.parseRelational();
      if (op === '===') left = left === right;
      else if (op === '!==') left = left !== right;
      else if (op === '==') left = left == right; // eslint-disable-line eqeqeq
      else left = left != right; // eslint-disable-line eqeqeq
    }
    return left;
  }
  private parseRelational(): unknown {
    let left = this.parseUnary();
    while (['<', '>', '<=', '>='].includes(this.peek()?.value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      if (op === '<') left = (left as never) < (right as never);
      else if (op === '>') left = (left as never) > (right as never);
      else if (op === '<=') left = (left as never) <= (right as never);
      else left = (left as never) >= (right as never);
    }
    return left;
  }
  private parseUnary(): unknown {
    if (this.peek()?.value === '!') { this.next(); return !this.parseUnary(); }
    return this.parsePrimary();
  }
  private parsePrimary(): unknown {
    const tok = this.peek();
    if (!tok) throw new Error('Unexpected end of condition');
    if (tok.type === 'paren' && tok.value === '(') {
      this.next();
      const val = this.parseOr();
      if (this.peek()?.value !== ')') throw new Error('Expected ")"');
      this.next();
      return val;
    }
    if (tok.type === 'string') { this.next(); return tok.value; }
    if (tok.type === 'number') { this.next(); return Number(tok.value); }
    if (tok.type === 'ident') { this.next(); return resolvePath(this.ctx, tok.value); }
    throw new Error(`Unexpected token in condition: "${tok.value}"`);
  }
}

export function evaluateCondition(condition: string, ctx: Ctx): boolean {
  return new ConditionParser(tokenize(condition), ctx).parse();
}
