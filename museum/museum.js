import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const sceneHost = document.querySelector('#scene');
const entryScreen = document.querySelector('#entry-screen');
const enterButton = document.querySelector('#enter-button');
const prompt = document.querySelector('#interact-prompt');
const roomChip = document.querySelector('#room-chip');
const storyToast = document.querySelector('#story-toast');
const mapMarker = document.querySelector('#map-marker');
const debugOutput = document.querySelector('#debug-output');
const resetPositionButton = document.querySelector('#reset-position');
const modal = document.querySelector('#exhibit-modal');
const modalKicker = document.querySelector('#modal-kicker');
const modalTitle = document.querySelector('#modal-title');
const modalBody = document.querySelector('#modal-body');
const modalLinks = document.querySelector('#modal-links');
const modalClose = document.querySelector('#modal-close');

const isTouch = matchMedia('(pointer: coarse)').matches;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090a08);
scene.fog = new THREE.FogExp2(0x090a08, 0.018);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 90);
camera.position.set(0, 1.72, 13.2);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.domElement.tabIndex = -1;
renderer.domElement.setAttribute('aria-label', 'Walkable 3D museum viewport');
sceneHost.append(renderer.domElement);

const controls = new PointerLockControls(camera, renderer.domElement);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
raycaster.far = 3.4;

const collisions = [];
const interactives = [];
const pressedKeys = new Set();
const playerVelocity = new THREE.Vector3();
const visitedRooms = new Set();
let currentInteractive = null;
let started = false;
let inputActive = false;
let modalOpen = false;
let touchLook = null;
let toastTimer = 0;
let lastInput = 'none';
let lastInputType = 'waiting';
let movementBlocked = false;
let lastDebugUpdate = 0;
let lastUiUpdate = 0;
let movementAttempts = 0;
let lastMovement = 'none';
let movingQuality = false;
let movementSettledAt = 0;
let measuredFps = 60;
let fpsFrames = 0;
let fpsSampleStarted = performance.now();

const CAMERA_HEIGHT = 1.72;
const CEILING_HEIGHT = 7.35;
const WALK_SPEED = 10.5;
const SPRINT_SPEED = 16;
const ACCELERATION = 12;
const RELEASE_DRAG = 5.2;
const MOVING_PIXEL_RATIO = Math.min(devicePixelRatio, 1.05);
const RESTING_PIXEL_RATIO = Math.min(devicePixelRatio, 1.75);

const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: 0x393832, roughness: 0.92 }),
  wallAlt: new THREE.MeshStandardMaterial({ color: 0x292b27, roughness: 0.96 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x49382a, roughness: 0.78 }),
  darkWood: new THREE.MeshStandardMaterial({ color: 0x211b16, roughness: 0.86 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x5c5549, roughness: 0.88 }),
  brass: new THREE.MeshStandardMaterial({ color: 0x8d713e, metalness: 0.62, roughness: 0.3 }),
  curtain: new THREE.MeshStandardMaterial({ color: 0x641f25, roughness: 0.9 }),
  rope: new THREE.MeshStandardMaterial({ color: 0xb08a45, roughness: 0.5 })
};

scene.add(new THREE.HemisphereLight(0xb9c1b5, 0x15120e, 1.35));
const moon = new THREE.DirectionalLight(0xe4e1d0, 1.45);
moon.position.set(3, 9, 5);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = -20;
moon.shadow.camera.right = 20;
moon.shadow.camera.top = 20;
moon.shadow.camera.bottom = -20;
scene.add(moon);

function box(x, y, z, w, h, d, material, { collide = false, shadow = true } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collide) collisions.push(new THREE.Box3().setFromObject(mesh));
  return mesh;
}

function wall(x, z, w, d, material = MAT.wall) {
  return box(x, CEILING_HEIGHT / 2, z, w, CEILING_HEIGHT, d, material, { collide: true });
}

function canvasTexture({ title, subtitle = '', body = '', accent = '#92733b', background = '#eee9dc', dark = '#1b1a16' }) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 16, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(64, 88, 86, 7);
  ctx.fillStyle = dark;
  ctx.font = '700 28px Arial';
  ctx.letterSpacing = '5px';
  ctx.fillText(subtitle.toUpperCase(), 64, 150);
  ctx.font = '56px Georgia';
  wrapText(ctx, title, 64, 250, 640, 66, 4);
  ctx.fillStyle = '#5c584f';
  ctx.font = '28px Arial';
  wrapText(ctx, body, 64, 520, 628, 43, 8);
  ctx.fillStyle = '#a39d8f';
  ctx.font = '700 18px Arial';
  ctx.fillText('YIPENG HUANGFU · IMMERSIVE ARCHIVE', 64, 945);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (let n = 0; n < words.length && lines < maxLines; n += 1) {
    const testLine = line + words[n] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, y);
      line = words[n] + ' ';
      y += lineHeight;
      lines += 1;
    } else {
      line = testLine;
    }
  }
  if (lines < maxLines) ctx.fillText(line.trim(), x, y);
}

function labelTexture(text, color = '#d8b873') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 190;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(13,13,10,.92)';
  ctx.fillRect(0, 0, 1024, 190);
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.strokeRect(2, 2, 1020, 186);
  ctx.fillStyle = color;
  ctx.font = '600 46px Arial';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '9px';
  ctx.fillText(text.toUpperCase(), 512, 112);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addLabel(text, x, y, z, rotationY = 0, scale = 4.5) {
  const material = new THREE.MeshBasicMaterial({ map: labelTexture(text), transparent: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale * 0.185), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  scene.add(mesh);
  return mesh;
}

function addPaper(exhibit, x, y, z, rotationY = 0, width = 2.15) {
  const texture = canvasTexture(exhibit);
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 1.33),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, emissive: 0x17130b, emissiveIntensity: 0.25 })
  );
  const height = width * 1.33;
  const display = new THREE.Group();
  display.position.set(x, y, z);
  display.rotation.y = rotationY;
  scene.add(display);

  paper.position.z = .035;
  paper.userData.exhibit = exhibit;
  display.add(paper);
  interactives.push(paper);

  // Four narrow rails form a real frame. The previous solid backing box could
  // visibly cut across the paper when viewed from an angle.
  const rail = .075;
  const frameParts = [
    [width + rail * 2, rail, 0, height / 2 + rail / 2],
    [width + rail * 2, rail, 0, -height / 2 - rail / 2],
    [rail, height, -width / 2 - rail / 2, 0],
    [rail, height, width / 2 + rail / 2, 0]
  ];
  for (const [w, h, px, py] of frameParts) {
    const frameRail = new THREE.Mesh(new THREE.BoxGeometry(w, h, .065), MAT.darkWood);
    frameRail.position.set(px, py, 0);
    frameRail.castShadow = false;
    display.add(frameRail);
  }

  // A fake emissive picture light gives the visual cue of overhead lighting
  // without adding another real-time light to every exhibit.
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(width * .58, .055, .085),
    new THREE.MeshBasicMaterial({ color: 0xffd896 })
  );
  lamp.position.set(0, height / 2 + .28, .16);
  display.add(lamp);
  return paper;
}

function addPhoto(exhibit, x, y, z, rotationY = 0, size = 2.55) {
  const texture = new THREE.TextureLoader().load('../images/profile.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  const photo = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: texture, roughness: .82, emissive: 0x130e08, emissiveIntensity: .18 })
  );
  const display = new THREE.Group();
  display.position.set(x, y, z);
  display.rotation.y = rotationY;
  scene.add(display);
  photo.position.z = .04;
  photo.userData.exhibit = exhibit;
  display.add(photo);
  interactives.push(photo);
  const rail = .085;
  for (const [w, h, px, py] of [
    [size + rail * 2, rail, 0, size / 2 + rail / 2],
    [size + rail * 2, rail, 0, -size / 2 - rail / 2],
    [rail, size, -size / 2 - rail / 2, 0],
    [rail, size, size / 2 + rail / 2, 0]
  ]) {
    const frameRail = new THREE.Mesh(new THREE.BoxGeometry(w, h, .08), MAT.darkWood);
    frameRail.position.set(px, py, 0);
    frameRail.castShadow = false;
    display.add(frameRail);
  }
}

const academic = [
  {
    subtitle: 'Education · 2024—Present', title: 'University of California, Los Angeles',
    body: 'PhD in Mechanical Engineering · Robotics, adaptive control, and physical human–robot interaction.',
    detail: '<p>Second-year PhD student in Mechanical Engineering at UCLA. Research spans rehabilitation robotics, adaptive control, and human sensory integration.</p><p>Current work is conducted across the Bionics Lab and Mohala Lab.</p>',
    links: [{ label: 'Classic biography', href: '../' }]
  },
  {
    subtitle: 'Exchange · 2023—2024', title: 'National University of Singapore',
    body: 'Senior-year exchange at NUS Suzhou Research Institute · Rough-terrain navigation and robot motion control.',
    detail: '<p>Worked on vision-based rough-terrain navigation, RGB-D point clouds, SLAM, gait control, and obstacle avoidance for quadruped robots.</p>'
  },
  {
    subtitle: 'Education · 2020—2024', title: 'Beijing University of Technology',
    body: 'B.Eng. in Robotics · Academic excellence and overseas study scholarships.',
    detail: '<p>Bachelor of Engineering in Robotics with coursework and project experience across control, simulation, sensing, and mechanical systems.</p>'
  }
];

const projects = [
  {
    subtitle: 'Research · UCLA', title: 'Assist-as-Needed Rehabilitation',
    body: 'An adaptive controller that models patient capability for upper-limb rehabilitation.',
    detail: '<p>Designed a C++ Assist-as-Needed controller combining an error-aware greedy strategy with RBF-based adaptive learning.</p><p>Built MATLAB monitoring and a Qt interface for real-time experiments.</p>'
  },
  {
    subtitle: 'Research · UCLA', title: 'Multi-Modal Mobile Tracking',
    body: 'A mobile experiment platform for visual, auditory, and haptic sensorimotor feedback.',
    detail: '<p>Developed an iOS application and data pipeline for human tracking experiments, signal processing, and sensory response modeling.</p>'
  },
  {
    subtitle: 'Publication · Sensors', title: 'Robot Dog on Rough Terrain',
    body: 'Vision-based planning, SLAM, gait control, and motion testing for difficult terrain.',
    detail: '<p>Designed and tested rough-terrain navigation using RGB-D perception, ROS, Gazebo, and MATLAB.</p>',
    links: [{ label: 'DOI', href: 'https://doi.org/10.3390/s24227306' }]
  },
  {
    subtitle: 'Publication · Sensors', title: 'GelStereo Reconstruction',
    body: 'Refractive calibration and high-precision 3D reconstruction for tactile sensing.',
    detail: '<p>Created automated acquisition and force–displacement calibration pipelines and performed sensor simulation with a UR5 robot.</p>',
    links: [{ label: 'DOI', href: 'https://doi.org/10.3390/s23052675' }]
  }
];

const personalPhoto = {
  subtitle: 'Personal archive', title: 'Outside the laboratory',
  body: 'Hiking, photography, and curiosity about the physical world.',
  detail: '<p>Time outdoors, photography, and travel provide a counterweight to research—and often a new way to notice motion, texture, balance, and human interaction.</p>'
};

const artistIntroduction = {
  subtitle: 'Artist introduction', title: 'Yipeng Huangfu',
  body: 'Roboticist, control researcher, photographer, and builder of systems that share space with people.',
  detail: '<p>I am a second-year PhD student in Mechanical Engineering at UCLA, working across robotics, adaptive control, sensing, and physical human–robot interaction.</p><p>This museum treats research as a creative practice: each project begins with observation, becomes an experiment, and eventually takes a physical or interactive form.</p>',
  links: [{ label: 'Read the classic biography', href: '../' }]
};

const personalCards = [
  { subtitle: 'Interest · 01', title: 'Hiking & Landscapes', body: 'Long routes, changing terrain, and the pleasure of moving through a place.', detail: '<p>This gallery is ready for a dedicated hiking photo. Replace the current card later by adding a personal image to the museum image collection.</p>' },
  { subtitle: 'Interest · 02', title: 'Photography', body: 'Light, framing, observation, and preserving a moment without interrupting it.', detail: '<p>The museum uses photography not only as decoration, but as part of its spatial narrative and memory archive.</p>' },
  { subtitle: 'Interest · 03', title: 'Making & Experimenting', body: 'Building small systems to understand how interaction feels in practice.', detail: '<p>A future version of this room can hold interactive sketches, prototypes, field notes, and personal experiments.</p>' }
];

// A single open-plan square gallery. Only the perimeter walls remain.
box(0, -.12, 0, 32, .24, 32, MAT.floor, { shadow: false });
box(0, CEILING_HEIGHT, 0, 32, .24, 32, MAT.darkWood, { shadow: false });
const grid = new THREE.GridHelper(32, 32, 0x8b7a5c, 0x5e584c);
grid.position.y = .012;
grid.material.opacity = .24;
grid.material.transparent = true;
scene.add(grid);

// Outer walls, with a central entrance in the south wall.
wall(0, -16, 32, .38);
wall(-16, 0, .38, 32);
wall(16, 0, .38, 32);
wall(-8.75, 16, 14.5, .38);
wall(8.75, 16, 14.5, .38);

// Soft room pools.
for (const [x, z, color] of [[-8.3,-8.3,0xffd99c],[8.3,-8.3,0xd9e5ff],[-8.3,8.3,0xffcfa8],[8.3,8.3,0xffb2a0]]) {
  const light = new THREE.PointLight(color, 24, 19, 1.9);
  light.position.set(x, 5.7, z);
  scene.add(light);
}

addLabel('Academic Journey', -8.2, 4.05, -15.78, 0, 5.2);
addLabel('Projects & Outcomes', 8.2, 4.05, -15.78, 0, 5.2);
addLabel('About the Researcher', -15.78, 4.35, 9.7, Math.PI / 2, 5.2);
addLabel('Interaction Stage', 15.78, 4.05, 8.2, -Math.PI / 2, 5.2);

academic.forEach((item, i) => addPaper(item, -11.4 + i * 3.15, 2.25, -15.76, 0, 2.18));
projects.forEach((item, i) => addPaper(item, 3.2 + i * 3.05, 2.2, -15.76, 0, 2.02));
addPhoto(personalPhoto, -15.75, 2.35, 12.1, Math.PI / 2, 3.45);
addPaper(artistIntroduction, -15.74, 2.2, 8.25, Math.PI / 2, 2.15);
personalCards.forEach((item, i) => addPaper(item, -15.74, 2.15, 3.8 - i * 3.55, Math.PI / 2, 1.78));

// A closed theatre curtain reserves the fourth hall for future interactive work.
for (let i = 0; i < 12; i += 1) {
  const fold = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, 4.6, 12), MAT.curtain);
  fold.position.set(15.35, 2.35, 3.1 + i * .92);
  fold.castShadow = true;
  scene.add(fold);
}
box(15.3, 4.65, 8.2, .45, .72, 11.8, MAT.curtain);
const curtainExhibit = {
  subtitle: 'Interaction · Coming next', title: 'The stage is not open—yet.',
  body: 'A reserved room for live robotics demos, haptic experiments, and small interactive studies.',
  detail: '<p>This curtain marks the next phase of the museum: interactive research demonstrations that visitors can operate directly in the browser.</p><p>Planned exhibits include trajectory tracking, adaptive-control parameter exploration, and manipulable robot models.</p>'
};
const curtainTrigger = box(14.86, 2.25, 8.2, .08, 4.3, 10.5, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
curtainTrigger.userData.exhibit = curtainExhibit;
interactives.push(curtainTrigger);
for (const z of [5.2, 11.2]) {
  box(12.2, .7, z, .16, 1.4, .16, MAT.brass);
}
box(12.2, 1.18, 8.2, .09, .09, 6, MAT.rope);

function addPopcornBucket(x, z) {
  const bucket = new THREE.Group();
  bucket.position.set(x, 0, z);
  scene.add(bucket);

  const stripeCanvas = document.createElement('canvas');
  stripeCanvas.width = 512;
  stripeCanvas.height = 512;
  const stripeContext = stripeCanvas.getContext('2d');
  stripeContext.fillStyle = '#f6efe0';
  stripeContext.fillRect(0, 0, 512, 512);
  stripeContext.fillStyle = '#c92d32';
  for (let stripe = 0; stripe < 8; stripe += 2) stripeContext.fillRect(stripe * 64, 0, 64, 512);
  const stripeTexture = new THREE.CanvasTexture(stripeCanvas);
  stripeTexture.colorSpace = THREE.SRGBColorSpace;
  stripeTexture.wrapS = THREE.RepeatWrapping;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(.68, .49, 1.15, 24, 1, true),
    new THREE.MeshStandardMaterial({ map: stripeTexture, roughness: .72 })
  );
  body.position.y = .74;
  body.castShadow = true;
  bucket.add(body);

  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xc92d32, roughness: .65 });
  for (const [radius, y] of [[.69, 1.32], [.5, .17]]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, .055, 8, 32), rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    bucket.add(rim);
  }

  const popcornGeometry = new THREE.IcosahedronGeometry(.18, 1);
  const popcornMaterial = new THREE.MeshStandardMaterial({ color: 0xffe7a6, roughness: 1 });
  const kernels = [
    [-.42, 1.35, -.14], [-.18, 1.42, .08], [.08, 1.36, -.18], [.34, 1.42, .05],
    [-.3, 1.55, .05], [0, 1.58, .11], [.28, 1.56, -.08], [-.08, 1.7, -.05]
  ];
  for (const [kx, ky, kz] of kernels) {
    const kernel = new THREE.Mesh(popcornGeometry, popcornMaterial);
    kernel.position.set(kx, ky, kz);
    kernel.scale.set(1.05, .8, 1);
    bucket.add(kernel);
  }
  return bucket;
}

// A playful placeholder waits behind the rope in front of the closed stage.
box(13.55, .16, 8.2, 1.75, .32, 1.75, MAT.darkWood, { shadow: true });
addPopcornBucket(13.55, 8.2);

function currentRoomName(position) {
  if (Math.abs(position.x) < 1.7 || Math.abs(position.z) < 1.7) return ['Central Gallery', 'central'];
  if (position.x < 0 && position.z < 0) return ['Academic Journey', 'academic'];
  if (position.x > 0 && position.z < 0) return ['Projects & Outcomes', 'projects'];
  if (position.x < 0 && position.z > 0) return ['Personal Archive', 'personal'];
  return ['Interaction Stage', 'interaction'];
}

const roomStories = {
  academic: 'Three institutions, connected by a growing interest in robots that can perceive, adapt, and work safely with people.',
  projects: 'The papers are temporary by design: a working archive, ready to be replaced by project thumbnails, videos, and 3D models.',
  personal: 'Research is only one way of paying attention. This room keeps space for landscapes, images, and experiments outside the lab.',
  interaction: 'The curtain stays closed in this first edition. What happens behind it will become the museum’s most hands-on room.'
};

function showStory(room) {
  if (!roomStories[room] || visitedRooms.has(room)) return;
  visitedRooms.add(room);
  storyToast.textContent = roomStories[room];
  storyToast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => storyToast.classList.remove('is-visible'), 6500);
}

function canOccupy(position) {
  const radius = .38;
  if (position.x < -15.45 || position.x > 15.45 || position.z < -15.45 || position.z > 15.45) return false;
  return !collisions.some((box3) => position.x + radius > box3.min.x && position.x - radius < box3.max.x && position.z + radius > box3.min.z && position.z - radius < box3.max.z);
}

function movePlayer(movement, source = 'frame loop') {
  if (movement.lengthSq() === 0) return;
  const origin = camera.position.clone();
  const destination = origin.clone().add(movement);
  movementBlocked = false;
  movementAttempts += 1;

  if (canOccupy(destination)) {
    camera.position.copy(destination);
  } else {
    movementBlocked = true;
    const slideX = origin.clone();
    slideX.x += movement.x;
    if (canOccupy(slideX)) camera.position.x = slideX.x;
    else playerVelocity.x = 0;
    const slideZ = camera.position.clone();
    slideZ.z += movement.z;
    if (canOccupy(slideZ)) camera.position.z = slideZ.z;
    else playerVelocity.z = 0;
  }
  camera.position.y = CAMERA_HEIGHT;
  const actualDistance = camera.position.distanceTo(origin);
  lastMovement = `${source}: ${actualDistance.toFixed(3)} m${movementBlocked ? ' (collision)' : ''}`;
}

function updateMovement(delta) {
  const forwardInput = Number(pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp'))
    - Number(pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown'));
  const rightInput = Number(pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight'))
    - Number(pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft'));
  const hasInput = forwardInput !== 0 || rightInput !== 0;

  if (hasInput) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const targetVelocity = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(rightInput)).normalize()
      .multiplyScalar(pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED);
    playerVelocity.lerp(targetVelocity, 1 - Math.exp(-ACCELERATION * delta));
  } else {
    // Exponential drag leaves a short, natural coast after the key is released.
    playerVelocity.multiplyScalar(Math.exp(-RELEASE_DRAG * delta));
  }

  if (playerVelocity.lengthSq() < .004) {
    playerVelocity.set(0, 0, 0);
  } else {
    movePlayer(playerVelocity.clone().multiplyScalar(delta), hasInput ? 'held key loop' : 'release inertia');
  }
  return hasInput || playerVelocity.lengthSq() > .004;
}

function updateMovementQuality(isMoving, now) {
  if (isMoving) {
    movementSettledAt = now;
    if (!movingQuality) {
      movingQuality = true;
      renderer.setPixelRatio(MOVING_PIXEL_RATIO);
    }
    return;
  }
  if (movingQuality && now - movementSettledAt > 220) {
    movingQuality = false;
    renderer.setPixelRatio(RESTING_PIXEL_RATIO);
  }
}

function updateInteraction() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hit = raycaster.intersectObjects(interactives, false)[0];
  currentInteractive = hit?.object?.userData?.exhibit ? hit.object : null;
  if (currentInteractive && !modalOpen) {
    prompt.innerHTML = '<strong>E</strong> Inspect exhibit';
    prompt.classList.add('is-visible');
  } else {
    prompt.classList.remove('is-visible');
  }
}

function openExhibit(exhibit) {
  if (!exhibit) return;
  modalOpen = true;
  if (!isTouch) controls.unlock();
  modalKicker.textContent = exhibit.subtitle || 'Exhibit';
  modalTitle.textContent = exhibit.title;
  modalBody.innerHTML = exhibit.detail || `<p>${exhibit.body}</p>`;
  modalLinks.replaceChildren();
  for (const link of exhibit.links || []) {
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = `${link.label} ↗`;
    if (/^https?:/.test(link.href)) { a.target = '_blank'; a.rel = 'noopener'; }
    modalLinks.append(a);
  }
  modal.hidden = false;
  modalClose.focus();
}

function closeExhibit() {
  modalOpen = false;
  modal.hidden = true;
  if (!isTouch) controls.lock();
}

function startExperience() {
  started = true;
  inputActive = true;
  entryScreen.classList.add('is-hidden');
  renderer.domElement.focus({ preventScroll: true });
  if (!isTouch) controls.lock();
  else enterButton.blur();
}

function clearMovementKeys() {
  pressedKeys.clear();
  playerVelocity.set(0, 0, 0);
}

function resetPlayer(reason = 'manual reset') {
  clearMovementKeys();
  camera.position.set(0, CAMERA_HEIGHT, 13.2);
  camera.rotation.set(0, 0, 0, 'YXZ');
  movementBlocked = false;
  lastInput = 'R / Reset';
  lastInputType = reason;
  console.info('[museum input] player reset:', reason, camera.position.toArray());
}

enterButton.addEventListener('click', startExperience);
modalClose.addEventListener('click', closeExhibit);
controls.addEventListener('lock', () => {
  inputActive = true;
  entryScreen.classList.add('is-hidden');
  renderer.domElement.focus({ preventScroll: true });
});
controls.addEventListener('unlock', () => {
  clearMovementKeys();
  if (started && !modalOpen) {
    inputActive = false;
    entryScreen.classList.remove('is-hidden');
    enterButton.innerHTML = 'Resume the museum <span>→</span>';
  }
});

const keyAliases = {
  w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD',
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD',
  ArrowUp: 'ArrowUp', ArrowLeft: 'ArrowLeft', ArrowDown: 'ArrowDown', ArrowRight: 'ArrowRight'
};
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const modifierKeys = new Set(['ShiftLeft', 'ShiftRight']);

function handleKeyDown(event) {
  const code = event.code || keyAliases[event.key] || keyAliases[event.key?.toLowerCase()];
  lastInput = `${code || event.key} (${event.repeat ? 'repeat' : 'down'})`;
  lastInputType = 'keydown received';
  if (movementKeys.has(code)) {
    pressedKeys.add(code);
    event.preventDefault();
  }
  if (modifierKeys.has(code)) pressedKeys.add(code);
  if (!event.repeat) console.info('[museum input] keydown:', code, { active: inputActive, locked: controls.isLocked });
  if (code === 'KeyR') resetPlayer('keyboard reset');
  if (code === 'KeyE' && currentInteractive && !modalOpen) openExhibit(currentInteractive.userData.exhibit);
  if (code === 'Escape' && modalOpen) closeExhibit();
}

function handleKeyUp(event) {
  const code = event.code || keyAliases[event.key] || keyAliases[event.key?.toLowerCase()];
  if (movementKeys.has(code)) {
    pressedKeys.delete(code);
    lastInput = `${code} (up)`;
    lastInputType = 'keyup received';
    console.info('[museum input] keyup:', code, camera.position.toArray());
  }
  if (modifierKeys.has(code)) pressedKeys.delete(code);
}

// Window-level capture remains active regardless of which overlay most recently
// received focus. OS key-repeat is deliberately ignored: held state drives the
// requestAnimationFrame loop until a matching keyup arrives.
window.addEventListener('keydown', handleKeyDown, true);
window.addEventListener('keyup', handleKeyUp, true);
addEventListener('blur', () => {
  clearMovementKeys();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearMovementKeys();
});
resetPositionButton.addEventListener('click', () => resetPlayer('button reset'));
renderer.domElement.addEventListener('click', () => {
  if (started && currentInteractive && (isTouch || controls.isLocked)) openExhibit(currentInteractive.userData.exhibit);
});

document.querySelectorAll('.mobile-controls button').forEach((button) => {
  const code = button.dataset.key;
  const down = (event) => { event.preventDefault(); pressedKeys.add(code); };
  const up = (event) => { event.preventDefault(); pressedKeys.delete(code); };
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('pointerleave', up);
});

renderer.domElement.addEventListener('touchstart', (event) => {
  if (!started || event.touches.length !== 1) return;
  touchLook = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
renderer.domElement.addEventListener('touchmove', (event) => {
  if (!touchLook || event.touches.length !== 1 || modalOpen) return;
  const touch = event.touches[0];
  const dx = touch.clientX - touchLook.x;
  const dy = touch.clientY - touchLook.y;
  camera.rotation.y -= dx * .004;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * .0035, -1.25, 1.25);
  touchLook = { x: touch.clientX, y: touch.clientY };
}, { passive: true });
renderer.domElement.addEventListener('touchend', () => { touchLook = null; }, { passive: true });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(movingQuality ? MOVING_PIXEL_RATIO : Math.min(devicePixelRatio, innerWidth < 760 ? 1.35 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
});

// Everything casting a shadow in this museum is static. Render the shadow map
// once instead of recomputing the same result for every camera frame.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

function animate() {
  const delta = Math.min(clock.getDelta(), .1);
  const playerIsMoving = started && inputActive && !modalOpen ? updateMovement(delta) : false;
  const now = performance.now();
  updateMovementQuality(playerIsMoving, now);

  // Interaction raycasts and DOM overlays do not need the renderer's full
  // refresh rate. Throttling them keeps frame time available for camera motion.
  if (now - lastUiUpdate > 140) {
    updateInteraction();
    const [roomName, roomKey] = currentRoomName(camera.position);
    roomChip.textContent = roomName;
    showStory(roomKey);
    mapMarker.style.left = `${THREE.MathUtils.mapLinear(camera.position.x, -16, 16, 4, 96)}%`;
    mapMarker.style.top = `${THREE.MathUtils.mapLinear(camera.position.z, -16, 16, 4, 96)}%`;
    lastUiUpdate = now;
  }
  if (now - lastDebugUpdate > 120) {
    const down = [...pressedKeys];
    debugOutput.textContent = [
      `Last event : ${lastInput}`,
      `Event state: ${lastInputType}`,
      `Keys down  : ${down.join(', ') || 'none'}`,
      `Input      : ${inputActive ? 'ACTIVE' : 'PAUSED'}`,
      `Pointer    : ${controls.isLocked ? 'LOCKED' : 'UNLOCKED'}`,
      `Position   : x ${camera.position.x.toFixed(2)}  z ${camera.position.z.toFixed(2)}`,
      `Collision  : ${movementBlocked ? 'BLOCKED' : 'clear'}`,
      `Velocity   : ${playerVelocity.length().toFixed(2)} m/s`,
      `Frame rate : ${measuredFps.toFixed(0)} fps · ${movingQuality ? 'motion' : 'detail'} quality`,
      `Move count : ${movementAttempts}`,
      `Last move  : ${lastMovement}`
    ].join('\n');
    lastDebugUpdate = now;
  }
  fpsFrames += 1;
  if (now - fpsSampleStarted >= 500) {
    const currentFps = fpsFrames * 1000 / (now - fpsSampleStarted);
    measuredFps += (currentFps - measuredFps) * .35;
    fpsFrames = 0;
    fpsSampleStarted = now;
  }
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
