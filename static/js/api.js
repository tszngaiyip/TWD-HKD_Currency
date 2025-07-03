// static/js/api.js
export async function fetchChart(period, fromCurrency = 'TWD', toCurrency = 'HKD', forceLive = false) {
  const params = new URLSearchParams({ period, from_currency: fromCurrency, to_currency: toCurrency, force_live: forceLive });
  const res = await fetch(`/api/chart?${params}`);
  if (!res.ok) throw new Error('圖表載入失敗');
  return await res.json();
}

export async function loadLatestRate(fromCurrency = 'TWD', toCurrency = 'HKD') {
  const params = new URLSearchParams({ from_currency: fromCurrency, to_currency: toCurrency });
  const res = await fetch(`/api/latest_rate?${params}`);
  if (!res.ok) throw new Error('匯率載入失敗');
  return await res.json();
}

export function triggerPregeneration(fromCurrency = 'TWD', toCurrency = 'HKD') {
  fetch(`/api/pregenerate_charts?from_currency=${fromCurrency}&to_currency=${toCurrency}`)
    .then(response => response.json())
    .then(data => console.log('🚀 預生成回應:', data))
    .catch(error => console.error('❌ 預生成錯誤:', error));
} 