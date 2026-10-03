export class ProjectMasonry {
  attach(grid) {
    this.observer?.disconnect();
    cancelAnimationFrame(this.frame);
    this.grid = grid;
    if (!grid) return;

    this.arrange();
    this.observer = new ResizeObserver(entries => {
      if (entries.some(entry => entry.target !== grid || Math.abs(entry.contentRect.width - this.width) > 0.5)) {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.arrange());
      }
    });
    this.observer.observe(grid);
    for (const card of grid.children) this.observer.observe(card);
  }

  arrange() {
    const grid = this.grid;
    if (!grid?.isConnected || !grid.clientWidth) return;
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.getPropertyValue('--project-gap')) || 14;
    const minimum = parseFloat(style.getPropertyValue('--project-min-width')) || 310;
    const limit = parseInt(style.getPropertyValue('--project-column-limit'), 10) || 10;
    this.width = grid.clientWidth;
    const columns = Math.max(1, Math.min(limit, Math.floor((this.width + gap) / (minimum + gap))));
    const cardWidth = (this.width - gap * (columns - 1)) / columns;
    const heights = Array(columns).fill(0);
    const cards = [...grid.children];

    grid.classList.add('masonry-ready');
    for (const card of cards) card.style.width = `${cardWidth}px`;
    for (const card of cards) {
      const column = heights.indexOf(Math.min(...heights));
      card.style.left = `${column * (cardWidth + gap)}px`;
      card.style.top = `${heights[column]}px`;
      heights[column] += card.getBoundingClientRect().height + gap;
    }
    grid.style.height = `${Math.ceil(Math.max(0, ...heights) - (cards.length ? gap : 0))}px`;
  }
}
