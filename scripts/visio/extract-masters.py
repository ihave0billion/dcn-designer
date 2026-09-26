#!/usr/bin/env python3
"""Extract the Visio stencil masters the DCN Designer library uses into a
workspace asset bundle (`<out>/library/visio/`). Python 3 stdlib only.

Optional tools, used when present on PATH:
  soffice            rasterise each master's EMF panel to PNG (LibreOffice)
  magick / convert   trim PNG whitespace + normalise product photos (ImageMagick)
Without soffice no `front.png` is written (index records `png: null`); without
ImageMagick the PNG is trimmed with a small stdlib cropper instead.

Bundle format — see docs/VISIO_EXPORT_PLAN.md ("Asset bundle"):

  library/visio/index.json
  library/visio/masters/<slug>/entry.xml          <Master> element from masters.xml
  library/visio/masters/<slug>/master.xml         masterN.xml part, verbatim
  library/visio/masters/<slug>/master.xml.rels    its rels part, verbatim
  library/visio/masters/<slug>/media/<orig name>  image69.emf, ...
  library/visio/masters/<slug>/front.png          rasterised + trimmed panel
  library/visio/images/<sku>.png                  product photos

Master lookup per SKU: "<id> Front" exact, then the same name ignoring the
Cisco family prefix (N9K-C / N9K- / N3K-C — the packs are inconsistent), then
an --alias. Everything else is reported as "none" (the app falls back to a
product photo or a generated schematic panel).

Usage:
  extract-masters.py --pack stencils/nexus9000/Switches\\ -\\ Cisco\\ Nexus\\ 9000.vssx \\
      --switches seed/switches.yaml --ipn seed/ipn_routers.yaml \\
      --images reference/images --out /path/to/workspace [--clean]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import zlib
from pathlib import Path

NS = 'http://schemas.microsoft.com/office/visio/2012/main'
RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
V = '{%s}' % NS
R = '{%s}' % RNS
ET.register_namespace('', NS)
ET.register_namespace('r', RNS)

# Same-port-layout siblings only (a 24-port panel is NOT a stand-in for a 48-port
# SKU). FX3 refreshes keep the FX front panel; SG2-O is the OSFP twin of SG2-Q.
DEFAULT_ALIASES = {
    'N9K-C93180YC-FX3': 'N9K-C93180YC-FX Front',
    'N9K-C93108TC-FX3': 'N9K-C93108TC-FX Front',
    '93108TC-FX3P': 'N9K-C93108TC-FX Front',
    'N9364E-SG2-O': 'N9364E-SG2-Q Front',
}

FAMILY_PREFIX = re.compile(r'^(N9K-C|N9K-|N3K-C|N3K-)', re.I)


def norm(name: str) -> str:
    """Comparison key: drop the family prefix, upper-case."""
    return FAMILY_PREFIX.sub('', name.strip()).upper()


def slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def yaml_ids(path: Path) -> list[str]:
    """Minimal: every `- id: X` / `id: X` line, in file order, de-duplicated."""
    out: list[str] = []
    for line in path.read_text(encoding='utf-8').splitlines():
        m = re.match(r'^\s*-?\s*id:\s*["\']?([^"\'#\s]+)', line)
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


# ────────────────────────────────────────────────────────────────────
# Stencil reader (port of claude-visio-diagrams/scripts/visio_builder.py Stencil)
# ────────────────────────────────────────────────────────────────────

class Stencil:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.zf = zipfile.ZipFile(path)
        self.masters: dict[str, ET.Element] = {}
        self._targets: dict[str, str] = {}
        root = ET.fromstring(self.zf.read('visio/masters/masters.xml'))
        rels = ET.fromstring(self.zf.read('visio/masters/_rels/masters.xml.rels'))
        relmap = {r.get('Id'): r.get('Target') for r in rels}
        for m in root.findall(f'{V}Master'):
            name = m.get('Name')
            rid = m.find(f'{V}Rel').get(f'{R}id')
            self.masters[name] = m
            self._targets[name] = relmap[rid]
        self._by_norm = {norm(n): n for n in self.masters}

    def find(self, sku: str) -> tuple[str | None, str]:
        """Return (master name, how) — how in exact / prefix / none."""
        want = f'{sku} Front'
        if want in self.masters:
            return want, 'exact'
        hit = self._by_norm.get(norm(want))
        if hit:
            return hit, 'exact (name variant)'
        return None, 'none'

    def top_shape(self, name: str) -> ET.Element:
        mroot = ET.fromstring(self.zf.read('visio/masters/' + self._targets[name]))
        return mroot.find(f'{V}Shapes/{V}Shape')

    def size_of(self, name: str) -> tuple[float, float]:
        cells = {c.get('N'): c.get('V') for c in self.top_shape(name).findall(f'{V}Cell')}
        return float(cells['Width']), float(cells['Height'])

    def parts(self, name: str) -> tuple[bytes, bytes | None, dict[str, bytes]]:
        """(master.xml bytes, master.xml.rels bytes or None, {media name: bytes})."""
        target = self._targets[name]
        xml = self.zf.read('visio/masters/' + target)
        media: dict[str, bytes] = {}
        rels_bytes: bytes | None = None
        try:
            rels_bytes = self.zf.read(f'visio/masters/_rels/{target}.rels')
        except KeyError:
            return xml, None, media
        for rel in ET.fromstring(rels_bytes):
            tgt = rel.get('Target')                      # ../media/imageN.emf
            base = tgt.rsplit('/', 1)[-1]
            media[base] = self.zf.read('visio/media/' + base)
        return xml, rels_bytes, media

    def entry_xml(self, name: str) -> bytes:
        return ET.tostring(self.masters[name], encoding='utf-8', xml_declaration=False)


# ────────────────────────────────────────────────────────────────────
# PNG helpers — stdlib decode/encode for 8-bit non-interlaced gray/RGB(A)
# ────────────────────────────────────────────────────────────────────

def _png_chunks(data: bytes):
    pos = 8
    while pos < len(data):
        (ln,) = struct.unpack('>I', data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        yield typ, data[pos + 8:pos + 8 + ln]
        pos += 12 + ln


def png_info(data: bytes) -> dict | None:
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h, depth, ctype, _c, _f, interlace = struct.unpack('>IIBBBBB', data[16:29])
    return dict(width=w, height=h, depth=depth, color_type=ctype, interlace=interlace)


def png_decode(data: bytes):
    info = png_info(data)
    if not info or info['depth'] != 8 or info['interlace'] != 0 or info['color_type'] not in (0, 2, 4, 6):
        raise ValueError('unsupported PNG (need 8-bit non-interlaced gray/RGB/RGBA)')
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[info['color_type']]
    raw = zlib.decompress(b''.join(c for t, c in _png_chunks(data) if t == b'IDAT'))
    w, h = info['width'], info['height']
    stride = w * ch
    rows: list[bytearray] = []
    prev = bytearray(stride)
    pos = 0
    for _ in range(h):
        ft = raw[pos]; pos += 1
        cur = bytearray(raw[pos:pos + stride]); pos += stride
        if ft == 1:
            for i in range(ch, stride):
                cur[i] = (cur[i] + cur[i - ch]) & 255
        elif ft == 2:
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                left = cur[i - ch] if i >= ch else 0
                cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = cur[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[i] = (cur[i] + pred) & 255
        rows.append(cur)
        prev = cur
    return w, h, ch, rows


def png_encode(w: int, h: int, ch: int, rows) -> bytes:
    ctype = {1: 0, 3: 2, 2: 4, 4: 6}[ch]

    def chunk(t: bytes, b: bytes) -> bytes:
        return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)

    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def png_trim_stdlib(data: bytes, pad: int = 4, thresh: int = 245) -> bytes:
    """Crop away near-white / transparent margins."""
    w, h, ch, rows = png_decode(data)
    has_alpha = ch in (2, 4)
    color_n = ch - 1 if has_alpha else ch

    def is_bg(row: bytearray, x: int) -> bool:
        base = x * ch
        if has_alpha and row[base + ch - 1] < 16:
            return True
        return all(row[base + i] >= thresh for i in range(color_n))

    x0, y0, x1, y1 = w, h, -1, -1
    for y, row in enumerate(rows):
        for x in range(w):
            if not is_bg(row, x):
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    if x1 < 0:
        return data
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w - 1, x1 + pad), min(h - 1, y1 + pad)
    out = [bytearray(rows[y][x0 * ch:(x1 + 1) * ch]) for y in range(y0, y1 + 1)]
    return png_encode(x1 - x0 + 1, y1 - y0 + 1, ch, out)


# ────────────────────────────────────────────────────────────────────
# External tools
# ────────────────────────────────────────────────────────────────────

def which(*names: str) -> str | None:
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    return None


# LibreOffice draws the EMF onto a Letter-sized page; the default PNG export is
# 96 dpi (a 19 in panel ends up 741 px wide — too coarse for print). The JSON
# filter options (LibreOffice ≥ 7.4) set the raster size; keep the page's
# 8.5:11 aspect so nothing is clipped. 3200 px wide → a 1RU panel ≈ 2900×130 px.
PNG_PIXEL_W, PNG_PIXEL_H = 3200, 4140


def emf_to_png(soffice: str, emf: Path, workdir: Path) -> Path | None:
    filt = ('png:draw_png_Export:{"PixelWidth":{"type":"long","value":"%d"},'
            '"PixelHeight":{"type":"long","value":"%d"}}' % (PNG_PIXEL_W, PNG_PIXEL_H))
    subprocess.run([soffice, '--headless', '--convert-to', filt, '--outdir', str(workdir), str(emf)],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    out = workdir / (emf.stem + '.png')
    if not out.exists():   # older LibreOffice without JSON filter options
        subprocess.run([soffice, '--headless', '--convert-to', 'png', '--outdir', str(workdir), str(emf)],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    return out if out.exists() else None


def trim_png(magick: str | None, src: Path, dst: Path) -> str:
    if magick:
        cmd = [magick, str(src), '-trim', '+repage', '-define', 'png:color-type=6',
               '-depth', '8', 'PNG32:' + str(dst)]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return 'imagemagick'
    dst.write_bytes(png_trim_stdlib(src.read_bytes()))
    return 'stdlib'


def normalise_photo(magick: str | None, src: Path, dst: Path) -> str | None:
    """Product photo → 8-bit non-interlaced RGBA PNG. Returns how, or None if skipped."""
    if magick:
        subprocess.run([magick, str(src), '-depth', '8', '-interlace', 'none', 'PNG32:' + str(dst)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return 'imagemagick'
    data = src.read_bytes()
    info = png_info(data)
    if info and info['depth'] == 8 and info['interlace'] == 0 and info['color_type'] in (0, 2, 4, 6):
        dst.write_bytes(data)
        return 'copied'
    return None


# ────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pack', action='append', required=True, help='.vssx stencil (repeatable)')
    ap.add_argument('--switches', type=Path, help='seed/switches.yaml (ids)')
    ap.add_argument('--ipn', type=Path, help='seed/ipn_routers.yaml (ids)')
    ap.add_argument('--sku', action='append', default=[], help='extra SKU (repeatable)')
    ap.add_argument('--images', type=Path, help='dir of product photos named <sku>.png/.jpg')
    ap.add_argument('--alias', action='append', default=[], help='SKU=MasterName (repeatable)')
    ap.add_argument('--no-default-aliases', action='store_true')
    ap.add_argument('--out', type=Path, required=True, help='workspace root; writes <out>/library/visio/')
    ap.add_argument('--clean', action='store_true', help='wipe <out>/library/visio first')
    ap.add_argument('--no-png', action='store_true', help='skip EMF rasterisation even if soffice exists')
    a = ap.parse_args(argv)

    skus: list[str] = []
    for p in (a.switches, a.ipn):
        if p:
            for s in yaml_ids(p):
                if s not in skus:
                    skus.append(s)
    for s in a.sku:
        if s not in skus:
            skus.append(s)
    if not skus:
        ap.error('no SKUs (give --switches/--ipn/--sku)')

    aliases = {} if a.no_default_aliases else dict(DEFAULT_ALIASES)
    for spec in a.alias:
        k, _, v = spec.partition('=')
        aliases[k.strip()] = v.strip()

    stencils = [Stencil(Path(p)) for p in a.pack]
    out = a.out / 'library' / 'visio'
    if a.clean and out.exists():
        shutil.rmtree(out)
    (out / 'masters').mkdir(parents=True, exist_ok=True)
    (out / 'images').mkdir(parents=True, exist_ok=True)

    soffice = None if a.no_png else which('soffice', 'libreoffice')
    magick = which('magick', 'convert')
    print(f'tools: soffice={soffice or "-"}  imagemagick={magick or "-"}', file=sys.stderr)

    # ---- resolve every SKU ----
    rows: list[tuple[str, str, str]] = []          # sku, master or '', how
    wanted: dict[str, Stencil] = {}                # master name -> stencil
    used_aliases: dict[str, str] = {}
    for sku in skus:
        name, how = None, 'none'
        for st in stencils:
            name, how = st.find(sku)
            if name:
                wanted[name] = st
                break
        if not name and sku in aliases:
            for st in stencils:
                if aliases[sku] in st.masters:
                    name, how = aliases[sku], f'alias → {aliases[sku]}'
                    wanted[name] = st
                    used_aliases[sku] = name
                    break
            if not name:
                how = f'alias target missing: {aliases[sku]}'
        rows.append((sku, name or '', how))

    # ---- extract masters ----
    masters_index: dict[str, dict] = {}
    tmp = Path(tempfile.mkdtemp(prefix='visio-extract-'))
    for name, st in sorted(wanted.items()):
        slug = slugify(name)
        d = out / 'masters' / slug
        (d / 'media').mkdir(parents=True, exist_ok=True)
        xml, rels, media = st.parts(name)
        (d / 'entry.xml').write_bytes(st.entry_xml(name))
        (d / 'master.xml').write_bytes(xml)
        if rels is not None:
            (d / 'master.xml.rels').write_bytes(rels)
        for mname, mbytes in media.items():
            (d / 'media' / mname).write_bytes(mbytes)
        w, h = st.size_of(name)
        png_rel: str | None = None
        if soffice:
            for mname in media:
                if not mname.lower().endswith('.emf'):
                    continue
                emf = d / 'media' / mname
                raw = emf_to_png(soffice, emf, tmp)
                if raw:
                    how_trim = trim_png(magick, raw, d / 'front.png')
                    png_rel = f'masters/{slug}/front.png'
                    print(f'  png {name}: {how_trim}', file=sys.stderr)
                    break
        elif (d / 'front.png').exists():
            png_rel = f'masters/{slug}/front.png'      # keep a previous run's PNG
        masters_index[name] = dict(slug=slug, width_in=round(w, 4), height_in=round(h, 4),
                                   media=sorted(media), png=png_rel)
    shutil.rmtree(tmp, ignore_errors=True)

    # ---- product photos ----
    images_index: dict[str, str] = {}
    photo_notes: list[str] = []
    if a.images and a.images.is_dir():
        by_norm = {norm(s): s for s in skus}
        for f in sorted(a.images.iterdir()):
            if f.suffix.lower() not in ('.png', '.jpg', '.jpeg'):
                continue
            sku = by_norm.get(norm(f.stem))
            if not sku:
                continue
            dst = out / 'images' / f'{sku}.png'
            how = normalise_photo(magick, f, dst)
            if how:
                images_index[sku] = f'images/{sku}.png'
            else:
                photo_notes.append(f'{f.name}: not an 8-bit non-interlaced PNG and no ImageMagick — skipped')

    # ---- index.json ----
    index = dict(
        schema_version=1,
        generated_at=_dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        packs=[dict(family=st.path.parent.name, file=st.path.name, sha256=sha256_of(st.path)) for st in stencils],
        masters=masters_index,
        aliases=used_aliases,
        images=images_index,
    )
    (out / 'index.json').write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')

    # ---- summary ----
    print()
    print(f'{"SKU":22s} {"resolution":28s} master')
    print('-' * 80)
    none: list[str] = []
    for sku, name, how in rows:
        photo = images_index.get(sku)
        if name:
            res = how
        elif photo:
            res = 'photo'
        else:
            res = 'NONE (schematic fallback)'
            none.append(sku)
        extra = f'  + photo' if (name and photo) else ''
        print(f'{sku:22s} {res:28s} {name}{extra}')
    for n in photo_notes:
        print('note:', n)
    print()
    print(f'wrote {out}: {len(masters_index)} masters, {len(images_index)} photos, '
          f'{sum(1 for m in masters_index.values() if m["png"])} front PNGs')
    if none:
        print('no coverage:', ', '.join(none))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
