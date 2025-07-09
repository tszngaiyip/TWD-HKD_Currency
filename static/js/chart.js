// static/js/chart.js
export function handleChartError(message) {
  const chartContainer = document.getElementById('chart-container');
  if (chartContainer) {
    chartContainer.innerHTML = `<p class="error">${message}</p>`;
  }
}

 