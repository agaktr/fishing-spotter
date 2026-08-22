import type { SpotCategory, TechniqueId } from "./types";

export interface TechniqueProfile {
  id: TechniqueId;
  label: string;
  aliases: string[];
  description: string;
  spotFit: Partial<Record<SpotCategory, number>>;
  idealDepth: {
    min: number;
    max: number;
    softMin: number;
    softMax: number;
  };
  waves: {
    idealMin: number;
    idealMax: number;
    maxSafe: number;
  };
  currentKmh: {
    idealMin: number;
    idealMax: number;
    maxSafe: number;
  };
  species: string[];
  rigs: string[];
  baits: string[];
  bestTimes: string[];
  castingAdvice: string;
}

export const TECHNIQUE_PROFILES: Record<TechniqueId, TechniqueProfile> = {
  surfcasting: {
    id: "surfcasting",
    label: "Surfcasting",
    aliases: ["surfcasting", "surf casting", "beach casting", "beachcasting", "casting", "ψάρεμα παραλίας", "παραλια", "παραλία"],
    description: "Μακρινές βολές από παραλίες και ανοιχτές ακτές σε αυλάκια, ξέρες και μικτά κομμάτια.",
    spotFit: {
      beach: 98,
      bay: 82,
      estuary: 84,
      shoal: 78,
      headland: 58,
      breakwater: 52,
      rocky: 45,
      harbour: 40,
      pier: 62,
      reef: 48,
      marina: 25,
      fallback: 55,
    },
    idealDepth: { min: 4, max: 12, softMin: 2, softMax: 18 },
    waves: { idealMin: 0.35, idealMax: 1.25, maxSafe: 1.9 },
    currentKmh: { idealMin: 0.25, idealMax: 1.8, maxSafe: 3.5 },
    species: ["τσιπούρα", "λαβράκι", "σαργός", "κέφαλος", "μελανούρι", "σαλάχια"],
    rigs: ["long pulley rig", "paternoster", "συρόμενο μονάγκιστρο", "διπλάρι"],
    baits: ["σκουλήκι", "καλαμάρι", "γαρίδα", "φιλέτο σαρδέλας", "μύδι"],
    bestTimes: ["σούρουπο", "πρώτες ώρες νύχτας", "ξημέρωμα", "ανερχόμενη κίνηση νερού"],
    castingAdvice: "Ξεκίνα στα 60-120μ και μετά μίκρυνε τη βολή αν τα ψάρια τρώνε στο πρώτο αυλάκι.",
  },
  spinning: {
    id: "spinning",
    label: "Spinning",
    aliases: ["spinning", "lure fishing", "lures", "σπινινγκ", "σπίνινγκ", "τεχνητά", "τεχνητα"],
    description: "Κινητό ψάρεμα με τεχνητά γύρω από ρεύματα, περάσματα αφρόψαρων, μπούκες και σημεία ενέδρας.",
    spotFit: {
      headland: 95,
      rocky: 92,
      breakwater: 88,
      estuary: 82,
      pier: 75,
      reef: 84,
      harbour: 68,
      beach: 62,
      bay: 58,
      shoal: 66,
      marina: 42,
      fallback: 55,
    },
    idealDepth: { min: 2, max: 15, softMin: 1, softMax: 28 },
    waves: { idealMin: 0.15, idealMax: 0.9, maxSafe: 1.6 },
    currentKmh: { idealMin: 0.4, idealMax: 2.2, maxSafe: 4 },
    species: ["λαβράκι", "λούτσος", "γοφάρι", "λίτσα", "παλαμίδα", "ζαργάνα"],
    rigs: ["minnow", "pencil", "metal vibe", "σιλικόνη", "topwater σε χαμηλό φως"],
    baits: ["τεχνητά σε χρώματα αφρόψαρων", "λευκές σιλικόνες", "minnow τύπου σαρδέλας"],
    bestTimes: ["ξημέρωμα", "σούρουπο", "λωρίδες ανέμου", "δραστηριότητα αφρόψαρων"],
    castingAdvice: "Κάνε βολές βεντάλια πρώτα στα ρεύματα και μετά δούλεψε παράλληλα σε βράχια ή μώλους.",
  },
  "shore-jigging": {
    id: "shore-jigging",
    label: "Shore Jigging",
    aliases: ["shore jigging", "shorejigging", "jigging", "shore jig", "τζιγκινγκ", "τζίγκινγκ", "shore τζιγκινγκ", "τζιγκινγκ ακτής"],
    description: "Βαρύτερα τεχνητά από την ακτή για βαθύτερα νερά σε βράχια, κάβους και κυματοθραύστες.",
    spotFit: {
      headland: 98,
      rocky: 94,
      breakwater: 90,
      reef: 88,
      pier: 70,
      harbour: 60,
      beach: 35,
      bay: 44,
      shoal: 74,
      marina: 28,
      fallback: 50,
    },
    idealDepth: { min: 10, max: 35, softMin: 5, softMax: 55 },
    waves: { idealMin: 0.1, idealMax: 0.85, maxSafe: 1.45 },
    currentKmh: { idealMin: 0.5, idealMax: 2.5, maxSafe: 4.5 },
    species: ["μαγιάτικο", "παλαμίδα", "συναγρίδα", "λούτσος", "γοφάρι", "ροφός κοντά σε δομή"],
    rigs: ["metal jig 20-60g", "slow jig", "casting jig", "assist hooks"],
    baits: ["metal jigs", "jigs σε χρώματα αφρόψαρων", "glow jigs σε χαμηλό φως"],
    bestTimes: ["ανατολή", "δύση", "ζωντανό ρεύμα", "περάσματα αφρόψαρων"],
    castingAdvice: "Προτίμησε βαθιά νερά στα 30-80μ από την ακτή και μέτρα το βύθισμα του jig για να βρεις τη ζώνη.",
  },
  eging: {
    id: "eging",
    label: "Eging",
    aliases: ["eging", "squid", "squid fishing", "egi", "cuttlefish", "καλαμάρια", "καλαμαρια", "σουπιές", "σουπιες"],
    description: "Ψάρεμα για καλαμάρια και σουπιές γύρω από καθαρά νερά, φυκιάδες, φώτα και λιμενικές δομές.",
    spotFit: {
      harbour: 92,
      marina: 86,
      pier: 88,
      breakwater: 86,
      rocky: 76,
      reef: 72,
      bay: 70,
      beach: 45,
      headland: 70,
      shoal: 60,
      fallback: 54,
    },
    idealDepth: { min: 3, max: 10, softMin: 1.5, softMax: 18 },
    waves: { idealMin: 0, idealMax: 0.45, maxSafe: 0.9 },
    currentKmh: { idealMin: 0.1, idealMax: 1.1, maxSafe: 2.2 },
    species: ["καλαμάρι", "σουπιά", "θράψαλο", "μικρά αρπακτικά γύρω από φώτα"],
    rigs: ["egi 2.5-3.5", "slow sink egi", "deep egi σε ρεύμα", "λεπτό fluorocarbon παράμαλλο"],
    baits: ["φυσικά χρώματα γαρίδας", "πορτοκαλί/ροζ egi", "glow egi τη νύχτα"],
    bestTimes: ["νύχτα", "σούρουπο", "φωτισμένα λιμάνια", "καθαρό και ήρεμο νερό"],
    castingAdvice: "Δούλεψε όρια φυκιάδας και γραμμές φωτός με παύσεις αρκετές ώστε το egi να πλησιάζει τον βυθό.",
  },
  "bottom-fishing": {
    id: "bottom-fishing",
    label: "Ψάρεμα Βυθού",
    aliases: ["bottom fishing", "bottom", "ledgering", "ledger", "bait fishing", "ψάρεμα βυθού", "πατωτό", "πατωτο", "δολωτό", "δολωτο"],
    description: "Ψάρεμα με δόλωμα στον βυθό από μώλους, βράχια, παραλίες και προβλήτες.",
    spotFit: {
      pier: 90,
      breakwater: 88,
      harbour: 82,
      beach: 76,
      rocky: 78,
      reef: 80,
      bay: 66,
      headland: 72,
      marina: 44,
      shoal: 70,
      fallback: 56,
    },
    idealDepth: { min: 5, max: 22, softMin: 2, softMax: 40 },
    waves: { idealMin: 0, idealMax: 0.9, maxSafe: 1.7 },
    currentKmh: { idealMin: 0.2, idealMax: 1.8, maxSafe: 3.8 },
    species: ["τσιπούρα", "σαργός", "λυθρίνι", "κέφαλος", "χειλού", "μουγγρί κοντά σε βράχια"],
    rigs: ["συρόμενο", "paternoster", "συρόμενο μολύβι", "κοντό παράμαλλο κοντά σε βράχια"],
    baits: ["γαρίδα", "σκουλήκι", "μύδι", "καλαμάρι", "σαρδέλα"],
    bestTimes: ["ξημέρωμα", "σούρουπο", "νύχτα", "μέτριο ρεύμα"],
    castingAdvice: "Κράτα πρώτα βυθό και μετά ελάφρυνε το μολύβι αν το ρεύμα αφήνει το δόλωμα να δουλεύει φυσικά.",
  },
  "rock-fishing": {
    id: "rock-fishing",
    label: "Ψάρεμα στα Βράχια",
    aliases: ["rock fishing", "rocks", "rockfishing", "float fishing", "float", "βράχια", "βραχια", "ψάρεμα στα βράχια", "απίκο", "απικο", "φελλός", "φελλος"],
    description: "Κοντινό ψάρεμα με δόλωμα, φελλό ή τεχνητό από ασφαλείς πλάκες και πατήματα βράχων.",
    spotFit: {
      rocky: 98,
      headland: 92,
      reef: 86,
      breakwater: 78,
      pier: 72,
      harbour: 62,
      beach: 30,
      bay: 52,
      shoal: 62,
      fallback: 50,
    },
    idealDepth: { min: 3, max: 18, softMin: 1, softMax: 35 },
    waves: { idealMin: 0, idealMax: 0.65, maxSafe: 1.15 },
    currentKmh: { idealMin: 0.15, idealMax: 1.6, maxSafe: 3 },
    species: ["χειλού", "σαργός", "τσιπούρα", "σκορπίνα", "ροφός", "λαβράκι"],
    rigs: ["αρματωσιά φελλού", "ελαφρύ πατωτό", "weedless σιλικόνη", "κοντό paternoster"],
    baits: ["γαρίδα", "μύδι", "σκουλήκι", "μικρό καβούρι", "λωρίδες καλαμαριού"],
    bestTimes: ["ήρεμα πρωινά", "σούρουπο", "καθαρό νερό", "ασφαλές χαμηλό swell"],
    castingAdvice: "Ψάρεψε πρώτα κοντά: ακμές βράχων, λωρίδες αφρού και αλλαγές βάθους στα 5-30μ.",
  },
  "boat-fishing": {
    id: "boat-fishing",
    label: "Ψάρεμα από Βάρκα",
    aliases: ["boat fishing", "boat", "kayak", "offshore", "βάρκα", "βαρκα", "ψάρεμα από βάρκα", "καγιάκ", "kayak"],
    description: "Ψάρεμα από σκάφος πάνω από ξέρες, κατεβάσματα, κανάλια και βαθύτερες δομές.",
    spotFit: {
      reef: 94,
      shoal: 88,
      headland: 78,
      rocky: 76,
      harbour: 62,
      marina: 64,
      bay: 58,
      breakwater: 54,
      pier: 45,
      beach: 35,
      fallback: 50,
    },
    idealDepth: { min: 15, max: 60, softMin: 8, softMax: 120 },
    waves: { idealMin: 0, idealMax: 0.7, maxSafe: 1.2 },
    currentKmh: { idealMin: 0.2, idealMax: 2.2, maxSafe: 4 },
    species: ["συναγρίδα", "μαγιάτικο", "ροφός", "λυθρίνι", "παλαμίδα", "καλαμάρι πάνω από φυκιάδα"],
    rigs: ["slow jig", "tenya", "ζωντανό σε drift", "καθετή βυθού", "συρτή με minnow"],
    baits: ["ζωντανό", "καλαμάρι", "σαρδέλα", "jigs", "inchiku"],
    bestTimes: ["στρωμένος καιρός", "αλλαγή από μπουνάτσα σε κίνηση", "ανατολή", "δομή επιβεβαιωμένη με βυθόμετρο"],
    castingAdvice: "Χρησιμοποίησε τον χάρτη μόνο για προγραμματισμό. Επιβεβαίωσε βάθος και ασφάλεια με ναυτικούς χάρτες και όργανα σκάφους.",
  },
};

export const DEFAULT_TECHNIQUE: TechniqueId = "surfcasting";

export function getTechniqueProfile(id: TechniqueId): TechniqueProfile {
  return TECHNIQUE_PROFILES[id];
}

export function findTechniqueByAlias(query: string): TechniqueProfile | undefined {
  const normalized = query.toLowerCase();
  const profiles = Object.values(TECHNIQUE_PROFILES);
  const aliases = profiles
    .flatMap((profile) => profile.aliases.map((alias) => ({ alias, profile })))
    .sort((a, b) => b.alias.length - a.alias.length);

  return aliases.find(({ alias }) => normalized.includes(alias))?.profile;
}
