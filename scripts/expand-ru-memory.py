#!/usr/bin/env python3
"""Reuse existing reviewed Russian text for identical English source strings."""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'i18n'
english = json.loads((ROOT / 'en-US.json').read_text(encoding='utf-8'))
russian = json.loads((ROOT / 'ru-RU.json').read_text(encoding='utf-8'))


def flatten(tree, prefix=''):
    for key, value in tree.items():
        name = f'{prefix}.{key}' if prefix else key
        if isinstance(value, dict):
            yield from flatten(value, name)
        else:
            yield name, value


def put(tree, key, value):
    parts = key.split('.')
    for part in parts[:-1]:
        tree = tree.setdefault(part, {})
    tree[parts[-1]] = value


source = dict(flatten(english))
translated = dict(flatten(russian))
memory = defaultdict(set)
for key, value in translated.items():
    memory[source[key]].add(value)

added = 0
for key, text in source.items():
    if key not in translated and len(memory[text]) == 1:
        put(russian, key, next(iter(memory[text])))
        added += 1

(ROOT / 'ru-RU.json').write_text(json.dumps(russian, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Reused {added} exact translations; now {len(dict(flatten(russian)))}/{len(source)} keys')
