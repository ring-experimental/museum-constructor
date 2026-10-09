"""
build_props.py -- procedural gallery props for museum-constructor (three.js).

Builds every model from scratch (clear scene -> build -> export GLB).
Deterministic: all randomness uses fixed seeds.

Usage (from the project root, PowerShell):
  & "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup `
      --python tools/blender/build_props.py -- --out public/assets/models [--only bench,plant]

Coordinate convention: specs are in three.js space (Y up, front = +Z, right = +X).
In Blender that is Z up, front = -Y, right = +X. glTF export converts (Y-up).
"""
import argparse
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

V = Vector
MODELS = ["bench", "plant", "pedestal", "track_light", "elevator"]


# --------------------------------------------------------------------------- utils
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="build_props.py")
    p.add_argument("--out", default="public/assets/models", help="output folder for .glb files")
    p.add_argument("--only", default="", help="comma separated model names (%s)" % ",".join(MODELS))
    return p.parse_args(argv)


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights,
                 bpy.data.curves, bpy.data.images):
        for d in list(coll):
            coll.remove(d)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def make_mat(name, base, metallic=0.0, roughness=0.5, emission=None, strength=0.0, double_sided=False):
    """Principled BSDF only, plain values (glTF friendly). double_sided -> backface culling off."""
    m = bpy.data.materials.new(name)
    m.use_backface_culling = not double_sided  # glTF exporter: doubleSided = not use_backface_culling
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    col = hex_lin(base)
    bsdf.inputs["Base Color"].default_value = (*col, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*hex_lin(emission), 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    else:
        bsdf.inputs["Emission Strength"].default_value = 0.0
    m.diffuse_color = (*col, 1.0)
    m.metallic = metallic
    m.roughness = roughness
    return m


def edges_of(faces):
    return list({e for f in faces for e in f.edges})


def rounded_rect(a0, a1, b0, b1, r, seg):
    """CCW rounded rectangle in a 2D (a, b) plane; returns list of (a, b)."""
    corners = [((a1 - r, b0 + r), -90), ((a1 - r, b1 - r), 0), ((a0 + r, b1 - r), 90), ((a0 + r, b0 + r), 180)]
    pts = []
    for (ca, cb), start in corners:
        for k in range(seg + 1):
            ang = math.radians(start + 90.0 * k / seg)
            pts.append((ca + r * math.cos(ang), cb + r * math.sin(ang)))
    return pts


def arc(center, r, a0, a1, n):
    """Points on a 2D arc (degrees), inclusive."""
    return [(center[0] + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             center[1] + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


# --------------------------------------------------------------------------- mesh builder
class Builder:
    """Accumulates geometry for ONE object in a bmesh.

    Per-face int layers:
      ang  smoothing angle (deg) used for sharp-edge detection
      bev  1 for faces created by bevel (smooth inside the bevel strip, sharp to the rest)
      uvm  1 if UVs were set explicitly, else box-projected (meters) at finalize
    """

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.l_ang = self.bm.faces.layers.int.new("ang")
        self.l_bev = self.bm.faces.layers.int.new("bev")
        self.l_uvm = self.bm.faces.layers.int.new("uvm")
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def mat(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def vert(self, co):
        return self.bm.verts.new(co)

    def face(self, verts, m, ang=35, uvs=None):
        f = self.bm.faces.new(verts)
        f.material_index = self.mat(m)
        f[self.l_ang] = ang
        if uvs is not None:
            for loop, uv in zip(f.loops, uvs):
                loop[self.uv].uv = uv
            f[self.l_uvm] = 1
        return f

    # ---- primitives
    def box(self, mn, mx, m, ang=35):
        mn, mx = V(mn), V(mx)
        c, s = (mn + mx) / 2, mx - mn
        M = Matrix.Translation(c) @ Matrix.Diagonal((s.x, s.y, s.z, 1.0))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)["verts"]
        faces = list({f for v in verts for f in v.link_faces})
        for f in faces:
            f.material_index = self.mat(m)
            f[self.l_ang] = ang
        return verts, faces

    def bevel(self, edges, offset, segments, profile=0.5):
        # sort by index: python set order of BMesh elements depends on memory addresses (non-deterministic)
        self.bm.edges.index_update()
        self.bm.verts.index_update()
        edges = sorted({e for e in edges if e is not None and e.is_valid}, key=lambda e: e.index)
        verts = sorted({v for e in edges for v in e.verts}, key=lambda v: v.index)
        res = bmesh.ops.bevel(self.bm, geom=edges + verts, offset=offset, offset_type="OFFSET",
                              profile_type="SUPERELLIPSE", segments=segments, profile=profile,
                              affect="EDGES", clamp_overlap=True, material=-1,
                              miter_outer="SHARP", miter_inner="SHARP", vmesh_method="ADJ")
        for f in res["faces"]:
            f[self.l_bev] = 1
        return res["faces"]

    def lathe(self, prof, segs, M, mats, ang=40, phase=0.0):
        """Revolve profile [(r, z)] around local Z, transformed by M.
        Traverse the profile so the visible side is on the left when walking (r,z) -> normals come out right:
        outer wall bottom->top, caps outward->in (top) / in->out (bottom)."""
        if not isinstance(mats, (list, tuple)):
            mats = [mats] * (len(prof) - 1)
        angs = [phase + 2 * math.pi * j / segs for j in range(segs)]
        rings = []
        for r, z in prof:
            if r <= 1e-7:
                rings.append([self.vert(M @ V((0.0, 0.0, z)))])
            else:
                rings.append([self.vert(M @ V((r * math.cos(a), r * math.sin(a), z))) for a in angs])
        vs = [0.0]
        for i in range(1, len(prof)):
            vs.append(vs[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
        U = 2 * math.pi * max(p[0] for p in prof)
        faces = []
        for i in range(len(prof) - 1):
            A, B = rings[i], rings[i + 1]
            if len(A) == 1 and len(B) == 1:
                continue
            for j in range(segs):
                j2 = (j + 1) % segs
                u0, u1 = U * j / segs, U * (j + 1) / segs
                if len(A) == 1:
                    vv = (A[0], B[j2], B[j])
                    uvs = [((u0 + u1) / 2, vs[i]), (u1, vs[i + 1]), (u0, vs[i + 1])]
                elif len(B) == 1:
                    vv = (A[j], A[j2], B[0])
                    uvs = [(u0, vs[i]), (u1, vs[i]), ((u0 + u1) / 2, vs[i + 1])]
                else:
                    vv = (A[j], A[j2], B[j2], B[j])
                    uvs = [(u0, vs[i]), (u1, vs[i]), (u1, vs[i + 1]), (u0, vs[i + 1])]
                faces.append(self.face(vv, mats[i], ang, uvs))
        return rings, faces

    def sweep(self, pts, section, m, ang=40, closed=False, cap0=True, cap1=True, binormal=None, scales=None):
        """Sweep a 2D section [(u, v)] (CCW in the (N, B) plane) along pts.
        Frames satisfy N x B = T so quads get outward normals."""
        pts = [V(p) for p in pts]
        n = len(pts)
        T = []
        for i in range(n):
            if closed:
                t = (pts[(i + 1) % n] - pts[i]).normalized() + (pts[i] - pts[(i - 1) % n]).normalized()
            elif i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            T.append(t.normalized())
        frames = []
        if binormal is not None:
            Bn = V(binormal).normalized()
            for t in T:
                N = Bn.cross(t).normalized()
                frames.append((N, t.cross(N)))
        else:
            t0 = T[0]
            ref = V((0, 0, 1)) if abs(t0.z) < 0.9 else V((1, 0, 0))
            N = (ref - t0 * ref.dot(t0)).normalized()
            for i, t in enumerate(T):
                if i > 0:
                    N = T[i - 1].rotation_difference(t) @ N
                    N = (N - t * N.dot(t)).normalized()
                frames.append((N, t.cross(N)))
        rings = []
        for i, p in enumerate(pts):
            N, B = frames[i]
            s = scales[i] if scales else 1.0
            rings.append([self.vert(p + N * (u * s) + B * (v * s)) for (u, v) in section])
        k = len(section)
        faces = []
        for i in range(n if closed else n - 1):
            i2 = (i + 1) % n
            for j in range(k):
                j2 = (j + 1) % k
                faces.append(self.face((rings[i][j], rings[i][j2], rings[i2][j2], rings[i2][j]), m, ang))
        if not closed:
            if cap0:
                faces.append(self.face(list(reversed(rings[0])), m, ang))
            if cap1:
                faces.append(self.face(list(rings[-1]), m, ang))
        return rings, faces

    # ---- output
    def finalize(self, location=None):
        bm = self.bm
        bm.normal_update()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) != 2:
                e.smooth = True
                continue
            a, b = lf
            if a.material_index != b.material_index:
                e.smooth = False
                continue
            ba, bb = a[self.l_bev], b[self.l_bev]
            if ba and bb:
                e.smooth = True
            elif ba or bb:
                e.smooth = False
            else:
                thr = math.radians(min(a[self.l_ang], b[self.l_ang]))
                e.smooth = e.calc_face_angle(math.pi) <= thr
        # box-projected UVs in meters for faces without explicit UVs
        for f in bm.faces:
            if f[self.l_uvm]:
                continue
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                co = loop.vert.co
                if ax == 2:
                    uv = (co.x, co.y if n.z > 0 else -co.y)
                elif ax == 1:
                    uv = (co.x if n.y < 0 else -co.x, co.z)
                else:
                    uv = (co.y if n.x > 0 else -co.y, co.z)
                loop[self.uv].uv = uv
        # canonical element order: bmesh.ops.bevel creates faces in a pointer-hash dependent order,
        # sorting makes the exported GLB byte-identical between runs.
        # (BMElemSeq.sort needs a numeric key -> rank by a tuple key first)
        bm.verts.index_update()
        erank = {e: i for i, e in enumerate(sorted(bm.edges, key=lambda e: tuple(sorted(v.index for v in e.verts))))}
        bm.edges.sort(key=lambda e: erank[e])
        frank = {f: i for i, f in enumerate(sorted(
            bm.faces, key=lambda f: (f.material_index, tuple(round(c, 6) for c in f.calc_center_median()),
                                     tuple(sorted(v.index for v in f.verts)))))}
        bm.faces.sort(key=lambda f: frank[f])
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for nm in ("ang", "bev", "uvm"):
            a = me.attributes.get(nm)
            if a is not None:
                me.attributes.remove(a)
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        if location is not None:
            ob.location = location
        return ob


# --------------------------------------------------------------------------- 1. bench
def build_bench():
    wood = make_mat("Bench_Wood", "#B98A5A", 0.0, 0.55)
    metal = make_mat("Bench_Metal", "#2B2B2B", 0.6, 0.45)
    b = Builder("Bench")

    # seat slab 1.8 x 0.5 x 0.06, top at 0.45
    _, faces = b.box((-0.9, -0.25, 0.39), (0.9, 0.25, 0.45), wood, ang=30)
    b.bevel(edges_of(faces), 0.005, 3)

    # two closed sled/loop legs of 50 x 16 mm flat bar, inset 0.15 from the ends
    t, w = 0.016, 0.05
    hy = 0.21 - t / 2
    z0, z1 = t / 2, 0.392 - t / 2          # top bar sinks 2 mm into the seat (no gap)
    path = rounded_rect(-hy, hy, z0, z1, 0.02, 6)
    section = [(-t / 2, -w / 2), (t / 2, -w / 2), (t / 2, w / 2), (-t / 2, w / 2)]
    for xc in (-0.75, 0.75):
        pts = [V((xc, y, z)) for (y, z) in path]
        rings, _ = b.sweep(pts, section, metal, ang=35, closed=True, binormal=(1, 0, 0))
        n = len(rings)
        long_edges = [b.bm.edges.get((rings[i][j], rings[(i + 1) % n][j])) for i in range(n) for j in range(4)]
        b.bevel(long_edges, 0.0015, 2)
    return [b.finalize()]


# --------------------------------------------------------------------------- 2. plant
def build_plant():
    rng = random.Random(1407)
    pot_m = make_mat("Plant_Pot", "#ECE8E1", 0.0, 0.75)
    soil_m = make_mat("Plant_Soil", "#2A2019", 0.0, 1.0)
    stem_m = make_mat("Plant_Stem", "#5E4D3B", 0.0, 0.8)
    leaf_a = make_mat("Plant_Leaf_A", "#2E5A26", 0.0, 0.42, double_sided=True)
    leaf_b = make_mat("Plant_Leaf_B", "#4E7E33", 0.0, 0.5, double_sided=True)
    b = Builder("Plant")
    I = Matrix.Identity(4)

    # ---- pot (lathe, slightly tapered, rounded foot + rim, visible inner wall)
    H, rt, rb, wall = 0.45, 0.21, 0.17, 0.012

    def rout(z):
        return rb + (rt - rb) * z / H

    prof = [(0.0, 0.0), (rb - 0.008, 0.0)]
    prof += [p for p in arc((rb - 0.008, 0.008), 0.008, -60, 0, 2)]
    prof += [(rout(0.2), 0.2), (rout(0.438), 0.438)]
    prof += arc((rt - 0.006, 0.444), 0.006, 0, 90, 3)[1:]          # outer rim round
    prof += [(rt - wall + 0.004, 0.45)]
    prof += [(rt - wall + 0.0012, 0.4488), (rt - wall, 0.446)]      # inner rim round
    prof += [(rout(0.38) - wall, 0.38)]
    b.lathe(prof, 40, I, pot_m, ang=40)

    # ---- soil: slightly mounded disc, edge buried in the inner wall
    zs = 0.405
    r_soil = rout(zs) - wall + 0.0015
    soil = [(r_soil, zs - 0.002), (0.15, zs + 0.002), (0.08, zs + 0.006), (0.0, zs + 0.008)]
    b.lathe(soil, 40, I, soil_m, ang=60)

    # ---- stems (quadratic bezier tubes)
    stems = [
        dict(base=(0.018, 0.010), h=0.86, lean=(0.09, 0.05), n=13, az0=0.3, r0=0.015),
        dict(base=(-0.026, 0.016), h=0.70, lean=(-0.14, 0.06), n=12, az0=1.9, r0=0.013),
        dict(base=(0.004, -0.028), h=0.56, lean=(0.05, -0.14), n=11, az0=3.3, r0=0.012),
    ]
    circle6 = [(math.cos(2 * math.pi * k / 6), math.sin(2 * math.pi * k / 6)) for k in range(6)]
    diamond4 = [(math.cos(2 * math.pi * k / 4 + math.pi / 4), math.sin(2 * math.pi * k / 4 + math.pi / 4)) for k in range(4)]

    def leaf(base, d, L, W, roll, mat, droop, fold, curl, twist, bend, ph, Nr=16, M=6):
        Z = V((0, 0, 1))
        n = (Z - d * Z.dot(d)).normalized()
        x = d.cross(n)
        R = Matrix.Rotation(roll, 3, d)
        x, n = R @ x, R @ n
        Mw = Matrix(((x.x, d.x, n.x, base.x), (x.y, d.y, n.y, base.y), (x.z, d.z, n.z, base.z), (0, 0, 0, 1)))

        def shape(t):   # obovate fiddle leaf: rounded base, widest ~2/3 up, broad rounded apex
            return (t ** 0.8) * ((1 - t) ** 0.5)
        fmax = max(shape(i / 400) for i in range(1, 400))

        def hw(t):
            waist = 1 - 0.10 * math.exp(-((t - 0.32) / 0.12) ** 2)   # fiddle "waist"
            return max(0.0035, W * shape(t) / fmax * waist)

        def pt(t, s):
            h = hw(t) if t < 1 else 0.0
            px, py = s * h, t * L
            pz = (fold * abs(px)                                   # midrib V-fold
                  - curl * L * abs(s) ** 3 * (h / W)               # margins roll down
                  + 0.10 * L * math.sin(math.pi * t)               # arch
                  - droop * L * t * t                              # tip droop
                  + 0.012 * L * math.sin(2 * math.pi * 2.3 * t + ph) * s * s)  # wavy margin
            a = twist * t
            px, pz = px * math.cos(a) - pz * math.sin(a), px * math.sin(a) + pz * math.cos(a)
            px += bend * L * t * t
            return Mw @ V((px, py, pz))

        rows = []
        for i in range(Nr):
            t = 1 - (1 - i / Nr) ** 1.8      # rows denser toward the apex -> rounded tip
            rows.append([(b.vert(pt(t, -1 + 2 * j / M)), (j / M, t)) for j in range(M + 1)])
        tip = b.vert(pt(1.0, 0.0))
        for i in range(Nr - 1):
            for j in range(M):
                q = (rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])
                b.face([c[0] for c in q], mat, 70, [c[1] for c in q])
        for j in range(M):
            q = (rows[-1][j], rows[-1][j + 1])
            b.face([q[0][0], q[1][0], tip], mat, 70, [q[0][1], q[1][1], (0.5, 1.0)])

    leaf_count = 0
    for si, st in enumerate(stems):
        bx, by = st["base"]
        lx, ly = st["lean"]
        P0 = V((bx, by, 0.39))
        P2 = V((bx + lx, by + ly, 0.41 + st["h"]))
        P1 = V((bx + lx * 0.15, by + ly * 0.15, 0.41 + st["h"] * 0.5))

        def bez(f, P0=P0, P1=P1, P2=P2):
            return P0 * (1 - f) ** 2 + P1 * (2 * (1 - f) * f) + P2 * (f * f)

        def rad(f, r0=st["r0"]):
            return r0 + (0.0055 - r0) * f

        ns = 12
        pts = [bez(k / ns) for k in range(ns + 1)]
        b.sweep(pts, circle6, stem_m, ang=60, cap0=False, cap1=True, scales=[rad(k / ns) for k in range(ns + 1)])

        n = st["n"]
        for k in range(n):
            f = 0.30 + 0.70 * (k / (n - 1)) ** 0.85
            terminal = k >= n - 2
            P = bez(f)
            az = st["az0"] + k * 2.39996 + rng.uniform(-0.3, 0.3)
            L = (0.33 + (0.22 - 0.33) * f) * rng.uniform(0.9, 1.07)
            elev = math.radians(4 + 40 * f + rng.uniform(-8, 8))
            droop = 0.34 + (0.14 - 0.34) * f + rng.uniform(-0.05, 0.05)
            lp = 0.045 + (0.025 - 0.045) * f
            if k == n - 1:            # newest leaf: small, upright
                L *= 0.62
                elev = math.radians(72 + rng.uniform(-6, 6))
                droop = 0.08
                lp = 0.018
            elif k == n - 2:
                L *= 0.8
                elev = math.radians(58 + rng.uniform(-6, 6))
                droop = 0.12
            hdir = V((math.cos(az), math.sin(az), 0.0))
            pe = min(elev + math.radians(20), math.radians(80))
            dp = (hdir * math.cos(pe) + V((0, 0, 1)) * math.sin(pe)).normalized()
            az2 = az + rng.uniform(-0.15, 0.15)
            d = (V((math.cos(az2), math.sin(az2), 0)) * math.cos(elev) + V((0, 0, 1)) * math.sin(elev)).normalized()
            p1 = P + dp * (lp * 0.5)
            base = p1 + (dp + d).normalized() * (lp * 0.5)
            p3 = base + d * 0.012
            b.sweep([P, p1, base, p3], diamond4, stem_m, ang=80, cap0=False, cap1=False,
                    scales=[0.0038, 0.0033, 0.003, 0.0015])
            mat = leaf_b if (terminal or (f > 0.8 and rng.random() < 0.5) or rng.random() < 0.12) else leaf_a
            leaf(base, d, L, 0.32 * L * rng.uniform(0.92, 1.06), rng.uniform(-0.25, 0.25), mat,
                 droop, fold=rng.uniform(0.22, 0.38), curl=rng.uniform(0.03, 0.07),
                 twist=rng.uniform(-0.25, 0.25), bend=rng.uniform(-0.06, 0.06), ph=rng.uniform(0, 6.28))
            leaf_count += 1
    print("plant leaves:", leaf_count)
    ob = b.finalize()
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs_ = [v.co.z for v in ob.data.vertices]
    print("plant footprint x=%.3f y=%.3f height=%.3f" % (max(xs) - min(xs), max(ys) - min(ys), max(zs_)))
    return [ob]


# --------------------------------------------------------------------------- 3. pedestal
def build_pedestal():
    white = make_mat("Pedestal_White", "#F2F0EC", 0.0, 0.8)
    gap = make_mat("Pedestal_Gap", "#121212", 0.0, 0.9)
    bronze = make_mat("Sculpture_Bronze", "#8C6239", 1.0, 0.3)

    p = Builder("Plinth")
    _, faces = p.box((-0.25, -0.25, 0.03), (0.25, 0.25, 0.95), white, ang=30)
    p.bevel(edges_of(faces), 0.002, 2)
    p.box((-0.235, -0.235, 0.0), (0.235, 0.235, 0.032), gap, ang=30)   # recessed shadow gap
    plinth = p.finalize()

    s = Builder("Sculpture")
    top = 0.95
    base_h, base_r = 0.014, 0.06
    c = 0.0025
    base_prof = [(0.0, top), (base_r - c, top), (base_r, top + c), (base_r, top + base_h - c),
                 (base_r - c, top + base_h), (0.0, top + base_h)]
    s.lathe(base_prof, 40, Matrix.Identity(4), bronze, ang=40)

    # thick Moebius ribbon (one half twist), standing in a vertical plane rotated 25 deg about Z
    R, thick, k_twist = 0.14, 0.013, 1
    n_u, n_v = 96, 16
    alpha = math.radians(25)
    udir = V((math.cos(alpha), math.sin(alpha), 0.0))
    Z = V((0, 0, 1))
    w = udir.cross(Z)
    sink = 0.004
    C = V((0, 0, top + base_h + R + thick - sink))
    rings = []
    for i in range(n_u):
        th = 2 * math.pi * i / n_u                       # th = 0 at the bottom
        radial = udir * math.sin(th) - Z * math.cos(th)
        P = C + radial * R
        phi = math.pi / 2 + k_twist * th / 2             # major axis horizontal at the foot
        a = 0.032 + 0.020 * (1 - math.cos(th)) / 2       # narrow foot, wide crown
        e1 = radial * math.cos(phi) + w * math.sin(phi)
        e2 = -radial * math.sin(phi) + w * math.cos(phi)
        ring = []
        for j in range(n_v):
            psi = -2 * math.pi * j / n_v                 # CCW about the tangent -> outward normals
            ring.append(s.vert(P + e1 * (a * math.cos(psi)) + e2 * (thick * math.sin(psi))))
        rings.append(ring)
    shift = (n_v // 2) * (k_twist % 2)
    for i in range(n_u):
        last = i == n_u - 1
        r0, r1 = rings[i], rings[(i + 1) % n_u]
        for j in range(n_v):
            j2 = (j + 1) % n_v
            a1 = r1[(j + shift) % n_v] if last else r1[j]
            b1 = r1[(j2 + shift) % n_v] if last else r1[j2]
            s.face((r0[j], r0[j2], b1, a1), bronze, 89)
    sculpt = s.finalize()
    return [plinth, sculpt]


# --------------------------------------------------------------------------- 4. track light
AIM_DEG = 57.5


def build_track_light():
    body = make_mat("Light_Body", "#1A1A1A", 0.0, 0.6)
    lens = make_mat("Light_Lens", "#FFF4E0", 0.0, 0.2, emission="#FFF4E0", strength=3.0)
    b = Builder("TrackLight")
    I = Matrix.Identity(4)

    # track adapter: insert (top at origin) + body block
    _, f = b.box((-0.045, -0.008, -0.007), (0.045, 0.008, 0.0), body, ang=30)
    b.bevel(edges_of(f), 0.001, 1)
    _, f = b.box((-0.055, -0.018, -0.038), (0.055, 0.018, -0.006), body, ang=30)
    b.bevel(edges_of(f), 0.003, 2)
    # stem + swivel
    b.lathe([(0.007, -0.051), (0.007, -0.037)], 12, I, body)       # ends are hidden inside block/swivel
    b.lathe([(0.0, -0.059), (0.013, -0.059), (0.014, -0.058), (0.014, -0.051), (0.013, -0.050), (0.0, -0.050)],
            14, I, body)

    # yoke (bent flat bar 6 x 18 mm), pivot axis along X
    zp = -0.136                    # pivot height
    t_y, w_y = 0.006, 0.018
    xa = 0.035 + 0.004 + t_y / 2   # arm centerline (4 mm clearance to the head)
    zb = -0.059 - t_y / 2          # cross bar centerline
    rc = 0.008
    path2d = [(-xa, zp)] + arc((-xa + rc, zb - rc), rc, 180, 90, 4) + arc((xa - rc, zb - rc), rc, 90, 0, 4) + [(xa, zp)]
    pts = [V((x, 0.0, z)) for x, z in path2d]
    sec = [(-t_y / 2, -w_y / 2), (t_y / 2, -w_y / 2), (t_y / 2, w_y / 2), (-t_y / 2, w_y / 2)]
    b.sweep(pts, sec, body, ang=35, binormal=(0, 1, 0))
    rotX = Matrix.Rotation(math.radians(90), 4, "Y")     # local Z -> +X
    for sx in (-1, 1):
        # rounded arm end (disc), 0.3 mm thinner than the arm on each side to avoid coplanar faces
        x0 = sx * xa - t_y / 2 + 0.0003
        M = Matrix.Translation((x0, 0.0, zp)) @ rotX
        L = t_y - 0.0006
        b.lathe([(0.0, 0.0), (w_y / 2, 0.0), (w_y / 2, L), (0.0, L)], 12, M, body)
        # knob on the outside of the arm, chamfered end pointing outward
        Mk = Matrix.Translation((sx * (xa + t_y / 2 - 0.0005), 0.0, zp)) @ Matrix.Rotation(math.radians(90 * sx), 4, "Y")
        b.lathe([(0.0, 0.0), (0.010, 0.0), (0.010, 0.0055), (0.0085, 0.007), (0.0, 0.007)], 12, Mk, body)
    # pivot pin (only the short piece between head and arms is visible)
    M = Matrix.Translation((-0.042, 0.0, zp)) @ rotX
    b.lathe([(0.005, 0.0), (0.005, 0.084)], 10, M, body)

    # lamp head: lathe around the aim axis. Aim = three.js -Z and down 57.5 deg (Blender +Y, -Z)
    e = math.radians(AIM_DEG)
    d = V((0.0, math.cos(e), -math.sin(e)))
    Mh = Matrix.Translation((0.0, 0.0, zp)) @ V((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    sr, sf, R = -0.06, 0.10, 0.035
    head = [(0.0, sr), (0.026, sr), (0.031, sr + 0.0015), (0.034, sr + 0.005), (R, sr + 0.009),
            (R, -0.022), (0.0332, -0.0205), (0.0332, -0.0165), (R, -0.015),
            (R, sf - 0.003), (0.0345, sf), (0.0305, sf), (0.0295, sf - 0.001), (0.0295, sf - 0.007),
            (0.0, sf - 0.007)]
    mats = [body] * (len(head) - 2) + [lens]
    b.lathe(head, 32, Mh, mats, ang=40, phase=math.pi / 32)
    ob = b.finalize()
    lens_c = Mh @ V((0, 0, sf - 0.007))
    print("track_light lens center (blender):", tuple(round(x, 4) for x in lens_c), "aim:", tuple(round(x, 4) for x in d))
    return [ob]


# --------------------------------------------------------------------------- 5. elevator
def build_elevator():
    clad = make_mat("Elevator_Clad", "#4A4541", 0.0, 0.6)
    steel = make_mat("Elevator_Steel", "#B8BCC0", 1.0, 0.35)
    cab = make_mat("Elevator_CabLight", "#FFF3E2", 0.0, 0.5, emission="#FFF1DC", strength=2.0)
    indm = make_mat("Elevator_Indicator", "#0B0B0B", 0.0, 0.08, emission="#FF9A2E", strength=0.35)
    btn = make_mat("Elevator_Button", "#EDEDED", 0.0, 0.3, emission="#FFE7B8", strength=0.8)

    HW, H = 0.98, 2.7          # half overall width, height
    OW, OH = 0.5, 2.2          # half opening width, opening height
    YF, YB = -0.095, -0.055    # cladding plate front / back (Blender y; three z = -y)

    # ---- Frame: U-shaped cladding plate + hollow sleeve + dark slot back + steel sill
    fr = Builder("Frame")
    outline = [(-HW, 0), (-OW, 0), (-OW, OH), (OW, OH), (OW, 0), (HW, 0), (HW, H), (-HW, H)]
    vs = [fr.vert(V((x, YF, z))) for x, z in outline]
    face = fr.face(vs, clad, 30)
    ext = bmesh.ops.extrude_face_region(fr.bm, geom=[face], use_keep_orig=True)
    nv = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(fr.bm, verts=nv, vec=(0.0, YB - YF, 0.0))
    fr.bm.faces.index_update()
    plate_faces = sorted({fc for v in vs + nv for fc in v.link_faces}, key=lambda fc: fc.index)
    for fc in plate_faces:
        fc.material_index = fr.mat(clad)
        fc[fr.l_ang] = 30
    bmesh.ops.recalc_face_normals(fr.bm, faces=plate_faces)
    front_edges = [e for e in fr.bm.edges
                   if all(abs(v.co.y - YF) < 1e-6 for v in e.verts) and not all(v.co.z < 1e-6 for v in e.verts)]
    fr.bevel(front_edges, 0.003, 2)
    fr.bm.normal_update()
    for fc in fr.bm.faces:   # stainless reveal on the inner edges of the opening
        if fc[fr.l_bev]:
            continue
        c, n = fc.calc_center_median(), fc.normal
        if abs(abs(n.x) - 1) < 1e-3 and abs(abs(c.x) - OW) < 1e-3 and c.z < OH:
            fc.material_index = fr.mat(steel)
        elif n.z < -0.999 and abs(c.z - OH) < 1e-3 and abs(c.x) < OW:
            fc.material_index = fr.mat(steel)
    T = 0.012
    fr.box((-HW + 0.001, YB - 0.001, 0.0), (-HW + 0.001 + T, 0.0, H - 0.001 - T), clad)
    fr.box((HW - 0.001 - T, YB - 0.001, 0.0), (HW - 0.001, 0.0, H - 0.001 - T), clad)
    fr.box((-HW + 0.001, YB - 0.001, H - 0.001 - T), (HW - 0.001, 0.0, H - 0.001), clad)
    fr.box((-HW + 0.001 + T, -0.003, 0.0), (HW - 0.001 - T, 0.0, H - 0.001 - T), clad)   # slot back
    fr.box((-OW, YF, 0.0), (OW, -0.003, 0.003), steel)                                   # sill
    frame = fr.finalize()

    # ---- CabLight: emissive backing just in front of the wall
    cl = Builder("CabLight")
    y = -0.005
    q = [cl.vert(V((x, y, z))) for x, z in ((-OW - 0.01, 0.0), (OW + 0.01, 0.0), (OW + 0.01, OH + 0.01), (-OW - 0.01, OH + 0.01))]
    cl.face(q, cab, 30)
    cablight = cl.finalize()

    # ---- doors: own origin at their own center
    dw, dt, dh = 0.51, 0.03, 2.21
    doors = []
    for name, sx in (("DoorL", -1), ("DoorR", 1)):
        d = Builder(name)
        _, f = d.box((-dw / 2, -dt / 2, -dh / 2), (dw / 2, dt / 2, dh / 2), steel, ang=30)
        d.bevel(edges_of(f), 0.0015, 2)
        doors.append(d.finalize(location=(sx * (0.001 + dw / 2), -0.035, 0.004 + dh / 2)))

    # ---- call panel on the right cladding at 1.1 m
    cp = Builder("CallPanel")
    cx, cz = OW + (HW - OW) / 2, 1.1
    _, f = cp.box((cx - 0.04, -0.101, cz - 0.1), (cx + 0.04, YF + 0.001, cz + 0.1), steel, ang=30)
    fe = [e for e in edges_of(f) if not all(abs(v.co.y - (YF + 0.001)) < 1e-6 for v in e.verts)]
    cp.bevel(fe, 0.002, 2)
    rotm = Matrix.Rotation(math.radians(90), 4, "X")   # local Z -> -Y (out of the wall)
    for bz in (cz + 0.035, cz - 0.035):
        M = Matrix.Translation((cx, -0.101, bz)) @ rotm
        cp.lathe([(0.0, -0.001), (0.0145, -0.001), (0.0145, 0.0025), (0.0125, 0.004), (0.007, 0.0048), (0.0, 0.005)],
                 20, M, btn, ang=40)
    callpanel = cp.finalize()

    # ---- floor indicator on the header
    ib = Builder("Indicator")
    iz = 2.45
    _, f = ib.box((-0.165, -0.099, iz - 0.045), (0.165, YF + 0.001, iz + 0.045), steel, ang=30)
    fe = [e for e in edges_of(f) if not all(abs(v.co.y - (YF + 0.001)) < 1e-6 for v in e.verts)]
    ib.bevel(fe, 0.0015, 2)
    _, f = ib.box((-0.15, -0.1015, iz - 0.04), (0.15, -0.098, iz + 0.04), indm, ang=30)
    ib.bm.normal_update()
    for fc in f:   # 0..1 UVs on the display face so the app can map e.g. a CanvasTexture with floor numbers
        if fc.normal.y < -0.9:
            for loop in fc.loops:
                co = loop.vert.co
                loop[ib.uv].uv = ((co.x + 0.15) / 0.3, (co.z - (iz - 0.04)) / 0.08)
            fc[ib.l_uvm] = 1
    indicator = ib.finalize()
    return [frame, cablight] + doors + [callpanel, indicator]


BUILDERS = {
    "bench": build_bench,
    "plant": build_plant,
    "pedestal": build_pedestal,
    "track_light": build_track_light,
    "elevator": build_elevator,
}


# --------------------------------------------------------------------------- export
def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for ob in objs:
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        ob.evaluated_get(dg).to_mesh_clear()
    return total


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True, export_apply=True,
        export_cameras=False, export_lights=False, export_materials="EXPORT",
        export_texcoords=True, export_normals=True, export_animations=False,
        use_selection=False, export_extras=False)


def main():
    args = parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    names = [n.strip() for n in args.only.split(",") if n.strip()] or MODELS
    for n in names:
        if n not in BUILDERS:
            raise SystemExit("unknown model %r (choose from %s)" % (n, MODELS))
    print("Blender", bpy.app.version_string)
    for name in names:
        clear_scene()
        objs = BUILDERS[name]()
        bpy.context.view_layer.update()
        path = os.path.join(out, name + ".glb")
        export(path)
        print("BUILT %-12s tris=%-6d objects=%s -> %s" % (name, tri_count(objs), [o.name for o in objs], path))


if __name__ == "__main__":
    main()
