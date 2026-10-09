"""
render_previews.py -- re-import exported GLBs into a fresh scene, validate them and render previews.

Usage (from the project root, PowerShell):
  & "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup `
      --python tools/blender/render_previews.py -- --models public/assets/models --out tools/blender/previews [--only bench] [--no-render]

For every <name>.glb it prints (prefix VALID):
  - glTF JSON facts: node names / TRS, materials (doubleSided, factors, emission), triangle count,
    bounding box in three.js space computed straight from accessor min/max
  - Blender re-import facts: objects, origins, world bbox (Blender + converted to three.js), tris
and renders tools/blender/previews/<name>.png (3/4 front view, front = Blender -Y) plus <name>_alt.png.
"""
import argparse
import json
import math
import os
import struct
import sys

import bpy
from mathutils import Matrix, Vector

V = Vector
MODELS = ["bench", "plant", "pedestal", "track_light", "elevator"]

# camera views: (suffix, az, el, focus box or None, door slide)
#   az = degrees from the front (-Y) toward +X, el = degrees above horizon,
#   focus = ((xmin, ymin, zmin), (xmax, ymax, zmax)) in Blender coords (None = whole object),
#   door slide = metres DoorL/DoorR are moved apart along X for that view (elevator only).
VIEWS = {
    "bench":       [("", 35, 20, None, 0), ("_alt", -35, 8, ((0.55, -0.26, 0.0), (0.92, 0.26, 0.46)), 0)],
    "plant":       [("", 35, 12, None, 0), ("_alt", 200, 30, None, 0), ("_top", 0, 88, None, 0),
                    ("_leaf", 35, 20, ((-0.05, -0.30, 0.62), (0.32, 0.05, 0.92)), 0)],
    "pedestal":    [("", 35, 14, None, 0), ("_alt", -55, 8, ((-0.2, -0.2, 0.93), (0.2, 0.2, 1.31)), 0)],
    "track_light": [("", 35, -10, None, 0), ("_alt", 150, -22, None, 0)],
    "elevator":    [("", 30, 8, None, 0), ("_open", 18, 6, None, 0.455),
                    ("_alt", -42, 4, ((0.35, -0.11, 0.85), (0.8, 0.0, 1.35)), 0.2)],
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--models", default="public/assets/models")
    p.add_argument("--out", default="tools/blender/previews")
    p.add_argument("--only", default="")
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--samples", type=int, default=48)
    return p.parse_args(argv)


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images,
                 bpy.data.worlds):
        for d in list(coll):
            coll.remove(d)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


# ------------------------------------------------------------------ glTF JSON inspection
def read_glb_json(path):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    clen, ctype = struct.unpack_from("<II", data, 12)
    return json.loads(data[20:20 + clen]), ver, length


def inspect_gltf(name, path):
    js, ver, length = read_glb_json(path)
    acc = js["accessors"]
    print("VALID [%s] glb v%d, %.1f KB, generator=%s" % (name, ver, length / 1024, js["asset"].get("generator")))
    print("VALID [%s] extensionsUsed=%s" % (name, js.get("extensionsUsed", [])))
    tris = 0
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for node in js["nodes"]:
        t = node.get("translation", [0, 0, 0])
        r = node.get("rotation", [0, 0, 0, 1])
        s = node.get("scale", [1, 1, 1])
        info = "translation=%s" % [round(x, 4) for x in t]
        if r != [0, 0, 0, 1] or s != [1, 1, 1]:
            info += " rotation=%s scale=%s  (!! non-identity)" % (r, s)
        ntris = 0
        if "mesh" in node:
            mesh = js["meshes"][node["mesh"]]
            mats = []
            for prim in mesh["primitives"]:
                if prim.get("mode", 4) == 4:
                    ntris += acc[prim["indices"]]["count"] // 3
                pa = acc[prim["attributes"]["POSITION"]]
                for i in range(3):
                    mn[i] = min(mn[i], pa["min"][i] + t[i])
                    mx[i] = max(mx[i], pa["max"][i] + t[i])
                mats.append(js["materials"][prim["material"]]["name"] if "material" in prim else None)
                attrs = sorted(prim["attributes"].keys())
            info += " tris=%d prims=%s attrs=%s" % (ntris, mats, attrs)
            tris += ntris
        print("VALID [%s] node %-10s %s" % (name, node.get("name"), info))
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        print("VALID [%s] material %-20s doubleSided=%-5s base=%s metal=%s rough=%s emissive=%s ext=%s" % (
            name, m["name"], m.get("doubleSided", False),
            [round(x, 3) for x in pbr.get("baseColorFactor", [1, 1, 1, 1])],
            pbr.get("metallicFactor", 1.0), pbr.get("roughnessFactor", 1.0),
            [round(x, 3) for x in m.get("emissiveFactor", [0, 0, 0])], m.get("extensions", {})))
    print("VALID [%s] gltf tris=%d  three.js bbox x[%.3f, %.3f] y[%.3f, %.3f] z[%.3f, %.3f]  size=(%.3f, %.3f, %.3f)" % (
        name, tris, mn[0], mx[0], mn[1], mx[1], mn[2], mx[2], mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]))
    extra = [k for k in ("cameras", "lights", "animations", "textures", "images") if js.get(k)]
    print("VALID [%s] unexpected top-level arrays: %s" % (name, extra or "none"))
    return js


# ------------------------------------------------------------------ Blender re-import
def import_and_validate(name, path):
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    dg = bpy.context.evaluated_depsgraph_get()
    mn = V((1e9, 1e9, 1e9))
    mx = V((-1e9, -1e9, -1e9))
    total = 0
    for ob in objs:
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        W = ob.matrix_world
        omn = V((1e9, 1e9, 1e9))
        omx = V((-1e9, -1e9, -1e9))
        for v in me.vertices:
            p = W @ v.co
            for i in range(3):
                omn[i] = min(omn[i], p[i])
                omx[i] = max(omx[i], p[i])
        for i in range(3):
            mn[i] = min(mn[i], omn[i])
            mx[i] = max(mx[i], omx[i])
        ctr = (omn + omx) / 2
        loc = ob.matrix_world.translation
        print("VALID [%s] blender obj %-10s parent=%s loc=(%.4f, %.4f, %.4f) bboxCenter=(%.4f, %.4f, %.4f) "
              "rot=%s scale=%s tris=%d mats=%s" % (
                  name, ob.name, ob.parent.name if ob.parent else None, loc.x, loc.y, loc.z, ctr.x, ctr.y, ctr.z,
                  tuple(round(a, 4) for a in ob.rotation_euler), tuple(round(a, 4) for a in ob.scale),
                  len(me.loop_triangles), [m.name for m in ob.data.materials]))
        # emissive lens aim check
        lens_ids = [i for i, m in enumerate(ob.data.materials) if m and m.name == "Light_Lens"]
        if lens_ids:
            nsum = V((0, 0, 0))
            csum = V((0, 0, 0))
            cnt = 0
            for p in me.polygons:
                if p.material_index in lens_ids:
                    nsum += (W.to_3x3() @ p.normal) * p.area
                    csum += W @ p.center
                    cnt += 1
            n = nsum.normalized()
            c = csum / max(cnt, 1)
            three = (n.x, n.z, -n.y)
            print("VALID [%s] lens normal blender=(%.3f, %.3f, %.3f) three=(%.3f, %.3f, %.3f) -> %.1f deg below horizon, "
                  "toward %s; lens center three=(%.3f, %.3f, %.3f)" % (
                      name, n.x, n.y, n.z, *three, math.degrees(math.asin(-three[1])),
                      "-Z" if three[2] < 0 else "+Z", c.x, c.z, -c.y))
        total += len(me.loop_triangles)
        ob.evaluated_get(dg).to_mesh_clear()
    print("VALID [%s] blender total tris=%d" % (name, total))
    print("VALID [%s] blender bbox x[%.3f, %.3f] y[%.3f, %.3f] z[%.3f, %.3f]" % (name, mn.x, mx.x, mn.y, mx.y, mn.z, mx.z))
    print("VALID [%s] => three.js bbox x[%.3f, %.3f] y[%.3f, %.3f] z[%.3f, %.3f]" % (
        name, mn.x, mx.x, mn.z, mx.z, -mx.y, -mn.y))
    return objs, mn, mx


# ------------------------------------------------------------------ preview scene
def mat_simple(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def add_plane(name, size, loc, rot, mat):
    me = bpy.data.meshes.new(name)
    h = size / 2
    me.from_pydata([(-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def look_at(ob, target):
    ob.rotation_euler = (V(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


def add_area(name, loc, target, size, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.size = size
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    look_at(ob, target)
    return ob


def sph(az, el):
    a, e = math.radians(az), math.radians(el)
    return V((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))


def fit_camera(cam, target, direction, corners, lens=50.0, margin=0.86):
    cam.data.lens = lens
    cam.data.sensor_width = 36
    half = math.atan(18.0 / lens) * margin
    lo, hi = 0.05, 100.0
    for _ in range(60):
        dist = (lo + hi) / 2
        cam.location = V(target) + direction * dist
        look_at(cam, target)
        R = cam.rotation_euler.to_matrix().transposed()
        ok = True
        for c in corners:
            p = R @ (c - cam.location)
            if p.z >= -1e-4 or max(abs(p.x), abs(p.y)) / -p.z > math.tan(half):
                ok = False
                break
        if ok:
            hi = dist
        else:
            lo = dist
    cam.location = V(target) + direction * hi
    look_at(cam, target)


def setup_render(scene, samples):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    ee = scene.eevee
    ee.taa_render_samples = samples
    for attr, val in (("use_shadows", True), ("use_raytracing", True), ("use_fast_gi", True)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception as ex:  # noqa
                print("eevee setting failed", attr, ex)
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "None"
    except Exception as ex:  # noqa
        print("view transform:", ex)
    w = bpy.data.worlds.new("Studio")
    scene.world = w
    try:
        w.use_nodes = True
    except Exception:  # noqa
        pass
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.42, 0.42, 0.43, 1)
    bg.inputs["Strength"].default_value = 0.55


def stage(name, mn, mx):
    """Context planes (floor / wall / ceiling) + 3-point area lighting scaled to the object."""
    grey = mat_simple("Stage_Grey", (0.42, 0.42, 0.43), 0.9)
    size = max((mx - mn).length, 0.3)
    if name == "track_light":
        add_plane("Ceiling", 6, (0, 0, 0.0005), (math.pi, 0, 0), grey)
    else:
        add_plane("Floor", 30, (0, 0, -0.0005), (0, 0, 0), grey)
    if name == "elevator":
        add_plane("Wall", 12, (0, 0.0005, 3), (math.radians(90), 0, 0), grey)  # normal -> -Y
    ctr = (mn + mx) / 2
    d = size * 2.2
    k = 18.0
    add_area("Key", ctr + sph(-40, 45) * d, ctr, size * 1.2, k * d * d)
    add_area("Fill", ctr + sph(70, 15) * d, ctr, size * 2.0, 0.35 * k * d * d)
    rim_el = -35 if name == "track_light" else 50
    add_area("Rim", ctr + sph(170, rim_el) * d, ctr, size * 1.0, 0.6 * k * d * d)
    if name == "track_light":
        add_area("Under", ctr + sph(20, -60) * d, ctr, size * 1.5, 0.4 * k * d * d)


def render_views(name, mn, mx, out_dir, samples):
    scene = bpy.context.scene
    camd = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", camd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    doors = {o.name: o.location.x for o in bpy.data.objects if o.name in ("DoorL", "DoorR")}
    for suffix, az, el, focus, slide in VIEWS[name]:
        for dn, x0 in doors.items():
            bpy.data.objects[dn].location.x = x0 + (slide if dn == "DoorR" else -slide)
        lo, hi = (mn.copy(), mx.copy()) if focus is None else (V(focus[0]), V(focus[1]))
        corners = [V((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
        fit_camera(cam, (lo + hi) / 2, sph(az, el), corners)
        scene.render.filepath = os.path.join(out_dir, name + suffix + ".png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


def main():
    args = parse_args()
    models = os.path.abspath(args.models)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    names = [n.strip() for n in args.only.split(",") if n.strip()] or MODELS
    for name in names:
        path = os.path.join(models, name + ".glb")
        if not os.path.exists(path):
            print("MISSING", path)
            continue
        clear()
        inspect_gltf(name, path)
        objs, mn, mx = import_and_validate(name, path)
        if args.no_render:
            continue
        setup_render(bpy.context.scene, args.samples)
        stage(name, mn, mx)
        render_views(name, mn, mx, out, args.samples)


if __name__ == "__main__":
    main()
