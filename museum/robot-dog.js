import * as THREE from 'three';

const URDF_SCALE = 0.95;
const BODY_HEIGHT = 0.405;
const DISPLAY_RING_RADIUS = 0.8;
const ENTER_GUIDE_DISTANCE = 2;
const EXIT_GUIDE_DISTANCE = 4;
const RETURN_GRACE_SECONDS = 2;
const ROAM_BOUNDS = 12.6;
const WALK_SPEED_RANGE = [.55, 1.05];
const RUN_SPEED_RANGE = [1.45, 2.25];

const FALLBACK_JOINTS = {
  FL_HipX: [0.1745, 0.062, 0],
  FL_HipY: [0, 0.0985, 0],
  FR_HipX: [0.1745, -0.062, 0],
  FR_HipY: [0, -0.0985, 0],
  HL_HipX: [-0.1745, 0.062, 0],
  HL_HipY: [0, 0.0985, 0],
  HR_HipX: [-0.1745, -0.062, 0],
  HR_HipY: [0, -0.0985, 0]
};

function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function parseVector(value, fallback = [0, 0, 0]) {
  const values = (value || '').trim().split(/\s+/).map(Number);
  return values.length === 3 && values.every(Number.isFinite) ? values : fallback;
}

function urdfPositionToThree(values) {
  return new THREE.Vector3(values[1], values[2], values[0]);
}

const URDF_TO_THREE = new THREE.Matrix4().set(
  0, 1, 0, 0,
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 0, 0, 1
);
const THREE_TO_URDF = URDF_TO_THREE.clone().invert();

function urdfRpyToThreeQuaternion([roll, pitch, yaw]) {
  const urdfRotation = new THREE.Matrix4()
    .makeRotationZ(yaw)
    .multiply(new THREE.Matrix4().makeRotationY(pitch))
    .multiply(new THREE.Matrix4().makeRotationX(roll));
  const threeRotation = URDF_TO_THREE.clone().multiply(urdfRotation).multiply(THREE_TO_URDF);
  return new THREE.Quaternion().setFromRotationMatrix(threeRotation);
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
  for (let face = 0; face < faceCount; face += 1) {
    const source = 84 + face * 50;
    const destination = face * 9;
    const normal = [
      view.getFloat32(source, true),
      view.getFloat32(source + 4, true),
      view.getFloat32(source + 8, true)
    ];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexSource = source + 12 + vertex * 12;
      const vertexDestination = destination + vertex * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        positions[vertexDestination + axis] = view.getFloat32(vertexSource + axis * 4, true);
        normals[vertexDestination + axis] = normal[axis];
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.applyMatrix4(URDF_TO_THREE);
  geometry.computeBoundingSphere();
  return { geometry, faceCount };
}

export class Lite3RobotDog {
  constructor(scene, {
    urdfUrl = './models/lite3/Lite3.urdf',
    exhibitTarget = new THREE.Vector3(9.3, 0, -12.65),
    exhibitLookTarget = new THREE.Vector3(9.3, 0, -15.76),
    guideSpeed = 10.5,
    debug = false
  } = {}) {
    this.scene = scene;
    this.urdfUrl = urdfUrl;
    this.exhibitTarget = exhibitTarget.clone();
    this.exhibitLookTarget = exhibitLookTarget.clone();
    this.guideSpeed = guideSpeed;
    this.debug = debug;
    this.root = new THREE.Group();
    this.root.name = 'Lite3RobotDog';
    this.root.position.set(-3.2, 0, 2.4);
    this.scene.add(this.root);

    this.bodyRig = null;
    this.legs = [];
    this.joints = new Map();
    this.target = new THREE.Vector3();
    this.heading = Math.PI * 0.75;
    this.root.rotation.y = this.heading;
    this.state = 'loading';
    this.urdfStatus = 'loading Lite3 URDF';
    this.stateTimer = 0;
    this.guided = false;
    this.ready = false;
    this.playerDistance = Infinity;
    this.speed = 0;
    this.roamSpeed = 0;
    this.turnTargetHeading = this.heading;
    this.gaitWeight = 0;
    this.gaitPhase = 0;
    this.visuals = new Map();
    this.waitingForReturn = false;
    this.returnTimer = 0;

    this.targetMarker = new THREE.Mesh(
      new THREE.RingGeometry(.16, .26, 24),
      new THREE.MeshBasicMaterial({ color: 0xd8b873, transparent: true, opacity: .85, side: THREE.DoubleSide })
    );
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.position.y = .018;
    this.targetMarker.visible = this.debug;
    this.scene.add(this.targetMarker);

    this.triggerMarker = new THREE.Group();
    this.triggerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: .24,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    const triggerCore = new THREE.Mesh(
      new THREE.RingGeometry(DISPLAY_RING_RADIUS - .038, DISPLAY_RING_RADIUS, 48),
      this.triggerMaterial
    );
    this.triggerGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: .055,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    const triggerGlow = new THREE.Mesh(
      new THREE.RingGeometry(DISPLAY_RING_RADIUS - .1, DISPLAY_RING_RADIUS + .055, 48),
      this.triggerGlowMaterial
    );
    this.triggerMarker.add(triggerGlow, triggerCore);
    this.triggerMarker.rotation.x = -Math.PI / 2;
    this.triggerMarker.position.y = .016;
    this.triggerMarker.visible = true;
    this.root.add(this.triggerMarker);
  }

  async load() {
    try {
      const response = await fetch(this.urdfUrl);
      if (!response.ok) throw new Error(`URDF request failed with ${response.status}`);
      const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('URDF XML could not be parsed');
      for (const joint of xml.querySelectorAll('joint')) {
        const origin = joint.querySelector('origin');
        const xyz = (origin?.getAttribute('xyz') || '0 0 0').trim().split(/\s+/).map(Number);
        this.joints.set(joint.getAttribute('name'), xyz);
      }
      for (const link of xml.querySelectorAll('link')) {
        const visual = link.querySelector('visual');
        const mesh = visual?.querySelector('mesh');
        if (!mesh) continue;
        const origin = visual.querySelector('origin');
        const fileName = mesh.getAttribute('filename').split('/').pop().replace(/\.dae$/i, '.stl');
        this.visuals.set(link.getAttribute('name'), {
          fileName,
          xyz: parseVector(origin?.getAttribute('xyz')),
          rpy: parseVector(origin?.getAttribute('rpy'))
        });
      }
      this.urdfStatus = `Lite3 URDF · ${this.joints.size} joints`;
    } catch (error) {
      console.warn('[robot dog] URDF unavailable; using embedded Lite3 joint locations.', error);
      this.urdfStatus = 'Lite3 fallback joint map';
    }

    try {
      const fileNames = [...new Set([...this.visuals.values()].map((visual) => visual.fileName))];
      if (!fileNames.length) throw new Error('URDF did not contain visual meshes');
      const loadedMeshes = await Promise.all(fileNames.map(async (fileName) => [
        fileName,
        await loadBinaryStl(`./models/lite3/meshes/${fileName}?v=2`)
      ]));
      const meshes = new Map(loadedMeshes);
      this.buildDetailedModel(meshes);
      const sourceFaces = loadedMeshes.reduce((sum, [, mesh]) => sum + mesh.faceCount, 0);
      const renderedFaces = [...this.visuals.keys()].reduce((sum, linkName) => {
        const mesh = meshes.get(this.visuals.get(linkName).fileName);
        return sum + (mesh?.faceCount || 0);
      }, 0);
      this.urdfStatus = `Lite3 URDF · ${this.joints.size} joints · ${(renderedFaces / 1000).toFixed(1)}k rendered faces / ${(sourceFaces / 1000).toFixed(1)}k shared`;
    } catch (error) {
      console.warn('[robot dog] detailed mesh assembly unavailable; using lightweight fallback.', error);
      this.urdfStatus += ' · proxy fallback';
      this.buildLowPolyModel();
    }
    this.ready = true;
    this.startRest(1.2);
    return this;
  }

  jointPosition(name) {
    return this.joints.get(name) || FALLBACK_JOINTS[name] || [0, 0, 0];
  }

  addVisual(linkName, parent, material) {
    const visual = this.visuals.get(linkName);
    const meshData = this.detailedMeshes.get(visual?.fileName);
    if (!visual || !meshData) return null;
    const mesh = new THREE.Mesh(meshData.geometry, material);
    mesh.name = `${linkName}_detailed`;
    mesh.position.copy(urdfPositionToThree(visual.xyz));
    mesh.quaternion.copy(urdfRpyToThreeQuaternion(visual.rpy));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }

  buildDetailedModel(meshes) {
    this.detailedMeshes = meshes;
    const shell = new THREE.MeshStandardMaterial({
      color: 0x343a3c,
      roughness: .48,
      metalness: .52
    });
    const limb = new THREE.MeshStandardMaterial({
      color: 0x222729,
      roughness: .56,
      metalness: .42
    });
    const footMaterial = new THREE.MeshStandardMaterial({ color: 0x141718, roughness: .74, metalness: .18 });

    this.bodyRig = new THREE.Group();
    this.bodyRig.name = 'Lite3_URDF_visual_hierarchy';
    this.bodyRig.position.y = BODY_HEIGHT;
    this.bodyRig.scale.setScalar(URDF_SCALE);
    this.root.add(this.bodyRig);
    this.addVisual('TORSO', this.bodyRig, shell);

    for (const name of ['FL', 'FR', 'HL', 'HR']) {
      const hipMount = new THREE.Group();
      hipMount.name = `${name}_HipX`;
      hipMount.position.copy(urdfPositionToThree(this.jointPosition(`${name}_HipX`)));
      this.bodyRig.add(hipMount);
      this.addVisual(`${name}_HIP`, hipMount, shell);

      const thighPivot = new THREE.Group();
      thighPivot.name = `${name}_HipY`;
      thighPivot.position.copy(urdfPositionToThree(this.jointPosition(`${name}_HipY`)));
      hipMount.add(thighPivot);
      this.addVisual(`${name}_THIGH`, thighPivot, limb);

      const kneePivot = new THREE.Group();
      kneePivot.name = `${name}_Knee`;
      kneePivot.position.copy(urdfPositionToThree(this.jointPosition(`${name}_Knee`)));
      thighPivot.add(kneePivot);
      this.addVisual(`${name}_SHANK`, kneePivot, limb);

      const foot = new THREE.Mesh(new THREE.SphereGeometry(.025, 10, 7), footMaterial);
      foot.name = `${name}_FOOT`;
      foot.position.copy(urdfPositionToThree(this.jointPosition(`${name}_Ankle`)));
      kneePivot.add(foot);

      // One forward-folding pose is shared by front and rear legs. The meshes
      // retain their authored left/right variations; only the light gait pose
      // is procedural.
      const neutralHip = .12;
      const neutralKnee = -.52;
      thighPivot.rotation.x = neutralHip;
      kneePivot.rotation.x = neutralKnee;
      this.legs.push({ name, thighPivot, kneePivot, neutralHip, neutralKnee });
    }

    this.addBlobShadow();
  }

  addBlobShadow() {
    const blobShadow = new THREE.Mesh(
      new THREE.CircleGeometry(.44, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .24, depthWrite: false })
    );
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = .01;
    blobShadow.scale.set(1, 1.45, 1);
    this.root.add(blobShadow);
  }

  buildLowPolyModel() {
    const white = new THREE.MeshStandardMaterial({ color: 0x343a3c, roughness: .58, metalness: .34, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x171b1c, roughness: .7, metalness: .28, flatShading: true });
    const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x596164, roughness: .42, metalness: .62, flatShading: true });
    const sensorMaterial = new THREE.MeshBasicMaterial({ color: 0x86d7c0 });

    this.bodyRig = new THREE.Group();
    this.bodyRig.position.y = BODY_HEIGHT;
    this.root.add(this.bodyRig);

    const body = new THREE.Mesh(new THREE.BoxGeometry(.46, .19, .72), white);
    body.name = 'TORSO_proxy';
    this.bodyRig.add(body);

    const topShell = new THREE.Mesh(new THREE.BoxGeometry(.29, .08, .42), dark);
    topShell.position.y = .13;
    this.bodyRig.add(topShell);

    const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(.31, .13, .08), dark);
    frontPlate.position.z = .39;
    this.bodyRig.add(frontPlate);

    for (const x of [-.09, .09]) {
      const sensor = new THREE.Mesh(new THREE.CircleGeometry(.027, 12), sensorMaterial);
      sensor.position.set(x, .015, .432);
      this.bodyRig.add(sensor);
    }

    const hipJointGeometry = new THREE.CylinderGeometry(.055, .055, .09, 8);
    hipJointGeometry.rotateZ(Math.PI / 2);
    const upperGeometry = new THREE.BoxGeometry(.085, .24, .09);
    upperGeometry.translate(0, -.12, 0);
    const lowerGeometry = new THREE.BoxGeometry(.064, .27, .07);
    lowerGeometry.translate(0, -.135, 0);
    const footGeometry = new THREE.SphereGeometry(.052, 8, 6);

    const legNames = ['FL', 'FR', 'HL', 'HR'];
    for (const name of legNames) {
      const hipOrigin = this.jointPosition(`${name}_HipX`);
      const thighOrigin = this.jointPosition(`${name}_HipY`);
      const mount = new THREE.Group();
      mount.name = `${name}_HipX_proxy`;
      mount.position.set(hipOrigin[1] * URDF_SCALE, hipOrigin[2] * URDF_SCALE, hipOrigin[0] * URDF_SCALE);
      this.bodyRig.add(mount);

      const innerJoint = new THREE.Mesh(hipJointGeometry, jointMaterial);
      mount.add(innerJoint);

      const lateralOffset = thighOrigin[1] * URDF_SCALE;
      const hipBridge = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(lateralOffset), .075, .075), dark);
      hipBridge.position.x = lateralOffset / 2;
      mount.add(hipBridge);

      const thighPivot = new THREE.Group();
      thighPivot.name = `${name}_HipY_proxy`;
      thighPivot.position.x = lateralOffset;
      mount.add(thighPivot);

      const outerJoint = new THREE.Mesh(hipJointGeometry, jointMaterial);
      thighPivot.add(outerJoint);

      const thigh = new THREE.Mesh(upperGeometry, white);
      thigh.name = `${name}_THIGH_proxy`;
      thighPivot.add(thigh);

      const kneePivot = new THREE.Group();
      kneePivot.name = `${name}_Knee_proxy`;
      kneePivot.position.y = -.24;
      thighPivot.add(kneePivot);

      const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(.052, 8, 6), jointMaterial);
      kneePivot.add(kneeJoint);

      const shank = new THREE.Mesh(lowerGeometry, dark);
      shank.name = `${name}_SHANK_proxy`;
      kneePivot.add(shank);

      const foot = new THREE.Mesh(footGeometry, dark);
      foot.position.y = -.27;
      kneePivot.add(foot);

      // Both front and rear lower legs fold toward the robot's +Z (front).
      // The earlier mirrored knee sign made the rear pair appear backwards.
      const neutralHip = .14;
      const neutralKnee = -.68;
      thighPivot.rotation.x = neutralHip;
      kneePivot.rotation.x = neutralKnee;
      this.legs.push({ name, thighPivot, kneePivot, neutralHip, neutralKnee });
    }

    // The moving dog does not enter the static shadow map. A cheap blob shadow
    // supplies grounding without invalidating the museum's one-time shadows.
    this.addBlobShadow();

    this.root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
    });
  }

  startRandomTurn() {
    const turnAmount = randomBetween(-Math.PI, Math.PI);
    this.turnTargetHeading = this.heading + turnAmount;
    this.state = 'wandering · turning';
    this.speed = 0;
  }

  startRoamSegment() {
    const running = Math.random() < .34;
    const range = running ? RUN_SPEED_RANGE : WALK_SPEED_RANGE;
    this.roamSpeed = randomBetween(range[0], range[1]);
    this.stateTimer = randomBetween(1, 10);
    this.state = `wandering · ${running ? 'run' : 'walk'} ${this.roamSpeed.toFixed(2)} m/s`;
    this.target.set(
      THREE.MathUtils.clamp(this.root.position.x + Math.sin(this.heading) * this.roamSpeed * this.stateTimer, -ROAM_BOUNDS, ROAM_BOUNDS),
      0,
      THREE.MathUtils.clamp(this.root.position.z + Math.cos(this.heading) * this.roamSpeed * this.stateTimer, -ROAM_BOUNDS, ROAM_BOUNDS)
    );
  }

  startRest(duration = randomBetween(1.7, 3.8)) {
    this.state = 'wandering · pause';
    this.stateTimer = duration;
    this.speed = 0;
  }

  startReturnWait() {
    this.guided = false;
    this.waitingForReturn = true;
    this.returnTimer = RETURN_GRACE_SECONDS;
    this.speed = 0;
    this.state = `waiting for visitor · ${this.returnTimer.toFixed(1)}s`;
  }

  setDebug(enabled) {
    this.debug = enabled;
    this.targetMarker.visible = enabled;
    this.triggerMarker.visible = true;
  }

  update(delta, playerPosition) {
    if (!this.ready) return;
    this.playerDistance = planarDistance(this.root.position, playerPosition);

    if (this.waitingForReturn) {
      if (this.playerDistance <= EXIT_GUIDE_DISTANCE) {
        this.waitingForReturn = false;
        this.guided = true;
        this.state = 'guiding to robot-dog exhibit';
        this.target.copy(this.exhibitTarget);
      } else {
        this.returnTimer -= delta;
        this.turnToward(playerPosition, delta);
        this.speed = 0;
        this.state = `waiting for visitor · ${Math.max(0, this.returnTimer).toFixed(1)}s`;
        if (this.returnTimer <= 0) {
          this.waitingForReturn = false;
          this.startRandomTurn();
        }
      }
    } else if (!this.guided && this.playerDistance <= ENTER_GUIDE_DISTANCE) {
      this.guided = true;
      this.state = 'guiding to robot-dog exhibit';
      this.target.copy(this.exhibitTarget);
    } else if (this.guided && this.playerDistance > EXIT_GUIDE_DISTANCE) {
      this.startReturnWait();
    }

    let desiredSpeed = 0;
    if (this.waitingForReturn) {
      desiredSpeed = 0;
    } else if (this.guided) {
      this.target.copy(this.exhibitTarget);
      if (planarDistance(this.root.position, this.exhibitTarget) < .48) {
        this.state = 'waiting at robot-dog exhibit';
        this.turnToward(this.exhibitLookTarget, delta);
      } else {
        this.state = 'guiding to robot-dog exhibit';
        const distanceToExhibit = planarDistance(this.root.position, this.exhibitTarget);
        desiredSpeed = Math.min(this.guideSpeed, Math.max(1.35, (distanceToExhibit - .42) * 2.4));
      }
    } else if (this.state === 'wandering · pause') {
      this.stateTimer -= delta;
      if (this.stateTimer <= 0) this.startRandomTurn();
    } else if (this.state === 'wandering · turning') {
      const difference = shortestAngle(this.heading, this.turnTargetHeading);
      this.heading += THREE.MathUtils.clamp(difference, -2.2 * delta, 2.2 * delta);
      this.root.rotation.y = this.heading;
      if (Math.abs(difference) < .025) this.startRoamSegment();
    } else if (this.state.startsWith('wandering ·')) {
      this.stateTimer -= delta;
      if (this.stateTimer <= 0) {
        this.startRest();
      } else {
        desiredSpeed = this.roamSpeed;
      }
    }

    if (desiredSpeed > 0 && this.guided) this.walkToward(this.target, desiredSpeed, delta);
    else if (desiredSpeed > 0) this.walkStraight(desiredSpeed, delta);
    else this.speed = THREE.MathUtils.damp(this.speed, 0, 9, delta);

    this.animateGait(delta, desiredSpeed > 0 ? THREE.MathUtils.clamp(this.speed / 1.55, 0, 1) : 0);
    const ringIsActive = this.guided || this.waitingForReturn;
    const pulse = Math.sin(this.gaitPhase * .55);
    const coreOpacity = ringIsActive ? .74 + pulse * .12 : .22 + pulse * .025;
    const glowOpacity = ringIsActive ? .2 + pulse * .035 : .05 + pulse * .012;
    this.triggerMaterial.opacity = THREE.MathUtils.damp(this.triggerMaterial.opacity, coreOpacity, 8, delta);
    this.triggerGlowMaterial.opacity = THREE.MathUtils.damp(this.triggerGlowMaterial.opacity, glowOpacity, 8, delta);
    if (this.debug) this.targetMarker.position.set(this.target.x, .018, this.target.z);
  }

  turnToward(target, delta) {
    const desiredHeading = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
    const difference = shortestAngle(this.heading, desiredHeading);
    this.heading += THREE.MathUtils.clamp(difference, -2.8 * delta, 2.8 * delta);
    this.root.rotation.y = this.heading;
    return difference;
  }

  walkToward(target, desiredSpeed, delta) {
    const difference = this.turnToward(target, delta);
    const turnPenalty = THREE.MathUtils.clamp(1 - Math.abs(difference) / 1.35, .12, 1);
    this.speed = THREE.MathUtils.damp(this.speed, desiredSpeed * turnPenalty, 5.5, delta);
    const remainingDistance = planarDistance(this.root.position, target);
    const step = Math.min(this.speed * delta, Math.max(0, remainingDistance - .42));
    this.root.position.x += Math.sin(this.heading) * step;
    this.root.position.z += Math.cos(this.heading) * step;
    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -ROAM_BOUNDS, ROAM_BOUNDS);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -ROAM_BOUNDS, ROAM_BOUNDS);
  }

  walkStraight(desiredSpeed, delta) {
    this.speed = THREE.MathUtils.damp(this.speed, desiredSpeed, 4.8, delta);
    const nextX = this.root.position.x + Math.sin(this.heading) * this.speed * delta;
    const nextZ = this.root.position.z + Math.cos(this.heading) * this.speed * delta;
    if (Math.abs(nextX) >= ROAM_BOUNDS || Math.abs(nextZ) >= ROAM_BOUNDS) {
      this.root.position.x = THREE.MathUtils.clamp(nextX, -ROAM_BOUNDS, ROAM_BOUNDS);
      this.root.position.z = THREE.MathUtils.clamp(nextZ, -ROAM_BOUNDS, ROAM_BOUNDS);
      this.startRest(randomBetween(.8, 2.1));
      return;
    }
    this.root.position.x = nextX;
    this.root.position.z = nextZ;
  }

  animateGait(delta, targetWeight) {
    this.gaitWeight = THREE.MathUtils.damp(this.gaitWeight, targetWeight, targetWeight > 0 ? 8 : 5, delta);
    this.gaitPhase += delta * (5.2 + this.speed * 1.6);
    for (const leg of this.legs) {
      const diagonalPhase = leg.name === 'FL' || leg.name === 'HR' ? 0 : Math.PI;
      const cycle = Math.sin(this.gaitPhase + diagonalPhase);
      const lift = Math.max(0, cycle);
      leg.thighPivot.rotation.x = leg.neutralHip + cycle * .34 * this.gaitWeight;
      const kneeDirection = Math.sign(leg.neutralKnee);
      leg.kneePivot.rotation.x = leg.neutralKnee + kneeDirection * lift * .38 * this.gaitWeight;
    }
    this.bodyRig.position.y = BODY_HEIGHT + Math.sin(this.gaitPhase * 2) * .016 * this.gaitWeight;
    this.bodyRig.rotation.z = Math.sin(this.gaitPhase) * .025 * this.gaitWeight;
    this.bodyRig.rotation.x = Math.cos(this.gaitPhase * 2) * .012 * this.gaitWeight;
  }

  getDebugSnapshot() {
    return {
      state: this.state,
      urdf: this.urdfStatus,
      distance: this.playerDistance,
      position: this.root.position,
      target: this.target,
      guided: this.guided,
      speed: this.speed,
      enterDistance: ENTER_GUIDE_DISTANCE,
      exitDistance: EXIT_GUIDE_DISTANCE
    };
  }
}
