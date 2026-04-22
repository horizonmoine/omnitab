/**
 * Curated lists of guitars and amplifiers, used by the AmpAutoConfig page
 * to seed the autocomplete Combobox. Free-text is still accepted — these
 * are SUGGESTIONS, not enums.
 *
 * Why curate? An LLM gets dramatically more accurate tone advice with a
 * canonical model name ("Fender Stratocaster American Pro II") than with
 * a typo or a colloquialism ("strato pro 2"). Suggestions = guardrails.
 *
 * Why not exhaustive? 30 guitars × 30 amps covers ~95 % of what most
 * players have. Power users can type the long-tail freely.
 */

export interface InstrumentSuggestion {
  /** Full canonical name. */
  name: string;
  /** Short manufacturer + model for display. */
  short: string;
  /** Tags for ranking (genre / era / pickup type). */
  tags: string[];
}

/** ~30 popular guitars, ordered roughly by mainstream familiarity. */
export const GUITARS: InstrumentSuggestion[] = [
  // Fenders
  { name: 'Fender Stratocaster American Pro II', short: 'Strat AmPro II', tags: ['strat', 'single-coil', 'modern'] },
  { name: 'Fender Stratocaster Player', short: 'Strat Player', tags: ['strat', 'single-coil', 'budget'] },
  { name: 'Fender Stratocaster Vintera 60s', short: 'Strat Vintera 60s', tags: ['strat', 'single-coil', 'vintage'] },
  { name: 'Fender Telecaster American Pro II', short: 'Tele AmPro II', tags: ['tele', 'single-coil', 'twang'] },
  { name: 'Fender Telecaster Player', short: 'Tele Player', tags: ['tele', 'single-coil', 'budget'] },
  { name: 'Fender Jaguar', short: 'Jaguar', tags: ['offset', 'single-coil', 'indie'] },
  { name: 'Fender Jazzmaster', short: 'Jazzmaster', tags: ['offset', 'single-coil', 'indie', 'shoegaze'] },
  { name: 'Fender Mustang', short: 'Mustang', tags: ['offset', 'short-scale', 'indie'] },

  // Gibsons / Epiphones
  { name: 'Gibson Les Paul Standard', short: 'Les Paul Std', tags: ['lespaul', 'humbucker', 'rock'] },
  { name: 'Gibson Les Paul Studio', short: 'Les Paul Studio', tags: ['lespaul', 'humbucker', 'rock'] },
  { name: 'Gibson SG Standard', short: 'SG Standard', tags: ['sg', 'humbucker', 'rock', 'metal'] },
  { name: 'Gibson Explorer', short: 'Explorer', tags: ['humbucker', 'metal'] },
  { name: 'Gibson Flying V', short: 'Flying V', tags: ['humbucker', 'metal'] },
  { name: 'Gibson ES-335', short: 'ES-335', tags: ['semi-hollow', 'humbucker', 'jazz', 'blues'] },
  { name: 'Epiphone Les Paul Standard 60s', short: 'Epi LP 60s', tags: ['lespaul', 'humbucker', 'budget'] },

  // Ibanez (metal/shred)
  { name: 'Ibanez RG550', short: 'RG550', tags: ['superstrat', 'humbucker', 'metal', 'shred'] },
  { name: 'Ibanez JEM7V (Steve Vai)', short: 'JEM7V', tags: ['superstrat', 'humbucker', 'shred'] },
  { name: 'Ibanez S Series', short: 'Ibanez S', tags: ['superstrat', 'humbucker', 'metal'] },
  { name: 'Ibanez RGA / Iron Label', short: 'Iron Label', tags: ['superstrat', 'humbucker', 'djent', 'metal'] },

  // PRS
  { name: 'PRS Custom 24', short: 'PRS Custom 24', tags: ['prs', 'humbucker', 'modern', 'rock'] },
  { name: 'PRS SE Standard', short: 'PRS SE', tags: ['prs', 'humbucker', 'budget'] },
  { name: 'PRS Silver Sky', short: 'Silver Sky', tags: ['prs', 'single-coil', 'strat-like'] },

  // ESP / Schecter (metal)
  { name: 'ESP LTD EC-1000', short: 'LTD EC-1000', tags: ['lespaul', 'humbucker', 'metal'] },
  { name: 'Schecter Hellraiser', short: 'Hellraiser', tags: ['superstrat', 'humbucker', 'metal'] },

  // Gretsch (twang / rockabilly)
  { name: 'Gretsch G5422', short: 'Gretsch 5422', tags: ['hollowbody', 'filtertron', 'rockabilly', 'jazz'] },
  { name: 'Gretsch White Falcon', short: 'White Falcon', tags: ['hollowbody', 'filtertron', 'jazz'] },

  // Acoustic & misc
  { name: 'Martin D-28 (acoustique)', short: 'Martin D-28', tags: ['acoustic'] },
  { name: 'Taylor 814ce (acoustique)', short: 'Taylor 814ce', tags: ['acoustic', 'electro-acoustic'] },
  { name: 'Rickenbacker 330', short: 'Ricky 330', tags: ['semi-hollow', 'jangle', 'indie'] },
  { name: 'Fender Squier (générique)', short: 'Squier', tags: ['budget'] },
];

/** ~30 popular amplifiers — covers vintage to modern, jazz to metal. */
export const AMPS: InstrumentSuggestion[] = [
  // Fender (clean / blues)
  { name: 'Fender Twin Reverb', short: 'Twin Reverb', tags: ['fender', 'clean', 'blues'] },
  { name: 'Fender Deluxe Reverb', short: 'Deluxe Reverb', tags: ['fender', 'clean', 'blues'] },
  { name: 'Fender Princeton Reverb', short: 'Princeton', tags: ['fender', 'clean', 'low-watt'] },
  { name: 'Fender Bassman', short: 'Bassman', tags: ['fender', 'crunch', 'tweed'] },
  { name: 'Fender Hot Rod Deluxe', short: 'Hot Rod Deluxe', tags: ['fender', 'crunch', 'modern'] },

  // Marshall (rock / classic)
  { name: 'Marshall JCM800 2203', short: 'JCM800', tags: ['marshall', 'crunch', 'rock', 'metal'] },
  { name: 'Marshall JCM900', short: 'JCM900', tags: ['marshall', 'high-gain', 'rock'] },
  { name: 'Marshall Plexi 1959 Super Lead', short: 'Plexi 1959', tags: ['marshall', 'crunch', 'classic-rock'] },
  { name: 'Marshall DSL40CR', short: 'DSL40', tags: ['marshall', 'modern', 'gigging'] },
  { name: 'Marshall Origin 20', short: 'Origin 20', tags: ['marshall', 'budget', 'home'] },

  // Vox (chime / Britpop)
  { name: 'Vox AC30', short: 'AC30', tags: ['vox', 'chime', 'britpop', 'indie'] },
  { name: 'Vox AC15', short: 'AC15', tags: ['vox', 'chime', 'low-watt'] },

  // Mesa Boogie (modern high-gain)
  { name: 'Mesa Boogie Dual Rectifier', short: 'Dual Rec', tags: ['mesa', 'high-gain', 'metal'] },
  { name: 'Mesa Boogie Mark V', short: 'Mark V', tags: ['mesa', 'versatile', 'metal'] },
  { name: 'Mesa Boogie Triple Rectifier', short: 'Triple Rec', tags: ['mesa', 'high-gain', 'metal'] },

  // Peavey (US heavy)
  { name: 'Peavey 5150 / 6505', short: '5150', tags: ['peavey', 'high-gain', 'metal'] },
  { name: 'Peavey Classic 30', short: 'Classic 30', tags: ['peavey', 'crunch', 'budget'] },

  // Orange (UK heavy)
  { name: 'Orange Rockerverb 50', short: 'Rockerverb 50', tags: ['orange', 'crunch', 'stoner', 'metal'] },
  { name: 'Orange Crush 35RT', short: 'Crush 35', tags: ['orange', 'budget', 'home'] },

  // Boutique
  { name: 'Friedman BE-100', short: 'Friedman BE-100', tags: ['boutique', 'high-gain', 'modded-marshall'] },
  { name: 'Bogner Shiva', short: 'Bogner Shiva', tags: ['boutique', 'versatile'] },
  { name: 'Matchless DC-30', short: 'Matchless DC-30', tags: ['boutique', 'chime', 'class-a'] },

  // Modelers / digital
  { name: 'Line 6 Helix LT', short: 'Helix LT', tags: ['modeler', 'digital', 'versatile'] },
  { name: 'Fractal Axe-Fx III', short: 'Axe-Fx III', tags: ['modeler', 'digital', 'pro'] },
  { name: 'Kemper Profiler', short: 'Kemper', tags: ['modeler', 'digital', 'pro'] },
  { name: 'Boss Katana 50 MkII', short: 'Katana 50', tags: ['modeler', 'budget', 'home'] },
  { name: 'Positive Grid Spark 40', short: 'Spark 40', tags: ['modeler', 'budget', 'home'] },

  // Other interfaces / direct
  { name: 'iRig Micro Amp', short: 'iRig Micro', tags: ['portable', 'mobile'] },
  { name: 'Direct In (DAW / casque)', short: 'DI', tags: ['direct', 'home'] },
  { name: 'Random combo bas de gamme', short: 'Combo lambda', tags: ['budget', 'home'] },
];

/**
 * Fuzzy filter — case- and accent-insensitive substring match against
 * `name`, `short`, AND `tags`. Used by the Combobox while typing.
 */
export function filterSuggestions<T extends InstrumentSuggestion>(
  list: T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  // Normalize accents — 'éclair' should match 'eclair'.
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nq = normalize(q);
  return list
    .filter((item) => {
      const haystack = normalize(`${item.name} ${item.short} ${item.tags.join(' ')}`);
      return haystack.includes(nq);
    })
    .slice(0, limit);
}
