// Undo/redo over immutable element arrays. Snapshots share unchanged element objects.

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.current = [];
  }

  /** Reset without undo entries (e.g. after loading a file). */
  reset(elements) {
    this.past = [];
    this.future = [];
    this.current = elements.slice();
  }

  /** Record a new state if it differs from the current one. Returns true when recorded. */
  commit(elements) {
    if (sameScene(this.current, elements)) return false;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = elements.slice();
    this.future = [];
    return true;
  }

  undo() {
    if (!this.past.length) return null;
    this.future.push(this.current);
    this.current = this.past.pop();
    return this.current.slice();
  }

  redo() {
    if (!this.future.length) return null;
    this.past.push(this.current);
    this.current = this.future.pop();
    return this.current.slice();
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

function sameScene(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
