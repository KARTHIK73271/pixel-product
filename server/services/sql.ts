/** Tiny positional-parameter builder: `b.p(value)` returns `$n`. */
export class Params {
  values: unknown[] = [];
  p(value: unknown) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
