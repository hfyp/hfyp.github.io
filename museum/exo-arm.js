import * as THREE from 'three';

const DISPLAY_SCALE = 2.35;
const HALF_SHOULDER_SEPARATION = 0.27;
const MAX_JOINT1_ANGLE = THREE.MathUtils.degToRad(10);
const MAX_JOINT2_ANGLE = THREE.MathUtils.degToRad(10);
const MAX_JOINT4_ANGLE = THREE.MathUtils.degToRad(30);
const FALLBACK_JOINTS = {
  Joint1: { position: [0, 0, 0], axis: [0.707107, -0.521334, -0.477714] },
  Joint2: { position: [-0.008178, -0.01109, 0], axis: [0.593426, 0.804889, 0] },
  Joint4: { position: [-0.006839, 0.00891, -0.302303], axis: [1, 0, 0] }
};

function parseVector(value, fallback) {
  const values = (value || '').trim().split(/\s+/).map(Number);
  return values.length === 3 && values.every(Number.isFinite) ? values : fallback;
}

async function loadBinaryStl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`STL request failed with ${response.status}: ${url}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 84) throw new Error(`Invalid binary STL: ${url}`);

  const view = new DataView(buffer);
  const faceCount = view.getUint32(80, true);
  if (84 + faceCount * 50 > buffer.byteLength) throw new Error(`Truncated binary STL: ${url}`);

  const positions = new Float32Array(faceCount * 9);
  const normals = new Float32Array(faceCount * 9);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];

  for (let face = 0; face < faceCount; face += 1) {
    const source = 84 + face * 50;
    const normal = [
      view.getFloat32(source, true),
      view.getFloat32(source + 4, true),
      view.getFloat32(source + 8, true)
    ];
    const destination = face * 9;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexSource = source + 12 + vertex * 12;
      const vertexDestination = destination + vertex * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(vertexSource + axis * 4, true);
        positions[vertexDestination + axis] = value;
        normals[vertexDestination + axis] = normal[axis];
        minimum[axis] = Math.min(minimum[axis], value);
        maximum[axis] = Math.max(maximum[axis], value);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return { geometry, faceCount, minimum, maximum };
}

export class WallExoArm {
  constructor(scene, {
    baseUrl = './models/exo-ul8/',
    position = new THREE.Vector3(-.25, 3.3, -15.58)
  } = {}) {
    this.scene = scene;
    this.baseUrl = baseUrl;
    this.wallAnchor = position.clone();
    this.status = 'loading detailed STL assembly';
    this.faceCount = 0;
    this.ready = false;
    this.time = 0;
    this.jointAngles = { Joint1: 0, Joint2: 0, Joint4: 0 };
    this.jointPivots = { Joint1: [], Joint2: [], Joint4: [] };

    this.root = new THREE.Group();
    this.root.name = 'EXO_UL8_bilateral_wall_study';
    this.scene.add(this.root);

    this.blueMetal = new THREE.MeshStandardMaterial({
      color: 0x1254a8,
      metalness: .68,
      roughness: .39
    });
    this.silverMotor = new THREE.MeshStandardMaterial({
      color: 0xcbd2d7,
      metalness: .86,
      roughness: .3
    });
  }

  async load() {
    const xmlPromise = fetch(`${this.baseUrl}model.xml`).then((response) => {
      if (!response.ok) throw new Error(`XML request failed with ${response.status}`);
      return response.text();
    });
    const meshPromises = Array.from(
      { length: 8 },
      (_, index) => loadBinaryStl(`${this.baseUrl}link${index}.stl?v=2`)
    );
    const [xmlText, meshes] = await Promise.all([xmlPromise, Promise.all(meshPromises)]);
    const joints = this.parseAnimatedJoints(xmlText);

    this.buildBilateralAssembly(meshes, joints);
    this.faceCount = meshes.reduce((sum, mesh) => sum + mesh.faceCount, 0);
    this.status = `${(this.faceCount / 1000).toFixed(1)}k faces · J1 0° · J2 0° · J4 0°`;
    this.ready = true;
    return this;
  }

  parseAnimatedJoints(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) return FALLBACK_JOINTS;
    const result = {};
    for (const name of ['Joint1', 'Joint2', 'Joint4']) {
      const fallback = FALLBACK_JOINTS[name];
      const joint = xml.querySelector(`joint[name="${name}"]`);
      result[name] = joint ? {
        position: parseVector(joint.getAttribute('pos'), fallback.position),
        axis: parseVector(joint.getAttribute('axis'), fallback.axis)
      } : fallback;
    }
    return result;
  }

  createMesh(meshData, material, name) {
    const mesh = new THREE.Mesh(meshData.geometry, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  attachGlobalMesh(meshData, material, name, parent, globalPivot) {
    const mesh = this.createMesh(meshData, material, name);
    mesh.position.copy(globalPivot).multiplyScalar(-1);
    parent.add(mesh);
    return mesh;
  }

  createJointPivot(name, joint, parent, parentGlobalPosition) {
    const globalPosition = new THREE.Vector3(...joint.position);
    const pivot = new THREE.Group();
    pivot.name = `EXO_${name}_pivot`;
    pivot.position.copy(globalPosition).sub(parentGlobalPosition);
    pivot.userData.axis = new THREE.Vector3(...joint.axis).normalize();
    parent.add(pivot);
    return { pivot, globalPosition };
  }

  buildSourceArm(meshes, joints) {
    const arm = new THREE.Group();
    arm.name = 'EXO_right_source_arm';

    // Link0 is fixed to the wall. Link1 responds to Joint1; Link2 and Link3
    // respond to Joint1+Joint2 while Joint3 remains locked at zero.
    arm.add(this.createMesh(meshes[0], this.blueMetal, 'EXO_Link0_wall_fixed'));
    const origin = new THREE.Vector3();
    const joint1 = this.createJointPivot('Joint1', joints.Joint1, arm, origin);
    this.attachGlobalMesh(meshes[1], this.blueMetal, 'EXO_Link1', joint1.pivot, joint1.globalPosition);

    const joint2 = this.createJointPivot('Joint2', joints.Joint2, joint1.pivot, joint1.globalPosition);
    this.attachGlobalMesh(meshes[2], this.silverMotor, 'EXO_Link2_motor', joint2.pivot, joint2.globalPosition);
    this.attachGlobalMesh(meshes[3], this.blueMetal, 'EXO_Link3', joint2.pivot, joint2.globalPosition);

    // Joint3 is fixed at zero. Joint4 uses its true global XML offset relative
    // to Joint2, preserving the DH bend instead of straightening the arm.
    const joint4 = this.createJointPivot('Joint4', joints.Joint4, joint2.pivot, joint2.globalPosition);

    const rigidLowerAssembly = new THREE.Group();
    rigidLowerAssembly.name = 'EXO_Link4_to_Link7_rigid_assembly';
    rigidLowerAssembly.position.copy(joint4.globalPosition).multiplyScalar(-1);
    joint4.pivot.add(rigidLowerAssembly);

    for (let index = 4; index <= 7; index += 1) {
      const material = index === 4 || index === 6 ? this.silverMotor : this.blueMetal;
      rigidLowerAssembly.add(this.createMesh(meshes[index], material, `EXO_Link${index}_rigid`));
    }

    return arm;
  }

  buildBilateralAssembly(meshes, joints) {
    const sourceArm = this.buildSourceArm(meshes, joints);

    // Native STL axes: X is lateral, Z is vertical, Y points away from the
    // mounting surface. This transform maps source Z to museum Y and source Y
    // to museum Z while retaining every original DH/STL bend and offset.
    sourceArm.rotation.x = Math.PI / 2;
    sourceArm.scale.set(DISPLAY_SCALE, DISPLAY_SCALE, -DISPLAY_SCALE);

    // Link0's rearmost Y surface lands exactly on the project-room wall. Every
    // other vertex then extends into the room rather than disappearing behind it.
    const link0WallY = meshes[0].minimum[1];
    const symmetryAxisX = this.wallAnchor.x;
    const shoulderOffset = HALF_SHOULDER_SEPARATION * DISPLAY_SCALE;
    sourceArm.position.set(
      symmetryAxisX + shoulderOffset,
      this.wallAnchor.y,
      this.wallAnchor.z - link0WallY * DISPLAY_SCALE + .015
    );
    this.root.add(sourceArm);

    // Load and upload one eight-link source arm only. The opposite side shares
    // all BufferGeometry and materials and is produced by a single X mirror.
    const mirroredArm = sourceArm.clone(true);
    mirroredArm.name = 'EXO_left_mirrored_arm';
    mirroredArm.position.x = symmetryAxisX - shoulderOffset;
    mirroredArm.scale.x *= -1;
    this.root.add(mirroredArm);

    for (const name of ['Joint1', 'Joint2', 'Joint4']) {
      this.jointPivots[name] = [
        sourceArm.getObjectByName(`EXO_${name}_pivot`),
        mirroredArm.getObjectByName(`EXO_${name}_pivot`)
      ];
    }
  }

  update(delta) {
    if (!this.ready) return;
    this.time += Math.min(delta, .05);

    // Joint1/2 move at half Joint4's angular frequency and remain inside ±10°.
    // The wider shoulder separation keeps the mirrored assemblies from meeting
    // at the center even at their extrema.
    this.jointAngles.Joint1 = Math.sin(this.time * 1.075) * MAX_JOINT1_ANGLE;
    this.jointAngles.Joint2 = Math.sin(this.time * 1.075 + .55) * MAX_JOINT2_ANGLE;
    this.jointAngles.Joint4 = Math.sin(this.time * 2.15) * MAX_JOINT4_ANGLE;
    for (const name of ['Joint1', 'Joint2', 'Joint4']) {
      for (const pivot of this.jointPivots[name]) {
        pivot.quaternion.setFromAxisAngle(pivot.userData.axis, this.jointAngles[name]);
      }
    }
    this.status = `${(this.faceCount / 1000).toFixed(1)}k faces · J1 ${THREE.MathUtils.radToDeg(this.jointAngles.Joint1).toFixed(0)}° · J2 ${THREE.MathUtils.radToDeg(this.jointAngles.Joint2).toFixed(0)}° · J4 ${THREE.MathUtils.radToDeg(this.jointAngles.Joint4).toFixed(0)}°`;
  }

  getDebugSnapshot() {
    return {
      status: this.status,
      faces: this.faceCount,
      joint1Degrees: THREE.MathUtils.radToDeg(this.jointAngles.Joint1),
      joint2Degrees: THREE.MathUtils.radToDeg(this.jointAngles.Joint2),
      joint4Degrees: THREE.MathUtils.radToDeg(this.jointAngles.Joint4),
      ready: this.ready
    };
  }
}
