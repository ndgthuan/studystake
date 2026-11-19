import {
  BoxGeometry, CanvasTexture, Group, MathUtils, Mesh, MeshBasicMaterial,
  OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';

export interface NotebookArt {
  edition: string;
  title: string;
  course: string;
  action: string;
}

export interface NotebookScene {
  update(art: NotebookArt): void;
  dispose(): void;
}

const WIDTH = 5.4;
const HEIGHT = 3.375;

function paperSurface(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ink = canvas.getContext('2d');
  if (!ink) throw new Error('Canvas 2D is unavailable');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { ink, texture };
}

function paintCover(ink: CanvasRenderingContext2D, art: NotebookArt, serif: string, sans: string) {
  const cloth = ink.createLinearGradient(0, 0, 960, 600);
  cloth.addColorStop(0, '#3d5883');
  cloth.addColorStop(.55, '#263e67');
  cloth.addColorStop(1, '#1a2e52');
  ink.fillStyle = cloth;
  ink.fillRect(0, 0, 960, 600);
  ink.fillStyle = '#ffffff0c';
  for (let x = 0; x < 960; x += 4) ink.fillRect(x, 0, 1, 600);
  for (let y = 0; y < 600; y += 3) ink.fillRect(0, y, 960, 1);
  ink.fillStyle = '#162847';
  ink.fillRect(17, 0, 26, 600);
  ink.fillStyle = '#8ca2c83b';
  ink.fillRect(40, 0, 3, 600);
  ink.fillStyle = '#101e3d80';
  ink.fillRect(113, 87, 710, 358);
  ink.fillStyle = '#faf3dd';
  ink.fillRect(104, 77, 710, 358);
  ink.strokeStyle = '#9e9f8e';
  ink.lineWidth = 2;
  ink.strokeRect(114, 87, 690, 338);
  ink.strokeRect(120, 93, 678, 326);

  ink.fillStyle = '#263655';
  ink.font = '600 22px "Courier New", monospace';
  ink.textAlign = 'left';
  ink.fillText('STUDYSTAKE', 149, 140);
  ink.textAlign = 'right';
  ink.fillText(`№ ${art.edition}`, 768, 140);
  ink.fillStyle = '#a7ac9b';
  ink.fillRect(149, 158, 619, 2);
  ink.textAlign = 'left';
  ink.fillStyle = '#223653';
  ink.font = `500 91px ${serif}`;
  ink.fillText(art.title, 144, 294, 625);
  ink.font = '24px "Courier New", monospace';
  ink.fillText(art.course.toUpperCase(), 149, 368, 619);

  ink.fillStyle = '#faf3dd';
  ink.font = `600 26px ${sans}`;
  ink.fillText(art.action, 106, 526, 545);
  ink.lineWidth = 4;
  ink.strokeStyle = '#faf3dd';
  ink.beginPath();
  ink.moveTo(756, 524);
  ink.lineTo(778, 502);
  ink.moveTo(765, 502);
  ink.lineTo(778, 502);
  ink.lineTo(778, 515);
  ink.stroke();

  ink.fillStyle = '#111d35aa';
  ink.fillRect(868, 0, 28, 600);
  ink.fillStyle = '#b54752';
  ink.fillRect(864, 0, 27, 600);
  ink.fillStyle = '#6b253951';
  for (let y = 0; y < 600; y += 4) ink.fillRect(864, y, 27, 1);
}

export function createNotebookScene(stage: HTMLAnchorElement, canvas: HTMLCanvasElement, initialArt: NotebookArt): NotebookScene | null {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
  if (!context) return null;

  const renderer = new WebGLRenderer({ canvas, context, alpha: true });
  const scene = new Scene();
  const camera = new OrthographicCamera(-3, 3, 2, -2, .1, 20);
  camera.position.z = 10;
  const book = new Group();
  const cover = new Group();
  scene.add(book);
  book.add(cover);
  cover.position.set(-WIDTH / 2, 0, .16);

  const coverArt = paperSurface(960, 600);
  const inside = paperSurface(480, 300);
  const geometries: (BoxGeometry | PlaneGeometry)[] = [];
  const materials: MeshBasicMaterial[] = [];

  function addMesh(parent: Group, geometry: BoxGeometry | PlaneGeometry, material: MeshBasicMaterial, x: number, z: number) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, 0, z);
    parent.add(mesh);
    if (!geometries.includes(geometry)) geometries.push(geometry);
    if (!materials.includes(material)) materials.push(material);
  }

  const binding = new MeshBasicMaterial({ color: '#182b4c' });
  addMesh(book, new BoxGeometry(WIDTH, HEIGHT, .07), binding, 0, -.18);
  const sheet = new BoxGeometry(WIDTH - .13, HEIGHT - .12, .026);
  const cream = new MeshBasicMaterial({ color: '#dfd0a8' });
  const ivory = new MeshBasicMaterial({ color: '#f8efd9' });
  for (let index = 0; index < 10; index++) {
    addMesh(book, sheet, index % 2 === 0 ? cream : ivory, -.027, -.13 + index * .026);
  }
  inside.ink.fillStyle = '#f5ecd6';
  inside.ink.fillRect(0, 0, 480, 300);
  inside.ink.fillStyle = '#7c93b270';
  for (let y = 25; y < 300; y += 15) inside.ink.fillRect(0, y, 480, 1);
  inside.ink.fillStyle = '#ba6b6566';
  inside.ink.fillRect(45, 0, 1, 300);
  addMesh(book, new PlaneGeometry(WIDTH - .13, HEIGHT - .12), new MeshBasicMaterial({ map: inside.texture }), -.027, .119);
  addMesh(book, new BoxGeometry(.10, HEIGHT, .39), binding, -WIDTH / 2 + .04, -.014);
  addMesh(cover, new BoxGeometry(WIDTH, HEIGHT, .047), binding, WIDTH / 2, 0);
  addMesh(cover, new PlaneGeometry(WIDTH, HEIGHT), new MeshBasicMaterial({ map: coverArt.texture }), WIDTH / 2, .024);

  const style = getComputedStyle(stage);
  const serif = style.getPropertyValue('--serif').trim() || 'Georgia, serif';
  const sans = style.fontFamily;
  let art = initialArt;
  let frame = 0;
  let previousFrame = 0;
  let disposed = false;
  let contextLost = false;
  let pointing = false;
  let focused = stage.matches(':focus-visible');
  book.rotation.set(-.15, -.19, .095);

  function requestFrame() {
    if (!frame && !disposed && !contextLost) frame = requestAnimationFrame(render);
  }

  // The cover rests at a fixed angle. Hover and focus lift it in place.
  function render(now: number) {
    frame = 0;
    const open = pointing || focused;
    const x = open ? -.28 : -.15;
    const lift = open ? .13 : 0;
    const hinge = open ? -.11 : 0;
    const blend = previousFrame ? 1 - Math.exp(-(now - previousFrame) / 62) : .22;
    book.rotation.x = MathUtils.lerp(book.rotation.x, x, blend);
    book.position.y = MathUtils.lerp(book.position.y, lift, blend);
    cover.rotation.y = MathUtils.lerp(cover.rotation.y, hinge, blend);
    const moving = Math.abs(book.rotation.x - x) + Math.abs(book.position.y - lift) +
      Math.abs(cover.rotation.y - hinge) > .003;
    if (!moving) {
      book.rotation.x = x;
      book.position.y = lift;
      cover.rotation.y = hinge;
    }
    renderer.render(scene, camera);
    stage.classList.add('notebook-rendered');
    previousFrame = moving ? now : 0;
    if (moving) requestFrame();
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    const aspect = width / height;
    // Allow room for the raised corner when the cover opens at the edge of the stage.
    const halfWidth = Math.max(3.03, aspect * 2.30);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfWidth / aspect;
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height, false);
    requestFrame();
  }

  function enter(event: PointerEvent) {
    if (event.pointerType === 'touch' || pointing) return;
    pointing = true;
    requestFrame();
  }

  function leave() {
    if (!pointing) return;
    pointing = false;
    requestFrame();
  }

  function syncFocus() {
    const next = stage.matches(':focus-visible');
    if (focused === next) return;
    focused = next;
    requestFrame();
  }

  function loseContext(event: Event) {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    stage.classList.remove('notebook-rendered');
  }

  function restoreContext() {
    contextLost = false;
    requestFrame();
  }

  function update(next: NotebookArt) {
    art = next;
    paintCover(coverArt.ink, art, serif, sans);
    coverArt.texture.needsUpdate = true;
    requestFrame();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  stage.addEventListener('pointerenter', enter);
  stage.addEventListener('pointerleave', leave);
  stage.addEventListener('focus', syncFocus);
  stage.addEventListener('blur', syncFocus);
  canvas.addEventListener('webglcontextlost', loseContext);
  canvas.addEventListener('webglcontextrestored', restoreContext);
  resize();
  update(art);
  void document.fonts.ready.then(() => { if (!disposed) update(art); });

  return {
    update,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      stage.removeEventListener('pointerenter', enter);
      stage.removeEventListener('pointerleave', leave);
      stage.removeEventListener('focus', syncFocus);
      stage.removeEventListener('blur', syncFocus);
      canvas.removeEventListener('webglcontextlost', loseContext);
      canvas.removeEventListener('webglcontextrestored', restoreContext);
      stage.classList.remove('notebook-rendered');
      coverArt.texture.dispose();
      inside.texture.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      renderer.dispose();
    },
  };
}
