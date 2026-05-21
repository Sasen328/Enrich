// §3 — Key Strip: keyboard shortcut hints between bars
export function KeyStrip() {
  return (
    <div className="kstrip">
      <span><kbd>⌘K</kbd> search</span>
      <span><kbd>S</kbd> slide rail</span>
      <span><kbd>I</kbd> icons-only rail</span>
      <span><kbd>D</kbd> toggle dark</span>
    </div>
  );
}
