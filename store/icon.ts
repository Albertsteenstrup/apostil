// `apostil icon <service id> <https address>`: keeps the picture of the service's own site as its icon, in Apostil's store, by set and value.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { headCommit, repoId } from '../shared/git';
import { fetchIcon, hostFits, type Fetcher } from '../shared/icon-fetch';
import { SERVICES, siteOf, valuesOf } from '../shared/marks';
import type { Store } from '../shared/store';

export interface IconResult {
  saved: boolean;
  problem?: string;
  icon?: string; // the kind of picture that was kept
}

/**
 * Downloads the icon of a service and keeps it. The site is that of the known service, or `site` for a service that the next add-marks declares.
 * Only that site (and hosts under it) is reached, unless `otherSite`: the main agent gives it after the owner said yes.
 */
export async function saveIcon(store: Store, folder: string, id: string, address: string, options: { site?: string; otherSite?: boolean } = {}, fetcher?: Fetcher): Promise<IconResult> {
  const known = valuesOf(store, repoId(folder), SERVICES.id).find((value) => value.id === id);
  const site = known?.site ?? options.site;
  if (!site) return { saved: false, problem: `The service "${id}" is not known yet. Give its site: apostil icon ${id} <address> --site <its site>.` };
  let host: string;
  try {
    host = new URL(address).hostname;
  } catch {
    return { saved: false, problem: `${address} is no web address.` };
  }
  if (!options.otherSite && !hostFits(host, site)) {
    return { saved: false, problem: `${host} is not the site of "${id}", which is ${siteOf(site)}. Use an address on that site. Another site only with the owner's word (--other-site).` };
  }
  const { icon, problem } = await fetchIcon(address, site, !!options.otherSite, fetcher);
  if (!icon) return { saved: false, problem };
  const file = store.iconFile(SERVICES.id, id, icon.ending);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, icon.bytes);
  // A known service keeps the new icon at once; a new one gets it when add-marks declares it.
  if (known) {
    store.saveMarkValue(SERVICES.id, { ...known, icon: icon.ending });
    // The service is no longer one whose website refused an icon.
    store.updateMap(repoId(folder), headCommit(folder), (stored) => {
      if (!stored?.iconRefused?.some((one) => one.set === SERVICES.id && one.value === id)) return undefined;
      const { iconRefused: _refused, ...rest } = stored;
      const left = stored.iconRefused.filter((one) => !(one.set === SERVICES.id && one.value === id));
      return { ...rest, ...(left.length ? { iconRefused: left } : {}) };
    });
  }
  return { saved: true, icon: icon.ending };
}
