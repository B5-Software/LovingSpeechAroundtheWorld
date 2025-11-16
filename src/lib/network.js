import { createLogger } from './logger.js';

const logger = createLogger('network');

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data;
}

export async function postJson(url, body) {
  return fetchJson(url, { method: 'POST', body });
}

export async function getJson(url) {
  return fetchJson(url, { method: 'GET' });
}

export function safeFetch(url, options = {}) {
  return fetchJson(url, options).catch((err) => {
    logger.warn(`safeFetch failed for ${url}`, err.message);
    return null;
  });
}
