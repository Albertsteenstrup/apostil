// When the tab "Map run" gets a new chart: one at a time, the next only after the page drew the last one, and none while the tab is hidden.
// A change in between is kept as "read again". No `vscode` import.

export class ChartSends {
  private sent = false; // a chart is on its way, or the page draws it
  private again = false;

  constructor(private send: () => void, private visible: () => boolean) {}

  /** A file of the run changed, or Home loaded again: the chart is read and sent now, or once the page drew and the tab shows. */
  changed(): void {
    if (this.sent || !this.visible()) { this.again = true; return; }
    this.sent = true;
    this.send();
  }

  /** The page drew the chart. */
  drew(): void {
    this.sent = false;
    this.shown();
  }

  /** The tab shows again, or the page drew: a change that waited goes now. */
  shown(): void {
    if (!this.again) return;
    this.again = false;
    this.changed();
  }
}
