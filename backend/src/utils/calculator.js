/**
 * A small, safe calculator for the voice agent: numbers, + - * / ( ) and % (as in "10% of 26000" or "26000 * 10%").
 * Language models, and audio models most of all, are unreliable at arithmetic, so every sum they say aloud is
 * done here. It is a hand-written parser, never eval.
 */
export function calculate(expression) {
  const src = String(expression ?? '').replace(/[,₹]|INR|Rs\.?/gi, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/x(?=\s*\d)/gi, '*');
  if (!/^[\d\s+\-*/().%]+$/.test(src)) throw new Error('Use only numbers and + - * / ( ) %');
  const tokens = src.match(/\d+(?:\.\d+)?|\.\d+|[-+*/()%]/g) ?? [];
  let i = 0;

  // expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-' unary | number ['%'] | '(' expr ')'
  function expr() {
    let v = term();
    while (tokens[i] === '+' || tokens[i] === '-') v = tokens[i++] === '+' ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = unary();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++];
      const r = unary();
      if (op === '/' && r === 0) throw new Error('Cannot divide by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function unary() {
    if (tokens[i] === '-') {
      i++;
      return -unary();
    }
    let v;
    if (tokens[i] === '(') {
      i++;
      v = expr();
      if (tokens[i++] !== ')') throw new Error('Missing )');
    } else if (tokens[i] !== undefined && /^[\d.]/.test(tokens[i])) {
      v = Number(tokens[i++]);
    } else {
      throw new Error('Could not read the expression');
    }
    while (tokens[i] === '%') {
      i++;
      v /= 100; // "10%" is 0.1, so "26000 * 10%" and "10% * 26000" both work
    }
    return v;
  }

  const result = expr();
  if (i < tokens.length) throw new Error('Could not read the expression');
  return Math.round(result * 100) / 100;
}
