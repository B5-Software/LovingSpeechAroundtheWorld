import { selectBestRelay } from './relaySelector.js';
import { safeFetch } from './network.js';

export async function fetchRelayManifest(directoryBaseUrl) {
  const data = await safeFetch(`${directoryBaseUrl}/api/relays`);
  if (!data) return [];
  return data.relays ?? [];
}

export async function chooseRelay(directoryBaseUrl) {
  const relays = await fetchRelayManifest(directoryBaseUrl);
  return selectBestRelay(relays);
}
