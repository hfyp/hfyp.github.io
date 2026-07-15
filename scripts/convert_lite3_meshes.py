#!/usr/bin/env python3
"""Convert Lite3 COLLADA visual meshes to compact binary STL files.

The source package mixes COLLADA 1.4/1.5, Y_UP/Z_UP assets, polylists, and a
shank split across many tiny geometry/material groups. The browser display does
not need those material groups, so this script bakes scene transforms and emits
one draw-friendly STL per asset.

Important: preserve each DAE's authored coordinate basis. Lite3.urdf already
contains the visual-origin RPY rotations that map those mesh coordinates into
their link frames. Converting Y_UP here as well would apply the same 90-degree
correction twice and make the articulated model appear exploded.
"""

from __future__ import annotations

import math
import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "lite3_description" / "meshes"
DESTINATION = ROOT / "museum" / "models" / "lite3" / "meshes"
ASSETS = (
    "TORSO", "FL_HIP", "FR_HIP", "HL_HIP", "HR_HIP",
    "L_THIGH", "R_THIGH", "SHANK",
)


def identity():
    return [[1.0 if row == column else 0.0 for column in range(4)] for row in range(4)]


def multiply(a, b):
    return [[sum(a[row][k] * b[k][column] for k in range(4)) for column in range(4)] for row in range(4)]


def transform_point(matrix, point):
    vector = [point[0], point[1], point[2], 1.0]
    result = [sum(matrix[row][column] * vector[column] for column in range(4)) for row in range(4)]
    return result[:3]


def translation(values):
    matrix = identity()
    matrix[0][3], matrix[1][3], matrix[2][3] = values[:3]
    return matrix


def scaling(values):
    matrix = identity()
    matrix[0][0], matrix[1][1], matrix[2][2] = values[:3]
    return matrix


def rotation(values):
    x, y, z, degrees = values
    length = math.sqrt(x * x + y * y + z * z) or 1.0
    x, y, z = x / length, y / length, z / length
    cosine, sine = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    one_minus = 1.0 - cosine
    return [
        [cosine + x * x * one_minus, x * y * one_minus - z * sine, x * z * one_minus + y * sine, 0.0],
        [y * x * one_minus + z * sine, cosine + y * y * one_minus, y * z * one_minus - x * sine, 0.0],
        [z * x * one_minus - y * sine, z * y * one_minus + x * sine, cosine + z * z * one_minus, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def node_matrix(node, namespace):
    matrix = identity()
    for child in list(node):
        tag = child.tag.split("}")[-1]
        values = [float(value) for value in (child.text or "").split()]
        if tag == "translate":
            matrix = multiply(matrix, translation(values))
        elif tag == "rotate":
            matrix = multiply(matrix, rotation(values))
        elif tag == "scale":
            matrix = multiply(matrix, scaling(values))
        elif tag == "matrix" and len(values) == 16:
            collada_matrix = [values[row * 4:(row + 1) * 4] for row in range(4)]
            matrix = multiply(matrix, collada_matrix)
    return matrix


def parse_geometry(geometry, namespace):
    mesh = geometry.find(namespace + "mesh")
    sources = {}
    for source in mesh.findall(namespace + "source"):
        array = source.find(namespace + "float_array")
        accessor = source.find("./" + namespace + "technique_common/" + namespace + "accessor")
        if array is None or accessor is None:
            continue
        values = [float(value) for value in (array.text or "").split()]
        stride = int(accessor.get("stride", "1"))
        sources[source.get("id")] = (values, stride)

    vertices_sources = {}
    for vertices in mesh.findall(namespace + "vertices"):
        position_input = next((item for item in vertices.findall(namespace + "input") if item.get("semantic") == "POSITION"), None)
        if position_input is not None:
            vertices_sources[vertices.get("id")] = position_input.get("source", "").lstrip("#")

    triangles = []
    for primitive in list(mesh):
        tag = primitive.tag.split("}")[-1]
        if tag not in ("polylist", "triangles"):
            continue
        inputs = primitive.findall(namespace + "input")
        stride = max((int(item.get("offset", "0")) for item in inputs), default=0) + 1
        vertex_input = next((item for item in inputs if item.get("semantic") in ("VERTEX", "POSITION")), None)
        if vertex_input is None:
            continue
        vertex_offset = int(vertex_input.get("offset", "0"))
        source_id = vertex_input.get("source", "").lstrip("#")
        if vertex_input.get("semantic") == "VERTEX":
            source_id = vertices_sources[source_id]
        values, position_stride = sources[source_id]
        indices = [int(value) for value in (primitive.findtext(namespace + "p") or "").split()]
        if tag == "triangles":
            counts = [3] * int(primitive.get("count", "0"))
        else:
            counts = [int(value) for value in (primitive.findtext(namespace + "vcount") or "").split()]
        cursor = 0
        for count in counts:
            polygon = []
            for vertex in range(count):
                index = indices[cursor + vertex * stride + vertex_offset]
                start = index * position_stride
                polygon.append(values[start:start + 3])
            cursor += count * stride
            for index in range(1, len(polygon) - 1):
                triangles.append((polygon[0], polygon[index], polygon[index + 1]))
    return triangles


def collada_triangles(path):
    root = ET.parse(path).getroot()
    namespace = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
    geometries = {
        geometry.get("id"): parse_geometry(geometry, namespace)
        for geometry in root.findall("./" + namespace + "library_geometries/" + namespace + "geometry")
    }
    output = []

    def walk(node, parent_matrix):
        matrix = multiply(parent_matrix, node_matrix(node, namespace))
        for instance in node.findall(namespace + "instance_geometry"):
            geometry_id = instance.get("url", "").lstrip("#")
            for triangle in geometries.get(geometry_id, ()):
                converted = []
                for point in triangle:
                    # Keep the mesh basis unchanged. The URDF <visual origin>
                    # owns the mesh-to-link rotation, including its 90° turns.
                    converted.append(tuple(transform_point(matrix, point)))
                output.append(tuple(converted))
        for child in node.findall(namespace + "node"):
            walk(child, matrix)

    visual_scene = root.find("./" + namespace + "library_visual_scenes/" + namespace + "visual_scene")
    if visual_scene is None:
        raise ValueError(f"No visual scene in {path}")
    for node in visual_scene.findall(namespace + "node"):
        walk(node, identity())
    return output


def normal(triangle):
    a, b, c = triangle
    ab = [b[index] - a[index] for index in range(3)]
    ac = [c[index] - a[index] for index in range(3)]
    value = (
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    )
    length = math.sqrt(sum(component * component for component in value))
    return tuple(component / length for component in value) if length > 1e-12 else (0.0, 0.0, 0.0)


def write_binary_stl(path, triangles):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as output:
        output.write(b"Lite3 browser mesh".ljust(80, b"\0"))
        output.write(struct.pack("<I", len(triangles)))
        for triangle in triangles:
            output.write(struct.pack("<3f", *normal(triangle)))
            for vertex in triangle:
                output.write(struct.pack("<3f", *vertex))
            output.write(struct.pack("<H", 0))


def main():
    total_faces = 0
    total_bytes = 0
    for name in ASSETS:
        source = SOURCE / f"{name}.dae"
        destination = DESTINATION / f"{name}.stl"
        triangles = collada_triangles(source)
        write_binary_stl(destination, triangles)
        total_faces += len(triangles)
        total_bytes += destination.stat().st_size
        print(f"{name:8s} {len(triangles):6d} faces  {destination.stat().st_size / 1024:7.1f} KiB")
    print(f"TOTAL    {total_faces:6d} faces  {total_bytes / 1024 / 1024:.2f} MiB")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Lite3 conversion failed: {error}", file=sys.stderr)
        raise
