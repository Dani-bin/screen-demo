"""
VH_HaulTruck 阶段 3：形体（blender-image-to-3d 模板改的）。尺寸来源见 asset-brief.md（# inferred 是照片里看不到、按同类车推断的）。
单位米，Z 上，车头朝 -Y，原点在轴距中点下方的地面；全部放 LOW。运行时先删掉阶段 2 的粗模块。
材质名和 /open-pit 页面的调色板同名（op_white 车身按状态给实例色、op_cargo 货堆、op_headlamp 车灯由页面控制）。
BUILD PHASE TEMPLATE
Copy this file to <asset>/build/NN_<phase>.py, fill in build(), run:

  blender --background --python build/02_blockout.py -- --master <asset>_master.blend

Every phase script is re-runnable: it opens the master, deletes what it owns
(objects whose names carry OWNER_TAG in a custom property), rebuilds them, saves.
Nothing else in the file is touched, so earlier phases and manual edits survive.

Coordinate convention: metres, Z up, subject faces -Y, origin at the ground
contact point (characters, props, architecture) or the ground centre (vehicles).
"""
import bpy, bmesh, sys, os, math, argparse
from mathutils import Vector, Matrix, Euler

PHASE = "03_forms"
OWNER_TAG = "phase:" + PHASE   # objects created here get ob["owner"] = OWNER_TAG


# ARGS AND FILE HANDLING

def argv_after_dashes():
    a = sys.argv
    return a[a.index("--") + 1:] if "--" in a else []


def open_master(path):
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(path))
    return bpy.context.scene


def save_master(path):
    bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))


def col(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def clear_owned(tag=None):
    """Delete every object this phase created last time, so the script is idempotent."""
    tag = tag or OWNER_TAG
    for ob in [o for o in bpy.data.objects if o.get("owner") == tag]:
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve):
                bpy.data.curves.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)


def own(ob):
    ob["owner"] = OWNER_TAG
    return ob


def log(*a):
    print("[" + PHASE + "]", *a)


# MESH PRIMITIVES (bmesh based, no operators, safe in background mode)

def new_mesh_object(name, bm, collection, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = location
    ob.rotation_euler = rotation
    ob.scale = scale
    col(collection).objects.link(ob)
    return own(ob)


def box(name, size, collection="LOW", location=(0, 0, 0), rotation=(0, 0, 0), base_at_origin=False):
    """size = (x, y, z). base_at_origin puts the bottom face on z=0."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if base_at_origin:
        bmesh.ops.translate(bm, vec=(0, 0, size[2] / 2), verts=bm.verts)
    return new_mesh_object(name, bm, collection, location, rotation)


def cylinder(name, radius, height, collection="LOW", segments=32, axis="Z", location=(0, 0, 0),
             radius_top=None, base_at_origin=False):
    """Cylinder or truncated cone along axis. radius_top defaults to radius."""
    bm = bmesh.new()
    r2 = radius if radius_top is None else radius_top
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=radius, radius2=r2, depth=height)
    if base_at_origin:
        bmesh.ops.translate(bm, vec=(0, 0, height / 2), verts=bm.verts)
    if axis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Y"), verts=bm.verts)
    elif axis == "Y":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, "X"), verts=bm.verts)
    return new_mesh_object(name, bm, collection, location)


def sphere(name, radius, collection="LOW", location=(0, 0, 0), u=24, v=12, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return new_mesh_object(name, bm, collection, location)


def grid(name, size_x, size_y, cuts_x, cuts_y, collection="LOW", location=(0, 0, 0), rotation=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=cuts_x, y_segments=cuts_y, size=0.5)
    bmesh.ops.scale(bm, vec=(size_x, size_y, 1), verts=bm.verts)
    return new_mesh_object(name, bm, collection, location, rotation)


def loft(name, sections, collection="LOW", close_sections=True, cap_ends=True, smooth=True):
    """Bridge a list of cross sections (each a list of Vector/tuple, same point count) into a hull.
    Use it for vehicle bodies, boat hulls, torsos: read section widths/heights off the top and side
    reference views at fixed stations along the length."""
    bm = bmesh.new()
    rings = []
    for sec in sections:
        vs = [bm.verts.new(Vector(p)) for p in sec]
        ring = []
        for i in range(len(vs)):
            if i == len(vs) - 1 and not close_sections:
                break
            ring.append(bm.edges.new((vs[i], vs[(i + 1) % len(vs)])))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        bmesh.ops.bridge_loops(bm, edges=a + b)
    if cap_ends and close_sections:
        bmesh.ops.contextual_create(bm, geom=rings[0])
        bmesh.ops.contextual_create(bm, geom=rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_mesh_object(name, bm, collection)
    if smooth:
        shade_smooth(ob, math.radians(35))
    return ob


def profile_spin(name, profile_xz, collection="LOW", steps=32, location=(0, 0, 0), angle=360):
    """Lathe a 2D profile (list of (radius, z)) around Z: vases, columns, wheel rims, bolts."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile_xz]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=math.radians(angle), steps=steps, use_merge=(angle >= 360))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_mesh_object(name, bm, collection, location)


def profile_extrude(name, profile_xy, length, collection="LOW", location=(0, 0, 0), rotation=(0, 0, 0)):
    """Extrude a closed 2D outline (list of (x, y)) along Z: arches, mouldings, I-beams, tracks, trims."""
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, 0)) for x, y in profile_xy]
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, length), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_mesh_object(name, bm, collection, location, rotation)


def curve_tube(name, points, radius, collection="LOW", resolution=12, taper_to=None, bevel_res=6):
    """Poly/bezier tube through points: cables, horns, tails, pipes, tentacles, railings, roots."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("NURBS")
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        if taper_to is not None:
            t = i / max(1, len(points) - 1)
            sp.points[i].radius = 1.0 + (taper_to - 1.0) * t
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(points))
    cu.resolution_u = resolution
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_res
    cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu)
    col(collection).objects.link(ob)
    return own(ob)


def skin_chain(name, joints, collection="HIGH", subdiv=2, root_index=0):
    """Organic blockout in one call. joints = [(x, y, z, radius), ...] connected in order, or a dict
    {"name": [(x, y, z, r), ...], ...} of chains sharing their first point with another chain by position.
    Skin modifier + Subdivision gives a smooth mass with quad loops at every joint, which is a usable
    LOW base for stylized characters after shrinkwrapping to the sculpt."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    chains = joints if isinstance(joints, dict) else {"main": joints}
    vert_by_pos = {}
    order = []
    for cname, pts in chains.items():
        prev = None
        for (x, y, z, r) in pts:
            key = (round(x, 5), round(y, 5), round(z, 5))
            v = vert_by_pos.get(key)
            if v is None:
                v = bm.verts.new((x, y, z))
                vert_by_pos[key] = v
                order.append((v, r))
            if prev is not None and prev is not v:
                if not bm.edges.get((prev, v)):
                    bm.edges.new((prev, v))
            prev = v
    bm.verts.index_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    col(collection).objects.link(ob)
    skin = ob.modifiers.new("Skin", "SKIN")
    skin.use_smooth_shade = True
    # skin_vertices layer exists once the modifier is present
    layer = me.skin_vertices[0].data
    for i, (v, r) in enumerate(order):
        layer[i].radius = (r, r)
        layer[i].use_root = (i == root_index)
    sub = ob.modifiers.new("Subdivision", "SUBSURF")
    sub.levels = subdiv
    sub.render_levels = subdiv
    return own(ob)


# MODIFIERS AND EDITS

def mirror_origin():
    """Shared empty at the world origin so mirrors work across the asset's centre line,
    not across each object's own origin (the classic Blender mirror mistake)."""
    ob = bpy.data.objects.get("REF_mirror_origin")
    if ob is None:
        ob = bpy.data.objects.new("REF_mirror_origin", None)
        ob.empty_display_type = "PLAIN_AXES"
        ob.empty_display_size = 0.05
        col("REF").objects.link(ob)
    return ob


def mirror(ob, axis="X", merge=0.001, clip=True, about_world=True):
    """Mirror across the world centre plane by default. Pass about_world=False to mirror
    across the object's own origin (only right when the origin sits on the symmetry plane)."""
    m = ob.modifiers.new("Mirror", "MIRROR")
    m.use_axis = (axis == "X", axis == "Y", axis == "Z")
    m.use_mirror_merge = merge > 0
    m.merge_threshold = merge
    m.use_clip = clip
    if about_world:
        m.mirror_object = mirror_origin()
    return m


def bevel(ob, width=0.01, segments=3, angle_limit=30, harden=True):
    b = ob.modifiers.new("Bevel", "BEVEL")
    b.width = width
    b.segments = segments
    b.limit_method = "ANGLE"
    b.angle_limit = math.radians(angle_limit)
    b.harden_normals = harden
    return b


def subsurf(ob, levels=2):
    s = ob.modifiers.new("Subdivision", "SUBSURF")
    s.levels = levels
    s.render_levels = levels
    return s


def solidify(ob, thickness=0.01, offset=-1.0, rim=True):
    s = ob.modifiers.new("Solidify", "SOLIDIFY")
    s.thickness = thickness
    s.offset = offset
    s.use_rim = rim
    return s


def boolean(ob, cutter, op="DIFFERENCE", hide_cutter=True, solver="EXACT"):
    b = ob.modifiers.new("Bool_" + cutter.name, "BOOLEAN")
    b.operation = op
    b.object = cutter
    b.solver = solver
    if hide_cutter:
        cutter.hide_render = True
        cutter.hide_viewport = True
        cutter.display_type = "WIRE"
    return b


def array(ob, count, offset=(1, 0, 0), relative=True, curve=None):
    a = ob.modifiers.new("Array", "ARRAY")
    a.count = count
    if relative:
        a.relative_offset_displace = offset
    else:
        a.use_relative_offset = False
        a.use_constant_offset = True
        a.constant_offset_displace = offset
    if curve is not None:
        a.fit_type = "FIT_CURVE"
        a.curve = curve
        c = ob.modifiers.new("Curve", "CURVE")
        c.object = curve
    return a


def shrinkwrap(ob, target, offset=0.0, mode="NEAREST_SURFACEPOINT"):
    s = ob.modifiers.new("Shrinkwrap", "SHRINKWRAP")
    s.target = target
    s.offset = offset
    s.wrap_method = mode
    return s


def remesh_voxel(ob, voxel_size=0.02, smooth_normals=True):
    r = ob.modifiers.new("Remesh", "REMESH")
    r.mode = "VOXEL"
    r.voxel_size = voxel_size
    r.use_smooth_shade = smooth_normals
    return r


def decimate(ob, ratio):
    d = ob.modifiers.new("Decimate", "DECIMATE")
    d.ratio = ratio
    return d


def apply_all_modifiers(ob):
    """Bake the modifier stack into the mesh without operators (safe in background)."""
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(eo)
    old = ob.data
    name = old.name
    ob.data = me
    ob.modifiers.clear()
    if old.users == 0:
        bpy.data.meshes.remove(old)
    me.name = name                      # keep the mesh name free of .001
    return ob


def apply_transform(ob):
    """Freeze location/rotation/scale into the mesh. Only for unparented objects."""
    if ob.parent is not None or ob.type != "MESH":
        return ob
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def set_origin(ob, world_point):
    """Move the object origin to world_point without moving the geometry."""
    p = Vector(world_point)
    local = ob.matrix_world.inverted() @ p
    ob.data.transform(Matrix.Translation(-local))
    ob.matrix_world = ob.matrix_world @ Matrix.Translation(local)
    return ob


def join_meshes(name, objects, collection="LOW"):
    """Merge several mesh objects into one new object in world space. Sources are left alone."""
    bm = bmesh.new()
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in objects:
        eo = ob.evaluated_get(dg)
        me = eo.to_mesh()
        tmp = bmesh.new()
        tmp.from_mesh(me)
        bmesh.ops.transform(tmp, matrix=eo.matrix_world, verts=tmp.verts)
        tmp_me = bpy.data.meshes.new("_tmp_join")
        tmp.to_mesh(tmp_me)
        tmp.free()
        bm.from_mesh(tmp_me)
        bpy.data.meshes.remove(tmp_me)
        eo.to_mesh_clear()
    return new_mesh_object(name, bm, collection)


def duplicate(ob, name, collection=None):
    new = ob.copy()
    new.data = ob.data.copy()
    new.name = name
    new.data.name = name
    col(collection or ob.users_collection[0].name).objects.link(new)
    return own(new)


def shade_smooth(ob, sharp_angle=math.radians(30)):
    """Smooth shading with sharp edges marked by angle. Marked sharp edges always split normals in 4.1+."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) <= sharp_angle
    bm.to_mesh(me)
    bm.free()
    if hasattr(me, "use_auto_smooth"):      # 4.0 only; removed in 4.1
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.pi
    return ob


def push(ob, center, radius, strength, direction=None, falloff="smooth"):
    """Code sculpting: move vertices within radius of center along their normal (or direction)."""
    me = ob.data
    c = ob.matrix_world.inverted() @ Vector(center)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    d = None if direction is None else (ob.matrix_world.to_3x3().inverted() @ Vector(direction)).normalized()
    for v in bm.verts:
        t = (v.co - c).length / radius
        if t >= 1.0:
            continue
        w = (1 - t * t) ** 2 if falloff == "smooth" else (1 - t)
        v.co += (d if d is not None else v.normal) * strength * w
    bm.to_mesh(me)
    bm.free()
    return ob


def taper(ob, axis="Z", top_scale=0.5, bottom=None, top=None):
    """Scale cross sections linearly along an axis (limb tapering, spires, hulls)."""
    me = ob.data
    idx = "XYZ".index(axis)
    cos = [v.co[idx] for v in me.vertices]
    lo = min(cos) if bottom is None else bottom
    hi = max(cos) if top is None else top
    for v in me.vertices:
        t = 0 if hi == lo else max(0.0, min(1.0, (v.co[idx] - lo) / (hi - lo)))
        s = 1 + (top_scale - 1) * t
        for j in range(3):
            if j != idx:
                v.co[j] *= s
    return ob


# UV

def smart_uv(ob, angle=66.0, margin=0.02, seams_from_sharp=True):
    """Quick unwrap for blockouts, props and hard surface: Smart UV Project through the operator,
    with seams taken from marked sharp edges when asked. Hero deforming parts get seams placed
    by hand in the phase script (mark_seams) and unwrap_by_seams instead."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    if seams_from_sharp:
        bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(angle))
        bpy.ops.mesh.mark_seam(clear=False)
        bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def mark_seams(ob, edge_filter):
    """edge_filter(bmesh_edge) -> bool. Marks seams by rule, e.g. lambda e: abs(e.verts[0].co.x) < 1e-4."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    n = 0
    for e in bm.edges:
        if edge_filter(e):
            e.seam = True
            n += 1
    bm.to_mesh(me)
    bm.free()
    log("seams marked on", ob.name, n)
    return ob


def unwrap_by_seams(ob, margin=0.02, method="ANGLE_BASED"):
    """Unwrap along marked seams, then pack islands."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method=method, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


# MATERIALS

def material(name, color=(0.5, 0.5, 0.5, 1), roughness=0.5, metallic=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0) and not m.use_nodes:   # 5.0+ materials always use nodes
        m.use_nodes = True
    # look nodes up by type: display names are translated in non-English Blender UIs
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return m


def assign(ob, mat):
    if ob.data.materials:
        ob.data.materials[0] = mat
    else:
        ob.data.materials.append(mat)
    return ob


# RIG HELPERS

def armature(name, bones, collection="RIG_DEF"):
    """bones = [(name, head, tail, parent_name_or_None, roll_deg, deform_bool), ...]"""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    col(collection).objects.link(ob)
    own(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, head, tail, parent, roll, deform in bones:
        eb = arm.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.roll = math.radians(roll)
        eb.use_deform = deform
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = (Vector(head) - arm.edit_bones[parent].tail).length < 1e-5
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def bind(mesh_ob, arm_ob, method="ARMATURE_AUTO"):
    """Parent with automatic weights. Weight painting corrections come after, in a later phase."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    mesh_ob.select_set(True)
    arm_ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.parent_set(type=method)
    return mesh_ob


def socket(name, location, parent=None, parent_bone=None, rotation=(0, 0, 0), size=0.1, **props):
    """Semantic attachment point. Local +Y = forward of whatever attaches, +Z = its up."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "ARROWS"
    ob.empty_display_size = size
    col("SOCKETS").objects.link(ob)
    own(ob)
    if parent is not None:
        ob.parent = parent
        if parent_bone:
            ob.parent_type = "BONE"
            ob.parent_bone = parent_bone
    ob.matrix_world = Matrix.Translation(Vector(location)) @ Euler(rotation).to_matrix().to_4x4()
    for k, v in props.items():
        ob[k] = v
    return ob


def lod_copy(ob, level, ratio):
    """Make <name>_LOD<level> from a LOD0 object with a Decimate at ratio. Rework silhouettes by hand after."""
    base = ob.name.replace("_LOD0", "")
    new = duplicate(ob, base + "_LOD" + str(level))
    decimate(new, ratio)
    return new


# BUILD

L = 9.4                    # 总长
W = 3.6                    # 车斗宽
H = 3.95                   # 护顶顶面
R = 1.45 / 2               # 轮胎半径（图 A：直径约占车高 37 %）
TW = 0.45                  # 胎宽
WB = 4.7                   # 轴距（前桥 → 后桥组中心）
TANDEM = 1.6               # 后双桥间距
YF = -WB / 2               # 前桥
YR = (WB / 2 - TANDEM / 2, WB / 2 + TANDEM / 2)
Y_FRONT = YF - 0.19 * L    # 前保险杠
Y_REAR = Y_FRONT + L       # 车斗尾
BED_Y0 = Y_REAR - 0.64 * L # 车斗前挡板
BED_Z0 = 0.53 * H          # 车斗底面离地
BED_TOP = BED_Z0 + 0.33 * H
TAIL_Y = Y_REAR - 1.7      # 尾部开始上翘的位置                     # inferred（图 B）
TAIL_Z = BED_Z0 + 0.6      # 尾沿抬高                               # inferred（图 B）
CANOPY_Y0 = BED_Y0 - 0.12 * L
RAKE = math.radians(12)    # 车头面板后倾                           # 图 A 估
PANEL_Z = (1.78, 3.3)      # 深色面板上下沿（高 ≈ 0.38 H）
PANEL_HW = 1.0             # 深色面板半宽（宽 ≈ 0.55 W）


def mats():
    """调色板：名字和页面一致；渲染时发光件给自发光"""
    def emis(name, rgb, k):
        m = material(name, (*rgb, 1), 0.4)
        b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = k
        return m
    return {
        "white": material("op_white", (0.62, 0.7, 0.76, 1), 0.5),
        "dark": material("op_dark", (0.04, 0.06, 0.08, 1), 0.6),
        "steel": material("op_steel", (0.2, 0.33, 0.46, 1), 0.45, 0.35),
        "cyan": emis("op_cyan", (0.1, 0.8, 1.0), 4.0),
        "red": emis("op_red", (1.0, 0.18, 0.2), 2.0),
        "lamp": emis("op_headlamp", (0.9, 0.95, 1.0), 8.0),
        "cargo": material("op_cargo", (0.08, 0.07, 0.06, 1), 0.95),
    }


def raked(name, hw, z0, z1, y_at_z0, depth, m, inset=0.0):
    """后倾的车头板：底边在 (y_at_z0, z0)，按 RAKE 向后上方倾到 z1；depth 是板厚（沿法线）"""
    h = (z1 - z0) / math.cos(RAKE)
    ob = box(name, (2 * hw, depth, h), location=(0, y_at_z0 + math.tan(RAKE) * (z1 - z0) / 2 + inset, (z0 + z1) / 2), rotation=(-RAKE, 0, 0))
    return assign(ob, m)


def wheel(tag, x, y, M):
    """轮胎：截面绕轴旋转（16 段，总览 / 近景都够），轮辋 + 轮毂；轴向沿 X"""
    prof = [(0.44, -TW / 2), (0.64, -TW / 2), (R, -TW / 2 + 0.06), (R, TW / 2 - 0.06), (0.64, TW / 2), (0.44, TW / 2)]
    t = profile_spin(f"VH_HaulTruck_Tyre_{tag}", prof, steps=16, location=(x, y, R))
    t.rotation_euler = (0, math.radians(90), 0)
    assign(t, M["dark"])
    rim = cylinder(f"VH_HaulTruck_Rim_{tag}", 0.44, TW - 0.08, segments=12, axis="X", location=(x, y, R))
    assign(rim, M["steel"])


def build(scene, args):
    clear_owned("phase:02_blockout")
    M = mats()
    # 车架：两根纵梁 + 三道横梁
    for sx in (-1, 1):
        assign(box(f"VH_HaulTruck_Rail_{sx:+d}", (0.3, L - 0.8, 0.42), location=(sx * 0.55, (Y_FRONT + Y_REAR) / 2 + 0.2, 1.2)), M["dark"])
    for y in (-1.2, 1.0, 3.6):
        assign(box(f"VH_HaulTruck_Cross_{y:+.1f}", (1.4, 0.25, 0.3), location=(0, y, 1.2)), M["dark"])
    # 车头下部：白色鼻箱 + 黑格栅 + 护杠竖条 + 保险杠 + 大灯
    assign(box("VH_HaulTruck_NoseLow", (2.9, 1.15, 0.95), location=(0, Y_FRONT + 0.6, 1.3)), M["white"])
    assign(box("VH_HaulTruck_Grille", (2.0, 0.06, 0.6), location=(0, Y_FRONT + 0.0, 1.28)), M["dark"])
    for i in range(7):
        assign(box(f"VH_HaulTruck_Guard_{i}", (0.07, 0.07, 0.95), location=(-0.9 + 0.3 * i, Y_FRONT - 0.12, 1.2)), M["steel"])
    assign(box("VH_HaulTruck_GuardTop", (2.0, 0.08, 0.08), location=(0, Y_FRONT - 0.12, 1.66)), M["steel"])
    assign(box("VH_HaulTruck_Bumper", (3.3, 0.35, 0.28), location=(0, Y_FRONT - 0.05, 0.72)), M["dark"])
    for sx in (-1, 1):
        assign(box(f"VH_HaulTruck_Lamp_{sx:+d}", (0.36, 0.06, 0.2), location=(sx * 1.2, Y_FRONT - 0.01, 1.28)), M["lamp"])
    # 车头上部：控制舱（侧面白）+ 后倾深色面板 + 面板下沿青色灯带
    y_face = Y_FRONT + 0.55  # 面板底边的 y（鼻箱后上方）
    assign(box("VH_HaulTruck_Module", (2.4, BED_Y0 - y_face - 0.2, PANEL_Z[1] - 1.75 + 0.05), location=(0, (y_face + 0.2 + BED_Y0) / 2 + 0.1, (1.75 + PANEL_Z[1]) / 2)), M["white"])
    raked("VH_HaulTruck_Panel", PANEL_HW, PANEL_Z[0], PANEL_Z[1], y_face, 0.12, M["dark"])
    raked("VH_HaulTruck_LightBand", PANEL_HW, PANEL_Z[0] - 0.02, PANEL_Z[0] + 0.12, y_face - 0.04, 0.06, M["cyan"])
    # 两侧白耳鳍：侧面是前低后高的梯形（前沿随面板后倾），向外伸出
    for sx in (-1, 1):
        # 图 A：耳鳍只是车头两角的窄条（侧面看约 0.7 m 深），第一版做成 2.2 m 长，侧面看像一个方驾驶室
        prof = [(y_face - 0.25, 1.4), (y_face - 0.25 + math.tan(RAKE) * (PANEL_Z[1] + 0.05 - 1.4), PANEL_Z[1] + 0.05), (y_face + 0.55, PANEL_Z[1] + 0.05), (y_face + 0.8, 1.4)]
        fin = profile_extrude(f"VH_HaulTruck_Fin_{sx:+d}", prof, 0.42, location=(sx * 1.2 if sx < 0 else 1.2 + 0.42, 0, 0), rotation=(0, math.radians(90) * (1 if sx < 0 else -1), 0))
        # profile_extrude 在 XY 平面画轮廓、沿 Z 拉伸：绕 Y 转 90° 后 X→-Z…；直接改顶点更稳，见下面 _fin_fix
        _fin_fix(fin, prof, sx, M)
        # 耳鳍前沿的竖向青灯条
        z0, z1 = 1.55, PANEL_Z[1] - 0.1
        ob = box(f"VH_HaulTruck_FinLight_{sx:+d}", (0.06, 0.06, (z1 - z0) / math.cos(RAKE)), location=(sx * 1.25, y_face - 0.27 + math.tan(RAKE) * ((z0 + z1) / 2 - 1.4), (z0 + z1) / 2), rotation=(-RAKE, 0, 0))
        assign(ob, M["cyan"])
        # 激光雷达立杆 + 探头
        assign(cylinder(f"VH_HaulTruck_LidarPole_{sx:+d}", 0.05, 0.75, segments=6, location=(sx * 1.45, y_face + 0.5, PANEL_Z[1] + 0.4)), M["dark"])
        assign(cylinder(f"VH_HaulTruck_Lidar_{sx:+d}", 0.14, 0.16, segments=8, location=(sx * 1.45, y_face + 0.5, PANEL_Z[1] + 0.82)), M["dark"])
        # 前轮挡泥板（白）
        assign(box(f"VH_HaulTruck_Fender_{sx:+d}", (0.6, 1.8, 0.12), location=(sx * (W / 2 - 0.3), YF, 2 * R + 0.12)), M["white"])
        # 电池箱（白）+ 散热格栅（暗）
        assign(box(f"VH_HaulTruck_Battery_{sx:+d}", (0.85, 1.9, 0.95), location=(sx * 1.3, -0.35, 1.6)), M["white"])
        for k in range(3):
            assign(box(f"VH_HaulTruck_Vent_{sx:+d}_{k}", (0.03, 0.4, 0.55), location=(sx * 1.73, -1.0 + 0.6 * k, 1.6)), M["dark"])
        # 尾灯
        assign(box(f"VH_HaulTruck_Tail_{sx:+d}", (0.3, 0.05, 0.18), location=(sx * 1.5, Y_REAR + 0.02, TAIL_Z - 0.25)), M["red"])
    # 车斗（开口的斗）：侧板轮廓 = 平底到 TAIL_Y、之后向尾部上翘；侧板顶沿从前往后略升
    side = [(BED_Y0, BED_Z0), (TAIL_Y, BED_Z0), (Y_REAR, TAIL_Z), (Y_REAR, BED_TOP + 0.15), (BED_Y0, BED_TOP)]
    for sx in (-1, 1):
        _plate_yz(f"VH_HaulTruck_BedSide_{sx:+d}", side, sx * (W / 2 - 0.06), 0.12, M["white"])
        for k, y in enumerate((BED_Y0 + 1.2, BED_Y0 + 2.6, BED_Y0 + 4.0)):  # 竖向加强筋
            z_bot = BED_Z0 if y < TAIL_Y else BED_Z0 + (TAIL_Z - BED_Z0) * (y - TAIL_Y) / (Y_REAR - TAIL_Y)
            assign(box(f"VH_HaulTruck_Rib_{sx:+d}_{k}", (0.12, 0.2, BED_TOP - z_bot), location=(sx * (W / 2 + 0.03), y, (BED_TOP + z_bot) / 2)), M["white"])
        assign(box(f"VH_HaulTruck_TopRail_{sx:+d}", (0.18, Y_REAR - BED_Y0, 0.16), location=(sx * (W / 2 + 0.02), (BED_Y0 + Y_REAR) / 2, BED_TOP + 0.04)), M["white"])
    # 斗底：平的一段 + 上翘的一段
    assign(box("VH_HaulTruck_BedFloor", (W - 0.1, TAIL_Y - BED_Y0, 0.16), location=(0, (BED_Y0 + TAIL_Y) / 2, BED_Z0 + 0.08)), M["white"])
    ln = math.hypot(Y_REAR - TAIL_Y, TAIL_Z - BED_Z0)
    ang = math.atan2(TAIL_Z - BED_Z0, Y_REAR - TAIL_Y)
    assign(box("VH_HaulTruck_BedTail", (W - 0.1, ln, 0.16), location=(0, (TAIL_Y + Y_REAR) / 2, (BED_Z0 + TAIL_Z) / 2 + 0.08), rotation=(ang, 0, 0)), M["white"])
    # 前挡板：一直升到护顶
    assign(box("VH_HaulTruck_BedFront", (W, 0.16, H - BED_Z0), location=(0, BED_Y0, (BED_Z0 + H) / 2)), M["white"])
    # 护顶：从前挡板顶向前伸到车头上方；顶面三道纵向加强槽（浅灰）
    assign(box("VH_HaulTruck_Canopy", (W - 0.1, BED_Y0 - CANOPY_Y0 + 0.4, 0.22), location=(0, (CANOPY_Y0 + BED_Y0 + 0.4) / 2, H - 0.11)), M["white"])
    for x in (-0.9, 0.0, 0.9):
        assign(box(f"VH_HaulTruck_CanopyRib_{x:+.1f}", (0.32, BED_Y0 - CANOPY_Y0 + 0.4, 0.1), location=(x, (CANOPY_Y0 + BED_Y0 + 0.4) / 2, H + 0.04)), M["steel"])
    assign(box("VH_HaulTruck_CanopyLip", (W - 0.1, 0.12, 0.35), location=(0, CANOPY_Y0, H - 0.3)), M["white"])
    # 车轮：前单胎，后两桥双胎
    for sx in (-1, 1):
        sd = "L" if sx > 0 else "R"
        wheel(f"F_{sd}", sx * (W / 2 - 0.35), YF, M)
        for i, y in enumerate(YR):
            wheel(f"R{i}o_{sd}", sx * (W / 2 - TW / 2), y, M)
            wheel(f"R{i}i_{sd}", sx * (W / 2 - TW * 1.5 - 0.05), y, M)
    # 货堆（页面只在重载时显示）：沿车斗长度的几个截面放样，中间高、两边低
    secs = []
    for y, top in ((BED_Y0 + 0.2, BED_TOP + 0.1), (BED_Y0 + 1.6, BED_TOP + 0.8), (BED_Y0 + 3.2, BED_TOP + 0.95), (TAIL_Y, BED_TOP + 0.6), (Y_REAR - 0.5, TAIL_Z + 0.3)):
        base = BED_Z0 + 0.17 if y <= TAIL_Y else BED_Z0 + (TAIL_Z - BED_Z0) * (y - TAIL_Y) / (Y_REAR - TAIL_Y) + 0.17
        hw = W / 2 - 0.15
        secs.append([(-hw, y, base), (-hw, y, BED_TOP - 0.1), (-hw * 0.45, y, top - 0.15), (0, y, top), (hw * 0.45, y, top - 0.15), (hw, y, BED_TOP - 0.1), (hw, y, base)])
    assign(loft("VH_HaulTruck_CargoPart", secs, smooth=False), M["cargo"])
    log("parts", len([o for o in bpy.data.objects if o.get("owner") == OWNER_TAG]))


def _plate_yz(name, prof_yz, x, thick, m):
    """YZ 平面里的多边形板（车斗侧板），厚 thick，中心在 x"""
    bm = bmesh.new()
    a = [bm.verts.new((x - thick / 2, y, z)) for y, z in prof_yz]
    b = [bm.verts.new((x + thick / 2, y, z)) for y, z in prof_yz]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(prof_yz)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return assign(new_mesh_object(name, bm, "LOW"), m)


def _fin_fix(ob, prof_yz, sx, M):
    """耳鳍：直接按 YZ 轮廓重建成板（profile_extrude 的轴向换算容易错，这里删掉它的网格重画）"""
    x_in, x_out = sx * 1.2, sx * 1.62
    me = ob.data
    bm = bmesh.new()
    a = [bm.verts.new((x_in, y, z)) for y, z in prof_yz]
    b = [bm.verts.new((x_out, y, z)) for y, z in prof_yz]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(prof_yz)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob.location = (0, 0, 0)
    ob.rotation_euler = (0, 0, 0)
    assign(ob, M["white"])


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    clear_owned()
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
