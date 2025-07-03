// static/js/chart.js
export function handleChartError(message) {
  const chartContainer = document.getElementById('chart-container');
  if (chartContainer) {
    chartContainer.innerHTML = `<p class="error">${message}</p>`;
  }
}

export function updateStats(stats) {
  const statsEl = document.getElementById('stats');
  if (!statsEl) return;
  statsEl.innerHTML = `
    <p>快取容量: ${stats.capacity}</p>
    <p>命中率: ${stats.hit_rate.toFixed(2)}%</p>
    <p>使用率: ${(stats.usage_ratio * 100).toFixed(2)}%</p>
  `;
}

export function getPrecision(value) {
  const str = value.toString();
  return str.includes('.') ? str.split('.')[1].length : 0;
} 