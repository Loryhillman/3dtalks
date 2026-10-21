"""Offline preparation of one pinned CC0 asset; never used by uploads."""
import argparse
import copy
import hashlib
import json
import struct
from pathlib import Path

SOURCE_SHA = '63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c'
COMPONENT = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
DIMENSIONS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def prepare(source):
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA:
        raise ValueError('Expected the pinned MPFB source; other assets are unsupported')
    json_size = struct.unpack_from('<I', source, 12)[0]
    original = json.loads(source[20:20 + json_size])
    binary_offset = 20 + json_size
    binary_size, binary_type = struct.unpack_from('<II', source, binary_offset)
    if binary_type != 0x004E4942 or original.get('animations'):
        raise ValueError('Unexpected source layout')
    binary = source[binary_offset + 8:binary_offset + 8 + binary_size]
    result = copy.deepcopy(original)
    result['accessors'], result['bufferViews'] = [], []
    output = bytearray()
    accessor_map = {}

    def view_bytes(index):
        view = original['bufferViews'][index]
        start = view.get('byteOffset', 0)
        return binary[start:start + view['byteLength']]

    def append_view(data):
        output.extend(bytes((-len(output)) % 4))
        index = len(result['bufferViews'])
        result['bufferViews'].append({'buffer': 0, 'byteOffset': len(output), 'byteLength': len(data)})
        output.extend(data)
        return index

    def accessor(index):
        if index in accessor_map:
            return accessor_map[index]
        a = original['accessors'][index]
        element_bytes = COMPONENT[a['componentType']] * DIMENSIONS[a['type']]
        size = a['count'] * element_bytes
        if size > 16 * 1024 * 1024:
            raise ValueError('Unexpected accessor budget')
        data = bytearray(size)
        if 'bufferView' in a:
            view = original['bufferViews'][a['bufferView']]
            source_view = view_bytes(a['bufferView'])
            stride, offset = view.get('byteStride', element_bytes), a.get('byteOffset', 0)
            for i in range(a['count']):
                item = source_view[offset + i * stride:offset + i * stride + element_bytes]
                if len(item) != element_bytes:
                    raise ValueError('Accessor outside source')
                data[i * element_bytes:(i + 1) * element_bytes] = item
        if 'sparse' in a:
            sparse = a['sparse']
            indices, values = sparse['indices'], sparse['values']
            index_data, value_data = view_bytes(indices['bufferView']), view_bytes(values['bufferView'])
            index_bytes = COMPONENT[indices['componentType']]
            index_format = {5121: '<B', 5123: '<H', 5125: '<I'}[indices['componentType']]
            for i in range(sparse['count']):
                target = struct.unpack_from(index_format, index_data, indices.get('byteOffset', 0) + i * index_bytes)[0]
                offset = values.get('byteOffset', 0) + i * element_bytes
                item = value_data[offset:offset + element_bytes]
                if target >= a['count'] or len(item) != element_bytes:
                    raise ValueError('Sparse accessor outside source')
                data[target * element_bytes:(target + 1) * element_bytes] = item
        converted = {k: copy.deepcopy(v) for k, v in a.items() if k not in ('sparse', 'bufferView', 'byteOffset')}
        converted['bufferView'] = append_view(data)
        converted['byteOffset'] = 0
        mapped = len(result['accessors'])
        result['accessors'].append(converted)
        accessor_map[index] = mapped
        return mapped

    for mesh_index, mesh in enumerate(result['meshes']):
        names = original['meshes'][mesh_index].get('extras', {}).get('targetNames', [])
        selected = [i for i, name in enumerate(names) if name.startswith('viseme_') or name in ('jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight')]
        mesh.setdefault('extras', {})['targetNames'] = [names[i] for i in selected]
        if 'weights' in mesh:
            mesh['weights'] = [0] * len(selected)
        for primitive in mesh['primitives']:
            primitive['attributes'] = {k: accessor(v) for k, v in primitive['attributes'].items()}
            if 'indices' in primitive:
                primitive['indices'] = accessor(primitive['indices'])
            if 'targets' in primitive:
                targets = primitive['targets']
                primitive['targets'] = [{k: accessor(v) for k, v in targets[i].items()} for i in selected]
                if not selected:
                    del primitive['targets']
    for node in result['nodes']:
        if 'weights' in node:
            node['weights'] = [0] * len(result['meshes'][node['mesh']]['extras']['targetNames'])
    for skin in result.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = accessor(skin['inverseBindMatrices'])
    for image in result.get('images', []):
        image['bufferView'] = append_view(view_bytes(image['bufferView']))
    result['buffers'] = [{'byteLength': len(output)}]
    result['asset']['generator'] = '3DTalks pinned MPFB research preparation; mouth/blink subset, dense accessors'
    raw_json = json.dumps(result, separators=(',', ':'), allow_nan=False).encode()
    raw_json += b' ' * ((-len(raw_json)) % 4)
    output.extend(bytes((-len(output)) % 4))
    total = 28 + len(raw_json) + len(output)
    if total > 40 * 1024 * 1024:
        raise ValueError('Prepared GLB exceeds existing body upload limit')
    glb = struct.pack('<III', 0x46546C67, 2, total)
    glb += struct.pack('<II', len(raw_json), 0x4E4F534A) + raw_json
    glb += struct.pack('<II', len(output), 0x004E4942) + output
    return glb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve() or args.output.exists():
        parser.error('Use a new output path; never overwrite the source or an existing asset')
    if args.source.stat().st_size > 40 * 1024 * 1024:
        parser.error('Source too large')
    prepared = prepare(args.source.read_bytes())
    with args.output.open('xb') as target:
        target.write(prepared)
    print(json.dumps({'bytes': len(prepared), 'sha256': hashlib.sha256(prepared).hexdigest()}))


if __name__ == '__main__':
    main()
