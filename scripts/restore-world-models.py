#!/usr/bin/env python3
"""Restore local model files referenced by world_objects in a PostgreSQL COPY dump.
Does not connect to the database or start/call Docker. Existing files are preserved.
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MAX_FILE = 256 * 1024 * 1024


def model_paths(dump):
    paths = set()
    columns = None
    for line in dump.read_text(encoding='utf-8').splitlines():
        match = re.match(r'COPY public\.world_objects \((.*?)\) FROM stdin;', line)
        if match:
            columns = [c.strip().strip('"') for c in match[1].split(',')]
            continue
        if columns is None:
            continue
        if line == r'\.':
            break
        values = line.split('\t')
        value = values[columns.index('model_path')]
        if not value.startswith('/models/uploaded/'):
            continue
        if '\\' in value or '..' in PurePosixPath(value).parts or '?' in value or '#' in value:
            raise ValueError('Unsafe model path: ' + value)
        if PurePosixPath(value).suffix.lower() in ('.glb', '.gltf', '.obj'):
            paths.add(value)
    if columns is None:
        raise ValueError('world_objects COPY section not found')
    return sorted(paths)


def restore(model_path, source, destination):
    target = destination / model_path.lstrip('/')
    if target.is_file():
        return {'path': model_path, 'status': 'existing', 'bytes': target.stat().st_size}
    temporary = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        url = source.rstrip('/') + urllib.parse.quote(model_path)
        request = urllib.request.Request(url, headers={'User-Agent': 'virtual-world-model-restore/1.0'})
        with urllib.request.urlopen(request, timeout=45) as response:
            if urllib.parse.urlsplit(response.url).hostname != urllib.parse.urlsplit(source).hostname:
                raise ValueError('Redirect to a different host')
            length = int(response.headers.get('Content-Length') or 0)
            if length > MAX_FILE:
                raise ValueError('File exceeds 256 MiB limit')
            with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.restore-', delete=False) as output:
                temporary = Path(output.name)
                size = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_FILE or shutil.disk_usage(destination).free < 512 * 1024 * 1024:
                        raise ValueError('File limit or free disk reserve reached')
                    output.write(chunk)
        if not size or (length and size != length):
            raise ValueError('Incomplete download')
        if target.suffix.lower() == '.glb':
            with temporary.open('rb') as data:
                header = data.read(12)
            if len(header) != 12:
                raise ValueError('Missing GLB header')
            magic, version, declared = struct.unpack('<4sII', header)
            if magic != b'glTF' or version != 2 or declared != size:
                raise ValueError('Invalid GLB header or length')
        elif target.suffix.lower() == '.gltf':
            json.loads(temporary.read_text())
        else:
            raise ValueError('OBJ dependencies need separate restoration; not installed automatically')
        temporary.chmod(0o644)
        os.replace(temporary, target)
        temporary = None
        return {'path': model_path, 'status': 'downloaded', 'bytes': size}
    except Exception as error:
        return {'path': model_path, 'status': 'failed', 'error': str(error)}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dump', type=Path, default=ROOT / 'db_export.sql')
    parser.add_argument('--destination', type=Path, default=ROOT / 'public')
    parser.add_argument('--source', default='https://miduo100.com')
    parser.add_argument('--workers', type=int, default=3, choices=range(1, 5))
    parser.add_argument('--report', type=Path, default=ROOT / 'model-restore-report.json')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--download', action='store_true',
                        help='Explicitly download legacy demo assets; default is audit only')
    args = parser.parse_args()
    if urllib.parse.urlsplit(args.source).scheme != 'https':
        parser.error('Source must use HTTPS')
    paths = model_paths(args.dump)
    existing = sum((args.destination / p.lstrip('/')).is_file() for p in paths)
    print(f'Model paths: {len(paths)}; existing: {existing}; missing: {len(paths)-existing}', flush=True)
    if args.dry_run or not args.download:
        print('Audit only. Legacy demo assets are downloaded only with --download.', flush=True)
        return
    args.destination.mkdir(parents=True, exist_ok=True)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        tasks = [executor.submit(restore, p, args.source, args.destination) for p in paths]
        for future in concurrent.futures.as_completed(tasks):
            item = future.result()
            results.append(item)
            print(f'[{len(results)}/{len(paths)}] {item["status"]}: {item["path"]}' + (' — ' + item['error'] if 'error' in item else ''), flush=True)
    summary = {status: sum(r['status'] == status for r in results) for status in ['existing', 'downloaded', 'failed']}
    summary['downloadedBytes'] = sum(r.get('bytes', 0) for r in results if r['status'] == 'downloaded')
    args.report.write_text(json.dumps({'source': args.source, 'scope': 'world_objects /models/uploaded model paths; no database or Docker changes', 'summary': summary, 'results': sorted(results, key=lambda r: r['path'])}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary), flush=True)
    return 1 if summary['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
