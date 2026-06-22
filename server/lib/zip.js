// Minimal, dependency-free ZIP writer (STORE method — no compression).
// Enough to bundle a set of text/CSV files into a single downloadable archive
// without pulling in archiver/jszip. Produces a standard .zip readable by any
// unzip tool.

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// DOS date/time. We can't read the clock in some sandboxes, so accept a fixed
// timestamp (epoch seconds) from the caller; default to a constant.
function dosDateTime(epochSeconds) {
  const d = new Date((epochSeconds || 0) * 1000);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (Math.floor(d.getUTCSeconds() / 2));
  const date = (((d.getUTCFullYear() - 1980) & 0x7f) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

/**
 * Build a ZIP buffer from entries: [{ name, content }] where content is a
 * string or Buffer. `epochSeconds` stamps every entry (pass a value from the
 * request layer since Date.now() may be unavailable here).
 */
function buildZip(entries, epochSeconds) {
  const { time, date } = dosDateTime(epochSeconds);
  const fileParts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.content) ? e.content : Buffer.from(String(e.content), 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header sig
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(0, 8);             // method = store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // compressed size
    local.writeUInt32LE(data.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    fileParts.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);       // central dir header sig
    cd.writeUInt16LE(20, 4);               // version made by
    cd.writeUInt16LE(20, 6);               // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);               // method
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const filesBuf = Buffer.concat(fileParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);        // end of central dir sig
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(filesBuf.length, 16);  // central dir offset
  end.writeUInt16LE(0, 20);

  return Buffer.concat([filesBuf, centralBuf, end]);
}

// CSV helper — array of objects → CSV string given an ordered column list.
function toCsv(cols, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

module.exports = { buildZip, toCsv };
