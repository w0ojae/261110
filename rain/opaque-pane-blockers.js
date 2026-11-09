// An exact, bounded complement to asynchronous GPU queries. Only real opaque
// faces are used, never an object's box: boxes would close windows and doors.
// The current eye must see the WHOLE pane through one convex opaque face.
export function createOpaquePaneBlockers(THREE, roots = [], {limit = 384} = {}) {
  const stats = {blockers: 0, revision: 0};
  const snapshots = [], faces = [];
  const eye = new THREE.Vector3(), point = new THREE.Vector3(), hit = new THREE.Vector3();
  const edge = new THREE.Vector3(), offset = new THREE.Vector3(), cross = new THREE.Vector3();
  const viewPoint = new THREE.Vector3(), corners = [];
  let built = false, signature = null;
  const margin = .001;
  const version = attribute => attribute?.isInterleavedBufferAttribute ? attribute.data.version : attribute?.version;

  function opaque(material) {
    return material && !material.isShaderMaterial && material.visible !== false &&
      material.transparent === false && material.opacity === 1 &&
      material.depthWrite === true && material.depthTest === true &&
      [THREE.LessDepth, THREE.LessEqualDepth].includes(material.depthFunc) &&
      [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].includes(material.side) &&
      !material.alphaTest && !material.alphaHash && !material.alphaMap && !material.alphaToCoverage &&
      !material.transmission && !material.displacementMap && !material.wireframe &&
      !material.polygonOffset && !(material.clippingPlanes?.length);
  }
  function visible(mesh, camera) {
    if (!mesh.layers.test(camera.layers)) return false;
    for (let object = mesh; object; object = object.parent) if (!object.visible) return false;
    return true;
  }
  const key = vertex => `${vertex.x},${vertex.y},${vertex.z}`;
  function shape(vertices, source, material) {
    const normal = vertices[1].clone().sub(vertices[0])
      .cross(vertices[2].clone().sub(vertices[0]));
    const doubleArea = normal.length();
    if (!Number.isFinite(doubleArea) || !(doubleArea > .000001)) return null;
    normal.multiplyScalar(1 / doubleArea);
    let area = 0;
    for (let i = 1; i < vertices.length - 1; i++) {
      area += vertices[i].clone().sub(vertices[0])
        .cross(vertices[i + 1].clone().sub(vertices[0])).length() / 2;
    }
    // Convexity is essential: testing corners against a concave boundary could
    // hide a pane through a gap. Do not weld, round or bridge unrelated faces.
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const c = vertices[(i + 2) % vertices.length];
      if (b.clone().sub(a).cross(c.clone().sub(b)).dot(normal) <= 1e-12) return null;
    }
    return {vertices, normal, constant: -normal.dot(vertices[0]), area, source, material,
      materialVersion: material.version, shaderHook: material.onBeforeCompile};
  }
  function build() {
    built = true;
    const visited = new Set(), triangles = [];
    for (const root of roots) root?.traverse?.(mesh => {
      if (visited.has(mesh)) return;
      visited.add(mesh);
      if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh ||
          mesh.userData.modelOutline || mesh.geometry?.morphAttributes?.position?.length) return;
      const geometry = mesh.geometry, position = geometry?.getAttribute?.('position');
      if (!position || position.isGLBufferAttribute || mesh.matrixWorld.determinant() <= 0) return;
      const index = geometry.index, count = index ? index.count : position.count;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some(opaque)) return;
      const source = {mesh, geometry, position, index, materials: mesh.material,
        positionVersion: version(position), indexVersion: version(index),
        matrix: mesh.matrixWorld.clone(), range: {...geometry.drawRange},
        groups: JSON.stringify(geometry.groups), ancestors: []};
      for (let ancestor = mesh; ancestor; ancestor = ancestor.parent) source.ancestors.push(ancestor);
      snapshots.push(source);
      const groups = Array.isArray(mesh.material) ? geometry.groups : [{start: 0, count, materialIndex: 0}];
      for (const group of groups) {
        const material = materials[group.materialIndex || 0];
        if (!opaque(material)) continue;
        const start = Math.max(0, group.start, geometry.drawRange.start);
        const end = Math.min(count, group.start + group.count,
          geometry.drawRange.start + geometry.drawRange.count);
        // A partial primitive is deliberately ignored.
        if (start % 3) continue;
        for (let i = start; i + 2 < end; i += 3) {
          const vertices = [0, 1, 2].map(j => new THREE.Vector3()
            .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)
            .applyMatrix4(source.matrix));
          const face = shape(vertices, source, material);
          if (face && face.area >= .025) triangles.push(face);
        }
      }
    });
    // Pair exact adjacent, coplanar triangles, including authored split normals.
    // A pair's convex boundary is precisely its union, so holes stay holes.
    triangles.sort((a, b) => b.area - a.area);
    const pool = triangles.slice(0, 4096), edges = new Map(), pairs = [];
    for (const triangle of pool) {
      const v = triangle.vertices;
      for (let i = 0; i < 3; i++) {
        const a = key(v[i]), b = key(v[(i + 1) % 3]);
        const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
        for (const other of edges.get(edgeKey) || []) {
          if (other.source !== triangle.source || other.material !== triangle.material ||
              other.normal.dot(triangle.normal) < 1 - 1e-12 ||
              v.some(p => Math.abs(other.normal.dot(p) + other.constant) > 1e-10)) continue;
          const ov = other.vertices;
          const sharedA = v[i], sharedB = v[(i + 1) % 3];
          const third = ov.find(p => key(p) !== a && key(p) !== b);
          const oi = ov.findIndex(p => key(p) === b);
          if (!third || key(ov[(oi + 1) % 3]) !== a) continue;
          const quad = shape([v[(i + 2) % 3], sharedA, third, sharedB], triangle.source, triangle.material);
          if (quad) pairs.push(quad);
        }
        if (!edges.has(edgeKey)) edges.set(edgeKey, []);
        edges.get(edgeKey).push(triangle);
      }
    }
    faces.push(...[...pool, ...pairs].sort((a, b) => b.area - a.area).slice(0, limit));
    stats.blockers = faces.length;
  }
  function current(source) {
    const {mesh, geometry, position, index} = source;
    let ancestor = mesh;
    for (const expected of source.ancestors) {
      if (ancestor !== expected) return false;
      ancestor = ancestor.parent;
    }
    return !ancestor && !geometry.morphAttributes?.position?.length &&
      mesh.geometry === geometry && mesh.material === source.materials &&
      geometry.getAttribute('position') === position && geometry.index === index &&
      version(position) === source.positionVersion && version(index) === source.indexVersion &&
      mesh.matrixWorld.equals(source.matrix) && mesh.matrixWorld.determinant() > 0 &&
      geometry.drawRange.start === source.range.start && geometry.drawRange.count === source.range.count &&
      JSON.stringify(geometry.groups) === source.groups;
  }
  function trackSources() {
    const next = [];
    for (const {mesh} of snapshots) {
      const geometry = mesh.geometry, position = geometry?.getAttribute?.('position'), index = geometry?.index;
      next.push(geometry, position, version(position), index, version(index),
        ...mesh.matrixWorld.elements, geometry?.drawRange.start, geometry?.drawRange.count,
        JSON.stringify(geometry?.groups), Boolean(geometry?.morphAttributes?.position?.length));
      for (let object = mesh; object; object = object.parent) next.push(object, object.visible, object.layers.mask);
      next.push(null);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        next.push(material, material?.version, material?.onBeforeCompile, material?.visible,
          material?.side, material?.opacity, material?.transparent, material?.depthWrite,
          material?.depthTest, material?.depthFunc, material?.alphaTest, material?.alphaHash, material?.alphaToCoverage,
          material?.alphaMap, material?.transmission, material?.displacementMap, material?.wireframe,
          material?.polygonOffset, JSON.stringify(material?.clippingPlanes));
      }
      next.push(null);
    }
    if (!signature || signature.length !== next.length || next.some((value, i) => value !== signature[i])) {
      signature = next; stats.revision++;
    }
  }
  function select(camera, panes) {
    if (!built) build();
    trackSources();
    const hidden = new Set();
    if (!camera.isPerspectiveCamera || !(camera.near > 0) || !(camera.far > camera.near)) return hidden;
    if (![...camera.matrixWorld.elements, ...camera.matrixWorldInverse.elements,
      ...camera.projectionMatrix.elements].every(Number.isFinite)) return hidden;
    eye.setFromMatrixPosition(camera.matrixWorld);
    const usable = new Map(snapshots.map(source => [source, current(source) && visible(source.mesh, camera)]));
    const active = faces.filter(face => usable.get(face.source) && opaque(face.material) &&
      face.material.version === face.materialVersion && face.material.onBeforeCompile === face.shaderHook &&
      (Array.isArray(face.source.mesh.material) ? face.source.mesh.material.includes(face.material) :
        face.source.mesh.material === face.material));
    if (!active.length) return hidden;
    for (const pane of panes) {
      if (!pane.geometry?.getAttribute('position') || pane.isSkinnedMesh || pane.isInstancedMesh ||
          pane.geometry.morphAttributes?.position?.length) continue;
      // Fresh bounds also handle a changed pane attribute. Eight box corners
      // enclose all its triangles, so this remains conservative for any mesh.
      pane.geometry.computeBoundingBox();
      const box = pane.geometry.boundingBox;
      if (!box || box.isEmpty()) continue;
      corners.length = 0;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(pane.matrixWorld));
      for (const face of active) {
        const side = face.normal.dot(eye) + face.constant;
        if (Math.abs(side) <= margin ||
            (face.material.side === THREE.FrontSide && side <= 0) ||
            (face.material.side === THREE.BackSide && side >= 0)) continue;
        let covered = true;
        for (const corner of corners) {
          const distance = face.normal.dot(corner) + face.constant;
          if (side * distance >= 0 || Math.abs(distance) <= margin) {covered = false; break;}
          const t = side / (side - distance);
          hit.copy(corner).sub(eye).multiplyScalar(t).add(eye);
          viewPoint.copy(hit).applyMatrix4(camera.matrixWorldInverse);
          if (viewPoint.z >= -camera.near - margin || viewPoint.z <= -camera.far + margin) {covered = false; break;}
          for (let i = 0; i < face.vertices.length; i++) {
            point.copy(face.vertices[i]); edge.copy(face.vertices[(i + 1) % face.vertices.length]).sub(point);
            offset.copy(hit).sub(point); cross.crossVectors(edge, offset);
            if (cross.dot(face.normal) <= margin * edge.length()) {covered = false; break;}
          }
          if (!covered) break;
        }
        if (covered) {hidden.add(pane); break;}
      }
    }
    return hidden;
  }
  function dispose() {faces.length = snapshots.length = 0; stats.blockers = 0;}
  return {select, dispose, stats};
}
