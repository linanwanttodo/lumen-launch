#!/usr/bin/env python3
# Regenerate locale/zh_CN/LC_MESSAGES/spotlight.mo from po/zh_CN.po
# The system has no msgfmt/xgettext (gettext package is purged), so we build
# the .mo binary by hand. Runs standalone; validates with Python gettext.
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PO = os.path.join(HERE, '..', 'po', 'zh_CN.po')
OUT = os.path.join(HERE, '..', 'locale', 'zh_CN', 'LC_MESSAGES', 'lumen-launch.mo')

STANDARD_HEADER = (b'Project-Id-Version: spotlight\nMIME-Version: 1.0\n'
                   b'Content-Type: text/plain; charset=UTF-8\n'
                   b'Content-Transfer-Encoding: 8bit\n'
                   b'Plural-Forms: nplurals=1; plural=0;\nLanguage: zh_CN\n')


def unquote(s):
    parts = re.findall(r'"((?:[^"\\]|\\.)*)"', s)
    raw = ''.join(parts).encode('utf-8')
    return (raw.replace(b'\\n', b'\n')
               .replace(b'\\t', b'\t')
               .replace(b'\\"', b'"')
               .replace(b'\\\\', b'\\'))


def main():
    with open(PO, encoding='utf-8') as f:
        content = f.read()

    blocks = re.findall(
        r'msgid\s+((?:"(?:[^"\\]|\\.)*"\s*)+)\n'
        r'msgstr\s+((?:"(?:[^"\\]|\\.)*"\s*)+)', content)

    entries = [(unquote(m), unquote(s)) for m, s in blocks]
    entries.sort(key=lambda e: e[0])
    entries = [(b'', STANDARD_HEADER)] + [e for e in entries if e[0] != b'']

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

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'wb') as f:
        f.write(struct.pack('<IIIIIII', 0x950412de, 0, n, o_table, t_table, 0, 0))
        f.write(o_pairs)
        f.write(t_pairs)
        f.write(originals)
        f.write(translations)

    print(f"wrote {n} entries to {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == '__main__':
    main()
