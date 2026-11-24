export class ApiError extends Error { constructor(message, { status, cancelled = false } = {}) { super(message); this.status=status; this.cancelled=cancelled; } }
export async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  try {
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const body = await response.json();
        message = body.message || body.error || message;
      } catch { }
      throw new ApiError(message, { status: response.status });
    }
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new ApiError('Request cancelled', { cancelled: true });
    if (error instanceof ApiError) throw error;
    throw new ApiError('Network request failed.');
  }
}
export function formatCompact(value) { return new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value||0)); }
export function formatDate(value) { if(!value)return 'Never'; return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
export function percent(value,total) { return !total?'0%':`${Math.round((Number(value||0)/total)*100)}%`; }
