import {
  BoxGeometry, BufferGeometry, EdgesGeometry, Group, Line, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, OctahedronGeometry, OrthographicCamera,
  Scene, Vector3, WebGLRenderer,
} from 'three';

export interface ChainMarkScene {
  pulse(): void;
  dispose(): void;
}

export function createChainMark(canvas: HTMLCanvasElement): ChainMarkScene | null {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
  if (!context) return null;
  const renderer = new WebGLRenderer({ canvas, context, alpha: true });
  const scene = new Scene();
  const camera = new OrthographicCamera(-3, 3, 1, -1, .1, 30);
  camera.position.set(0, 5, 7);
  camera.lookAt(0, 0, 0);
  const rail = new Group();
  rail.rotation.y = -.29;
  scene.add(rail);

  const cube = new BoxGeometry(.78, .56, .66);
  const edges = new EdgesGeometry(cube);
  const fill = new MeshBasicMaterial();
  const outline = new LineBasicMaterial({ transparent: true, opacity: .75 });
  const trackStyle = new LineBasicMaterial({ transparent: true, opacity: .42 });
  const flowStyle = new MeshBasicMaterial();
  const diamond = new OctahedronGeometry(.13);
  const track = new BufferGeometry().setFromPoints([new Vector3(-2.62, 0, 0), new Vector3(2.62, 0, 0)]);
  rail.add(new Line(track, trackStyle));
  const blocks = [-1.95, 0, 1.95].map(x => {
    const group = new Group();
    group.position.x = x;
    group.add(new Mesh(cube, fill), new LineSegments(edges, outline));
    rail.add(group);
    return group;
  });
  const signal = new Mesh(diamond, flowStyle);
  signal.visible = false;
  rail.add(signal);

  let frame = 0;
  let start = 0;
  let lost = false;

  function draw(now: number) {
    frame = 0;
    if (lost) return;
    const progress = start ? Math.min(1, (now - start) / 900) : 1;
    const x = -2.62 + progress * 5.24;
    signal.position.set(x, .31, 0);
    signal.rotation.y = progress * Math.PI;
    signal.visible = progress < 1;
    blocks.forEach(block => {
      block.position.y = progress < 1 ? .21 * Math.exp(-12 * (x - block.position.x) ** 2) : 0;
    });
    renderer.render(scene, camera);
    canvas.dataset.rendered = '';
    if (progress < 1) frame = requestAnimationFrame(draw);
  }

  function measure() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    camera.top = 2.96 * height / width;
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height, false);
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function pulse() {
    const style = getComputedStyle(canvas);
    fill.color.set(style.getPropertyValue('--card').trim());
    outline.color.set(style.getPropertyValue('--muted').trim());
    trackStyle.color.copy(outline.color);
    flowStyle.color.set(style.getPropertyValue('--accent').trim());
    start = performance.now();
    if (!frame && !lost) frame = requestAnimationFrame(draw);
  }

  function lose(event: Event) {
    event.preventDefault();
    lost = true;
    delete canvas.dataset.rendered;
  }

  function restore() {
    lost = false;
    pulse();
  }

  const observer = new ResizeObserver(measure);
  observer.observe(canvas);
  canvas.addEventListener('webglcontextlost', lose);
  canvas.addEventListener('webglcontextrestored', restore);
  measure();
  pulse();

  return {
    pulse,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', lose);
      canvas.removeEventListener('webglcontextrestored', restore);
      delete canvas.dataset.rendered;
      [cube, edges, diamond, track].forEach(geometry => geometry.dispose());
      [fill, outline, trackStyle, flowStyle].forEach(material => material.dispose());
      renderer.dispose();
    },
  };
}
