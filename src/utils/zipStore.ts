/** ZIP archive with STORE (no compression). JPEG/PNG are already compressed. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function u16(n: number): [number, number] {
  return [n & 0xff, (n >>> 8) & 0xff];
}

function u32(n: number): [number, number, number, number] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

export function zipStore(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name.replace(/\\/g, '/'));
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;
    const local = new Uint8Array(30 + name.length + size);
    let o = 0;
    const put = (bytes: number[]) => {
      local.set(bytes, o);
      o += bytes.length;
    };
    put([0x50, 0x4b, 0x03, 0x04]);
    put(u16(20));
    put(u16(1 << 11));
    put(u16(0));
    put(u16(0));
    put(u16(0));
    put(u32(crc));
    put(u32(size));
    put(u32(size));
    put(u16(name.length));
    put(u16(0));
    local.set(name, o);
    o += name.length;
    local.set(data, o);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    o = 0;
    const putc = (bytes: number[]) => {
      central.set(bytes, o);
      o += bytes.length;
    };
    putc([0x50, 0x4b, 0x01, 0x02]);
    putc(u16(20));
    putc(u16(20));
    putc(u16(1 << 11));
    putc(u16(0));
    putc(u16(0));
    putc(u16(0));
    putc(u32(crc));
    putc(u32(size));
    putc(u32(size));
    putc(u16(name.length));
    putc(u16(0));
    putc(u16(0));
    putc(u16(0));
    putc(u16(0));
    putc(u32(0));
    putc(u32(offset));
    central.set(name, o);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  let o = 0;
  const pute = (bytes: number[]) => {
    eocd.set(bytes, o);
    o += bytes.length;
  };
  pute([0x50, 0x4b, 0x05, 0x06]);
  pute(u16(0));
  pute(u16(0));
  pute(u16(entries.length));
  pute(u16(entries.length));
  pute(u32(centralSize));
  pute(u32(offset));
  pute(u16(0));

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of locals) {
    out.set(part, p);
    p += part.length;
  }
  for (const part of centrals) {
    out.set(part, p);
    p += part.length;
  }
  out.set(eocd, p);
  return out;
}
