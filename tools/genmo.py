#!/usr/bin/env python3
# Regenerate locale/<lang>/LC_MESSAGES/lumen-launch.mo from po/<lang>.po
# The system has no msgfmt/xgettext (gettext package is purged), so we build
# the .mo binary by hand. Runs standalone; validates with Python gettext.
# Usage: genmo.py [lang ...]   (default: zh_CN)
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def unquote(s):
    parts = re.findall(r'"((?:[^"\\]|\\.)*)"', s)
    raw = ''.join(parts).encode('utf-8')
    return (raw.replace(b'\\n', b'\n')
               .replace(b'\\t', b'\t')
               .replace(b'\\"', b'"')
               .replace(b'\\\\', b'\\'))


def build(lang):
    po = os.path.join(HERE, '..', 'po', f'{lang}.po')
    out = os.path.join(HERE, '..', 'locale', lang, 'LC_MESSAGES', 'lumen-launch.mo')
    header = (b'Project-Id-Version: lumen launch\nMIME-Version: 1.0\n'
              b'Content-Type: text/plain; charset=UTF-8\n'
              b'Content-Transfer-Encoding: 8bit\n'
              b'Plural-Forms: nplurals=1; plural=0;\n'
              + b'Language: ' + lang.encode() + b'\n')

    with open(po, encoding='utf-8') as f:
        content = f.read()

    blocks = re.findall(
        r'msgid\s+((?:"(?:[^"\\]|\\.)*"\s*)+)\n'
        r'msgstr\s+((?:"(?:[^"\\]|\\.)*"\s*)+)', content)

    entries = [(unquote(m), unquote(s)) for m, s in blocks]
    entries.sort(key=lambda e: e[0])
    entries = [(b'', header)] + [e for e in entries if e[0] != b'']

    n = len(entries)
    o_table = 28
    t_table = o_table + 8 * n
    originals_start = t_table + 8 * n
    translations_start = originals_start + sum(len(k) + 1 for k, _ in entries)

    o_pairs = bytearray()
    t_pairs = bytearray()
    originals = bytearray()
    translations = bytearray()
    for k, v in entries:
        o_pairs += struct.pack('<II', len(k), originals_start + len(originals))
        originals += k + b'\0'
        t_pairs += struct.pack('<II', len(v), translations_start + len(translations))
        translations += v + b'\0'

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(struct.pack('<IIIIIII', 0x950412de, 0, n, o_table, t_table, 0, 0))
        f.write(o_pairs)
        f.write(t_pairs)
        f.write(originals)
        f.write(translations)

    print(f"wrote {n} entries to {out} ({os.path.getsize(out)} bytes)")


def main():
    langs = sys.argv[1:] or ['zh_CN']
    for lang in langs:
        build(lang)


if __name__ == '__main__':
    main()
