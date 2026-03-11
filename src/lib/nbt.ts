import pako from 'pako';
import type { MapPixel, McVersion } from './types.js';

// NBT tag types
export const enum TagType {
  End = 0,
  Byte = 1,
  Short = 2,
  Int = 3,
  Long = 4,
  Float = 5,
  Double = 6,
  ByteArray = 7,
  String = 8,
  List = 9,
  Compound = 10,
  IntArray = 11,
  LongArray = 12,
}

// Minecraft DataVersion per release
const DATA_VERSIONS: Record<McVersion, number> = {
  '1.20': 3463,
  '1.19': 3105,
  '1.18.2': 2860,
  '1.17.1': 2730,
  '1.16.5': 2586,
};

export class NBTWriter {
  private buf: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor() {
    this.buf = new Uint8Array(1 << 20); // 1 MB initial
    this.view = new DataView(this.buf.buffer);
  }

  private grow(needed: number) {
    if (this.offset + needed <= this.buf.length) return;
    let newLen = this.buf.length * 2;
    while (newLen < this.offset + needed) newLen *= 2;
    const next = new Uint8Array(newLen);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  writeByte(v: number) {
    this.grow(1);
    this.view.setInt8(this.offset++, v);
  }

  writeUByte(v: number) {
    this.grow(1);
    this.view.setUint8(this.offset++, v);
  }

  writeShort(v: number) {
    this.grow(2);
    this.view.setInt16(this.offset, v, false);
    this.offset += 2;
  }

  writeInt(v: number) {
    this.grow(4);
    this.view.setInt32(this.offset, v, false);
    this.offset += 4;
  }

  writeLong(lo: number, hi: number) {
    // Write as two Int32 big-endian (hi first, then lo)
    this.grow(8);
    this.view.setInt32(this.offset, hi, false);
    this.view.setInt32(this.offset + 4, lo, false);
    this.offset += 8;
  }

  writeFloat(v: number) {
    this.grow(4);
    this.view.setFloat32(this.offset, v, false);
    this.offset += 4;
  }

  writeDouble(v: number) {
    this.grow(8);
    this.view.setFloat64(this.offset, v, false);
    this.offset += 8;
  }

  writeString(s: string) {
    const encoded = new TextEncoder().encode(s);
    this.grow(2 + encoded.length);
    this.view.setUint16(this.offset, encoded.length, false);
    this.offset += 2;
    this.buf.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  writeByteArray(arr: Uint8Array | number[]) {
    const len = arr instanceof Uint8Array ? arr.length : arr.length;
    this.grow(4 + len);
    this.writeInt(len);
    for (let i = 0; i < len; i++) {
      this.writeUByte(arr instanceof Uint8Array ? arr[i] : arr[i]);
    }
  }

  writeIntArray(arr: number[]) {
    this.grow(4 + arr.length * 4);
    this.writeInt(arr.length);
    for (const v of arr) this.writeInt(v);
  }

  writeLongArray(arr: [number, number][]) {
    this.grow(4 + arr.length * 8);
    this.writeInt(arr.length);
    for (const [hi, lo] of arr) this.writeLong(lo, hi);
  }

  // Tag header: type byte + name string
  private writeTagHeader(type: TagType, name: string) {
    this.writeUByte(type);
    this.writeString(name);
  }

  writeByteTag(name: string, v: number) {
    this.writeTagHeader(TagType.Byte, name);
    this.writeByte(v);
  }

  writeShortTag(name: string, v: number) {
    this.writeTagHeader(TagType.Short, name);
    this.writeShort(v);
  }

  writeIntTag(name: string, v: number) {
    this.writeTagHeader(TagType.Int, name);
    this.writeInt(v);
  }

  writeLongTag(name: string, hi: number, lo: number) {
    this.writeTagHeader(TagType.Long, name);
    this.writeLong(lo, hi);
  }

  writeStringTag(name: string, v: string) {
    this.writeTagHeader(TagType.String, name);
    this.writeString(v);
  }

  writeByteArrayTag(name: string, arr: Uint8Array | number[]) {
    this.writeTagHeader(TagType.ByteArray, name);
    this.writeByteArray(arr);
  }

  writeIntArrayTag(name: string, arr: number[]) {
    this.writeTagHeader(TagType.IntArray, name);
    this.writeIntArray(arr);
  }

  writeLongArrayTag(name: string, arr: [number, number][]) {
    this.writeTagHeader(TagType.LongArray, name);
    this.writeLongArray(arr);
  }

  // Compound tag: writes header, calls fn to write children, then writes TAG_End
  writeCompoundTag(name: string, fn: () => void) {
    this.writeTagHeader(TagType.Compound, name);
    fn();
    this.writeUByte(TagType.End); // TAG_End
  }

  // List tag: all items must be same type
  writeListTag(name: string, itemType: TagType, items: (() => void)[]) {
    this.writeTagHeader(TagType.List, name);
    this.writeUByte(itemType);
    this.writeInt(items.length);
    for (const fn of items) fn();
  }

  finish(compress = true): Uint8Array {
    const data = this.buf.slice(0, this.offset);
    return compress ? pako.gzip(data) : data;
  }
}

// ── Varint encoding (for BlockData in .schem) ─────────────────────────────────

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0; // treat as unsigned
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return bytes;
}

// ── Block state string builder ────────────────────────────────────────────────

type VersionEntry = { NBTName: string; NBTArgs: Record<string, string> } | string;
type BlockVersions = Record<string, VersionEntry>;

function resolveVersionEntry(validVersions: BlockVersions, version: string): { NBTName: string; NBTArgs: Record<string, string> } | null {
  const entry = validVersions[version];
  if (!entry) return null;
  if (typeof entry === 'string' && entry.startsWith('&')) {
    // Reference to another version e.g. "&1.12.2"
    return resolveVersionEntry(validVersions, entry.slice(1));
  }
  if (typeof entry === 'string') return null; // unknown string format
  return entry;
}

function blockStateString(
  pixel: MapPixel,
  coloursJSON: Record<string, { blocks: Record<string, { validVersions: BlockVersions }> }>,
  version: McVersion
): string {
  const colourSet = coloursJSON[String(pixel.colourSetId)];
  if (!colourSet) return 'minecraft:stone';

  const block = colourSet.blocks[pixel.blockId];
  if (!block) return 'minecraft:stone';

  const resolved = resolveVersionEntry(block.validVersions, version);
  if (!resolved) return 'minecraft:stone';

  const { NBTName, NBTArgs } = resolved;
  const name = NBTName.startsWith('minecraft:') ? NBTName : `minecraft:${NBTName}`;
  const args = Object.entries(NBTArgs);
  if (args.length === 0) return name;
  const props = args.map(([k, v]) => `${k}=${v}`).join(',');
  return `${name}[${props}]`;
}

// ── WorldEdit .schem v2 ───────────────────────────────────────────────────────

export function generateSchem(
  pixels: MapPixel[][],
  version: McVersion,
  coloursJSON: Record<string, { blocks: Record<string, { validVersions: Record<string, { NBTName: string; NBTArgs: Record<string, string> } | string> }> }>
): Uint8Array {
  const height = pixels.length;    // Z dimension (rows)
  const width = pixels[0]?.length ?? 0; // X dimension (cols)
  const layers = 1;               // Y = 1 block tall

  // Build block state palette
  const stateToId = new Map<string, number>();
  const idToState: string[] = [];

  function getOrAdd(state: string): number {
    if (stateToId.has(state)) return stateToId.get(state)!;
    const id = idToState.length;
    stateToId.set(state, id);
    idToState.push(state);
    return id;
  }

  // Always add air at 0
  getOrAdd('minecraft:air');

  // Collect block data indices
  // Schematic layout: Width(X) × Height(Y) × Length(Z)
  // Y=0 only, X iterates fastest, then Z
  const blockIndices: number[] = [];
  for (let z = 0; z < height; z++) {
    for (let y = 0; y < layers; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = pixels[z][x];
        const state = blockStateString(pixel, coloursJSON, version);
        blockIndices.push(getOrAdd(state));
      }
    }
  }

  // Encode block data as varint bytes
  const varintBytes: number[] = [];
  for (const idx of blockIndices) {
    varintBytes.push(...encodeVarint(idx));
  }

  const dataVersion = DATA_VERSIONS[version];
  const writer = new NBTWriter();

  writer.writeCompoundTag('Schematic', () => {
    writer.writeIntTag('Version', 2);
    writer.writeIntTag('DataVersion', dataVersion);

    writer.writeCompoundTag('Metadata', () => {
      writer.writeStringTag('Name', 'MapForge Export');
      writer.writeIntTag('WEOffsetX', 0);
      writer.writeIntTag('WEOffsetY', 0);
      writer.writeIntTag('WEOffsetZ', 0);
    });

    writer.writeShortTag('Width', width);
    writer.writeShortTag('Height', layers);
    writer.writeShortTag('Length', height);

    writer.writeIntTag('PaletteMax', idToState.length);

    writer.writeCompoundTag('Palette', () => {
      for (let i = 0; i < idToState.length; i++) {
        writer.writeIntTag(idToState[i], i);
      }
    });

    writer.writeByteArrayTag('BlockData', varintBytes);

    // Offset
    writer.writeIntArrayTag('Offset', [0, 0, 0]);
  });

  return writer.finish(true);
}

// ── Litematica .litematic ─────────────────────────────────────────────────────

function bigIntToHiLo(n: bigint): [number, number] {
  const lo = Number(BigInt.asIntN(32, n));
  const hi = Number(BigInt.asIntN(32, n >> 32n));
  return [hi, lo];
}

export function generateLitematic(
  pixels: MapPixel[][],
  version: McVersion,
  name: string,
  coloursJSON: Record<string, { blocks: Record<string, { validVersions: Record<string, { NBTName: string; NBTArgs: Record<string, string> } | string> }> }>
): Uint8Array {
  const sizeZ = pixels.length;
  const sizeX = pixels[0]?.length ?? 0;
  const sizeY = 1;
  const volume = sizeX * sizeY * sizeZ;
  const dataVersion = DATA_VERSIONS[version];

  // Build block state palette
  const stateToId = new Map<string, number>();
  const idToState: string[] = [];

  function getOrAdd(state: string): number {
    if (stateToId.has(state)) return stateToId.get(state)!;
    const id = idToState.length;
    stateToId.set(state, id);
    idToState.push(state);
    return id;
  }

  // Air must be index 0
  getOrAdd('minecraft:air');

  // Collect pixel block ids (litematic: X varies fastest, then Z, then Y)
  // For a flat structure: Y=0, iterate X then Z
  const blockIds: number[] = new Array(volume).fill(0);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const pixel = pixels[z][x];
      const state = blockStateString(pixel, coloursJSON, version);
      const id = getOrAdd(state);
      // Index: y * sizeX * sizeZ + z * sizeX + x  (Y outer, Z middle, X inner)
      blockIds[0 * sizeX * sizeZ + z * sizeX + x] = id;
    }
  }

  // Litematica uses packed long arrays
  // bits per entry = max(2, ceil(log2(palette size)))
  const paletteSize = idToState.length;
  const bitsPerEntry = Math.max(2, Math.ceil(Math.log2(paletteSize || 1)));
  const entriesPerLong = Math.floor(64 / bitsPerEntry);
  const longCount = Math.ceil(volume / entriesPerLong);
  const packed: [number, number][] = [];

  let currentLong = 0n;
  let bitPos = 0;
  let longIndex = 0;

  for (let i = 0; i < volume; i++) {
    const id = BigInt(blockIds[i]);
    const mask = (1n << BigInt(bitsPerEntry)) - 1n;
    currentLong |= (id & mask) << BigInt(bitPos);
    bitPos += bitsPerEntry;
    if (bitPos + bitsPerEntry > 64 || i === volume - 1) {
      packed.push(bigIntToHiLo(BigInt.asIntN(64, currentLong)));
      longIndex++;
      currentLong = 0n;
      bitPos = 0;
    }
  }

  // Pad to longCount if needed
  while (packed.length < longCount) {
    packed.push([0, 0]);
  }

  const now = BigInt(Date.now());
  const nowHiLo = bigIntToHiLo(BigInt.asIntN(64, now));

  const writer = new NBTWriter();

  writer.writeCompoundTag('', () => {
    writer.writeIntTag('MinecraftDataVersion', dataVersion);
    writer.writeIntTag('Version', 5);

    writer.writeCompoundTag('Metadata', () => {
      writer.writeStringTag('Name', name);
      writer.writeStringTag('Author', 'MapForge');
      writer.writeLongTag('TimeCreated', nowHiLo[0], nowHiLo[1]);
      writer.writeLongTag('TimeModified', nowHiLo[0], nowHiLo[1]);

      writer.writeCompoundTag('EnclosingSize', () => {
        writer.writeIntTag('x', sizeX);
        writer.writeIntTag('y', sizeY);
        writer.writeIntTag('z', sizeZ);
      });

      writer.writeIntTag('RegionCount', 1);
      writer.writeLongTag('TotalBlocks', 0, volume);
      writer.writeLongTag('TotalVolume', 0, volume);

      writer.writeListTag('PreviewImageData', TagType.Int, []);
    });

    writer.writeCompoundTag('Regions', () => {
      writer.writeCompoundTag(name, () => {
        writer.writeCompoundTag('Position', () => {
          writer.writeIntTag('x', 0);
          writer.writeIntTag('y', 0);
          writer.writeIntTag('z', 0);
        });

        writer.writeCompoundTag('Size', () => {
          writer.writeIntTag('x', sizeX);
          writer.writeIntTag('y', sizeY);
          writer.writeIntTag('z', sizeZ);
        });

        // Block state palette
        writer.writeListTag('BlockStatePalette', TagType.Compound, idToState.map((state) => () => {
          // Parse "minecraft:block[prop=val,...]" format
          const bracketIdx = state.indexOf('[');
          let blockName: string;
          let props: Record<string, string> = {};

          if (bracketIdx !== -1) {
            blockName = state.slice(0, bracketIdx);
            const propsStr = state.slice(bracketIdx + 1, -1);
            for (const kv of propsStr.split(',')) {
              const [k, v] = kv.split('=');
              if (k && v) props[k] = v;
            }
          } else {
            blockName = state;
          }

          writer.writeStringTag('Name', blockName);
          if (Object.keys(props).length > 0) {
            writer.writeCompoundTag('Properties', () => {
              for (const [k, v] of Object.entries(props)) {
                writer.writeStringTag(k, v);
              }
            });
          }
        }));

        // Packed block states
        writer.writeLongArrayTag('BlockStates', packed);

        // Empty entity/tile entity lists
        writer.writeListTag('Entities', TagType.Compound, []);
        writer.writeListTag('TileEntities', TagType.Compound, []);

        writer.writeLongTag('TotalBlocks', 0, volume);
      });
    });
  });

  return writer.finish(true);
}
