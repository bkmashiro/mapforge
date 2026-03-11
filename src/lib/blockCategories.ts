// Based on mapartcraft coloursJSON colour set IDs 0-60
// Each colour set has a representative block that determines its category
export type BlockCategory = 'natural' | 'stone' | 'wood' | 'metal' | 'terracotta' | 'wool' | 'misc';

// Map colourSetId → category
// IDs based on mapartcraft coloursJSON order
export const colourCategories: Record<number, BlockCategory> = {
  0: 'natural',      // Grass
  1: 'natural',      // Sand
  2: 'misc',         // Cobweb
  3: 'natural',      // Lava/Fire/TNT (red)
  4: 'natural',      // Ice
  5: 'metal',        // Iron
  6: 'natural',      // Leaves (foliage)
  7: 'natural',      // Snow
  8: 'natural',      // Clay
  9: 'natural',      // Dirt
  10: 'stone',       // Stone
  11: 'natural',     // Water
  12: 'wood',        // Wood (oak)
  13: 'stone',       // Quartz
  14: 'wool',        // Wool/Concrete (orange)
  15: 'wool',        // Magenta
  16: 'wool',        // Light Blue
  17: 'wool',        // Yellow
  18: 'wool',        // Lime
  19: 'wool',        // Pink
  20: 'wool',        // Gray
  21: 'wool',        // Light Gray
  22: 'wool',        // Cyan
  23: 'wool',        // Purple
  24: 'wool',        // Blue
  25: 'wool',        // Brown
  26: 'wool',        // Green
  27: 'wool',        // Red
  28: 'wool',        // Black
  29: 'metal',       // Gold
  30: 'metal',       // Diamond
  31: 'misc',        // Lapis
  32: 'metal',       // Emerald
  33: 'wood',        // Spruce
  34: 'wood',        // Nether
  35: 'terracotta',  // Terracotta (white)
  36: 'terracotta',  // Orange Terracotta
  37: 'terracotta',  // Magenta Terracotta
  38: 'terracotta',  // Light Blue Terracotta
  39: 'terracotta',  // Yellow Terracotta
  40: 'terracotta',  // Lime Terracotta
  41: 'terracotta',  // Pink Terracotta
  42: 'terracotta',  // Gray Terracotta
  43: 'terracotta',  // Cyan Terracotta
  44: 'terracotta',  // Purple Terracotta
  45: 'terracotta',  // Blue Terracotta
  46: 'terracotta',  // Brown Terracotta
  47: 'terracotta',  // Green Terracotta
  48: 'terracotta',  // Red Terracotta
  49: 'terracotta',  // Black Terracotta
  50: 'stone',       // Crimson Nylium
  51: 'wood',        // Crimson Stem
  52: 'misc',        // Crimson Hyphae
  53: 'stone',       // Warped Nylium
  54: 'wood',        // Warped Stem
  55: 'misc',        // Warped Hyphae
  56: 'stone',       // Warped Wart
  57: 'stone',       // Deepslate
  58: 'stone',       // Raw Iron
  59: 'natural',     // Glow Lichen
  60: 'misc',        // Extra
};

export const CATEGORY_ORDER: BlockCategory[] = [
  'natural',
  'stone',
  'wood',
  'metal',
  'terracotta',
  'wool',
  'misc',
];

export function getCategory(colourSetId: number): BlockCategory {
  return colourCategories[colourSetId] ?? 'misc';
}
