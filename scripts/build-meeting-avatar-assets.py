"""Offline Blender/MPFB asset build; never executed by the application server.

Run Blender with --background --factory-startup --python this.py --
  /absolute/mpfb2/src /absolute/isolated-mpfb-home /absolute/new-output-directory
The isolated home must contain the pinned system assets and visemes02 in data/.
"""
import json
import sys
import subprocess
from pathlib import Path

import bpy


def main():
    addon_root, user_root, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
    if bpy.app.version != (4, 5, 3):
        raise ValueError('This recipe was checked with Blender 4.5.3')
    commit = subprocess.check_output(['git', '-C', str(addon_root.parent), 'rev-parse', 'HEAD'], text=True).strip()
    if commit != 'b1a2dc98776da9d1eea751b159d42cf61778fe2e':
        raise ValueError('Expected pinned MPFB 2.0.18 source checkout')
    subprocess.run(['git', '-C', str(addon_root.parent), 'diff', '--quiet', 'HEAD', '--', 'src/mpfb'], check=True)
    if output.exists():
        raise ValueError('Use a new output directory; never overwrite existing models')
    output.mkdir(parents=True)
    # Plain source checkout, isolated from the user's Blender installation/settings.
    native_extension_path = bpy.utils.extension_path_user
    bpy.utils.extension_path_user = lambda package, **kwargs: str(user_root) if package == 'mpfb' else native_extension_path(package, **kwargs)
    sys.path.insert(0, str(addon_root))
    bpy.ops.preferences.addon_enable(module='mpfb')
    from mpfb.services import HumanService, AssetService, TargetService, ExportService, FaceService, ObjectService

    def asset(name, subdir):
        resolved = AssetService.find_asset_absolute_path(name, asset_subdir=subdir)
        if not resolved:
            raise FileNotFoundError(f'Required asset missing: {subdir}/{name}')
        return resolved

    results = []
    for variant, gender, race, skin, hair, clothes in [
        ('male-asian', 1.0, {'asian': 1.0, 'african': 0.0, 'caucasian': 0.0}, 'young_asian_male.mhmat', 'short02.mhclo', 'male_casualsuit03.mhclo'),
        ('female-neutral', 0.0, {'asian': .333, 'african': .333, 'caucasian': .334}, 'young_caucasian_female.mhmat', 'ponytail01.mhclo', 'male_casualsuit03.mhclo'),
    ]:
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        macro = TargetService.get_default_macro_info_dict()
        macro.update(gender=gender, age=.5, muscle=.45, weight=.45, race=race)
        base = HumanService.create_human(macro_detail_dict=macro)
        HumanService.set_character_skin(asset(skin, 'skins'), base, skin_type='GAMEENGINE')
        HumanService.add_builtin_rig(base, 'mixamo')
        parts = [('eyes', 'low-poly.mhclo', 'Eyes'), ('eyebrows', 'eyebrow001.mhclo', 'Eyebrows'),
                 ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes'), ('tongue', 'tongue01.mhclo', 'Tongue'),
                 ('teeth', 'teeth_base.mhclo', 'Teeth'), ('hair', hair, 'Hair'), ('clothes', clothes, 'Clothes'),
                 ('clothes', 'shoes01.mhclo', 'Clothes')]
        for subdir, name, kind in parts:
            HumanService.add_mhclo_asset(asset(name, subdir), base, asset_type=kind, material_type='GAMEENGINE', subdiv_levels=0)
        root = ExportService.create_character_copy(base, name_suffix='_meeting')
        export_base = ObjectService.find_object_of_type_amongst_nearest_relatives(root, 'Basemesh')
        TargetService.bake_targets(export_base)
        FaceService.load_targets(export_base, load_microsoft_visemes=False, load_meta_visemes=True, load_arkit_faceunits=False)
        # Only opening shape is currently used. Keep matching teeth/tongue deformation.
        for key in list(export_base.data.shape_keys.key_blocks):
            if key.name not in ('Basis', 'viseme_aa'):
                export_base.shape_key_remove(key)
        FaceService.interpolate_targets(export_base)
        ExportService.bake_modifiers_remove_helpers(export_base, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
        selected = [root, *ObjectService.get_list_of_children(root)]
        for bone in root.data.bones:
            bone.name = bone.name.replace('mixamorig:', '')
        for obj in selected:
            for modifier in list(obj.modifiers):
                if modifier.type == 'SUBSURF':
                    obj.modifiers.remove(modifier)
        # Export only the prepared hierarchy, never the source design.
        bpy.ops.object.select_all(action='DESELECT')
        for obj in selected:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = root
        # Downsize only images referenced by this hierarchy; exporter embeds them.
        images = set()
        opaque_materials = set()
        cutout_materials = set()
        for obj in selected:
            if obj.type != 'MESH':
                continue
            for slot in obj.material_slots:
                if slot.material and slot.material.use_nodes:
                    cutout = any(name in obj.name.lower() for name in ('hair', 'short02', 'ponytail01', 'eyebrow', 'eyelashes'))
                    (cutout_materials if cutout else opaque_materials).add(slot.material)
                    for node in slot.material.node_tree.nodes:
                        if node.type == 'TEX_IMAGE' and node.image:
                            images.add(node.image)
        for material in opaque_materials | cutout_materials:
            bsdf = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
            alpha = bsdf.inputs['Alpha']
            links = list(alpha.links)
            alpha_source = links[0].from_socket if links else None
            for link in links:
                material.node_tree.links.remove(link)
            alpha.default_value = 1.0
            if material in cutout_materials and links:
                threshold = material.node_tree.nodes.new('ShaderNodeMath')
                threshold.operation = 'GREATER_THAN'
                threshold.inputs[1].default_value = .5
                material.node_tree.links.new(alpha_source, threshold.inputs[0])
                material.node_tree.links.new(threshold.outputs[0], alpha)
            material.use_backface_culling = material not in cutout_materials
        for image in images:
            width, height = image.size
            if max(width, height) > 1024:
                factor = 1024 / max(width, height)
                image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
        destination = output / f'{variant}.glb'
        bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_selection=True,
                                  export_animations=False, export_morph=True, export_morph_normal=False,
                                  export_morph_tangent=False, export_try_sparse_sk=False,
                                  export_image_format='JPEG', export_jpeg_quality=88)
        results.append({'variant': variant, 'bytes': destination.stat().st_size,
                        'macro': macro, 'skin': skin, 'parts': parts})
    (output / 'build.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results))


if __name__ == '__main__':
    main()
