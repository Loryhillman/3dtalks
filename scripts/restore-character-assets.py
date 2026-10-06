#!/usr/bin/env python3
"""Audit/download character template assets referenced by a pg_dump COPY snapshot.

Does not touch PostgreSQL or Docker. Downloads only files under /uploads/ from
an explicitly supplied origin and checks basic file signatures.
"""
import argparse
import concurrent.futures
from pathlib import Path
import re
import urllib.request
import urllib.error

TABLES = {'character_templates', 'animation_library', 'weapons'}
ASSET = re.compile(r'/uploads/[A-Za-z0-9_./-]+\.(?:glb|gltf|fbx|png|jpg|jpeg|webp|mp3|wav)', re.I)

def references(dump):
    active = False
    paths = set()
    with dump.open('r', encoding='utf-8', errors='replace') as source:
        for line in source:
            if line.startswith('COPY public.'):
                active = line.split(' ', 2)[1].removeprefix('public.') in TABLES
                continue
            if active and line.startswith('\\.'):
                active = False
            elif active:
                paths.update(ASSET.findall(line))
    return sorted(paths)

def is_valid(path):
    if not path.is_file() or path.stat().st_size == 0:
        return False
    if path.suffix.lower() == '.glb':
        with path.open('rb') as f:
            return f.read(4) == b'glTF'
    return True

def download(item):
    rel, root, origin = item
    target = root / rel.lstrip('/')
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + '.part')
    url = origin.rstrip('/') + rel
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 character-asset-recovery'})
        with urllib.request.urlopen(request, timeout=45) as response, temp.open('wb') as output:
            if response.status != 200:
                raise RuntimeError(f'HTTP {response.status}')
            length = response.headers.get('Content-Length')
            received = 0
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
                received += len(block)
            if length and received != int(length):
                raise RuntimeError(f'incomplete {received}/{length}')
        if temp.stat().st_size == 0:
            raise RuntimeError('empty file')
        if target.suffix.lower() == '.glb':
            with temp.open('rb') as check:
                if check.read(4) != b'glTF':
                    raise RuntimeError('invalid GLB signature')
        temp.replace(target)
        return rel, None
    except Exception as error:
        temp.unlink(missing_ok=True)
        return rel, str(error)

parser = argparse.ArgumentParser()
parser.add_argument('--dump', type=Path, default=Path('transfer/db_export.sql'))
parser.add_argument('--root', type=Path, default=Path('transfer/assets/public'))
parser.add_argument('--origin', default='https://miduo100.com')
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
refs = references(args.dump)
missing = [p for p in refs if not is_valid(args.root / p.lstrip('/')) and not is_valid(Path('public') / p.lstrip('/'))]
print(f'Referenced: {len(refs)}; missing from transfer and source: {len(missing)}')
for p in missing:
    print(p)
if args.download and missing:
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        for path, error in executor.map(download, ((p, args.root, args.origin) for p in missing)):
            if error:
                failures.append((path, error))
            else:
                print('downloaded', path)
    for path, error in failures:
        print('FAILED', path, error)
    print(f'Downloaded: {len(missing)-len(failures)}; failed: {len(failures)}')
    if failures:
        raise SystemExit(1)
