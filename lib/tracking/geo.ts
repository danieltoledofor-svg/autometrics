import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

/**
 * País, estado e cidade a partir do IP do visitante.
 *
 * Usa a base gratuita "IP to City Lite" da DB-IP (CC BY 4.0: a tela que mostra
 * o local precisa do crédito "Localização por IP: DB-IP"). O arquivo fica no
 * próprio servidor e é trocado uma vez por mês; nenhum IP sai daqui.
 *
 * A base tem ~130 MB. Ela é lida direto do disco, pedaço por pedaço, sem
 * carregar na memória: cada consulta lê algumas dezenas de bytes.
 */

const DIR = process.env.GEO_DB_DIR || path.join(os.tmpdir(), 'autometrics-geo');
const MARKER = Buffer.from([0xab, 0xcd, 0xef, 0x4d, 0x61, 0x78, 0x4d, 0x69, 0x6e, 0x64, 0x2e, 0x63, 0x6f, 0x6d]); // \xab\xcd\xefMaxMind.com

export interface Place { country_code: string; country: string; region: string; city: string }

type Db = { fd: number; nodeCount: number; recordSize: number; ipVersion: number; dataStart: number; ipv4Start: number; file: string };
let db: Db | null = null;
let downloading: Promise<void> | null = null;

const monthTag = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const fileFor = (tag: string) => path.join(DIR, `dbip-city-lite-${tag}.mmdb`);

function read(fd: number, offset: number, length: number): Buffer {
  const b = Buffer.allocUnsafe(length);
  fs.readSync(fd, b, 0, length, offset);
  return b;
}

/** Lê um valor da seção de dados. Devolve [valor, posição seguinte]. */
function decode(fd: number, dataStart: number, offset: number, follow = true): [any, number] {
  const ctrl = read(fd, offset++, 1)[0];
  let type = ctrl >> 5;
  if (type === 1) {                                               // ponteiro para outro ponto dos dados
    const psize = (ctrl >> 3) & 3;
    const b = read(fd, offset, psize + 1);
    const base = ctrl & 7;
    const pointer = psize === 0 ? (base << 8) | b[0]
      : psize === 1 ? 2048 + ((base << 16) | (b[0] << 8) | b[1])
      : psize === 2 ? 526336 + ((base << 24) | (b[0] << 16) | (b[1] << 8) | b[2])
      : b.readUInt32BE(0);
    const next = offset + psize + 1;
    return [follow ? decode(fd, dataStart, dataStart + pointer, true)[0] : null, next];
  }
  if (type === 0) type = 7 + read(fd, offset++, 1)[0];
  let size = ctrl & 0x1f;
  if (size === 29) size = 29 + read(fd, offset++, 1)[0];
  else if (size === 30) { size = 285 + read(fd, offset, 2).readUInt16BE(0); offset += 2; }
  else if (size === 31) { const b = read(fd, offset, 3); size = 65821 + ((b[0] << 16) | (b[1] << 8) | b[2]); offset += 3; }

  if (type === 7) {                                               // mapa
    const map: Record<string, any> = {};
    for (let i = 0; i < size; i++) {
      let key: any, value: any;
      [key, offset] = decode(fd, dataStart, offset);
      [value, offset] = decode(fd, dataStart, offset);
      map[String(key)] = value;
    }
    return [map, offset];
  }
  if (type === 11) {                                              // lista
    const list: any[] = [];
    for (let i = 0; i < size; i++) { let v: any; [v, offset] = decode(fd, dataStart, offset); list.push(v); }
    return [list, offset];
  }
  if (type === 14) return [size !== 0, offset];                   // verdadeiro/falso: o tamanho é o valor
  const b = size ? read(fd, offset, size) : Buffer.alloc(0);
  offset += size;
  if (type === 2) return [b.toString('utf8'), offset];
  if (type === 3) return [size === 8 ? b.readDoubleBE(0) : 0, offset];
  if (type === 15) return [size === 4 ? b.readFloatBE(0) : 0, offset];
  if (type === 5 || type === 6 || type === 8 || type === 9 || type === 10) {
    let n = 0;
    for (const byte of b) n = n * 256 + byte;
    return [n, offset];
  }
  return [null, offset];                                          // bytes e tipos que não usamos
}

function open(file: string): Db {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const tailSize = Math.min(size, 128 * 1024);
  const tail = read(fd, size - tailSize, tailSize);
  const at = tail.lastIndexOf(MARKER);
  if (at < 0) { fs.closeSync(fd); throw new Error('Base de localização inválida.'); }
  const metaStart = size - tailSize + at + MARKER.length;
  const [meta] = decode(fd, metaStart, metaStart);
  const nodeCount = meta.node_count, recordSize = meta.record_size, ipVersion = meta.ip_version;
  const dataStart = (nodeCount * recordSize * 2) / 8 + 16;
  const opened: Db = { fd, nodeCount, recordSize, ipVersion, dataStart, ipv4Start: 0, file };
  // Numa base IPv6, o IPv4 mora em ::/96: 96 passos pela esquerda, feitos uma vez.
  if (ipVersion === 6) {
    let node = 0;
    for (let i = 0; i < 96 && node < nodeCount; i++) node = record(opened, node, 0);
    opened.ipv4Start = node;
  }
  return opened;
}

function record(d: Db, node: number, bit: number): number {
  const bytes = (d.recordSize * 2) / 8;
  const b = read(d.fd, node * bytes, bytes);
  if (d.recordSize === 24) return bit ? b.readUIntBE(3, 3) : b.readUIntBE(0, 3);
  if (d.recordSize === 28) return bit ? ((b[3] & 0x0f) * 16777216) + b.readUIntBE(4, 3) : ((b[3] >> 4) * 16777216) + b.readUIntBE(0, 3);
  return bit ? b.readUInt32BE(4) : b.readUInt32BE(0);
}

function ipBytes(ip: string): { bytes: number[]; v4: boolean } | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every(p => p >= 0 && p <= 255) ? { bytes: parts, v4: true } : null;
  }
  if (!ip.includes(':')) return null;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined && tail ? tail.split(':') : [];
  if (tail === undefined && h.length !== 8) return null;
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    if (!/^[0-9a-f]{1,4}$/i.test(g) || Number.isNaN(n)) return null;
    bytes.push(n >> 8, n & 255);
  }
  return { bytes, v4: false };
}

/** Baixa a base do mês, descompactando direto para o disco. */
async function download(tag: string) {
  fs.mkdirSync(DIR, { recursive: true });
  const target = fileFor(tag), tmp = `${target}.baixando`;
  const res = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${tag}.mmdb.gz`);
  if (!res.ok || !res.body) throw new Error(`Base de localização indisponível (${res.status}).`);
  await pipeline(Readable.fromWeb(res.body as any), zlib.createGunzip(), fs.createWriteStream(tmp));
  fs.renameSync(tmp, target);
  for (const f of fs.readdirSync(DIR)) {
    if (f.startsWith('dbip-city-lite-') && f.endsWith('.mmdb') && path.join(DIR, f) !== target) fs.rmSync(path.join(DIR, f), { force: true });
  }
}

/**
 * Deixa a base pronta para consulta. Devolve false enquanto ela ainda não
 * existe no servidor (o download roda ao fundo e a próxima chamada já acha).
 */
export async function geoReady(wait = false): Promise<boolean> {
  const now = new Date();
  const current = monthTag(now), previous = monthTag(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const want = fileFor(current);
  if (db && db.file === want) return true;
  if (fs.existsSync(want)) {
    try { if (db) fs.closeSync(db.fd); } catch { /* já fechado */ }
    db = open(want);
    return true;
  }
  if (!downloading) {
    // A base do mês sai nos primeiros dias: se ainda não existe, fica a anterior.
    downloading = download(current).catch(() => (fs.existsSync(fileFor(previous)) ? undefined : download(previous)))
      .catch(e => { console.error('[Geo] Falha ao baixar a base:', e?.message); })
      .finally(() => { downloading = null; });
  }
  if (wait) await downloading;
  if (!db) {
    const have = [current, previous].map(fileFor).find(f => fs.existsSync(f));
    if (have) db = open(have);
  }
  return !!db;
}

const regionNames = (() => { try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch { return null; } })();

/** Local de um IP, ou null quando a base não conhece (ou ainda não está pronta). */
export function lookup(ip: string): Place | null {
  if (!db) return null;
  const parsed = ipBytes(String(ip || '').trim());
  if (!parsed) return null;
  let node = 0;
  if (parsed.v4) {
    if (db.ipVersion === 6) node = db.ipv4Start;
  } else if (db.ipVersion === 4) return null;
  for (const byte of parsed.bytes) {
    for (let bit = 7; bit >= 0 && node < db.nodeCount; bit--) node = record(db, node, (byte >> bit) & 1);
    if (node >= db.nodeCount) break;
  }
  if (node <= db.nodeCount) return null;
  const [data] = decode(db.fd, db.dataStart, db.dataStart + (node - db.nodeCount - 16));
  if (!data || typeof data !== 'object') return null;
  const code = String(data.country?.iso_code || '').toUpperCase();
  let country = data.country?.names?.['pt-BR'] || '';
  if (!country && code) { try { country = regionNames?.of(code) || ''; } catch { /* código desconhecido */ } }
  return {
    country_code: code,
    country: country || data.country?.names?.en || '',
    region: data.subdivisions?.[0]?.names?.en || '',
    city: data.city?.names?.en || '',
  };
}
