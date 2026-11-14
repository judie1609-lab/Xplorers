"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from "react";
import targetCasesJson from "./target-cases.json";

const EPHEMERAL_STORAGE_MODE = process.env.NEXT_PUBLIC_XPLORERS_EPHEMERAL_STORAGE === "true";
const LOW_MEMORY_MODE = process.env.NEXT_PUBLIC_XPLORERS_LOW_MEMORY_MODE === "true";
const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL?.trim();
const USE_SAME_ORIGIN_API = !CONFIGURED_API_URL && process.env.NODE_ENV === "production";
const API_URL_IS_HTTPS_ORIGIN = (() => {
  if (!CONFIGURED_API_URL) return false;
  try {
    const parsed = new URL(CONFIGURED_API_URL);
    return parsed.protocol === "https:" && parsed.origin === CONFIGURED_API_URL;
  } catch {
    return false;
  }
})();

if (EPHEMERAL_STORAGE_MODE && !API_URL_IS_HTTPS_ORIGIN && !USE_SAME_ORIGIN_API) {
  throw new Error(
    "Set NEXT_PUBLIC_API_URL to an HTTPS API origin, or build with the same-origin proxy enabled for Vercel.",
  );
}

// Vercel production requests stay on the frontend origin and are forwarded by
// Next.js rewrites. Development keeps the existing local FastAPI default.
const API = CONFIGURED_API_URL || (USE_SAME_ORIGIN_API ? "" : "http://127.0.0.1:8000");

type CollectionStat = { name: string; rows: number };
type BandStat = { name: string; rows: number };
type Summary = {
  total_rows?: number;
  unique_obs_ids?: number;
  collections?: CollectionStat[];
  bands?: BandStat[];
};
type Observation = {
  id?: number | string;
  obs_id?: string;
  collection?: string;
  band?: string;
  ra_deg?: number | null;
  dec_deg?: number | null;
  mjd_start?: number | null;
  mjd_end?: number | null;
  exposure_seconds?: number | null;
  calibration_status?: string;
  access_url?: string;
};

type ScientificImage = {
  name: string;
  format: string;
  size_bytes: number;
  url: string;
};

type FitsAnalysis = {
  status: string;
  metadata: {
    image_name: string;
    width: number;
    height: number;
    unit?: string | null;
    date_obs?: string | null;
    mjd_obs?: number | null;
    telescope?: string | null;
    instrument?: string | null;
    fits_hdu_count: number;
  };
  science_image: {
    shape: number[];
    valid_pixels: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    std: number | null;
  };
  variance?: {
    shape: number[];
    valid_pixels: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    std: number | null;
  } | null;
  flags?: {
    shape: number[];
    unique_values_count: number;
    most_common_values: { value: number; count: number }[];
  } | null;
  wcs?: {
    coordinate_system?: string;
    pixel_to_sky?: Record<string, { ra_deg: number; dec_deg: number }>;
    available?: boolean;
    message?: string;
  } | null;
  scientific_note?: string;
};

type PixelAnalysis = {
  status: string;
  image_name: string;
  pixel: { x: number; y: number };
  science_value: number | null;
  unit?: string | null;
  variance_value?: number | null;
  flag_value?: number | null;
  sky_coordinates?: {
    ra_deg: number;
    dec_deg: number;
    coordinate_system?: string;
  } | null;
  note?: string;
};


type RoiAnalysis = {
  status: string;
  image_name: string;
  region: {
    x1: number; y1: number; x2: number; y2: number;
    width: number; height: number;
    total_pixels: number; valid_pixels: number; invalid_pixels: number;
  };
  science_statistics: {
    min: number; max: number; mean: number; median: number; std: number;
  };
  unit?: string | null;
  histogram: { bin_start: number; bin_end: number; count: number }[];
  variance?: { valid_pixels: number; mean: number | null; std: number | null } | null;
  flags?: { unique_values_count: number; most_common_values: { value: number; count: number }[] } | null;
  sky_center?: { ra_deg: number; dec_deg: number; coordinate_system: string } | null;
  note?: string;
};


type ObservationClusters = {
  status: string;
  model: string;
  learning_type: string;
  cluster_count: number;
  records_loaded: number;
  records_used: number;
  features_used: string[];
  inertia: number;
  clusters: {
    cluster_id: number;
    observation_count: number;
    median_ra_deg: number;
    median_dec_deg: number;
    median_mjd_start: number;
    median_exposure_seconds: number;
    band_distribution: Record<string, number>;
    collection_distribution: Record<string, number>;
  }[];
  sample_assignments: {
    id: number;
    obs_id?: string | null;
    cluster_id: number;
    band?: string | null;
    collection?: string | null;
    ra_deg: number;
    dec_deg: number;
    mjd_start: number;
    exposure_seconds: number;
  }[];
  interpretation_note: string;
  limitations: string;
};

type NavItem = { name: string; icon: string };

const navigation: NavItem[] = [
  { name: "Overview", icon: "◈" },
  { name: "Target Coverage", icon: "◎" },
  { name: "Sky Explorer", icon: "✧" },
  { name: "Image Explorer", icon: "▧" },
  { name: "Comparison Lab", icon: "⇄" },
  { name: "3D Universe", icon: "◎" },
  { name: "Galaxy Explorer", icon: "✦" },
  { name: "AI Analysis", icon: "⌘" },
  { name: "Scientific Analysis", icon: "⌁" },
  { name: "Scientific Visualization", icon: "▥" },
  { name: "Smart Search", icon: "⌕" },
  { name: "IRSA Archive", icon: "↗" },
  { name: "Explainable AI", icon: "✧" },
];

const bandColors = ["#36c9e8", "#4b9aff", "#a78bfa", "#35d6a5", "#f0b45a", "#f0789b"];

function extractRows(data: unknown): Observation[] {
  if (Array.isArray(data)) return data as Observation[];
  if (!data || typeof data !== "object") return [];
  const value = data as Record<string, unknown>;
  if (Array.isArray(value.items)) return value.items as Observation[];
  if (Array.isArray(value.observations)) return value.observations as Observation[];
  if (Array.isArray(value.results)) return value.results as Observation[];
  return [];
}

function numberFormat(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
return value.toLocaleString("en-US");}
function formatCoordinate(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(4)}°`;
}
function formatFileBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function InteractivePlanet() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const rotationRef = useMemo(() => ({ current: { x: 0, y: 0 } }), []);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true });
    if (!gl) return;

    const vertexSource = `
      attribute vec2 position;
      varying vec2 vUv;
      void main(){ vUv=position*.5+.5; gl_Position=vec4(position,0.0,1.0); }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uPointer;
      uniform float uPaused;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
                   mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
      }
      void main(){
        vec2 uv=(vUv-.5)*2.0;
        uv.x*=uResolution.x/uResolution.y;
        vec2 center=vec2(.43,.0);
        vec2 p=uv-center;
        float radius=length(p);
        if(radius>0.82){ gl_FragColor=vec4(0.0); return; }
        float z=sqrt(max(0.0,.82*.82-radius*radius));
        vec3 n=normalize(vec3(p,z));
        float angle=atan(n.x,n.z)+uPointer.x+uTime*uPaused*.18;
        float latitude=asin(clamp(n.y,-1.0,1.0));
        vec2 tex=vec2(angle*1.25,latitude*2.2);
        float clouds=noise(tex*vec2(5.0,8.0)+vec2(uTime*.025,0.0));
        float bands=sin(latitude*24.0+noise(tex*3.0)*4.0+sin(angle*3.0)*1.5);
        float land=noise(tex*vec2(9.0,13.0)+vec2(2.0,1.0));
        vec3 deep=vec3(.018,.075,.19);
        vec3 ocean=vec3(.035,.28,.52);
        vec3 cyan=vec3(.19,.72,.83);
        vec3 col=mix(deep,ocean,smoothstep(.08,.82,land));
        col=mix(col,cyan,smoothstep(.54,.9,clouds)*.38);
        col+=vec3(.08,.24,.3)*smoothstep(.45,.95,bands)*.22;
        vec3 light=normalize(vec3(-.55,.48,.85));
        float diffuse=max(dot(n,light),0.0);
        float rim=pow(1.0-max(dot(n,vec3(0.,0.,1.)),0.0),2.8);
        col*=.24+.88*diffuse;
        col+=vec3(.12,.58,.85)*rim*.55;
        float spec=pow(max(dot(reflect(-light,n),vec3(0.,0.,1.)),0.0),28.0);
        col+=vec3(.55,.86,1.0)*spec*.45;
        float edge=smoothstep(.82,.795,radius);
        gl_FragColor=vec4(col,edge);
      }
    `;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const rotationState = rotationRef;
    const timeLoc = gl.getUniformLocation(program, "uTime");
    const resolutionLoc = gl.getUniformLocation(program, "uResolution");
    const pointerLoc = gl.getUniformLocation(program, "uPointer");
    const pausedLoc = gl.getUniformLocation(program, "uPaused");
    let frame = 0;
    const start = performance.now();
    let width = 0, height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width * dpr));
      height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = width; canvas.height = height;
      gl.viewport(0, 0, width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const draw = (now: number) => {
      const elapsed = (now - start) / 1000;
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(timeLoc, elapsed * speed);
      gl.uniform2f(resolutionLoc, width, height);
      gl.uniform2f(pointerLoc, rotationState.current.x, rotationState.current.y);
      gl.uniform1f(pausedLoc, paused ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [paused, speed, rotationRef]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerStart.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    setShowHint(false);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    rotationRef.current.x += dx * 0.008;
    rotationRef.current.y = Math.max(-0.55, Math.min(0.55, rotationRef.current.y + dy * 0.006));
  };
  return (
    <div className="interactive-planet-widget">
      <canvas
        ref={canvasRef}
        className="interactive-planet-canvas"
        aria-label="Interactive animated procedural 3D-style planet. Drag to explore."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      />
      <div className="planet-widget-label"><span className="live-dot" /> LIVE PLANET VIEW</div>
      {showHint && <div className="planet-drag-hint">DRAG TO EXPLORE</div>}
      <div className="planet-controls">
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "▶ Resume" : "Ⅱ Pause"}</button>
        <label>ROTATION <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.45}>0.5×</option><option value={1}>1×</option><option value={1.8}>1.8×</option><option value={3}>3×</option></select></label>
      </div>
    </div>
  );
}


const GALAXY_OBJECTS = [
  { id: "solara", name: "Solara", type: "Blue-white star", distance: "Illustrative system", detail: "A featured star in the interactive demo galaxy. This is a visual discovery object, not a catalog measurement.", color: "#8deaff", orbit: 0, size: 13 },
  { id: "elyra", name: "Elyra", type: "Ocean world", distance: "Illustrative orbit 1", detail: "A fictional ocean world used to demonstrate object selection and exploration controls.", color: "#39c9e8", orbit: 1, size: 8 },
  { id: "vexa", name: "Vexa", type: "Rocky world", distance: "Illustrative orbit 2", detail: "A fictional rocky planet. Its displayed properties are for interface demonstration only.", color: "#e6a66e", orbit: 2, size: 6 },
  { id: "nyra", name: "Nyra", type: "Ice giant", distance: "Illustrative orbit 3", detail: "A fictional ice giant with a cool atmospheric palette, included in the demo scene.", color: "#a6a4ff", orbit: 3, size: 10 },
  { id: "orbis", name: "Orbis", type: "Distant planet", distance: "Illustrative orbit 4", detail: "A fictional outer planet. No physical distance or orbital period is implied.", color: "#e58bc7", orbit: 4, size: 7 },
];

function InteractiveGalaxyExplorer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedId, setSelectedId] = useState("solara");
  const [zoom, setZoom] = useState(1);
  const [paused, setPaused] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [filter, setFilter] = useState("all");
  const [missionId, setMissionId] = useState("first-light");
  const [visitedObjects, setVisitedObjects] = useState<string[]>([]);
  const [missionMessage, setMissionMessage] = useState("");
  const [showSpherexData, setShowSpherexData] = useState(false);
  const [selectedObservation, setSelectedObservation] = useState<Observation | null>(null);
  const [compareA, setCompareA] = useState("0");
  const [compareB, setCompareB] = useState("1");
  const [spherexCount, setSpherexCount] = useState(0);
  const [spherexStatus, setSpherexStatus] = useState<"loading" | "ready" | "error">("loading");
  const [compareRows, setCompareRows] = useState<Observation[]>([]);
  const observationsRef = useRef<Observation[]>([]);
  const showSpherexRef = useRef(false);
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, panX: 0, panY: 0 });
  const zoomRef = useRef(1);
  const pausedRef = useRef(false);
  const labelsRef = useRef(true);
  const selected = GALAXY_OBJECTS.find((item) => item.id === selectedId) || GALAXY_OBJECTS[0];
  const comparisonOne = compareRows[Number(compareA)] || null;
  const comparisonTwo = compareRows[Number(compareB)] || null;
  const missions = [
    { id: "first-light", title: "First Light", level: "BEGINNER", description: "Locate the central star and begin your exploration.", target: "solara", reward: "Explorer badge" },
    { id: "ice-world", title: "The Ice World", level: "SCOUT", description: "Find Nyra, the demo system's ice giant.", target: "nyra", reward: "Deep-space scout badge" },
    { id: "full-survey", title: "System Survey", level: "ADVANCED", description: "Visit every object in the illustrative star system.", target: "all", reward: "Master survey badge" },
  ];
  const activeMission = missions.find((mission) => mission.id === missionId) || missions[0];
  const missionComplete = activeMission.target === "all"
    ? GALAXY_OBJECTS.every((object) => visitedObjects.includes(object.id))
    : visitedObjects.includes(activeMission.target);
  const missionProgress = activeMission.target === "all"
    ? Math.round((GALAXY_OBJECTS.filter((object) => visitedObjects.includes(object.id)).length / GALAXY_OBJECTS.length) * 100)
    : missionComplete ? 100 : 0;
  const selectGalaxyObject = (id: string) => {
    setSelectedId(id);
    setVisitedObjects((current) => current.includes(id) ? current : [...current, id]);
    setMissionMessage("");
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/v1/observations?limit=500`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Observations request failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        const rows = extractRows(payload).filter((row) =>
          typeof row.ra_deg === "number" && Number.isFinite(row.ra_deg) &&
          typeof row.dec_deg === "number" && Number.isFinite(row.dec_deg)
        );
        setCompareRows(rows);
        setSpherexCount(rows.length);
        setSpherexStatus("ready");
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setCompareRows([]);
        setSpherexCount(0);
        setSpherexStatus("error");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => { observationsRef.current = compareRows; }, [compareRows]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { showSpherexRef.current = showSpherexData; }, [showSpherexData]);
  useEffect(() => { labelsRef.current = showLabels; }, [showLabels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let width = 0;
    let height = 0;
    let elapsed = 0;
    let last = 0;
    const stars = Array.from({ length: 260 }, (_, i) => ({
      x: ((i * 7919) % 997) / 997,
      y: ((i * 3571 + 71) % 991) / 991,
      r: 0.35 + ((i * 13) % 12) / 10,
      phase: (i * 17) % 10,
    }));
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width * dpr));
      height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.04) : 0;
      last = now;
      if (!pausedRef.current) elapsed += dt;
      ctx.clearRect(0, 0, width, height);
      const cx = width * 0.49 + drag.current.panX;
      const cy = height * 0.51 + drag.current.panY;
      const scale = zoomRef.current * Math.min(width, height) / 520;

      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * .72);
      bg.addColorStop(0, "#102b4b");
      bg.addColorStop(.55, "#09182d");
      bg.addColorStop(1, "#050b17");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Drifting nebula clouds and twinkling star field.
      for (let i = 0; i < 3; i++) {
        const nx = width * (.18 + i * .32) + Math.sin(elapsed * .08 + i) * 25;
        const ny = height * (.25 + (i % 2) * .45) + Math.cos(elapsed * .06 + i) * 18;
        const cloud = ctx.createRadialGradient(nx, ny, 0, nx, ny, width * .27);
        cloud.addColorStop(0, i === 1 ? "rgba(53,135,201,.12)" : "rgba(92,82,190,.10)");
        cloud.addColorStop(1, "rgba(5,11,23,0)");
        ctx.fillStyle = cloud;
        ctx.fillRect(0, 0, width, height);
      }
      stars.forEach((star) => {
        const twinkle = .35 + .65 * (Math.sin(elapsed * 1.5 + star.phase) * .5 + .5);
        const x = (star.x * width + elapsed * (star.phase % 3 - 1) * 2 + width) % width;
        const y = (star.y * height + Math.sin(elapsed * .12 + star.phase) * 3 + height) % height;
        ctx.beginPath();
        ctx.arc(x, y, star.r * (width / 900 + .5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(205,235,255,${twinkle * .8})`;
        ctx.fill();
      });

      // Decorative spiral arms.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(elapsed * .025);
      for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        for (let t = 0; t < 5.8; t += .035) {
          const radius = (18 + t * 27) * scale;
          const angle = t + arm * Math.PI * 2 / 3;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius * .55;
          if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(77,173,220,.13)";
        ctx.lineWidth = 10 * scale;
        ctx.stroke();
      }
      ctx.restore();

      // Optional SPHEREx observation overlay: RA/Dec sky coordinates projected to the canvas.
      // These are sky positions, not 3D distances or orbital locations.
      if (showSpherexRef.current && observationsRef.current.length) {
        const rows = observationsRef.current;
        rows.forEach((row, index) => {
          const ra = (row.ra_deg as number) * Math.PI / 180;
          const dec = (row.dec_deg as number) * Math.PI / 180;
          const x = ((ra / (Math.PI * 2)) * width + drag.current.panX + width) % width;
          const y = height * (0.5 - dec / Math.PI) + drag.current.panY;
          const bandIndex = Number(String(row.band || "").replace(/\\D/g, "")) || (index % 6);
          const pointColor = ["#67e8f9", "#7dd3fc", "#a5b4fc", "#c4b5fd", "#f0abfc", "#f9a8d4"][Math.abs(bandIndex) % 6];
          ctx.beginPath();
          ctx.arc(x, y, 2.1 + (index % 3) * .45, 0, Math.PI * 2);
          ctx.fillStyle = pointColor;
          ctx.shadowColor = pointColor;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      }

      // Central star glow.
      const sunGlow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 48 * scale);
      sunGlow.addColorStop(0, "rgba(220,250,255,.95)");
      sunGlow.addColorStop(.15, "rgba(93,215,255,.55)");
      sunGlow.addColorStop(1, "rgba(55,151,220,0)");
      ctx.fillStyle = sunGlow;
      ctx.beginPath(); ctx.arc(cx, cy, 48 * scale, 0, Math.PI * 2); ctx.fill();

      GALAXY_OBJECTS.slice(1).forEach((obj) => {
        const orbit = (48 + obj.orbit * 42) * scale;
        ctx.beginPath();
        ctx.ellipse(cx, cy, orbit, orbit * .58, -.16, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(112,204,239,.18)";
        ctx.lineWidth = 1;
        ctx.stroke();
        const angle = elapsed * (.25 / (obj.orbit * .55 + .6)) + obj.orbit * 1.7;
        const x = cx + Math.cos(angle) * orbit;
        const y = cy + Math.sin(angle) * orbit * .58;
        const radius = Math.max(3, obj.size * scale * .55);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.2);
        glow.addColorStop(0, obj.color + "bb");
        glow.addColorStop(1, obj.color + "00");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2); ctx.fill();
        const planet = ctx.createRadialGradient(x - radius * .35, y - radius * .35, 1, x, y, radius);
        planet.addColorStop(0, "#ffffff");
        planet.addColorStop(.2, obj.color);
        planet.addColorStop(1, "#101c37");
        ctx.fillStyle = planet;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        if (labelsRef.current) {
          ctx.font = `${Math.max(10, 11 * width / 900)}px Arial`;
          ctx.fillStyle = "rgba(218,239,255,.78)";
          ctx.fillText(obj.name, x + radius + 7, y - radius - 5);
        }
      });

      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, 8 * scale), 0, Math.PI * 2);
      ctx.fillStyle = "#e9fdff";
      ctx.shadowColor = "#59dfff";
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (labelsRef.current) {
        ctx.font = `bold ${Math.max(10, 12 * width / 900)}px Arial`;
        ctx.fillStyle = "#c9f5ff";
        ctx.fillText("SOLARA", cx + 14, cy - 12);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current.active = true;
    drag.current.moved = false;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current.active) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
    drag.current.panX += dx;
    drag.current.panY += dy;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
  };
  const onPointerUp = () => { drag.current.active = false; };
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (drag.current.moved) {
      drag.current.moved = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Prefer a nearby real SPHEREx observation when the data overlay is enabled.
    if (showSpherexData && observationsRef.current.length) {
      let nearestRow: Observation | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const row of observationsRef.current) {
        if (typeof row.ra_deg !== "number" || typeof row.dec_deg !== "number") continue;
        const px = ((row.ra_deg / 360) * rect.width + drag.current.panX + rect.width) % rect.width;
        const py = rect.height * (0.5 - row.dec_deg / 180) + drag.current.panY;
        const distance = Math.hypot(clickX - px, clickY - py);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestRow = row;
        }
      }
      if (nearestRow !== null && nearestDistance <= 18) {
        setSelectedObservation(nearestRow);
        return;
      }
    }

    setSelectedObservation(null);
    const x = clickX - rect.width * .49;
    const y = clickY - rect.height * .51;
    if (Math.hypot(x, y) < 34 * zoom) selectGalaxyObject("solara");
    else {
      const nearest = GALAXY_OBJECTS.slice(1).reduce((best, obj) => {
        const angle = performance.now() / 1000 * (.25 / (obj.orbit * .55 + .6)) + obj.orbit * 1.7;
        const orbit = (48 + obj.orbit * 42) * zoom;
        const px = Math.cos(angle) * orbit;
        const py = Math.sin(angle) * orbit * .58;
        const distance = Math.hypot(x - px, y - py);
        return distance < best.distance ? { id: obj.id, distance } : best;
      }, { id: "elyra", distance: Infinity });
      if (nearest.distance < 45 * zoom) selectGalaxyObject(nearest.id);
    }
  };

  return (
    <section className="galaxy-page">
      <div className="galaxy-heading">
        <div><div className="eyebrow"><span /> INTERACTIVE DEEP SPACE</div><h1>Galaxy <span>Explorer.</span></h1><p className="subtitle">Navigate a living demo galaxy, discover worlds and inspect selected objects.</p></div>
        <div className="galaxy-live"><i /> SIMULATION RUNNING</div>
      </div>
      <div className="galaxy-layout">
        <div className="galaxy-view-card">
          <div className="galaxy-canvas-top"><span>✧ LOCAL STAR SYSTEM · VISUAL DEMO</span><span>DRAG TO PAN · WHEEL TO ZOOM</span></div>
          <canvas ref={canvasRef} className="galaxy-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={handleCanvasClick} onWheel={(event) => setZoom((value) => Math.max(.55, Math.min(2.4, value - event.deltaY * .001)))} />
          <div className="galaxy-controls">
            <button type="button" onClick={() => setPaused((v) => !v)}>{paused ? "▶ Resume" : "Ⅱ Pause"}</button>
            <button type="button" onClick={() => { setZoom(1); drag.current.panX = 0; drag.current.panY = 0; }}>⌖ Reset view</button>
            <label>ZOOM <input type="range" min=".55" max="2.4" step=".05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
            <button type="button" onClick={() => setShowLabels((v) => !v)}>{showLabels ? "Hide labels" : "Show labels"}</button>
            <button type="button" className={showSpherexData ? "spherex-toggle active" : "spherex-toggle"} onClick={() => setShowSpherexData((v) => !v)} disabled={spherexStatus !== "ready" || spherexCount === 0}>{showSpherexData ? "Hide SPHEREx data" : "Show SPHEREx data"}</button>
          </div>
          <div className="spherex-data-status">
            <span className={spherexStatus === "ready" ? "status-dot ready" : spherexStatus === "error" ? "status-dot error" : "status-dot"} />
            {spherexStatus === "loading" ? "Loading SPHEREx observations…" : spherexStatus === "error" ? "SPHEREx data unavailable — demo galaxy remains available." : `${spherexCount.toLocaleString()} observations with valid RA/Dec loaded`}
            {showSpherexData && spherexStatus === "ready" ? " · Sky-coordinate overlay enabled" : ""}
          </div>
        </div>
        <aside className="galaxy-info-card">
          {selectedObservation ? (
            <div className="spherex-observation-detail">
              <div className="galaxy-info-kicker">SPHEREx OBSERVATION</div>
              <h2>{selectedObservation.obs_id || `Observation ${selectedObservation.id ?? "—"}`}</h2>
              <div className="galaxy-object-type">Selected from loaded SPHEREx records</div>
              <div className="galaxy-fact"><span>Collection</span><strong>{selectedObservation.collection || "—"}</strong></div>
              <div className="galaxy-fact"><span>Band</span><strong>{selectedObservation.band || "—"}</strong></div>
              <div className="galaxy-fact"><span>RA (deg)</span><strong>{typeof selectedObservation.ra_deg === "number" ? selectedObservation.ra_deg.toFixed(6) : "—"}</strong></div>
              <div className="galaxy-fact"><span>Dec (deg)</span><strong>{typeof selectedObservation.dec_deg === "number" ? selectedObservation.dec_deg.toFixed(6) : "—"}</strong></div>
              <div className="galaxy-fact"><span>Start MJD</span><strong>{typeof selectedObservation.mjd_start === "number" ? selectedObservation.mjd_start.toFixed(5) : "—"}</strong></div>
              <div className="galaxy-fact"><span>End MJD</span><strong>{typeof selectedObservation.mjd_end === "number" ? selectedObservation.mjd_end.toFixed(5) : "—"}</strong></div>
              <div className="galaxy-fact"><span>Exposure (s)</span><strong>{typeof selectedObservation.exposure_seconds === "number" ? selectedObservation.exposure_seconds.toFixed(2) : "—"}</strong></div>
              <div className="galaxy-fact"><span>Calibration</span><strong>{selectedObservation.calibration_status || "—"}</strong></div>
              {selectedObservation.access_url ? <a className="spherex-access-link" href={selectedObservation.access_url} target="_blank" rel="noreferrer">Open observation data ↗</a> : null}
              <div className="galaxy-demo-note">SOURCE: LOADED SPHEREx DATABASE RECORD</div>
              <button type="button" className="spherex-clear-selection" onClick={() => setSelectedObservation(null)}>Back to demo objects</button>
            </div>
          ) : <>
          <div className="galaxy-info-kicker">SELECTED OBJECT</div>
          <div className="galaxy-object-orb" style={{ background: `radial-gradient(circle at 32% 28%, #fff, ${selected.color} 24%, #10213e 78%)`, boxShadow: `0 0 42px ${selected.color}55` }} />
          <h2>{selected.name}</h2><div className="galaxy-object-type">{selected.type}</div>
          <div className="galaxy-fact"><span>Classification</span><strong>{selected.type}</strong></div>
          <div className="galaxy-fact"><span>Scene label</span><strong>{selected.distance}</strong></div>
          <p className="galaxy-object-detail">{selected.detail}</p>
          <div className="galaxy-demo-note">DEMO DATA · NOT A SCIENTIFIC CATALOG</div>
          <div className="galaxy-object-list"><strong>DISCOVER OBJECTS</strong>{GALAXY_OBJECTS.map((obj) => <button key={obj.id} type="button" className={selectedId === obj.id ? "active" : ""} onClick={() => selectGalaxyObject(obj.id)}><i style={{ background: obj.color }} />{obj.name}<span>↗</span></button>)}</div>
          </>}
        </aside>
      </div>
      <div className="galaxy-bottom-note"><span>✦</span> This interactive scene is illustrative. It does not represent measured SPHEREx positions, distances or orbital paths.</div>
      <section className="observation-compare-card">
        <div className="observation-compare-heading">
          <div>
            <div className="eyebrow"><span /> SCIENTIFIC WORKSPACE</div>
            <h2>Observation <span>Comparison.</span></h2>
            <p>Compare two records currently loaded from the SPHEREx observation API.</p>
          </div>
          <div className="compare-count">{spherexCount.toLocaleString()} RECORDS LOADED</div>
        </div>
        {spherexStatus === "loading" ? (
          <div className="compare-empty">Loading observation records…</div>
        ) : spherexStatus === "error" || compareRows.length < 2 ? (
          <div className="compare-empty">At least two SPHEREx observations are needed. Check that the backend is running and the observations endpoint returns records.</div>
        ) : (
          <>
            <div className="compare-selectors">
              <label>OBSERVATION A
                <select value={compareA} onChange={(event) => setCompareA(event.target.value)}>
                  {compareRows.map((row, index) => <option key={`a-${index}`} value={String(index)}>{row.obs_id || `Record ${row.id ?? index + 1}`} · {row.band || "Band —"}</option>)}
                </select>
              </label>
              <div className="compare-versus">VS</div>
              <label>OBSERVATION B
                <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
                  {compareRows.map((row, index) => <option key={`b-${index}`} value={String(index)}>{row.obs_id || `Record ${row.id ?? index + 1}`} · {row.band || "Band —"}</option>)}
                </select>
              </label>
              <button type="button" className="compare-swap" onClick={() => { setCompareA(compareB); setCompareB(compareA); }}>⇄ Swap</button>
            </div>
            {comparisonOne && comparisonTwo ? (
              <div className="compare-table-wrap">
                <table className="compare-table">
                  <thead><tr><th>PROPERTY</th><th>OBSERVATION A</th><th>OBSERVATION B</th><th>COMPARISON</th></tr></thead>
                  <tbody>
                    {([
                      ["Observation ID", comparisonOne.obs_id || comparisonOne.id || "—", comparisonTwo.obs_id || comparisonTwo.id || "—"],
                      ["Collection", comparisonOne.collection || "—", comparisonTwo.collection || "—"],
                      ["Band", comparisonOne.band || "—", comparisonTwo.band || "—"],
                      ["Right Ascension (°)", typeof comparisonOne.ra_deg === "number" ? comparisonOne.ra_deg.toFixed(6) : "—", typeof comparisonTwo.ra_deg === "number" ? comparisonTwo.ra_deg.toFixed(6) : "—"],
                      ["Declination (°)", typeof comparisonOne.dec_deg === "number" ? comparisonOne.dec_deg.toFixed(6) : "—", typeof comparisonTwo.dec_deg === "number" ? comparisonTwo.dec_deg.toFixed(6) : "—"],
                      ["Start MJD", typeof comparisonOne.mjd_start === "number" ? comparisonOne.mjd_start.toFixed(5) : "—", typeof comparisonTwo.mjd_start === "number" ? comparisonTwo.mjd_start.toFixed(5) : "—"],
                      ["End MJD", typeof comparisonOne.mjd_end === "number" ? comparisonOne.mjd_end.toFixed(5) : "—", typeof comparisonTwo.mjd_end === "number" ? comparisonTwo.mjd_end.toFixed(5) : "—"],
                      ["Exposure (s)", typeof comparisonOne.exposure_seconds === "number" ? comparisonOne.exposure_seconds.toFixed(2) : "—", typeof comparisonTwo.exposure_seconds === "number" ? comparisonTwo.exposure_seconds.toFixed(2) : "—"],
                      ["Calibration", comparisonOne.calibration_status || "—", comparisonTwo.calibration_status || "—"],
                    ] as [string, string | number, string | number][]).map(([label, a, b]) => (
                      <tr key={label}><td>{label}</td><td>{String(a)}</td><td>{String(b)}</td><td>{String(a) === String(b) ? "Same" : "Different"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="compare-footnote">Values are displayed as returned by the backend. “Same / Different” is a literal field comparison, not a scientific significance test.</div>
          </>
        )}
      </section>
      <section className="mission-mode-card">
        <div className="mission-mode-heading">
          <div><div className="eyebrow"><span /> GUIDED EXPLORATION</div><h2>Mission <span>Mode.</span></h2><p>Complete small discovery objectives as you explore the demo system.</p></div>
          <div className="mission-mode-status"><i /> {missionComplete ? "MISSION COMPLETE" : "MISSION IN PROGRESS"}</div>
        </div>
        <div className="mission-mode-grid">
          <div className="mission-list">
            {missions.map((mission) => (
              <button key={mission.id} type="button" className={missionId === mission.id ? "mission-option active" : "mission-option"} onClick={() => { setMissionId(mission.id); setMissionMessage(""); }}>
                <span className="mission-option-icon">✦</span>
                <span className="mission-option-copy"><strong>{mission.title}</strong><small>{mission.level} · {mission.description}</small></span>
                <span className="mission-option-arrow">›</span>
              </button>
            ))}
          </div>
          <div className="mission-detail">
            <div className="mission-detail-top"><span>ACTIVE OBJECTIVE</span><span>{missionProgress}%</span></div>
            <h3>{activeMission.title}</h3>
            <p>{activeMission.description}</p>
            <div className="mission-progress-track"><span style={{ width: `${missionProgress}%` }} /></div>
            <div className="mission-target-line"><span>OBJECTIVE</span><strong>{activeMission.target === "all" ? "Visit all 5 demo objects" : `Select ${GALAXY_OBJECTS.find((object) => object.id === activeMission.target)?.name}`}</strong></div>
            <div className="mission-target-line"><span>REWARD</span><strong>{activeMission.reward}</strong></div>
            {missionComplete ? <div className="mission-complete-message">✦ Objective completed! Great exploration.</div> : <button type="button" className="mission-action-button" onClick={() => { if (activeMission.target === "all") { setMissionMessage("Select each object in the Discover Objects list to complete the survey."); } else { selectGalaxyObject(activeMission.target); setMissionMessage("Target selected. Objective complete!"); } }}> {activeMission.target === "all" ? "How to complete" : "Locate target"} ↗</button>}
            {missionMessage && <div className="mission-inline-message">{missionMessage}</div>}
            <div className="mission-visited-count">DISCOVERED OBJECTS <strong>{visitedObjects.length} / {GALAXY_OBJECTS.length}</strong></div>
          </div>
        </div>
      </section>
    </section>
  );
}


function ScientificVisualizationWorkspace({ observations, summary }: { observations: Observation[]; summary: Summary | null }) {
  const bandCounts = useMemo(() => {
    const counts = new Map<string, number>();
    observations.forEach((row) => { const key = row.band || "Unknown"; counts.set(key, (counts.get(key) || 0) + 1); });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [observations]);
  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    observations.forEach((row) => { const key = row.collection || "Unknown"; counts.set(key, (counts.get(key) || 0) + 1); });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [observations]);
  const maxBand = Math.max(1, ...bandCounts.map((item) => item[1]));
  const coordinateRows = observations.filter((row) => typeof row.ra_deg === "number" && typeof row.dec_deg === "number").slice(0, 350);
  return <section className="page-section added-workspace">
    <div className="welcome-row"><div><div className="eyebrow"><span /> DATA EXPLORATION · VISUAL ANALYTICS</div><h1>Scientific <span>Visualization.</span></h1><p className="subtitle">Explore distributions and sky-coordinate coverage in the observation records loaded for this session.</p></div><span className="date-chip">{observations.length.toLocaleString()} LOADED ROWS</span></div>
    <div className="stats-grid"><div className="stat-card"><div className="stat-top">Database rows</div><div className="stat-value">{numberFormat(summary?.total_rows)}</div><div className="stat-foot">Backend summary</div></div><div className="stat-card"><div className="stat-top">Loaded sample</div><div className="stat-value">{numberFormat(observations.length)}</div><div className="stat-foot">Current browser session</div></div><div className="stat-card"><div className="stat-top">Bands in sample</div><div className="stat-value">{bandCounts.length}</div><div className="stat-foot">Distinct band labels</div></div><div className="stat-card"><div className="stat-top">Valid sky coordinates</div><div className="stat-value">{coordinateRows.length}</div><div className="stat-foot">Shown in scatter preview (max 350)</div></div></div>
    <div className="added-two-col"><article className="chart-card"><div className="chart-title-row"><div><h3>Observation count by band</h3><p>Counts are calculated from records loaded in this session.</p></div><span className="chart-mark">BANDS</span></div>{bandCounts.length ? <div className="added-bars">{bandCounts.map(([name,count],index)=><div className="added-bar-row" key={name}><span>{name}</span><div className="added-bar-track"><i style={{width:`${count/maxBand*100}%`,background:bandColors[index%bandColors.length]}} /></div><strong>{numberFormat(count)}</strong></div>)}</div> : <div className="empty-state">No band values are available in the loaded sample.</div>}</article>
    <article className="chart-card"><div className="chart-title-row"><div><h3>Top collections</h3><p>Largest collection groups in the loaded sample.</p></div><span className="chart-mark">COLLECTIONS</span></div>{collectionCounts.length ? <div className="added-bars">{collectionCounts.map(([name,count],index)=><div className="added-bar-row" key={name}><span title={name}>{name}</span><div className="added-bar-track"><i style={{width:`${count/Math.max(1,...collectionCounts.map(x=>x[1]))*100}%`,background:bandColors[index%bandColors.length]}} /></div><strong>{numberFormat(count)}</strong></div>)}</div> : <div className="empty-state">No collection values are available.</div>}</article></div>
    <article className="chart-card"><div className="chart-title-row"><div><h3>Sky coverage · RA / Dec</h3><p>Each dot represents one loaded observation record with valid coordinates. This is a 2D sky-coordinate plot, not a 3D distance map.</p></div><span className="chart-mark">EQUATORIAL</span></div><div className="sky-scatter-wrap"><svg viewBox="0 0 720 300" role="img" aria-label="Right ascension and declination scatter plot"><rect x="48" y="12" width="650" height="240" rx="8" fill="#08182a" stroke="#29445e"/>{[0,1,2,3,4].map((v)=><g key={v}><line x1="48" x2="698" y1={12+v*60} y2={12+v*60} stroke="#29445e" strokeDasharray="3 5"/><text x="39" y={16+v*60} textAnchor="end" fill="#83a4bd" fontSize="10">{(90-v*45).toString()}°</text><line x1={48+v*162.5} x2={48+v*162.5} y1="12" y2="252" stroke="#29445e" strokeDasharray="3 5"/><text x={48+v*162.5} y="270" textAnchor="middle" fill="#83a4bd" fontSize="10">{(v*90).toString()}°</text></g>)}{coordinateRows.map((row,index)=><circle key={`${row.id??row.obs_id??index}-${index}`} cx={48+((Number(row.ra_deg)%360+360)%360)/360*650} cy={12+(90-Math.max(-90,Math.min(90,Number(row.dec_deg))))/180*240} r="2.4" fill={bandColors[index%bandColors.length]} opacity=".78" />)}</svg><div className="scatter-axis-labels"><span>Declination (Dec)</span><span>Right Ascension (RA)</span></div></div></article>
    <p className="page-note">Scientific scope: charts summarize the loaded API sample only. They do not infer source classes, physical distances, or survey completeness.</p>
  </section>;
}

function SmartObservationSearchWorkspace({ observations }: { observations: Observation[] }) {
  const [query,setQuery] = useState(""); const [band,setBand] = useState("all"); const [collection,setCollection] = useState("all"); const [raMin,setRaMin] = useState(""); const [raMax,setRaMax] = useState(""); const [decMin,setDecMin] = useState(""); const [decMax,setDecMax] = useState(""); const [mjdMin,setMjdMin] = useState(""); const [mjdMax,setMjdMax] = useState("");
  const [centerRa,setCenterRa] = useState(""); const [centerDec,setCenterDec] = useState(""); const [fov,setFov] = useState("");
  const [serverRows,setServerRows] = useState<Observation[] | null>(null); const [serverTotal,setServerTotal] = useState<number | null>(null); const [serverPages,setServerPages] = useState(0); const [serverPage,setServerPage] = useState(1); const [serverError,setServerError] = useState(""); const [serverLoading,setServerLoading] = useState(false);
  const bands = useMemo(()=>Array.from(new Set(observations.map(x=>x.band).filter((x): x is string=>Boolean(x))).values()).sort(),[observations]);
  const collections = useMemo(()=>Array.from(new Set(observations.map(x=>x.collection).filter((x): x is string=>Boolean(x))).values()).sort(),[observations]);
  const filtered = useMemo(()=>observations.filter(row=>{
    const text=[row.obs_id,row.id,row.collection,row.band,row.calibration_status].join(" ").toLowerCase();
    if(query.trim()&&!text.includes(query.trim().toLowerCase())) return false;
    if(band!=="all"&&row.band!==band) return false; if(collection!=="all"&&row.collection!==collection) return false;
    const within=(value:number|null|undefined,min:string,max:string)=>{if(min!==""&&(value==null||value<Number(min)))return false;if(max!==""&&(value==null||value>Number(max)))return false;return true;};
    return within(row.ra_deg,raMin,raMax)&&within(row.dec_deg,decMin,decMax)&&within(row.mjd_start,mjdMin,mjdMax);
  }),[observations,query,band,collection,raMin,raMax,decMin,decMax,mjdMin,mjdMax]);
  const runCatalogSearch=async(nextPage=1)=>{setServerLoading(true);setServerError("");try{const params=new URLSearchParams({page:String(nextPage),page_size:"50"});if(query.trim())params.set("q",query.trim());if(band!=="all")params.set("band",band);if(collection!=="all")params.set("collection",collection);for(const [key,value] of [["ra_min",raMin],["ra_max",raMax],["dec_min",decMin],["dec_max",decMax],["min_mjd",mjdMin],["max_mjd",mjdMax]] as const)if(value!=="")params.set(key,value);if(centerRa!==""||centerDec!==""||fov!==""){if(centerRa!=="")params.set("ra_deg",centerRa);if(centerDec!=="")params.set("dec_deg",centerDec);if(fov!=="")params.set("fov_deg",fov);}const response=await fetch(`${API}/api/v1/catalog/search?${params.toString()}`,{cache:"no-store"});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.detail||`Catalog search failed (${response.status})`);setServerRows(Array.isArray(payload.items)?payload.items:[]);setServerTotal(Number(payload.total)||0);setServerPages(Number(payload.pages)||0);setServerPage(Number(payload.page)||nextPage);}catch(error){setServerError(error instanceof Error?error.message:"Catalog search failed.");}finally{setServerLoading(false);}};
  const visibleRows=serverRows??filtered;const visibleTotal=serverTotal??filtered.length;
  const exportCsv=()=>{const cols:(keyof Observation)[]=["id","obs_id","collection","band","ra_deg","dec_deg","mjd_start","mjd_end","exposure_seconds","calibration_status","access_url"];const esc=(v:unknown)=>`"${String(v??"").replace(/"/g,'""')}"`;const csv=[cols.map(esc).join(","),...visibleRows.map(row=>cols.map(c=>esc(row[c])).join(","))].join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=serverRows?"xplorers_catalog_page.csv":"xplorers_filtered_observations.csv";a.click();URL.revokeObjectURL(url);};
  const reset=()=>{setQuery("");setBand("all");setCollection("all");setRaMin("");setRaMax("");setDecMin("");setDecMax("");setMjdMin("");setMjdMax("");setCenterRa("");setCenterDec("");setFov("");setServerRows(null);setServerTotal(null);setServerPages(0);setServerPage(1);setServerError("");};
  return <section className="page-section added-workspace"><div className="welcome-row"><div><div className="eyebrow"><span /> OBSERVATION DISCOVERY</div><h1>Smart <span>Search.</span></h1><p className="subtitle">Search the full local SPHEREx catalog by metadata, sky coordinates, cone FOV and observation time.</p></div><span className="date-chip">{visibleTotal.toLocaleString()} MATCHES</span></div>
    <article className="chart-card search-filter-card"><div className="search-filter-grid"><label className="search-wide">Search ID / metadata<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Observation ID, collection, status…" /></label><label>Band<select value={band} onChange={e=>setBand(e.target.value)}><option value="all">All bands</option>{bands.map(x=><option key={x}>{x}</option>)}</select></label><label>Collection<select value={collection} onChange={e=>setCollection(e.target.value)}><option value="all">All collections</option>{collections.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>RA min (°)<input type="number" min="0" max="360" value={raMin} onChange={e=>setRaMin(e.target.value)} placeholder="0" /></label><label>RA max (°)<input type="number" min="0" max="360" value={raMax} onChange={e=>setRaMax(e.target.value)} placeholder="360" /></label><label>Dec min (°)<input type="number" min="-90" max="90" value={decMin} onChange={e=>setDecMin(e.target.value)} placeholder="-90" /></label><label>Dec max (°)<input type="number" min="-90" max="90" value={decMax} onChange={e=>setDecMax(e.target.value)} placeholder="90" /></label><label>Center RA (°)<input type="number" min="0" max="360" value={centerRa} onChange={e=>setCenterRa(e.target.value)} placeholder="Optional" /></label><label>Center Dec (°)<input type="number" min="-90" max="90" value={centerDec} onChange={e=>setCenterDec(e.target.value)} placeholder="Optional" /></label><label>FOV diameter (°)<input type="number" min="0.0001" max="360" step="any" value={fov} onChange={e=>setFov(e.target.value)} placeholder="Optional" /></label><label>Start MJD min<input type="number" value={mjdMin} onChange={e=>setMjdMin(e.target.value)} placeholder="Optional" /></label><label>Start MJD max<input type="number" value={mjdMax} onChange={e=>setMjdMax(e.target.value)} placeholder="Optional" /></label></div>
      <div className="search-actions"><button type="button" className="outline-button" onClick={reset}>Reset filters</button><button type="button" className="outline-button" onClick={exportCsv} disabled={!visibleRows.length}>↓ Export current results</button><button type="button" className="primary-button" onClick={()=>void runCatalogSearch(1)} disabled={serverLoading}>{serverLoading?"Searching…":"Search full catalog"}</button></div>{serverError&&<div className="error-banner">{serverError}</div>}</article>
    <div className="section-heading lower-heading"><div><h2>Matching observations</h2><p>{serverRows?`Page ${serverPage} of ${Math.max(serverPages,1)} from the full local catalog.`:"Showing matches from the preloaded browser sample. Search full catalog to include every database row."}</p></div><span className="data-source">{visibleTotal.toLocaleString()} MATCHES</span></div><div className="data-panel"><div className="table-scroll"><div className="table-head search-results-head"><span>OBSERVATION ID</span><span>COLLECTION</span><span>BAND</span><span>RA / DEC</span><span>START MJD</span><span>EXPOSURE</span></div>{visibleRows.slice(0,150).map((row,index)=><div className="table-row search-results-head" key={row.id??row.obs_id??index}><strong>{row.obs_id??row.id??`Record ${index+1}`}</strong><span>{row.collection??"—"}</span><span>{row.band??"—"}</span><span>{formatCoordinate(row.ra_deg)} / {formatCoordinate(row.dec_deg)}</span><span>{numberFormat(row.mjd_start)}</span><span>{numberFormat(row.exposure_seconds)} s</span></div>)}{!visibleRows.length&&<div className="empty-state">No observations match this search. Try widening the filters.</div>}</div></div>
    {serverRows&&serverPages>1&&<div className="search-actions"><button type="button" className="outline-button" onClick={()=>void runCatalogSearch(serverPage-1)} disabled={serverLoading||serverPage<=1}>← Previous page</button><span className="data-source">Page {serverPage} / {serverPages}</span><button type="button" className="outline-button" onClick={()=>void runCatalogSearch(serverPage+1)} disabled={serverLoading||serverPage>=serverPages}>Next page →</button></div>}
    <p className="page-note">FOV means full angular diameter; the server searches a spherical cone with radius FOV ÷ 2. RA ranges may cross 0°. Export after a catalog search contains the current server page; without a server search it contains the loaded sample.</p>
  </section>;
}

type IrsaArchiveItem = {
  obs_publisher_did?: string;
  obs_id?: string;
  collection?: string;
  band?: string;
  ra_deg?: number | null;
  dec_deg?: number | null;
  mjd_start?: number | null;
  mjd_end?: number | null;
  calibration_level?: string;
  calibration_status?: string;
  access_url: string;
  access_format: string;
  product_access_mode: string;
  product_available: boolean;
};

type IrsaSearchMeta = {
  availability?: "MATCHES_FOUND" | "NO_MATCHES" | "UNKNOWN";
  query_status?: string;
  result_completeness?: "COMPLETE" | "CAPPED" | "NOT EVALUATED";
  count?: number;
  max_records?: number;
  pagination_supported?: boolean;
  query_strategy_note?: string;
  query_url?: string;
};

type IrsaArchiveProduct = {
  id?: number;
  sha256: string;
  obs_publisher_did?: string | null;
  obs_id?: string | null;
  collection?: string | null;
  band?: string | null;
  mjd_start?: number | null;
  filename: string;
  static_url: string;
  size_bytes: number;
  retrieved_at: string;
  source_access_url?: string;
  resolved_access_url?: string;
  quality_state: "PASS" | "WARNING" | "REJECT" | "NOT EVALUATED";
  scientific_quality_state: "PASS" | "WARNING" | "REJECT" | "NOT EVALUATED";
  validation?: { extensions?: { name: string; shape: number[] | null; unit?: string | null }[] };
};

type ScienceTargetCase = {
  id: string;
  name: string;
  catalogCoordinate: string;
  catalogEpoch: string;
  searchCenter: string;
  raDeg: string;
  decDeg: string;
  referenceUrl: string;
  coverageState: string;
  coverageSummary: string;
  cachedProducts: string[];
  pairState: string;
  targetCoordinateInProduct: string;
};

const SCIENCE_TARGET_CASES: ScienceTargetCase[] = targetCasesJson;


type ArchiveEvidenceSnapshot = {
  target_name: string | null;
  query: Record<string, string> | null;
  query_state: "NOT RUN" | "LOADING" | "COMPLETE" | "CAPPED" | "NOT EVALUATED" | "TIMEOUT" | "FAILED";
  submitted_at: string | null;
  response_received_at: string | null;
  query_url: string | null;
  query_status: string | null;
  result_completeness: string | null;
  availability: string | null;
  result_count: number;
  items: IrsaArchiveItem[];
  error: string | null;
  retrieved_products: IrsaArchiveProduct[];
  cached_products: EpochCachedProduct[];
};

const EMPTY_ARCHIVE_EVIDENCE: ArchiveEvidenceSnapshot = {
  target_name: null, query: null, query_state: "NOT RUN", submitted_at: null,
  response_received_at: null, query_url: null, query_status: null,
  result_completeness: null, availability: null, result_count: 0,
  items: [], error: null, retrieved_products: [], cached_products: [],
};

type EpochCachedProduct = {
  filename: string;
  sha256_from_filename: string;
  size_bytes: number;
  integrity_state: string;
  metadata_state: string;
  metadata_reason: string;
  metadata: Record<string, unknown> | null;
  archive_provenance: Record<string, unknown>;
};

type EpochComparisonReport = {
  schema_version?: string;
  generated_at?: string;
  quality_state?: string;
  quality_reason?: string;
  wcs_geometry_state?: string;
  inputs?: { a: Record<string, unknown>; b: Record<string, unknown> };
  footprint_comparison?: Record<string, unknown> & {
    overlap_percent_a_in_b?: number;
    overlap_percent_b_in_a?: number;
    a_to_b?: Record<string, unknown>;
    b_to_a?: Record<string, unknown>;
  };
  wcs_mapping_residuals?: { a_to_b?: Record<string, unknown>; b_to_a?: Record<string, unknown> };
  source_alignment?: Record<string, unknown>;
  eligibility_report?: {
    state?: string;
    allowed?: boolean;
    reason?: string;
    threshold_policy?: string;
    blocked_by?: string[];
    checks?: Record<string, { state?: string; reason?: string; evidence?: Record<string, unknown> }>;
  };
  scientific_differencing?: Record<string, unknown>;
  visual_comparison?: Record<string, unknown>;
};

function EpochComparisonWorkspace({ onReportChange }: { onReportChange: (report: EpochComparisonReport | null) => void }) {
  const [products, setProducts] = useState<EpochCachedProduct[]>([]);
  const [imageA, setImageA] = useState("");
  const [imageB, setImageB] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<EpochComparisonReport | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/v1/archive/cached-products`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || `Could not load cached FITS products (${response.status}).`);
        setProducts(Array.isArray(payload.items) ? payload.items as EpochCachedProduct[] : []);
      })
      .catch(caught => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Could not load cached FITS products.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingProducts(false); });
    return () => controller.abort();
  }, []);

  const selectedA = products.find(product => product.filename === imageA);
  const selectedB = products.find(product => product.filename === imageB);
  const value = (record: Record<string, unknown> | null | undefined, key: string) => {
    const current = record?.[key];
    return current === null || current === undefined || current === "" ? "NOT RECORDED" : String(current);
  };
  const productObservationId = (product: EpochCachedProduct) => {
    const headerId = value(product.metadata, "obs_id");
    return headerId === "NOT RECORDED" ? value(product.archive_provenance, "obs_id") : headerId;
  };
  const productLabel = (product: EpochCachedProduct) => {
    const obsId = productObservationId(product);
    return `${obsId === "NOT RECORDED" ? product.filename.slice(0, 16) : obsId} · ${product.filename.slice(0, 12)}`;
  };
  const clearReport = () => { setReport(null); setError(""); onReportChange(null); };
  const compare = async () => {
    if (!imageA || !imageB || imageA === imageB) return;
    setComparing(true); setError(""); clearReport();
    try {
      const response = await fetch(`${API}/api/v1/analysis/epochs/wcs-comparison`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_a: imageA, image_b: imageB }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof payload.detail === "string" ? payload.detail : `WCS comparison failed (${response.status}).`;
        throw new Error(detail);
      }
      const completed: EpochComparisonReport = {
        ...(payload as EpochComparisonReport),
        schema_version: "xplorers-epoch-comparison-1.0",
        generated_at: new Date().toISOString(),
      };
      setReport(completed);
      onReportChange(completed);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "WCS comparison failed.";
      setError(message); onReportChange(null);
    } finally {
      setComparing(false);
    }
  };
  const exportReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = "xplorers_wcs_comparison_report.json"; link.click(); URL.revokeObjectURL(url);
  };
  const formatMetric = (record: Record<string, unknown> | undefined, key: string) => {
    const val = record?.[key];
    return typeof val === "number" && Number.isFinite(val) ? val.toFixed(5) : "NOT EVALUATED";
  };
  const residual = (direction: Record<string, unknown> | undefined) =>
    direction?.wcs_mapping_affine_residual_px as Record<string, unknown> | undefined;
  const eligibility = report?.eligibility_report;

  return <section className="epoch-workspace lower-heading">
    <div className="section-heading"><div><h2>Cross-epoch WCS geometry &amp; eligibility</h2><p>Select two cached archive products for coordinate-footprint diagnostics and a fail-closed eligibility report.</p></div><span className="chart-mark">NO PIXEL DIFFERENCING</span></div>
    <article className="chart-card epoch-pair-selector">
      <label><span>IMAGE A · REFERENCE</span><select value={imageA} onChange={event => { setImageA(event.target.value); clearReport(); }} disabled={loadingProducts || products.length === 0}><option value="">Select a cached FITS product</option>{products.map(product => <option key={product.filename} value={product.filename}>{productLabel(product)}</option>)}</select></label>
      <label><span>IMAGE B · COMPARISON</span><select value={imageB} onChange={event => { setImageB(event.target.value); clearReport(); }} disabled={loadingProducts || products.length === 0}><option value="">Select a cached FITS product</option>{products.map(product => <option key={product.filename} value={product.filename}>{productLabel(product)}</option>)}</select></label>
      <button type="button" className="primary-button" onClick={() => void compare()} disabled={comparing || !imageA || !imageB || imageA === imageB}>{comparing ? "Comparing WCS…" : "Compare WCS geometry"}</button>
      {loadingProducts && <span className="fits-source-note">Reading local cached product headers…</span>}
      {!loadingProducts && products.length === 0 && <p className="page-note">No hash-named FITS products are available in the local archive cache.</p>}
      {selectedA && selectedB && <div className="epoch-selected-products">
        {[selectedA, selectedB].map((product, index) => { const checked = report?.inputs?.[index === 0 ? "a" : "b"]; return <div className="epoch-product-summary" key={product.filename}><strong>Image {index === 0 ? "A" : "B"} · {productLabel(product)}</strong><span>Observation ID: {productObservationId(product)} · Band: {value(product.archive_provenance, "band") !== "NOT RECORDED" ? value(product.archive_provenance, "band") : value(product.metadata, "band")}</span><span>Release: {value(product.archive_provenance, "release")} · Observation time: {value(product.metadata, "date_obs")} · MJD {value(product.metadata, "mjd_obs")}</span><span>Detector {value(product.metadata, "detector")} · {product.size_bytes.toLocaleString()} bytes · local hash {product.sha256_from_filename}</span><span>SHA-256 check: {String(checked?.integrity_state || product.integrity_state)} · product metadata: {product.metadata_state}</span><small>Archive source URL: {value(product.archive_provenance, "record_state") === "AVAILABLE" ? value(product.archive_provenance, "source_access_url") : "NOT RECORDED in the local product registry."} · retrieval time: {value(product.archive_provenance, "retrieved_at")}</small></div>; })}
      </div>}
      {error && <div className="error-banner" role="alert"><strong>Comparison unavailable</strong><span>{error}</span></div>}
    </article>
    {report && <>
      <div className="epoch-state-row"><div><span className="new-tag">WCS GEOMETRY DIAGNOSTICS · REPORT {report.quality_state || "NOT EVALUATED"}</span><p>{String(report.quality_reason || "The report is limited to WCS geometry; source registration and calibration compatibility are not evaluated.")} Geometry values compare coordinate transformations and are not measured source-registration residuals.</p></div><span className={`quality-chip quality-${String(report.wcs_geometry_state || "NOT EVALUATED").toLowerCase().replaceAll(" ", "-")}`}>GEOMETRY {report.wcs_geometry_state || "NOT EVALUATED"}</span></div>
      <div className="added-two-col epoch-metrics-grid">
        <article className="chart-card"><div className="chart-title-row"><div><h3>Sampled footprint overlap</h3><p>Bidirectional regular WCS pixel-grid sampling.</p></div><span className="chart-mark">GEOMETRY</span></div><div className="epoch-metric-lines"><span>A sampled inside B<strong>{typeof report.footprint_comparison?.overlap_percent_a_in_b === "number" ? `${report.footprint_comparison.overlap_percent_a_in_b.toFixed(2)}%` : "—"}</strong></span><span>B sampled inside A<strong>{typeof report.footprint_comparison?.overlap_percent_b_in_a === "number" ? `${report.footprint_comparison.overlap_percent_b_in_a.toFixed(2)}%` : "—"}</strong></span></div><p className="page-note">Overlap reports sampled footprint geometry only. It does not establish common detected sources or scientific comparability.</p></article>
        <article className="chart-card"><div className="chart-title-row"><div><h3>WCS mapping residuals</h3><p>Affine fit to WCS-derived pixel mappings, in pixels.</p></div><span className="chart-mark">NOT SOURCE MATCHES</span></div><div className="epoch-metric-lines"><span>A → B RMS / p95<strong>{formatMetric(residual(report.wcs_mapping_residuals?.a_to_b), "rms")} / {formatMetric(residual(report.wcs_mapping_residuals?.a_to_b), "p95")} px</strong></span><span>B → A RMS / p95<strong>{formatMetric(residual(report.wcs_mapping_residuals?.b_to_a), "rms")} / {formatMetric(residual(report.wcs_mapping_residuals?.b_to_a), "p95")} px</strong></span></div><p className="page-note">Empirical source-registration residual: NOT EVALUATED. {String(report.source_alignment?.reason || "No source-registration method ran.")}</p></article>
      </div>
      <div className="section-heading lower-heading"><div><h2>Scientific eligibility</h2><p>Eligibility is separate from geometric alignment. Any missing or non-passing prerequisite keeps differencing blocked.</p></div><span className={`quality-chip quality-${String(eligibility?.state || "NOT EVALUATED").toLowerCase().replaceAll(" ", "-")}`}>{eligibility?.state || "NOT EVALUATED"}</span></div>
      <div className="data-panel quality-gate-list epoch-eligibility-list">{Object.entries(eligibility?.checks || {}).map(([name, check]) => <div className="quality-gate-row" key={name}><div><strong>{name.replaceAll("_", " ").toUpperCase()}</strong><small>{check.reason || "No reason supplied."}</small>{check.evidence && <small className="epoch-check-evidence">Evidence: {JSON.stringify(check.evidence)}</small>}</div><span className={`quality-chip quality-${String(check.state || "NOT EVALUATED").toLowerCase().replaceAll(" ", "-")}`}>{check.state || "NOT EVALUATED"}</span></div>)}{!eligibility?.checks && <div className="empty-state">No eligibility report was returned.</div>}</div>
      <div className="epoch-state-row"><div><span className="new-tag">SCIENTIFIC DIFFERENCING GATE</span><p>{String((report.scientific_differencing?.reason as string | undefined) || eligibility?.reason || "No differencing eligibility has been established.")} Pixels subtracted: no.</p></div><span className={`quality-chip quality-${String(report.scientific_differencing?.quality_state || "NOT EVALUATED").toLowerCase().replaceAll(" ", "-")}`}>{String(report.scientific_differencing?.quality_state || "NOT EVALUATED")}</span></div>
      <div className="epoch-state-row"><div><span className="new-tag">VISUAL COMPARISON</span><p>{String(report.visual_comparison?.reason || "Visual rendering is not part of this WCS endpoint.")} CSS overlay, blending, and footprint overlap do not enable scientific differencing.</p></div><span className="quality-chip quality-not-evaluated">NOT EVALUATED</span></div>
      <div className="search-actions"><button className="outline-button" type="button" onClick={exportReport}>↓ Export comparison report · JSON</button></div>
      <p className="page-note">No image pixels were subtracted. Motion tracking, photometry, spectra, and change detection remain NOT EVALUATED until their separate data and validation requirements pass.</p>
    </>}
  </section>;
}

function IrsaArchiveWorkspace({
  initialTarget,
  onEvidenceChange,
}: {
  initialTarget: ScienceTargetCase | null;
  onEvidenceChange: Dispatch<SetStateAction<ArchiveEvidenceSnapshot>>;
}) {
  const [ra, setRa] = useState(() => initialTarget?.raDeg || "");
  const [dec, setDec] = useState(() => initialTarget?.decDeg || "");
  const [fov, setFov] = useState(() => initialTarget ? "0.2" : "0.1");
  const [collection, setCollection] = useState("spherex_qr3");
  const [maxMjd, setMaxMjd] = useState("");
  const [minMjd, setMinMjd] = useState("");
  const [items, setItems] = useState<IrsaArchiveItem[]>([]);
  const [searchMeta, setSearchMeta] = useState<IrsaSearchMeta | null>(null);
  const [products, setProducts] = useState<IrsaArchiveProduct[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [retrieveKey, setRetrieveKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [queryTargetName, setQueryTargetName] = useState(() => initialTarget?.name || "");

  useEffect(() => {
    let mounted = true;
    fetch(`${API}/api/v1/archive/products`, { cache: "no-store" })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error("Could not load local retrieval history.");
        if (mounted && Array.isArray(payload.items)) {
          const loaded = payload.items as IrsaArchiveProduct[];
          setProducts(loaded);
          onEvidenceChange(previous => ({ ...previous, retrieved_products: loaded }));
        }
      })
      .catch(() => { if (mounted) setProducts([]); });
    fetch(`${API}/api/v1/archive/cached-products`, { cache: "no-store" })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("Could not load the local FITS cache inventory.");
        if (mounted && Array.isArray(payload.items)) {
          const cached = payload.items as EpochCachedProduct[];
          onEvidenceChange(previous => ({ ...previous, cached_products: cached }));
        }
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, [onEvidenceChange]);

  const apiError = (payload: Record<string, unknown>, status: number) => {
    const detail = payload.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
    return `IRSA request failed (${status}).`;
  };

  const search = async () => {
    setSearchState("loading"); setError(""); setMessage(""); setItems([]); setSearchMeta(null);
    const submittedAt = new Date().toISOString();
    const query: Record<string, string> = { ra_deg: ra, dec_deg: dec, fov_deg: fov, collection, max_records: "100" };
    if (minMjd) query.min_mjd = minMjd;
    if (maxMjd) query.max_mjd = maxMjd;
    onEvidenceChange(previous => ({ ...EMPTY_ARCHIVE_EVIDENCE, target_name: queryTargetName || null, query, query_state: "LOADING", submitted_at: submittedAt, retrieved_products: previous.retrieved_products, cached_products: previous.cached_products }));
    try {
      const params = new URLSearchParams({ ra_deg: ra, dec_deg: dec, fov_deg: fov, collection, max_records: "100" });
      if (minMjd) params.set("min_mjd", minMjd);
      if (maxMjd) params.set("max_mjd", maxMjd);
      const response = await fetch(`${API}/api/v1/archive/search?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(payload, response.status));
      setItems(Array.isArray(payload.items) ? payload.items as IrsaArchiveItem[] : []);
      setSearchMeta(payload as IrsaSearchMeta);
      setSearchState("ready");
      const resultItems = Array.isArray(payload.items) ? payload.items as IrsaArchiveItem[] : [];
      const completeness = String(payload.result_completeness || "NOT EVALUATED");
      const responseReceivedAt = new Date().toISOString();
      onEvidenceChange(previous => ({
        ...previous,
        target_name: queryTargetName || null,
        query,
        query_state: completeness === "CAPPED" ? "CAPPED" : completeness === "COMPLETE" ? "COMPLETE" : "NOT EVALUATED",
        submitted_at: submittedAt,
        response_received_at: responseReceivedAt,
        query_url: typeof payload.query_url === "string" ? payload.query_url : null,
        query_status: typeof payload.query_status === "string" ? payload.query_status : null,
        result_completeness: completeness,
        availability: typeof payload.availability === "string" ? payload.availability : null,
        result_count: resultItems.length,
        items: resultItems,
        error: null,
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "IRSA search failed.";
      setError(message);
      setSearchState("error");
      onEvidenceChange(previous => ({
        ...previous,
        target_name: queryTargetName || null,
        query,
        query_state: /timeout|timed out/i.test(message) ? "TIMEOUT" : "FAILED",
        submitted_at: submittedAt,
        response_received_at: new Date().toISOString(),
        query_url: null,
        query_status: null,
        result_completeness: null,
        availability: "UNKNOWN",
        result_count: 0,
        items: [],
        error: message,
      }));
    }
  };

  const retrieve = async (item: IrsaArchiveItem) => {
    const key = item.obs_publisher_did || item.access_url;
    setRetrieveKey(key); setError(""); setMessage("");
    try {
      const response = await fetch(`${API}/api/v1/archive/products/retrieve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_url: item.access_url, access_format: item.access_format,
          obs_publisher_did: item.obs_publisher_did, obs_id: item.obs_id,
          collection: item.collection, band: item.band, mjd_start: item.mjd_start,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(payload, response.status));
      const product = payload as IrsaArchiveProduct;
      setProducts(current => [product, ...current.filter(existing => existing.sha256 !== product.sha256)]);
      onEvidenceChange(previous => ({ ...previous, retrieved_products: [product, ...previous.retrieved_products.filter(existing => existing.sha256 !== product.sha256)] }));
      setMessage(`${product.filename} retrieved and validated. Structural state: ${product.quality_state}; scientific quality: ${product.scientific_quality_state}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Product retrieval failed.");
    } finally {
      setRetrieveKey("");
    }
  };

  const structuralQuality: IrsaArchiveProduct["quality_state"] = products.length === 0
    ? "NOT EVALUATED"
    : products.some(product => product.quality_state === "REJECT")
      ? "REJECT"
      : products.some(product => product.quality_state === "WARNING")
        ? "WARNING"
        : products.every(product => product.quality_state === "PASS")
          ? "PASS"
          : "NOT EVALUATED";
  const qualityGates: { name: string; state: string; evidence: string }[] = [
    { name: "FITS structure and available checksums", state: structuralQuality, evidence: products.length ? `${products.length} retrieved product(s); this gate covers file integrity only.` : "No retrieved FITS product is available." },
    { name: "Scientific calibration and uncertainty validation", state: "NOT EVALUATED", evidence: "Requires release-specific calibration and uncertainty rules." },
    { name: "WCS validation and cross-epoch registration", state: "NOT EVALUATED", evidence: "No reference image pair or registration residuals have been validated." },
    { name: "FLAGS, PSF/ePSF, ZOD and spectral metadata interpretation", state: "NOT EVALUATED", evidence: "Exact extension inventory is exposed; official definitions and checks are still required." },
    { name: "Target identity, change, motion and light curves", state: "NOT EVALUATED", evidence: "No target detections or derived measurements are asserted by this workspace." },
    { name: "Scientific evidence dossier readiness", state: "NOT EVALUATED", evidence: "A dossier requires validated measurements, controls, and reviewable provenance." },
  ];

  return <section className="page-section added-workspace">
    <div className="welcome-row"><div><div className="eyebrow"><span /> IRSA · LIVE ARCHIVE METADATA</div><h1>IRSA <span>Archive.</span></h1><p className="subtitle">Search official SPHEREx Quick Release metadata and retrieve a selected FITS product with recorded provenance.</p></div><span className="date-chip">ON DEMAND · {collection.toUpperCase()}</span></div>
    <article className="chart-card search-filter-card"><div className="search-filter-grid">
      <label>Right ascension · degrees<input type="number" min="0" max="359.999999" step="any" value={ra} onChange={event => { setRa(event.target.value); setQueryTargetName(""); }} placeholder="Required · 0–360" /></label>
      <label>Declination · degrees<input type="number" min="-90" max="90" step="any" value={dec} onChange={event => { setDec(event.target.value); setQueryTargetName(""); }} placeholder="Required · −90–90" /></label>
      <label>FOV diameter · degrees<input type="number" min="0.000001" max="360" step="any" value={fov} onChange={event => { setFov(event.target.value); setQueryTargetName(""); }} /></label>
      <label>IRSA collection<select value={collection} onChange={event => { setCollection(event.target.value); setQueryTargetName(""); }}><option value="spherex_qr3">SPHEREx QR3 · wide</option><option value="spherex_qr3_deep">SPHEREx QR3 · deep</option><option value="spherex_dr1">SPHEREx DR1 · wide</option><option value="spherex_dr1_deep">SPHEREx DR1 · deep</option></select></label>
      <label>Start MJD · minimum<input type="number" step="any" value={minMjd} onChange={event => setMinMjd(event.target.value)} placeholder="Optional" /></label>
      <label>Start MJD · maximum<input type="number" step="any" value={maxMjd} onChange={event => setMaxMjd(event.target.value)} placeholder="Optional" /></label>
    </div><div className="search-actions"><button type="button" className="primary-button" onClick={() => void search()} disabled={searchState === "loading" || !ra || !dec || !fov}>{searchState === "loading" ? "Searching IRSA…" : "Search IRSA metadata"}</button><span className="data-source">{queryTargetName ? `TARGET PRESET · ${queryTargetName} · QUERY NOT SENT` : "FOV diameter becomes SIA cone radius = FOV ÷ 2"}</span></div>
      {error && <div className="error-banner" role="alert">{error}<span>Archive availability or product quality remains NOT EVALUATED when the request fails.</span></div>}
      {message && <div className="evidence-inventory-row"><span className="evidence-check available">✓</span><div><strong>Retrieval recorded</strong><small>{message}</small></div><span className="evidence-state">PROVENANCE SAVED</span></div>}
    </article>
    <div className="section-heading lower-heading"><div><h2>Archive search results</h2><p>{searchState === "idle" ? "No query has been sent. Results are not prefilled or simulated." : searchState === "loading" ? "Waiting for the IRSA SIA response." : searchState === "error" ? /timeout|timed out/i.test(error) ? "IRSA request timed out. This is not a zero-row result." : "The live archive request failed; no coverage conclusion is available." : `${items.length} metadata rows returned · ${searchMeta?.result_completeness || "result completeness NOT EVALUATED"}.`}</p></div><span className="data-source">{searchState === "ready" ? searchMeta?.result_completeness || "LIVE RESPONSE" : searchState === "error" ? /timeout|timed out/i.test(error) ? "TIMEOUT" : "REQUEST FAILED" : "NOT EVALUATED"}</span></div>
    {searchMeta?.result_completeness === "CAPPED" && <div className="evidence-inventory-row"><span className="evidence-check">!</span><div><strong>Returned metadata is capped</strong><small>IRSA reported QUERY_STATUS=OVERFLOW at MAXREC {searchMeta.max_records}. These rows are a lower bound, not a complete archive count. The SIA interface does not expose a page cursor.</small></div><span className="evidence-state">CAPPED</span></div>}
    <div className="data-panel"><div className="table-scroll"><div className="table-head archive-table-head"><span>OBSERVATION</span><span>COLLECTION · BAND</span><span>RA / DEC</span><span>MJD START</span><span>ACCESS PRODUCT</span><span>ACTION</span></div>
      {items.map((item, index) => <div className="table-row archive-table-head" key={`${item.obs_publisher_did || item.access_url}-${index}`}><strong>{item.obs_id || item.obs_publisher_did || "Archive row"}</strong><span>{item.collection || "—"} · {item.band || "—"}</span><span>{formatCoordinate(item.ra_deg)} / {formatCoordinate(item.dec_deg)}</span><span>{numberFormat(item.mjd_start)}</span><span title={item.access_url}>{item.product_access_mode}<small className="archive-access-format">{item.access_format}</small></span><button type="button" className="outline-button" disabled={!item.product_available || Boolean(retrieveKey)} onClick={() => void retrieve(item)}>{retrieveKey === (item.obs_publisher_did || item.access_url) ? "Retrieving…" : item.product_available ? "Retrieve FITS" : "Unavailable"}</button></div>)}
      {searchState === "ready" && items.length === 0 && searchMeta?.availability === "NO_MATCHES" && <div className="empty-state">IRSA returned QUERY_STATUS=OK with no rows for this exact collection, cone, time range, and calibration query. This result does not establish absence of archive coverage outside these constraints.</div>}
      {searchState === "ready" && items.length === 0 && searchMeta?.availability !== "NO_MATCHES" && <div className="empty-state">No rows were returned, but IRSA did not provide a complete zero-row status. Archive coverage remains NOT EVALUATED.</div>}
      {searchState === "idle" && <div className="empty-state">Enter coordinates and query the live IRSA archive to see actual metadata.</div>}
      {searchState === "error" && <div className="empty-state">No archive rows are displayed because the live query failed.</div>}
    </div></div>
    <div className="section-heading lower-heading"><div><h2>Scientific quality gate</h2><p>Integrity status is separate from astronomical validation; absent evidence stays NOT EVALUATED.</p></div><span className={`quality-chip quality-${structuralQuality.toLowerCase().replaceAll(" ", "-")}`}>{structuralQuality}</span></div>
    <div className="data-panel quality-gate-list">{qualityGates.map(gate => <div className="quality-gate-row" key={gate.name}><div><strong>{gate.name}</strong><small>{gate.evidence}</small></div><span className={`quality-chip quality-${gate.state.toLowerCase().replaceAll(" ", "-")}`}>{gate.state}</span></div>)}</div>
    <div className="section-heading lower-heading"><div><h2>Retrieved products and provenance</h2><p>Only user-requested FITS retrievals appear here. Existing local products are deduplicated by SHA-256.</p></div><span className="data-source">{products.length} RECORDED</span></div>
    <div className="data-panel file-list">{products.map(product => <div className="file-row" key={product.sha256}><span className="file-icon">FITS</span><div><strong>{product.obs_id || product.filename} · {product.quality_state}</strong><small>{product.collection || "Collection unavailable"} · {product.band || "Band unavailable"} · retrieved {new Date(product.retrieved_at).toLocaleString()} · {formatFileBytes(product.size_bytes)}</small><small>SHA-256 {product.sha256} · scientific quality {product.scientific_quality_state}</small><small>Extensions: {product.validation?.extensions?.map(extension => extension.name).join(", ") || "not reported"}</small><a className="text-link" href={`${API}${product.static_url}`} target="_blank" rel="noreferrer">Open cached FITS product ↗</a></div></div>)}{!products.length && <div className="empty-state">No archive product has been retrieved in this workspace.</div>}</div>
    <p className="page-note">SIA responses use VOTable so the standard OVERFLOW marker can distinguish capped rows from a complete zero-row result. IRSA documents MAXREC and TIME/POS constraints, but no page cursor or async job interface; this workspace does not retry automatically. For a timeout, submit one narrower cone or MJD interval at a time. Timeouts do not mean zero coverage. Metadata and product retrieval do not establish target detections or validate calibration, source registration, variability, or motion.</p>
  </section>;
}

function TargetCoverageWorkspace({ onPrepareSearch }: { onPrepareSearch: (target: ScienceTargetCase) => void }) {
  const scientificCapabilities = [
    ["IRSA SIA metadata search and bounded FITS retrieval", "IMPLEMENTED", "User-triggered live search and explicit retrieval; completeness and product integrity are reported separately."],
    ["Five required target cases and target-position coverage", "PARTIALLY IMPLEMENTED", "Catalog coordinates and local footprint checks are documented; a footprint is not a target detection."],
    ["Temporal display and playback of target images", "PARTIALLY IMPLEMENTED", "The existing overview timeline uses catalog metadata; no validated target-image sequence or scientifically eligible playback is available."],
    ["WCS footprint geometry and comparison eligibility", "IMPLEMENTED", "Real cached products have WCS diagnostics and explicit eligibility reasons. WCS mapping residuals are not source-registration measurements."],
    ["Compare Like-with-Like", "PARTIALLY IMPLEMENTED", "A transparent fail-closed pair report exists; calibration and other prerequisites remain unevaluated for current pairs."],
    ["Quality Gate and evidence dossier", "PARTIALLY IMPLEMENTED", "Integrity and pair eligibility are represented. This session dossier records query results and products, but the scientific evidence is not complete."],
    ["What Changed, Motion Tracking, Light Curves, Reference-Star Control, Change Atlas", "NOT EVALUATED", "No scientifically valid compatible multi-epoch source measurements or calibrated change products are available."],
    ["Compass Coverage and Spectral Explorer", "NOT EVALUATED", "A target coverage map and calibrated spectral WCS products have not been validated."],
  ] as const;

  return <section className="page-section added-workspace">
    <div className="welcome-row"><div><div className="eyebrow"><span /> REQUIRED SCIENCE CASES · REAL ARCHIVE STATUS</div><h1>Target <span>Coverage.</span></h1><p className="subtitle">Five required SPHEREx cases, with archive metadata kept separate from target detections and scientific measurements.</p></div><span className="quality-chip quality-reject">NOT READY FOR JUDGING</span></div>
    <div className="epoch-state-row"><div><span className="new-tag">COORDINATE AND QUERY METHOD</span><p>Catalog positions are linked to SIMBAD and documented as ICRS/J2000.0. Search centers use the documented linear proper-motion propagation to epoch 2025.0; it omits parallax, radial velocity, and observation-specific propagation. The prepared IRSA query uses a 0.2° FOV diameter (0.1° radius), QR3 wide, and is sent only after you press Search. This query center is not a source measurement.</p></div><span className="quality-chip quality-warning">APPROXIMATE QUERY CENTER</span></div>
    <div className="added-two-col">
      {SCIENCE_TARGET_CASES.map(target => <article className="chart-card" key={target.id}>
        <div className="chart-title-row"><div><h2>{target.name}</h2><p>{target.coverageState}</p></div><span className={`quality-chip ${target.id === "wise0855" ? "quality-warning" : "quality-not-evaluated"}`}>{target.id === "wise0855" ? "COVERAGE UNRESOLVED" : "METADATA ≠ DETECTION"}</span></div>
        <div className="fits-detail-grid"><span>Catalog coordinate<strong>{target.catalogCoordinate}</strong></span><span>Catalog epoch<strong>{target.catalogEpoch}</strong></span><span>Prepared search center<strong>{target.searchCenter}</strong></span><span>Multi-epoch status<strong>{target.pairState}</strong></span></div>
        <p className="page-note">{target.coverageSummary}</p>
        <div className="quality-gate-list data-panel">{target.cachedProducts.length ? target.cachedProducts.map(product => <div className="quality-gate-row" key={product}><div><strong>Verified cached QR3 product</strong><small>{product}</small></div><span className="quality-chip quality-warning">FITS WARNING</span></div>) : <div className="quality-gate-row"><div><strong>Locally verified product</strong><small>None. A prior zero-row result is limited to its specific query; other searches timed out.</small></div><span className="quality-chip quality-not-evaluated">NOT EVALUATED</span></div>}</div>
        <p className="page-note">{target.targetCoordinateInProduct} Source coordinates: <a className="text-link" href={target.referenceUrl} target="_blank" rel="noreferrer">SIMBAD catalog entry ↗</a></p>
        <div className="search-actions"><button className="outline-button" type="button" onClick={() => onPrepareSearch(target)}>Prepare user-triggered IRSA search ↗</button></div>
      </article>)}
    </div>
    <div className="section-heading lower-heading"><div><h2>Scientific feature status</h2><p>Statuses reflect implemented application behavior and retained evidence. Missing prerequisites remain NOT EVALUATED.</p></div></div>
    <div className="data-panel quality-gate-list">{scientificCapabilities.map(([name, state, reason]) => <div className="quality-gate-row" key={name}><div><strong>{name}</strong><small>{reason}</small></div><span className={`quality-chip quality-${state.toLowerCase().replaceAll(" ", "-")}`}>{state}</span></div>)}</div>
    <p className="page-note">Coverage counts and dates are bounded SIA metadata samples from the retained archive validation record, not complete histories. WISE 0855 remains unresolved because the alternative queries timed out; timeout is not treated as absence. See the full query log, IDs, product provenance, and limitations in the linked validation record documented in README_WINDOWS.md.</p>
  </section>;
}

function ExplainableAIWorkspace({ clusterResult, anomalyResult, observations }: { clusterResult: ObservationClusters | null; anomalyResult: Record<string, unknown> | null; observations: Observation[] }) {
  const clusterItems = clusterResult?.clusters ?? [];
  const anomalies = Array.isArray(anomalyResult?.anomalies) ? anomalyResult.anomalies as Record<string,unknown>[] : [];
  const report = { title:"XPLORERS Explainable AI Summary", generated_at:new Date().toISOString(), scope:{loaded_observation_sample:observations.length, clustering_records_used:clusterResult?.records_used??0, anomaly_result_available:Boolean(anomalyResult)}, clustering:clusterResult?{model:clusterResult.model,learning_type:clusterResult.learning_type,cluster_count:clusterResult.cluster_count,features_used:clusterResult.features_used,clusters:clusterResult.clusters,interpretation_note:clusterResult.interpretation_note,limitations:clusterResult.limitations}:null, anomaly_detection:anomalyResult?{model:anomalyResult.model,learning_type:anomalyResult.learning_type,total_tiles_analyzed:anomalyResult.total_tiles_analyzed,anomalous_tiles_detected:anomalyResult.anomalous_tiles_detected,score_note:anomalyResult.score_note,explanation_note:anomalyResult.explanation_note,scientific_limitations:anomalyResult.scientific_limitations,top_anomalies:anomalies.slice(0,30)}:null, caution:"Unsupervised clusters and anomaly scores are exploratory signals. They do not establish astrophysical object classes or discoveries." };
  const download=()=>{const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="xplorers_explainable_ai_report.json";a.click();URL.revokeObjectURL(url);};
  return <section className="page-section added-workspace"><div className="welcome-row"><div><div className="eyebrow"><span /> MODEL INTERPRETATION · EVIDENCE</div><h1>Explainable <span>AI.</span></h1><p className="subtitle">Review what the current unsupervised models used, what they returned, and what their outputs do not prove.</p></div><button type="button" className="primary-button" onClick={download}>↓ Export AI explanation · JSON</button></div>
    <div className="added-two-col"><article className="chart-card explain-card"><span className="new-tag">CLUSTERING · K-MEANS</span><h2>Why these groups?</h2>{clusterResult?<><div className="explain-metric"><strong>{clusterResult.cluster_count}</strong><span>groups generated from {numberFormat(clusterResult.records_used)} usable records</span></div><p><b>Features supplied to the model</b></p><div className="feature-chips">{clusterResult.features_used.map(x=><span key={x}>{x}</span>)}</div><p>{clusterResult.interpretation_note}</p><p className="page-note">{clusterResult.limitations}</p><div className="explain-cluster-list">{clusterItems.map(item=><div key={item.cluster_id}><span>Cluster {item.cluster_id+1}</span><strong>{numberFormat(item.observation_count)} records</strong><small>Median RA {formatCoordinate(item.median_ra_deg)} · Dec {formatCoordinate(item.median_dec_deg)} · Exposure {numberFormat(item.median_exposure_seconds)} s</small></div>)}</div></>:<div className="empty-state">No clustering result is loaded yet. Open AI Analysis and run clustering to populate this explanation.</div>}</article>
    <article className="chart-card explain-card"><span className="new-tag">ANOMALY DETECTION · ISOLATION FOREST</span><h2>How to read unusual tiles</h2>{anomalyResult?<><div className="explain-metric"><strong>{numberFormat(Number(anomalyResult.anomalous_tiles_detected)||0)}</strong><span>anomalous tiles reported by the current run</span></div><div className="feature-chips"><span>Tile size: {String(anomalyResult.tile_size??"—")} px</span><span>Contamination: {String(anomalyResult.contamination??"—")}</span><span>Model: {String(anomalyResult.model??"IsolationForest")}</span></div>{typeof anomalyResult.score_note==="string"&&<p>{anomalyResult.score_note}</p>}{typeof anomalyResult.explanation_note==="string"&&<p>{anomalyResult.explanation_note}</p>}{typeof anomalyResult.scientific_limitations==="string"&&<p className="page-note">{anomalyResult.scientific_limitations}</p>}<p><b>Returned candidate tiles:</b> {anomalies.length}</p></>:<div className="empty-state">No anomaly result is loaded yet. Run anomaly detection in AI Analysis to explain its current output.</div>}</article></div>
    <article className="chart-card explain-caution"><span className="new-tag">SCIENTIFIC INTERPRETATION RULES</span><h2>What AI can and cannot conclude</h2><ul><li>Clustering groups records by the numerical features supplied to the model; a cluster is not automatically a physical object class.</li><li>Anomaly detection flags records or image tiles that differ from the model&apos;s learned pattern; an unusual score is not proof of a transient or new discovery.</li><li>Model results depend on the selected data sample, preprocessing, parameters and coverage.</li><li>Review candidate results against calibrated imagery, metadata, instrument effects and independent scientific evidence before making claims.</li></ul><p className="page-note">The exported report contains the analysis outputs currently held in this browser session. Missing model results are reported as unavailable, not invented.</p></article>
  </section>;
}

function Home() {
  const [active, setActive] = useState("Overview");
  const [health, setHealth] = useState("Connecting");
  const [readinessCheck, setReadinessCheck] = useState<"idle" | "checking" | "passed" | "failed">("idle");
  const [readinessMessage, setReadinessMessage] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [images, setImages] = useState<ScientificImage[]>([]);
  const [imageSearch, setImageSearch] = useState("");
  const [selectedPreview, setSelectedPreview] = useState<ScientificImage | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [imagesError, setImagesError] = useState("");
  const [selectedFitsName, setSelectedFitsName] = useState("");
  const [fitsAnalysis, setFitsAnalysis] = useState<FitsAnalysis | null>(null);
  const [epochComparisonReport, setEpochComparisonReport] = useState<EpochComparisonReport | null>(null);
  const [archiveEvidence, setArchiveEvidence] = useState<ArchiveEvidenceSnapshot>(EMPTY_ARCHIVE_EVIDENCE);
  const [targetQueryPreset, setTargetQueryPreset] = useState<ScienceTargetCase | null>(null);
  const [selectedTargetCase, setSelectedTargetCase] = useState<ScienceTargetCase | null>(null);
  const [fitsLoading, setFitsLoading] = useState(false);
  const [fitsError, setFitsError] = useState("");
  const [pixelAnalysis, setPixelAnalysis] = useState<PixelAnalysis | null>(null);
  const [pixelLoading, setPixelLoading] = useState(false);
  const [pixelError, setPixelError] = useState("");
  const [roiBounds, setRoiBounds] = useState({ x1: 900, y1: 900, x2: 1100, y2: 1100 });
  const [roiAnalysis, setRoiAnalysis] = useState<RoiAnalysis | null>(null);
  const [roiLoading, setRoiLoading] = useState(false);
  const [roiError, setRoiError] = useState("");
  const [comparisonLeft, setComparisonLeft] = useState("");
  const [comparisonRight, setComparisonRight] = useState("");
  const [comparisonZoom, setComparisonZoom] = useState(1);
  const [comparisonWipe, setComparisonWipe] = useState(50);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [comparisonMode, setComparisonMode] = useState<"side-by-side" | "overlay" | "wipe" | "difference">("side-by-side");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [clusterCount, setClusterCount] = useState(4);
  const [clusterResult, setClusterResult] = useState<ObservationClusters | null>(null);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [clusterError, setClusterError] = useState("");

  const [anomalyTileSize, setAnomalyTileSize] = useState(64);
  const [anomalyContamination, setAnomalyContamination] = useState(0.03);
  const [anomalyResult, setAnomalyResult] = useState<Record<string, unknown> | null>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyError, setAnomalyError] = useState("");

  const runFitsAnomalyDetection = async () => {
    const fitsName = availableFits[0]?.name;
    if (!fitsName) {
      setAnomalyError("No FITS image is currently available.");
      return;
    }
    setAnomalyLoading(true);
    setAnomalyError("");
    setAnomalyResult(null);
    try {
      const params = new URLSearchParams({
        tile_size: String(anomalyTileSize),
        contamination: String(anomalyContamination),
        max_results: "30",
      });
      const response = await fetch(
        `${API}/api/v1/ai/anomaly/${encodeURIComponent(fitsName)}?${params.toString()}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Anomaly detection failed (${response.status})`);
      setAnomalyResult(payload as Record<string, unknown>);
    } catch (err) {
      setAnomalyError(err instanceof Error ? err.message : "Could not run anomaly detection.");
    } finally {
      setAnomalyLoading(false);
    }
  };

  // Interactive 3D Universe controls
  const [universeBand, setUniverseBand] = useState("All bands");
  const [universeCollection, setUniverseCollection] = useState("All collections");
  const [universeSearch, setUniverseSearch] = useState("");
  const [universeSelected, setUniverseSelected] = useState<Observation | null>(null);
  const [universeRotation, setUniverseRotation] = useState({ x: -12, y: 18 });
  const [universeZoom, setUniverseZoom] = useState(1);
  const [universeAutoRotate, setUniverseAutoRotate] = useState(false);

  const universeBands = useMemo(
    () => Array.from(new Set(observations.map((item) => item.band).filter((value): value is string => Boolean(value)))).sort(),
    [observations],
  );
  const universeCollections = useMemo(
    () => Array.from(new Set(observations.map((item) => item.collection).filter((value): value is string => Boolean(value)))).sort(),
    [observations],
  );
  const universeRows = useMemo(() => {
    const term = universeSearch.trim().toLowerCase();
    return observations.filter((item) => {
      const bandMatch = universeBand === "All bands" || item.band === universeBand;
      const collectionMatch = universeCollection === "All collections" || item.collection === universeCollection;
      const searchMatch = !term || [item.obs_id, item.collection, item.band]
        .some((value) => value?.toLowerCase().includes(term));
      return bandMatch && collectionMatch && searchMatch &&
        typeof item.ra_deg === "number" && Number.isFinite(item.ra_deg) &&
        typeof item.dec_deg === "number" && Number.isFinite(item.dec_deg);
    }).slice(0, 500);
  }, [observations, universeBand, universeCollection, universeSearch]);

  const universePointPosition = (item: Observation) => {
    const ra = (((item.ra_deg ?? 0) % 360) + 360) % 360;
    const dec = Math.max(-90, Math.min(90, item.dec_deg ?? 0));
    const x = 50 + (ra / 360 - 0.5) * 86;
    const y = 50 - (dec / 180) * 86;
    return { left: `${x}%`, top: `${y}%` };
  };


  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const healthResponse = await fetch(`${API}/health`, { signal });
      if (!healthResponse.ok) throw new Error(`Backend health check failed (${healthResponse.status})`);

      const [summaryResponse, observationsResponse, imagesResponse] = await Promise.all([
        fetch(`${API}/api/v1/metadata/summary`, { signal }),
        fetch(`${API}/api/v1/observations?limit=500`, { signal }),
        fetch(`${API}/api/v1/images`, { signal }),
      ]);

      if (!summaryResponse.ok) {
        throw new Error(`Could not load metadata summary (${summaryResponse.status})`);
      }
      if (!observationsResponse.ok) {
        throw new Error(`Could not load observations (${observationsResponse.status})`);
      }
      if (!imagesResponse.ok) {
        throw new Error(`Could not load images (${imagesResponse.status})`);
      }

      const [summaryData, observationsData, imagesData] = await Promise.all([
        summaryResponse.json(),
        observationsResponse.json(),
        imagesResponse.json(),
      ]);

      setSummary(summaryData as Summary);
      setObservations(extractRows(observationsData));
      const returnedImages = Array.isArray(imagesData?.images) ? imagesData.images : [];
      setImages(returnedImages as ScientificImage[]);
      setImagesError("");
      setHealth("Connected");
      setError("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setHealth("Offline");
      const message = err instanceof Error ? err.message : "Could not connect to backend";
      setError(message);
      setImagesError(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
  const controller = new AbortController();

  const timer = window.setTimeout(() => {
    void loadData(controller.signal);
  }, 0);

  return () => {
    window.clearTimeout(timer);
    controller.abort();
  };
}, [loadData, refreshKey]);

  const runReadinessCheck = async () => {
    setReadinessCheck("checking");
    setReadinessMessage("");
    try {
      const response = await fetch(`${API}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
      const payload = await response.json();
      setReadinessCheck("passed");
      setReadinessMessage(`Backend responded successfully${payload?.status ? ` · status: ${payload.status}` : ""}.`);
    } catch (error) {
      setReadinessCheck("failed");
      setReadinessMessage(error instanceof Error ? error.message : "Unable to reach the backend health endpoint.");
    }
  };

  const availableFits = images.filter((image) =>
    [".fits", ".fit"].includes(image.format.toLowerCase()),
  );
  const activeFitsName = selectedFitsName || availableFits[0]?.name || "";

  useEffect(() => {
    if (active !== "Scientific Analysis" || !activeFitsName) return;
    if (LOW_MEMORY_MODE) {
      setFitsAnalysis(null);
      setFitsLoading(false);
      setFitsError(
        "NOT EVALUATED: Full-image FITS statistics are disabled in the configured 512 MB low-memory deployment.",
      );
      return;
    }
    const controller = new AbortController();

    async function loadFitsAnalysis() {
      setFitsLoading(true);
      setFitsError("");
      setFitsAnalysis(null);
      try {
        const response = await fetch(
          `${API}/api/v1/analysis/fits/${encodeURIComponent(activeFitsName)}`,
          { signal: controller.signal },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.detail || `FITS analysis failed (${response.status})`);
        }
        setFitsAnalysis(payload as FitsAnalysis);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setFitsError(err instanceof Error ? err.message : "Could not analyze FITS file");
      } finally {
        if (!controller.signal.aborted) setFitsLoading(false);
      }
    }

    void loadFitsAnalysis();
    return () => controller.abort();
  }, [active, activeFitsName]);

  const collections = summary?.collections ?? [];
  const bands = summary?.bands ?? [];
  const previewImages = images.filter((image) =>
    [".png", ".jpg", ".jpeg", ".webp"].includes(image.format.toLowerCase()),
  );
  const filteredPreviewImages = previewImages.filter((image) =>
    image.name.toLowerCase().includes(imageSearch.trim().toLowerCase()),
  );
  const fitsFiles = images.filter((image) => image.format.toLowerCase() === ".fits");
  const selectedLeftImage = previewImages.find((image) => image.name === comparisonLeft) ?? previewImages[0];
  const selectedRightImage = previewImages.find((image) => image.name === comparisonRight) ?? previewImages[1] ?? previewImages[0];
  const imageUrl = (image: ScientificImage) => `${API}${image.url}`;
  const sciencePreview =
    previewImages.find((image) => image.name.toLowerCase().includes("science_preview")) ??
    previewImages.find((image) => image.name.toLowerCase().includes("preview")) ??
    previewImages[0];

  const handleScienceImageClick = async (event: MouseEvent<HTMLImageElement>) => {
    const imageElement = event.currentTarget;
    const bounds = imageElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !imageElement.naturalWidth || !imageElement.naturalHeight) {
      setPixelError("The science preview image is not ready yet. Please try again.");
      return;
    }

    const x = Math.max(0, Math.min(
      imageElement.naturalWidth - 1,
      Math.floor(((event.clientX - bounds.left) / bounds.width) * imageElement.naturalWidth),
    ));
    const y = Math.max(0, Math.min(
      imageElement.naturalHeight - 1,
      Math.floor(((event.clientY - bounds.top) / bounds.height) * imageElement.naturalHeight),
    ));

    setPixelLoading(true);
    setPixelError("");
    setPixelAnalysis(null);
    try {
      const response = await fetch(
        `${API}/api/v1/analysis/pixel/${encodeURIComponent(activeFitsName)}?x=${x}&y=${y}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `Pixel analysis failed (${response.status})`);
      }
      setPixelAnalysis(payload as PixelAnalysis);
    } catch (err) {
      setPixelError(err instanceof Error ? err.message : "Could not read this pixel.");
    } finally {
      setPixelLoading(false);
    }
  };

  const handleRoiAnalysis = async () => {
    if (!activeFitsName) return;
    setRoiLoading(true);
    setRoiError("");
    setRoiAnalysis(null);
    try {
      const params = new URLSearchParams({
        x1: String(roiBounds.x1), y1: String(roiBounds.y1),
        x2: String(roiBounds.x2), y2: String(roiBounds.y2),
      });
      const response = await fetch(
        `${API}/api/v1/analysis/roi/${encodeURIComponent(activeFitsName)}?${params.toString()}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Region analysis failed (${response.status})`);
      setRoiAnalysis(payload as RoiAnalysis);
    } catch (err) {
      setRoiError(err instanceof Error ? err.message : "Could not analyze the selected region.");
    } finally {
      setRoiLoading(false);
    }
  };


  const runObservationClustering = async () => {
    setClusterLoading(true);
    setClusterError("");
    setClusterResult(null);
    try {
      const response = await fetch(
        `${API}/api/v1/ai/observation-clusters?clusters=${clusterCount}&max_records=10000`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `Clustering failed (${response.status})`);
      }
      setClusterResult(payload as ObservationClusters);
    } catch (err) {
      setClusterError(err instanceof Error ? err.message : "Could not run observation clustering.");
    } finally {
      setClusterLoading(false);
    }
  };

  const formatBytes = (bytes: number) => bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  const timeline = useMemo(() => {
    const sorted = observations
      .filter((item) => item.mjd_start != null && Number.isFinite(Number(item.mjd_start)))
      .slice()
      .sort((a, b) => Number(a.mjd_start) - Number(b.mjd_start));

    if (sorted.length <= 18) return sorted;
    const step = (sorted.length - 1) / 17;
    return Array.from({ length: 18 }, (_, index) => sorted[Math.round(index * step)]);
  }, [observations]);

  const maxCollection = Math.max(1, ...collections.map((item) => Number(item.rows) || 0));
  const maxBand = Math.max(1, ...bands.map((item) => Number(item.rows) || 0));
  const maxExposure = Math.max(1, ...timeline.map((item) => Number(item.exposure_seconds) || 0));

  const stats = [
    {
      label: "Total Observations",
      value: numberFormat(summary?.total_rows),
      icon: "◈",
      note: "Total database records",
    },
    {
      label: "Sky Collections",
      value: numberFormat(collections.length || (summary ? 0 : null)),
      icon: "✧",
      note: "Connected SPHEREx collections",
    },
    {
      label: "Available Bands",
      value: numberFormat(bands.length || (summary ? 0 : null)),
      icon: "◉",
      note: "Spectral band groups",
    },
    {
      label: "Unique Observation IDs",
      value: numberFormat(summary?.unique_obs_ids),
      icon: "⌘",
      note: "Distinct observation identifiers",
    },
  ];

  const downloadReportFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportEvidenceJson = () => {
    const selectedTarget = archiveEvidence.query
      ? SCIENCE_TARGET_CASES.find(target => target.name === archiveEvidence.target_name) || null
      : selectedTargetCase;
    const report = {
      schema_version: "xplorers-evidence-dossier-1.1",
      report_title: "XPLORERS Scientific Evidence Report",
      generated_at: new Date().toISOString(),
      platform: "XPLORERS",
      software: { frontend: "Next.js", backend: "FastAPI", report_schema: "xplorers-evidence-dossier-1.1" },
      backend_status: health,
      database_summary: summary,
      selected_target_case: selectedTarget,
      archive_search_session: archiveEvidence,
      archive_products_in_local_registry: archiveEvidence.retrieved_products,
      cached_product_inventory: archiveEvidence.cached_products,
      observation_sample: observations,
      image_assets: images,
      fits_analysis: fitsAnalysis,
      epoch_wcs_comparison: epochComparisonReport,
      roi_analysis: roiAnalysis,
      pixel_analysis: pixelAnalysis,
      clustering_analysis: clusterResult,
      anomaly_detection: anomalyResult,
      scientific_quality_state: "NOT EVALUATED",
      scientific_limitations: [
        "Archive footprint metadata does not establish a target detection.",
        "WCS geometry diagnostics are not empirical source-registration measurements.",
        "Motion, photometry, spectra, light curves, and scientific change detection remain NOT EVALUATED unless explicitly supported by a validated result in this report.",
        "A request timeout is not evidence of zero archive coverage.",
        "Any target search center propagated linearly to epoch 2025.0 omits parallax, radial velocity, and observation-specific propagation.",
      ],
      scientific_note: "This report contains data currently available in this browser session. The archive query is not persisted to the project database; export this dossier to retain its parameters, response or error, and products for the session.",
    };
    downloadReportFile("xplorers_scientific_evidence.json", JSON.stringify(report, null, 2), "application/json");
  };

  const exportObservationsCsv = () => {
    const columns: (keyof Observation)[] = [
      "id", "obs_id", "collection", "band", "ra_deg", "dec_deg",
      "mjd_start", "mjd_end", "exposure_seconds", "calibration_status", "access_url",
    ];
    const escapeCsv = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [
      columns.map(escapeCsv).join(","),
      ...observations.map((item) => columns.map((column) => escapeCsv(item[column])).join(",")),
    ];
    downloadReportFile("xplorers_observation_sample.csv", rows.join("\r\n"), "text/csv;charset=utf-8");
  };

  const printEvidenceReport = () => {
    window.print();
  };

  return (
    <main className="x-shell">
      <div className="cosmic-backdrop" aria-hidden="true">
        <div className="cosmic-nebula cosmic-nebula-one" />
        <div className="cosmic-nebula cosmic-nebula-two" />
        <InteractivePlanet />
      </div>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">✧</div>
          <div className="brand-copy">
            <strong>XPLORERS<span>.</span></strong>
            <small>ASTRONOMY INTELLIGENCE</small>
          </div>
        </div>

        <div className="workspace">
          <span className="workspace-dot" />
          SCIENCE WORKSPACE
          <span className="workspace-arrow">⌄</span>
        </div>

        <div className="nav-label">PLATFORM</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.name}
              onClick={() => setActive(item.name)}
              className={`nav-item ${active === item.name ? "selected" : ""}`}
              type="button"
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-text">{item.name}</span>
              {item.name === "AI Analysis" && <span className="new-tag">AI</span>}
            </button>
          ))}
        </nav>

        <div className="nav-label second-label">WORKSPACE</div>
        <button
          className={`nav-item ${active === "Scientific Evidence" ? "selected" : ""}`}
          onClick={() => setActive("Scientific Evidence")}
          type="button"
        >
          <span className="nav-icon">▤</span><span className="nav-text">Scientific Evidence</span>
        </button>
        <button
          className={`nav-item ${active === "Mission Readiness" ? "selected" : ""}`}
          onClick={() => setActive("Mission Readiness")}
          type="button"
        >
          <span className="nav-icon">✦</span><span className="nav-text">Mission Readiness</span>
        </button>
        <button
          className={`nav-item ${active === "Settings" ? "selected" : ""}`}
          onClick={() => setActive("Settings")}
          type="button"
        >
          <span className="nav-icon">⚙</span><span className="nav-text">Settings</span>
        </button>

        <div className="sidebar-bottom">
          <div className="status-line">
            <span className={`status-dot ${health === "Connected" ? "online" : ""}`} />
            <span>Backend {health}</span>
          </div>
          <div className="profile">
            <div className="avatar">X</div>
            <div><strong>Research Workspace</strong><small>SPHEREx Project</small></div>
          </div>
          <div className="version">XPLORERS · RESEARCH PLATFORM</div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> {active}</div>
          <div className="top-actions">
            <span className="live-indicator"><i /> LIVE SYSTEM</span>
            <button className="icon-button" aria-label="Notifications" type="button">♧</button>
            <div className="top-avatar">X</div>
          </div>
        </header>

        <div className="content">
          {EPHEMERAL_STORAGE_MODE && (
            <div className="error-banner" role="status">
              <strong>Render Free storage is temporary</strong>
              <span>The catalog is re-imported from the public CSV when the backend starts. Downloaded FITS products and their local cache records can disappear after spin-down, restart, or redeploy. “Cached” means currently present on this running service; availability is not guaranteed.</span>
            </div>
          )}
          {LOW_MEMORY_MODE && (
            <div className="error-banner" role="status">
              <strong>512 MB low-memory safeguards are active</strong>
              <span>Full-image FITS summaries, anomaly analysis, and observation clustering are disabled and remain NOT EVALUATED. Pixel, region, archive, and WCS requests may still need temporary cached products and can be constrained by available memory.</span>
            </div>
          )}
          {active === "Overview" ? (
          <>
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><span /> SPACE DATA INTELLIGENCE</div>
              <h1>Explore the <span>Unknown.</span></h1>
              <p className="subtitle">
                Discover, visualize and analyze the universe through intelligent astronomical data.
              </p>
            </div>
            <div className="date-chip">✧ &nbsp; SPHEREx MISSION</div>
          </div>

          <section className="hero-panel">
            <div className="hero-glow" />
            <div className="hero-content">
              <div className="hero-tag">✦ YOUR UNIVERSE. YOUR DISCOVERY.</div>
              <h2>See beyond<br />what we know.</h2>
              <p>
                Explore astronomical observations, compare scientific images
                and uncover patterns with AI-powered analysis.
              </p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => setActive("3D Universe")} type="button">
                  Enter the Universe <span>↗</span>
                </button>
                <button className="hero-secondary-button" onClick={() => setActive("Image Explorer")} type="button">
                  Explore scientific images <span>→</span>
                </button>
              </div>
            </div>
            <div className="orbit-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orbit orbit-three" />
              <div className="planet"><div /></div>
              <span className="orbit-star star-a">✦</span>
              <span className="orbit-star star-b">✧</span>
              <span className="orbit-star star-c">·</span>
            </div>
            <div className="hero-caption">OBSERVE <span>·</span> COMPARE <span>·</span> DISCOVER</div>
          </section>

          <section className="discovery-launchpad" aria-label="Explore XPLORERS tools">
            <div className="launchpad-heading">
              <div>
                <div className="eyebrow"><span /> YOUR NEXT DISCOVERY STARTS HERE</div>
                <h2>Choose your <span>exploration.</span></h2>
                <p>Jump straight into the tools that turn SPHEREx observations into scientific insight.</p>
              </div>
              <span className="launchpad-hint">SELECT A MISSION <b>↘</b></span>
            </div>
            <div className="launchpad-grid">
              <button className="launch-card launch-card-featured" type="button" onClick={() => setActive("3D Universe")}>
                <span className="launch-card-icon">◎</span>
                <span className="launch-card-kicker">01 · MAP THE SKY</span>
                <strong>3D Universe</strong>
                <small>Navigate sky positions, filter spectral bands and inspect observations.</small>
                <span className="launch-card-link">Enter universe <b>↗</b></span>
                <span className="launch-card-art launch-art-globe" aria-hidden="true"><i /><i /><i /></span>
              </button>
              <button className="launch-card" type="button" onClick={() => setActive("Image Explorer")}>
                <span className="launch-card-icon">▧</span>
                <span className="launch-card-kicker">02 · SEE THE DATA</span>
                <strong>Image Explorer</strong>
                <small>Open scientific imagery and investigate pixel-level information.</small>
                <span className="launch-card-link">Explore images <b>↗</b></span>
                <span className="launch-card-art launch-art-image" aria-hidden="true">✦</span>
              </button>
              <button className="launch-card" type="button" onClick={() => setActive("Comparison Lab")}>
                <span className="launch-card-icon">⇄</span>
                <span className="launch-card-kicker">03 · FIND DIFFERENCES</span>
                <strong>Comparison Lab</strong>
                <small>Compare available scientific image previews side by side.</small>
                <span className="launch-card-link">Compare images <b>↗</b></span>
                <span className="launch-card-art launch-art-compare" aria-hidden="true"><i /><i /></span>
              </button>
              <button className="launch-card" type="button" onClick={() => setActive("AI Analysis")}>
                <span className="launch-card-icon">⌘</span>
                <span className="launch-card-kicker">04 · REVEAL PATTERNS</span>
                <strong>AI Analysis</strong>
                <small>Explore clustering and anomaly-detection results from the dataset.</small>
                <span className="launch-card-link">Run AI analysis <b>↗</b></span>
                <span className="launch-card-art launch-art-ai" aria-hidden="true"><i /><i /><i /><i /></span>
              </button>
            </div>
          </section>

          <div className="section-heading">
            <div><h2>Mission Overview</h2><p>Your scientific workspace at a glance.</p></div>
            <div className="heading-actions">
              <span className={`data-source ${health === "Connected" ? "" : "source-offline"}`}>
                {health === "Connected" ? "LIVE DATA CONNECTION" : `BACKEND ${health.toUpperCase()}`}
              </span>
              <button className="refresh-button" onClick={() => setRefreshKey((value) => value + 1)} type="button" disabled={loading}>
                {loading ? "Loading…" : "↻ Refresh"}
              </button>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <strong>Connection issue:</strong> {error}
              <span>Check that the FastAPI backend is running at {API}.</span>
            </div>
          )}

          <div className="stats-grid">
            {stats.map((stat, index) => (
              <div className="stat-card" key={stat.label}>
                <div className="stat-top">
                  <span>{stat.label}</span>
                  <span className={`stat-icon color-${index}`}>{stat.icon}</span>
                </div>
                <div className="stat-value">{loading && !summary ? "…" : stat.value}</div>
                <div className="stat-foot">{stat.note}</div>
              </div>
            ))}
          </div>

          <section className="mission-strip" aria-label="Live mission data summary">
            <div className="mission-strip-copy">
              <span className="mission-pulse" />
              <div><strong>Mission data is within reach.</strong><small>Use the live database to move from sky coordinates to image-level investigation.</small></div>
            </div>
            <button type="button" onClick={() => setActive("Scientific Analysis")}>Open scientific workspace <b>↗</b></button>
          </section>

          <div className="section-heading lower-heading">
            <div><h2>Scientific Data Analytics</h2><p>Charts generated from the connected SPHEREx database.</p></div>
            <span className="data-source">DATABASE-DRIVEN VISUALS</span>
          </div>

          <section className="charts-grid" aria-label="Scientific data charts">
            <div className="chart-card">
              <div className="chart-title-row">
                <div><h3>Collections Distribution</h3><p>Observation records by collection</p></div>
                <span className="chart-mark">01</span>
              </div>
              {collections.length > 0 ? (
                <div className="bar-list">
                  {collections.map((item) => (
                    <div className="bar-item" key={item.name}>
                      <div className="bar-label"><span title={item.name}>{item.name}</span><strong>{numberFormat(item.rows)}</strong></div>
                      <div className="bar-track"><div className="bar-fill collection-fill" style={{ width: `${Math.max(1, (Number(item.rows) / maxCollection) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : <div className="chart-empty">{loading ? "Loading collection data…" : "No collection statistics available."}</div>}
            </div>

            <div className="chart-card">
              <div className="chart-title-row">
                <div><h3>Spectral Bands Distribution</h3><p>Observation records by spectral band</p></div>
                <span className="chart-mark">02</span>
              </div>
              {bands.length > 0 ? (
                <div className="bar-list">
                  {bands.map((item, index) => (
                    <div className="bar-item" key={item.name}>
                      <div className="bar-label"><span title={item.name}>{item.name}</span><strong>{numberFormat(item.rows)}</strong></div>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(1, (Number(item.rows) / maxBand) * 100)}%`, background: bandColors[index % bandColors.length] }} /></div>
                    </div>
                  ))}
                </div>
              ) : <div className="chart-empty">{loading ? "Loading spectral band data…" : "No spectral band statistics available."}</div>}
            </div>

            <div className="chart-card timeline-card">
              <div className="chart-title-row">
                <div><h3>Observation Timeline</h3><p>Exposure duration across observation dates</p></div>
                <span className="chart-mark">03</span>
              </div>
              {timeline.length > 0 ? (
                <>
                  <div className="timeline-chart">
                    {timeline.map((item, index) => {
                      const exposure = Number(item.exposure_seconds) || 0;
                      const height = Math.max(5, (exposure / maxExposure) * 100);
                      return (
                        <div className="timeline-column" key={`${item.id ?? item.obs_id ?? "record"}-${index}`} title={`MJD ${item.mjd_start} · Exposure ${exposure} seconds`}>
                          <span className="timeline-value">{Math.round(exposure)}s</span>
                          <div className="timeline-bar-wrap"><div className="timeline-bar" style={{ height: `${height}%` }} /></div>
                          <span className="timeline-date">{Number(item.mjd_start).toFixed(1)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="axis-caption"><span>Earlier observation</span><span>MJD · Modified Julian Date</span><span>Later observation</span></div>
                </>
              ) : <div className="chart-empty">{loading ? "Loading observation timeline…" : "No dated observation records available."}</div>}
            </div>
          </section>

          <div className="section-heading lower-heading">
            <div><h2>Observation Explorer</h2><p>Recent astronomical records from your database.</p></div>
            <span className="record-count">{numberFormat(observations.length)} records loaded</span>
          </div>

          <div className="data-panel">
            <div className="table-scroll">
              <div className="table-head">
                <span>OBSERVATION ID</span><span>COLLECTION</span>
                <span>BAND</span><span>RA / DEC</span><span>STATUS</span>
              </div>
              {observations.length > 0 ? observations.slice(0, 50).map((obs, index) => (
                <div className="table-row" key={obs.id ?? obs.obs_id ?? index}>
                  <strong title={obs.obs_id}>{obs.obs_id ?? obs.id ?? `Record ${index + 1}`}</strong>
                  <span title={obs.collection}>{obs.collection ?? "—"}</span>
                  <span>{obs.band ?? "—"}</span>
                  <span>{formatCoordinate(obs.ra_deg)} / {formatCoordinate(obs.dec_deg)}</span>
                  <span className={`record-status ${obs.calibration_status?.toLowerCase() === "calibrated" ? "calibrated" : ""}`}>
                    ● {obs.calibration_status ?? "Available"}
                  </span>
                </div>
              )) : (
                <div className="empty-state">
                  <div className="empty-icon">✧</div>
                  <strong>{health === "Connected" ? "No observation records returned" : "Waiting for backend connection"}</strong>
                  <p>{error || "Your astronomical records will appear here when available."}</p>
                </div>
              )}
            </div>
            {observations.length > 50 && <div className="table-note">Showing the latest 50 records from {numberFormat(observations.length)} loaded records.</div>}
          </div>

          </>
          ) : active === "Image Explorer" ? (
            <section className="page-section">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span /> SCIENTIFIC IMAGE LIBRARY</div>
                  <h1>Image <span>Explorer.</span></h1>
                  <p className="subtitle">Browse the scientific image previews and inspect the original SPHEREx data files.</p>
                </div>
                <button className="refresh-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} type="button">{loading ? "Loading…" : "↻ Refresh images"}</button>
              </div>
              {imagesError && <div className="error-banner">{imagesError}</div>}
              <div className="stats-grid image-stats">
                <div className="stat-card"><div className="stat-top">Available files</div><div className="stat-value">{images.length}</div><div className="stat-foot">Files returned by the images API</div></div>
                <div className="stat-card"><div className="stat-top">Viewable previews</div><div className="stat-value">{previewImages.length}</div><div className="stat-foot">PNG, JPG and WebP images</div></div>
                <div className="stat-card"><div className="stat-top">Scientific FITS files</div><div className="stat-value">{fitsFiles.length}</div><div className="stat-foot">Original data, not browser image previews</div></div>
                <div className="stat-card"><div className="stat-top">Connection</div><div className="stat-value">{health}</div><div className="stat-foot">FastAPI image endpoint</div></div>
              </div>
              <div className="image-library-toolbar">
                <div className="section-heading lower-heading">
                  <div><h2>Image previews</h2><p>Explore the available scientific previews. Select any image to open the interactive viewer.</p></div>
                  <span className="record-count">{filteredPreviewImages.length} / {previewImages.length} preview(s)</span>
                </div>
                <label className="image-search">
                  <span>⌕</span>
                  <input value={imageSearch} onChange={(event) => setImageSearch(event.target.value)} placeholder="Search images by filename…" />
                  {imageSearch && <button type="button" onClick={() => setImageSearch("")}>Clear</button>}
                </label>
              </div>
              {filteredPreviewImages.length ? (
                <div className="image-grid image-grid-enhanced">
                  {filteredPreviewImages.map((image, index) => (
                    <article className="image-card image-card-enhanced" key={image.name}>
                      <button className="image-preview image-preview-button" type="button" onClick={() => { setSelectedPreview(image); setPreviewZoom(1); }} aria-label={`Inspect ${image.name}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageUrl(image)} alt={image.name} />
                        <span className="image-hover-action">OPEN VIEWER <b>↗</b></span>
                        <span className="image-index">IMAGE {String(index + 1).padStart(2, "0")}</span>
                      </button>
                      <div className="image-card-info"><strong title={image.name}>{image.name}</strong><span>{image.format.toUpperCase()} · {formatBytes(image.size_bytes)}</span></div>
                      <div className="image-card-actions">
                        <button type="button" className="text-link" onClick={() => { setSelectedPreview(image); setPreviewZoom(1); }}>Inspect image ↗</button>
                        <a className="text-link" href={imageUrl(image)} target="_blank" rel="noreferrer">Open file ↗</a>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="empty-state"><div className="empty-icon">▧</div><strong>{imageSearch ? "No matching images" : "No preview images found"}</strong><p>{imageSearch ? "Try another filename or clear the search." : "Check that the backend image endpoint returns PNG, JPG or WebP files."}</p></div>}

              {selectedPreview && (
                <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`Image viewer: ${selectedPreview.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPreview(null); }}>
                  <div className="image-lightbox-panel">
                    <div className="image-lightbox-header">
                      <div><span className="eyebrow"><span /> SCIENTIFIC IMAGE VIEWER</span><strong>{selectedPreview.name}</strong><small>{selectedPreview.format.toUpperCase()} · {formatBytes(selectedPreview.size_bytes)}</small></div>
                      <button type="button" className="image-lightbox-close" onClick={() => setSelectedPreview(null)} aria-label="Close viewer">×</button>
                    </div>
                    <div className="image-lightbox-stage">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl(selectedPreview)} alt={selectedPreview.name} style={{ transform: `scale(${previewZoom})` }} />
                    </div>
                    <div className="image-lightbox-controls">
                      <div className="image-zoom-control"><span>ZOOM</span><button type="button" onClick={() => setPreviewZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))))}>−</button><input aria-label="Image zoom" type="range" min="0.5" max="3" step="0.1" value={previewZoom} onChange={(event) => setPreviewZoom(Number(event.target.value))} /><button type="button" onClick={() => setPreviewZoom((value) => Math.min(3, Number((value + 0.1).toFixed(2))))}>+</button><button type="button" onClick={() => setPreviewZoom(1)}>Reset</button></div>
                      <a className="primary-button" href={imageUrl(selectedPreview)} target="_blank" rel="noreferrer">Open original ↗</a>
                    </div>
                  </div>
                </div>
              )}
              <div className="section-heading lower-heading"><div><h2>Original scientific files</h2><p>FITS files contain scientific data and require a dedicated viewer for visualization.</p></div></div>
              <div className="data-panel file-list">
                {fitsFiles.length ? fitsFiles.map((file) => <div className="file-row" key={file.name}><span className="file-icon">FITS</span><div><strong>{file.name}</strong><small>{formatBytes(file.size_bytes)} · Scientific source file</small></div><a className="text-link" href={imageUrl(file)} target="_blank" rel="noreferrer">Download ↗</a></div>) : <div className="empty-state">No FITS files were returned by the API.</div>}
              </div>
            </section>
          ) : active === "Scientific Analysis" ? (
            <section className="page-section">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span /> FITS DATA INSPECTION</div>
                  <h1>Scientific <span>Analysis.</span></h1>
                  <p className="subtitle">Inspect measured image statistics, auxiliary FITS extensions and celestial WCS coordinates.</p>
                </div>
                <span className="date-chip">SOURCE-BASED ANALYSIS</span>
              </div>

              {availableFits.length > 0 ? (
                <div className="chart-card fits-selector-card">
                  <label className="fits-select-label" htmlFor="fits-source">Scientific FITS source</label>
                  <select id="fits-source" value={activeFitsName} onChange={(event) => {
                      setSelectedFitsName(event.target.value);
                      setPixelAnalysis(null);
                      setPixelError("");
                    }}>
                    {availableFits.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}
                  </select>
                  <span className="fits-source-note">Analysis is calculated from the selected FITS file by the backend.</span>
                </div>
              ) : (
                <div className="empty-state"><div className="empty-icon">⌁</div><strong>No FITS source file found</strong><p>Add a .fits or .fit file to the backend static/images folder, then refresh the platform.</p></div>
              )}

              {fitsLoading && <div className="chart-card fits-state">Reading scientific FITS data…</div>}
              {fitsError && <div className="error-banner"><strong>FITS analysis unavailable</strong><span>{fitsError}</span></div>}

              {fitsAnalysis && (
                <>
                  <section className="chart-card pixel-inspector lower-heading">
                    <div className="chart-title-row">
                      <div>
                        <h3>Interactive pixel inspection</h3>
                        <p>Click anywhere on the science preview to read that pixel directly from the selected FITS file.</p>
                      </div>
                      <span className="chart-mark">LIVE FITS QUERY</span>
                    </div>
                    {sciencePreview ? (
                      <div className="pixel-image-frame">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="pixel-inspection-image"
                          src={imageUrl(sciencePreview)}
                          alt={`Clickable scientific preview for ${activeFitsName}`}
                          onClick={handleScienceImageClick}
                          title="Click to inspect pixel values"
                        />
                      </div>
                    ) : (
                      <div className="chart-empty">No science preview image is available. Add a PNG preview to the backend image folder.</div>
                    )}
                    <p className="pixel-hint">Click a location in the image. Its position is mapped to the preview&apos;s native pixel dimensions.</p>
                    {pixelLoading && <div className="fits-state">Reading selected pixel from FITS…</div>}
                    {pixelError && <div className="error-banner"><strong>Pixel query unavailable</strong><span>{pixelError}</span></div>}
                    {pixelAnalysis && (
                      <div className="pixel-result">
                        <div className="pixel-result-heading">
                          <strong>Selected pixel · X {pixelAnalysis.pixel.x}, Y {pixelAnalysis.pixel.y}</strong>
                          <span>{pixelAnalysis.image_name}</span>
                        </div>
                        <div className="pixel-result-grid">
                          <div><span>Science value</span><strong>{numberFormat(pixelAnalysis.science_value)} {pixelAnalysis.unit || fitsAnalysis.metadata.unit || ""}</strong></div>
                          <div><span>Variance</span><strong>{numberFormat(pixelAnalysis.variance_value)}</strong></div>
                          <div><span>Stored FLAGS value</span><strong>{numberFormat(pixelAnalysis.flag_value)}</strong></div>
                          <div><span>Right ascension</span><strong>{pixelAnalysis.sky_coordinates ? `${pixelAnalysis.sky_coordinates.ra_deg.toFixed(6)}°` : "—"}</strong></div>
                          <div><span>Declination</span><strong>{pixelAnalysis.sky_coordinates ? `${pixelAnalysis.sky_coordinates.dec_deg.toFixed(6)}°` : "—"}</strong></div>
                          <div><span>Coordinate system</span><strong>{pixelAnalysis.sky_coordinates?.coordinate_system || "—"}</strong></div>
                        </div>
                        {pixelAnalysis.note && <p className="page-note">{pixelAnalysis.note}</p>}
                      </div>
                    )}
                    <div className="roi-panel">
                      <div className="chart-title-row">
                        <div><h3>Region of interest · ROI</h3><p>Enter a rectangular pixel region. The upper-right bounds (X2, Y2) are exclusive.</p></div>
                        <span className="chart-mark">ORIGINAL FITS DATA</span>
                      </div>
                      <div className="roi-controls">
                        {([
                          ["x1", "X start"], ["y1", "Y start"],
                          ["x2", "X end"], ["y2", "Y end"],
                        ] as const).map(([key, label]) => (
                          <label key={key}>{label}
                            <input
                              type="number"
                              min={0}
                              max={key === "x1" || key === "x2" ? fitsAnalysis.metadata.width : fitsAnalysis.metadata.height}
                              value={roiBounds[key]}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                                setRoiBounds((current) => ({ ...current, [key]: Number.isFinite(value) ? value : 0 }));
                              }}
                            />
                          </label>
                        ))}
                        <button className="primary-button roi-button" type="button" onClick={handleRoiAnalysis} disabled={roiLoading}>
                          {roiLoading ? "Analyzing region…" : "Analyze selected region ↗"}
                        </button>
                      </div>
                      <p className="pixel-hint">Image size: {fitsAnalysis.metadata.width} × {fitsAnalysis.metadata.height} pixels. Choose X2 greater than X1 and Y2 greater than Y1.</p>
                      {roiError && <div className="error-banner" role="alert">{roiError}</div>}
                      {roiLoading && <div className="fits-state">Calculating ROI statistics from the FITS source…</div>}
                      {roiAnalysis && (
                        <div className="roi-result">
                          <div className="pixel-result-heading">
                            <strong>Measured region · {roiAnalysis.region.width} × {roiAnalysis.region.height} pixels</strong>
                            <span>{roiAnalysis.image_name}</span>
                          </div>
                          <div className="roi-summary-grid">
                            <div><span>Valid pixels</span><strong>{numberFormat(roiAnalysis.region.valid_pixels)}</strong></div>
                            <div><span>Invalid pixels</span><strong>{numberFormat(roiAnalysis.region.invalid_pixels)}</strong></div>
                            <div><span>Minimum</span><strong>{roiAnalysis.science_statistics.min.toExponential(4)}</strong></div>
                            <div><span>Maximum</span><strong>{roiAnalysis.science_statistics.max.toExponential(4)}</strong></div>
                            <div><span>Mean</span><strong>{roiAnalysis.science_statistics.mean.toExponential(4)} {roiAnalysis.unit || ""}</strong></div>
                            <div><span>Median</span><strong>{roiAnalysis.science_statistics.median.toExponential(4)}</strong></div>
                            <div><span>Std deviation</span><strong>{roiAnalysis.science_statistics.std.toExponential(4)}</strong></div>
                            <div><span>Variance mean</span><strong>{numberFormat(roiAnalysis.variance?.mean)}</strong></div>
                            <div><span>Center RA</span><strong>{roiAnalysis.sky_center ? `${roiAnalysis.sky_center.ra_deg.toFixed(6)}°` : "—"}</strong></div>
                            <div><span>Center Dec</span><strong>{roiAnalysis.sky_center ? `${roiAnalysis.sky_center.dec_deg.toFixed(6)}°` : "—"}</strong></div>
                          </div>
                          <div className="roi-histogram">
                            <div className="chart-title-row"><div><h3>ROI intensity histogram</h3><p>Distribution of finite science-pixel values in this region.</p></div></div>
                            <div className="roi-bars">
                              {roiAnalysis.histogram.map((bin, index) => {
                                const peak = Math.max(1, ...roiAnalysis.histogram.map((item) => item.count));
                                return <div className="roi-bin" key={index} title={`${bin.bin_start.toExponential(2)} to ${bin.bin_end.toExponential(2)}: ${numberFormat(bin.count)} pixels`}>
                                  <div className="roi-bar-track"><div className="roi-bar-fill" style={{ height: `${(bin.count / peak) * 100}%` }} /></div>
                                  <span>{numberFormat(bin.count)}</span>
                                </div>;
                              })}
                            </div>
                          </div>
                          {roiAnalysis.flags && <p className="page-note">FLAGS in this region contain {roiAnalysis.flags.unique_values_count} distinct stored values. Their scientific meanings are not inferred here.</p>}
                          <p className="page-note">{roiAnalysis.note}</p>
                        </div>
                      )}
                    </div>
                  </section>

                  <div className="stats-grid fits-stats">
                    <div className="stat-card"><div className="stat-top">Image dimensions</div><div className="stat-value">{fitsAnalysis.metadata.width.toLocaleString()} × {fitsAnalysis.metadata.height.toLocaleString()}</div><div className="stat-foot">Width × height in pixels</div></div>
                    <div className="stat-card"><div className="stat-top">Valid pixels</div><div className="stat-value">{numberFormat(fitsAnalysis.science_image.valid_pixels)}</div><div className="stat-foot">Finite values in science image</div></div>
                    <div className="stat-card"><div className="stat-top">Measurement unit</div><div className="stat-value fits-unit">{fitsAnalysis.metadata.unit || "Not specified"}</div><div className="stat-foot">BUNIT from FITS header</div></div>
                    <div className="stat-card"><div className="stat-top">FITS extensions</div><div className="stat-value">{fitsAnalysis.metadata.fits_hdu_count}</div><div className="stat-foot">Header/data units in source file</div></div>
                  </div>

                  <div className="section-heading lower-heading"><div><h2>Science image statistics</h2><p>Calculated from finite pixel values in the main scientific image.</p></div><span className="record-count">{fitsAnalysis.metadata.image_name}</span></div>
                  <div className="charts-grid fits-analysis-grid">
                    {[
                      ["Minimum", fitsAnalysis.science_image.min],
                      ["Maximum", fitsAnalysis.science_image.max],
                      ["Mean", fitsAnalysis.science_image.mean],
                      ["Standard deviation", fitsAnalysis.science_image.std],
                    ].map(([label, value]) => (
                      <div className="chart-card fits-metric" key={String(label)}>
                        <span>{label}</span>
                        <strong>{typeof value === "number" ? value.toExponential(5) : "—"}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="charts-grid lower-heading">
                    <article className="chart-card">
                      <div className="chart-title-row"><div><h3>Variance extension</h3><p>Pixel variance values reported by the FITS file.</p></div><span className="chart-mark">{fitsAnalysis.variance ? "AVAILABLE" : "NOT FOUND"}</span></div>
                      {fitsAnalysis.variance ? <div className="fits-detail-grid"><span>Shape<strong>{fitsAnalysis.variance.shape.join(" × ")}</strong></span><span>Valid pixels<strong>{numberFormat(fitsAnalysis.variance.valid_pixels)}</strong></span><span>Minimum<strong>{numberFormat(fitsAnalysis.variance.min)}</strong></span><span>Maximum<strong>{numberFormat(fitsAnalysis.variance.max)}</strong></span><span>Mean<strong>{numberFormat(fitsAnalysis.variance.mean)}</strong></span><span>Std<strong>{numberFormat(fitsAnalysis.variance.std)}</strong></span></div> : <div className="chart-empty">No VARIANCE extension returned.</div>}
                    </article>
                    <article className="chart-card">
                      <div className="chart-title-row"><div><h3>FLAGS extension</h3><p>Most frequent stored flag values; meanings are not assumed.</p></div><span className="chart-mark">{fitsAnalysis.flags ? `${fitsAnalysis.flags.unique_values_count} VALUES` : "NOT FOUND"}</span></div>
                      {fitsAnalysis.flags ? <div className="flag-list">{fitsAnalysis.flags.most_common_values.slice(0,8).map((flag) => <div className="flag-row" key={flag.value}><span>Value {flag.value}</span><strong>{numberFormat(flag.count)} pixels</strong></div>)}</div> : <div className="chart-empty">No FLAGS extension returned.</div>}
                    </article>
                  </div>

                  <div className="section-heading lower-heading"><div><h2>Celestial coordinates · WCS</h2><p>Sky coordinates calculated from image pixel positions.</p></div><span className="chart-mark">{fitsAnalysis.wcs?.coordinate_system || "WCS STATUS"}</span></div>
                  {fitsAnalysis.wcs?.pixel_to_sky ? (
                    <div className="data-panel"><div className="table-scroll"><div className="table-head wcs-table"><span>PIXEL LOCATION</span><span>RIGHT ASCENSION</span><span>DECLINATION</span></div>{Object.entries(fitsAnalysis.wcs.pixel_to_sky).map(([position, coordinate]) => <div className="table-row wcs-table" key={position}><strong>{position.replaceAll("_"," ").toUpperCase()}</strong><span>{coordinate.ra_deg.toFixed(6)}°</span><span>{coordinate.dec_deg.toFixed(6)}°</span></div>)}</div></div>
                  ) : <div className="empty-state">Celestial WCS coordinates are not available for this image.</div>}

                  <div className="chart-card fits-metadata lower-heading">
                    <div className="chart-title-row"><div><h3>FITS header metadata</h3><p>Selected metadata values read from the scientific image header.</p></div></div>
                    <div className="fits-detail-grid"><span>Observation date<strong>{fitsAnalysis.metadata.date_obs || "—"}</strong></span><span>MJD observation<strong>{numberFormat(fitsAnalysis.metadata.mjd_obs)}</strong></span><span>Telescope<strong>{fitsAnalysis.metadata.telescope || "—"}</strong></span><span>Instrument<strong>{fitsAnalysis.metadata.instrument || "—"}</strong></span></div>
                  </div>
                  <p className="page-note">{fitsAnalysis.scientific_note || "Statistics are reported from the selected FITS file. Interpret quality flags using the official instrument documentation."}</p>
                </>
              )}
              <EpochComparisonWorkspace onReportChange={setEpochComparisonReport} />
            </section>
          ) : active === "Target Coverage" ? (
            <TargetCoverageWorkspace onPrepareSearch={target => {
              setSelectedTargetCase(target);
              setTargetQueryPreset(target);
              setArchiveEvidence(previous => ({ ...EMPTY_ARCHIVE_EVIDENCE, retrieved_products: previous.retrieved_products, cached_products: previous.cached_products }));
              setActive("IRSA Archive");
            }} />
          ) : active === "Sky Explorer" ? (
            <section className="page-section">
              <div className="welcome-row"><div><div className="eyebrow"><span /> SPHEREx OBSERVATIONS</div><h1>Sky <span>Explorer.</span></h1><p className="subtitle">Explore the sky-position metadata available in the connected observation records.</p></div><span className="date-chip">{observations.length.toLocaleString()} LOADED RECORDS</span></div>
              <div className="section-heading"><div><h2>Observation coordinates</h2><p>Right ascension and declination from the database.</p></div><span className="record-count">Showing up to 100 records</span></div>
              <div className="data-panel"><div className="table-scroll"><div className="table-head sky-table-head"><span>OBSERVATION ID</span><span>RA (DEG)</span><span>DEC (DEG)</span><span>BAND</span><span>COLLECTION</span></div>{observations.slice(0,100).map((obs,index)=><div className="table-row sky-table-row" key={obs.id ?? obs.obs_id ?? index}><strong>{obs.obs_id ?? obs.id ?? `Record ${index+1}`}</strong><span>{formatCoordinate(obs.ra_deg)}</span><span>{formatCoordinate(obs.dec_deg)}</span><span>{obs.band ?? "—"}</span><span>{obs.collection ?? "—"}</span></div>)}</div></div>
              <p className="page-note">Coordinates are shown as catalog metadata. A sky map projection can be added as a separate visualization layer.</p>
            </section>
          ) : active === "Comparison Lab" ? (
            <section className="page-section">
              <div className="welcome-row"><div><div className="eyebrow"><span /> VISUAL COMPARISON WORKSPACE</div><h1>Comparison <span>Lab.</span></h1><p className="subtitle">Place two available image previews side by side for visual inspection.</p></div></div>
              {previewImages.length >= 2 ? <>
                <div className="compare-controls compare-controls-enhanced">
                  <label><span className="compare-source-label"><i className="compare-dot compare-dot-a" /> IMAGE A · REFERENCE</span><select value={comparisonLeft || previewImages[0].name} onChange={(event)=>setComparisonLeft(event.target.value)}>{previewImages.map((image)=><option key={image.name} value={image.name}>{image.name}</option>)}</select></label>
                  <button type="button" className="compare-swap" title="Swap Image A and Image B" onClick={()=>{setComparisonLeft(selectedRightImage?.name ?? "");setComparisonRight(selectedLeftImage?.name ?? "");}}>⇄</button>
                  <label><span className="compare-source-label"><i className="compare-dot compare-dot-b" /> IMAGE B · COMPARISON</span><select value={comparisonRight || previewImages[1].name} onChange={(event)=>setComparisonRight(event.target.value)}>{previewImages.map((image)=><option key={image.name} value={image.name}>{image.name}</option>)}</select></label>
                </div>
                <div className="compare-toolbar compare-toolbar-enhanced">
                  <div className="mode-switch mode-switch-enhanced" aria-label="Comparison mode">
                    <button type="button" className={comparisonMode === "side-by-side" ? "active" : ""} onClick={()=>setComparisonMode("side-by-side")}>▥ Side by side</button>
                    <button type="button" className={comparisonMode === "overlay" ? "active" : ""} onClick={()=>setComparisonMode("overlay")}>◉ Blend</button>
                    <button type="button" className={comparisonMode === "wipe" ? "active" : ""} onClick={()=>setComparisonMode("wipe")}>◫ Swipe</button>
                    <button type="button" className={comparisonMode === "difference" ? "active" : ""} onClick={()=>setComparisonMode("difference")}>✧ Difference view</button>
                  </div>
                  <label className="range-control"><span>Zoom <strong>{comparisonZoom.toFixed(1)}×</strong></span><input type="range" min="1" max="3" step="0.1" value={comparisonZoom} onChange={(event)=>setComparisonZoom(Number(event.target.value))}/></label>
                  {comparisonMode === "overlay" && <label className="range-control"><span>Image B opacity <strong>{Math.round(overlayOpacity*100)}%</strong></span><input type="range" min="0" max="1" step="0.05" value={overlayOpacity} onChange={(event)=>setOverlayOpacity(Number(event.target.value))}/></label>}
                  {comparisonMode === "wipe" && <label className="range-control"><span>Reveal Image B <strong>{comparisonWipe}%</strong></span><input type="range" min="0" max="100" step="1" value={comparisonWipe} onChange={(event)=>setComparisonWipe(Number(event.target.value))}/></label>}
                  <button className="outline-button" type="button" onClick={()=>{setComparisonZoom(1);setOverlayOpacity(0.5);setComparisonWipe(50);}}>Reset view</button>
                </div>
                {comparisonMode === "side-by-side" ? (
                  <div className="compare-grid">{[selectedLeftImage,selectedRightImage].map((image,index)=>image && <article className="chart-card compare-card" key={`${index}-${image.name}`}><h3>{index===0?"Image A":"Image B"}</h3><p>{image.name}</p><div className="compare-viewport">{/* eslint-disable-next-line @next/next/no-img-element */}<img style={{transform:`scale(${comparisonZoom})`}} src={imageUrl(image)} alt={image.name}/></div></article>)}</div>
                ) : selectedLeftImage && selectedRightImage && comparisonMode === "overlay" ? (
                  <article className="chart-card overlay-card compare-stage-card"><h3>Blend comparison</h3><p>Image A: {selectedLeftImage.name} · Image B: {selectedRightImage.name}</p><div className="overlay-viewport"><div className="overlay-stack" style={{transform:`scale(${comparisonZoom})`}}>{/* eslint-disable-next-line @next/next/no-img-element */}<img className="overlay-base" src={imageUrl(selectedLeftImage)} alt={`Base ${selectedLeftImage.name}`}/>{/* eslint-disable-next-line @next/next/no-img-element */}<img className="overlay-top" style={{opacity:overlayOpacity}} src={imageUrl(selectedRightImage)} alt={`Overlay ${selectedRightImage.name}`}/></div></div><p className="overlay-caption">Blend the two previews and adjust Image B opacity to inspect visual structure.</p></article>
                ) : selectedLeftImage && selectedRightImage && comparisonMode === "wipe" ? (
                  <article className="chart-card overlay-card compare-stage-card"><h3>Swipe comparison</h3><p>Drag the reveal slider above to compare Image A and Image B across the same view.</p><div className="overlay-viewport wipe-viewport"><div className="wipe-stack" style={{transform:`scale(${comparisonZoom})`}}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={imageUrl(selectedLeftImage)} alt={`Reference ${selectedLeftImage.name}`}/><div className="wipe-reveal" style={{clipPath:`inset(0 0 0 ${comparisonWipe}%)`}}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={imageUrl(selectedRightImage)} alt={`Reveal ${selectedRightImage.name}`}/></div><div className="wipe-divider" style={{left:`${comparisonWipe}%`}}><span>↔</span></div></div><div className="wipe-label wipe-label-a">IMAGE A</div><div className="wipe-label wipe-label-b">IMAGE B</div></div><p className="overlay-caption">This is a visual reveal comparison, not a registered scientific difference map.</p></article>
                ) : selectedLeftImage && selectedRightImage && comparisonMode === "difference" ? (
                  <article className="chart-card overlay-card compare-stage-card"><h3>Difference blend</h3><p>High-contrast visual blend of the two selected previews.</p><div className="overlay-viewport"><div className="overlay-stack difference-stack" style={{transform:`scale(${comparisonZoom})`}}>{/* eslint-disable-next-line @next/next/no-img-element */}<img className="overlay-base" src={imageUrl(selectedLeftImage)} alt={`Difference base ${selectedLeftImage.name}`}/>{/* eslint-disable-next-line @next/next/no-img-element */}<img className="overlay-top difference-top" src={imageUrl(selectedRightImage)} alt={`Difference blend ${selectedRightImage.name}`}/></div></div><p className="overlay-caption">CSS difference blend is for visual exploration only. It is not a calibrated pixel subtraction or scientific residual map.</p></article>
                ) : null}
                <p className="page-note">These comparison modes are visual inspection tools. The previews have not been astrometrically registered or scientifically calibrated against each other. Difference blend is not a scientific pixel-level difference calculation.</p>
              </> : <div className="empty-state"><strong>Two preview images are needed</strong><p>Add at least two PNG/JPG/WebP previews to the backend image folder to use this comparison view.</p></div>}
            </section>
          ) : active === "3D Universe" ? (
            <section className="page-section">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span /> LIVE SPHEREx SKY DATA</div>
                  <h1>3D <span>Universe.</span></h1>
                  <p className="subtitle">Explore loaded observations by sky position. Filter, rotate, zoom and select individual records.</p>
                </div>
                <span className="date-chip">{numberFormat(universeRows.length)} POINTS VISIBLE</span>
              </div>

              <div className="universe-toolbar">
                <label>Band
                  <select value={universeBand} onChange={(event) => { setUniverseBand(event.target.value); setUniverseSelected(null); }}>
                    <option>All bands</option>
                    {universeBands.map((band) => <option key={band}>{band}</option>)}
                  </select>
                </label>
                <label>Collection
                  <select value={universeCollection} onChange={(event) => { setUniverseCollection(event.target.value); setUniverseSelected(null); }}>
                    <option>All collections</option>
                    {universeCollections.map((collection) => <option key={collection}>{collection}</option>)}
                  </select>
                </label>
                <label className="universe-search">Find observation
                  <input value={universeSearch} onChange={(event) => setUniverseSearch(event.target.value)} placeholder="Search observation ID…" />
                </label>
                <button type="button" className={`outline-button ${universeAutoRotate ? "universe-active" : ""}`} onClick={() => setUniverseAutoRotate((value) => !value)}>
                  {universeAutoRotate ? "Ⅱ Pause rotation" : "▶ Auto rotate"}
                </button>
                <button type="button" className="outline-button" onClick={() => { setUniverseRotation({ x: -12, y: 18 }); setUniverseZoom(1); }}>
                  ↺ Reset view
                </button>
              </div>

              <div className="universe-layout">
                <div className="universe-panel interactive-universe">
                  <div className="universe-stars">✦　　·　　　 ✧　　　·　　　✦</div>
                  <div className="universe-orbit orbit-a"></div>
                  <div className="universe-orbit orbit-b"></div>
                  <div className="universe-orbit orbit-c"></div>
                  <div className="universe-globe-stage">
                    <div className={`universe-globe ${universeAutoRotate ? "auto-rotating" : ""}`}
                      style={universeAutoRotate
                        ? ({ "--universe-zoom": String(universeZoom) } as CSSProperties)
                        : { transform: `scale(${universeZoom}) rotateX(${universeRotation.x}deg) rotateY(${universeRotation.y}deg)` }}>
                      <div className="universe-sphere"></div>
                      {universeRows.map((item, index) => {
                        const position = universePointPosition(item);
                        const selected = universeSelected?.obs_id === item.obs_id;
                        const colorIndex = Math.max(0, universeBands.indexOf(item.band || ""));
                        return <button type="button" key={`${item.obs_id ?? item.id ?? index}-${index}`}
                          className={`universe-point ${selected ? "selected" : ""}`}
                          style={{ ...position, "--point-color": bandColors[colorIndex % bandColors.length] } as CSSProperties}
                          title={`${item.obs_id ?? "Observation"} · ${item.band ?? "Unknown band"}`}
                          aria-label={`Select observation ${item.obs_id ?? index + 1}`}
                          onClick={() => setUniverseSelected(item)} />;
                      })}
                    </div>
                  </div>
                  <div className="universe-caption">RA / DEC SKY POSITIONS · SELECT A POINT TO INSPECT</div>
                  <div className="universe-zoom">
                    <span>−</span>
                    <input aria-label="Zoom universe" type="range" min="0.75" max="1.5" step="0.05" value={universeZoom} onChange={(event) => setUniverseZoom(Number(event.target.value))} />
                    <span>+</span>
                  </div>
                </div>

                <aside className="universe-inspector chart-card">
                  <div className="chart-title-row"><div><h3>Selected observation</h3><p>Choose any point on the sky globe.</p></div><span className="chart-mark">INSPECT</span></div>
                  {universeSelected ? (
                    <div className="universe-observation">
                      <strong>{universeSelected.obs_id ?? "Observation record"}</strong>
                      <div><span>Collection</span><b>{universeSelected.collection ?? "—"}</b></div>
                      <div><span>Spectral band</span><b>{universeSelected.band ?? "—"}</b></div>
                      <div><span>Right ascension</span><b>{formatCoordinate(universeSelected.ra_deg)}</b></div>
                      <div><span>Declination</span><b>{formatCoordinate(universeSelected.dec_deg)}</b></div>
                      <div><span>Exposure</span><b>{universeSelected.exposure_seconds != null ? `${universeSelected.exposure_seconds.toFixed(2)} s` : "—"}</b></div>
                      {universeSelected.access_url && <a className="text-link" href={universeSelected.access_url} target="_blank" rel="noreferrer">Open source observation ↗</a>}
                    </div>
                  ) : (
                    <div className="universe-empty"><span>✧</span><strong>No observation selected</strong><p>Click one of the colored points to see its metadata here.</p></div>
                  )}
                  <div className="universe-legend"><strong>Band legend</strong>{universeBands.map((band, index) => <div key={band}><i style={{ background: bandColors[index % bandColors.length] }} />{band}</div>)}</div>
                </aside>
              </div>
              <div className="universe-rotation">
                <label>Rotate horizontally <input type="range" min="-180" max="180" value={universeRotation.y} onChange={(event) => setUniverseRotation((value) => ({ ...value, y: Number(event.target.value) }))} /></label>
                <label>Tilt vertically <input type="range" min="-60" max="60" value={universeRotation.x} onChange={(event) => setUniverseRotation((value) => ({ ...value, x: Number(event.target.value) }))} /></label>
              </div>
              <p className="page-note">Positions are plotted from the RA/Dec values returned by the observation database. The globe is an interactive sky-position view, not a physical 3D map of galaxy distances.</p>
            </section>
          ) : active === "AI Analysis" ? (
            <section className="page-section">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span /> UNSUPERVISED MACHINE LEARNING</div>
                  <h1>AI <span>Analysis.</span></h1>
                  <p className="subtitle">Discover exploratory patterns in the connected SPHEREx observation metadata.</p>
                </div>
                <span className="date-chip">MODEL · K-MEANS</span>
              </div>

              <div className="stats-grid">
                <div className="stat-card"><div className="stat-top">Observations in database</div><div className="stat-value">{numberFormat(summary?.total_rows)}</div><div className="stat-foot">Connected database total</div></div>
                <div className="stat-card"><div className="stat-top">Spectral bands</div><div className="stat-value">{numberFormat(bands.length)}</div><div className="stat-foot">Available band groups</div></div>
                <div className="stat-card"><div className="stat-top">Loaded preview records</div><div className="stat-value">{numberFormat(observations.length)}</div><div className="stat-foot">Frontend sample only</div></div>
                <div className="stat-card"><div className="stat-top">Model status</div><div className="stat-value">{clusterResult ? "Ready" : "Idle"}</div><div className="stat-foot">Run the model to generate groups</div></div>
              </div>

              <div className="chart-card ai-model-card">
                <div className="chart-title-row">
                  <div><h3>Observation Profile Clustering</h3><p>Group records using sky position, observation time and exposure duration.</p></div>
                  <span className="chart-mark">ML 01</span>
                </div>
                <div className="ai-controls">
                  <label className="ai-select-label">Number of groups
                    <select value={clusterCount} onChange={(event)=>setClusterCount(Number(event.target.value))}>
                      {[2,3,4,5,6,7,8].map((value)=><option key={value} value={value}>{value} clusters</option>)}
                    </select>
                  </label>
                  <button className="primary-button" type="button" onClick={runObservationClustering} disabled={LOW_MEMORY_MODE || clusterLoading}>
                    {LOW_MEMORY_MODE ? "Disabled on Free 512 MB" : clusterLoading ? "Analyzing observations…" : "Run clustering model"} {!LOW_MEMORY_MODE && <span>↗</span>}
                  </button>
                </div>
                <p className="page-note">The model uses up to 10,000 records and standardizes five numeric features: sin(RA), cos(RA), Dec, MJD start and log(1 + exposure seconds).</p>
                {clusterError && <div className="error-banner" role="alert"><strong>Model request failed</strong><span>{clusterError}</span></div>}
                {clusterLoading && <div className="fits-state">Preparing features and discovering observation groups…</div>}
              </div>

              <div className="chart-card ai-model-card anomaly-model-card">
                <div className="chart-title-row">
                  <div><h3>Scientific Image Anomaly Detection</h3><p>Find unusual image tiles using an unsupervised Isolation Forest model.</p></div>
                  <span className="chart-mark">ML 02</span>
                </div>
                <div className="ai-controls anomaly-controls">
                  <label className="ai-select-label">Tile size
                    <select value={anomalyTileSize} onChange={(event)=>setAnomalyTileSize(Number(event.target.value))}>
                      {[32,64,128].map((value)=><option key={value} value={value}>{value} × {value} pixels</option>)}
                    </select>
                  </label>
                  <label className="ai-select-label">Expected anomaly fraction
                    <select value={anomalyContamination} onChange={(event)=>setAnomalyContamination(Number(event.target.value))}>
                      {[0.01,0.02,0.03,0.05,0.08,0.1].map((value)=><option key={value} value={value}>{(value*100).toFixed(0)}%</option>)}
                    </select>
                  </label>
                  <button className="primary-button" type="button" onClick={runFitsAnomalyDetection} disabled={LOW_MEMORY_MODE || anomalyLoading || availableFits.length === 0}>
                    {LOW_MEMORY_MODE ? "Disabled on Free 512 MB" : anomalyLoading ? "Scanning image tiles…" : "Detect unusual regions"} {!LOW_MEMORY_MODE && <span>↗</span>}
                  </button>
                </div>
                <p className="page-note">The model ranks image tiles by how unusual their measured features are relative to the analyzed image. The anomaly score is not a probability and does not identify an astronomical object by itself.</p>
                {anomalyError && <div className="error-banner" role="alert"><strong>Anomaly request failed</strong><span>{anomalyError}</span></div>}
                {anomalyLoading && <div className="fits-state">Extracting tile features and scoring unusual regions…</div>}
                {anomalyResult && (
                  <div className="anomaly-result-panel">
                    <div className="anomaly-result-top">
                      <div><span className="new-tag">MODEL COMPLETED</span><h3>Unusual regions detected</h3></div>
                      <strong>{numberFormat(Number(anomalyResult.anomalous_tiles_detected))} <small>/ {numberFormat(Number(anomalyResult.total_tiles_analyzed))} tiles</small></strong>
                    </div>
                    <div className="anomaly-progress"><span style={{width:`${Math.max(0,Math.min(100,Number(anomalyResult.total_tiles_analyzed) ? Number(anomalyResult.anomalous_tiles_detected)/Number(anomalyResult.total_tiles_analyzed)*100 : 0))}%`}} /></div>
                    <div className="anomaly-summary-grid">
                      <div><small>Typical tiles</small><strong>{numberFormat(Number(anomalyResult.typical_tiles_detected))}</strong></div>
                      <div><small>Tile size</small><strong>{numberFormat(Number(anomalyResult.tile_size))} px</strong></div>
                      <div><small>Model</small><strong>{String(anomalyResult.model ?? "IsolationForest")}</strong></div>
                      <div><small>Learning</small><strong>{String(anomalyResult.learning_type ?? "Unsupervised")}</strong></div>
                    </div>
                    {Array.isArray(anomalyResult.anomalies) && anomalyResult.anomalies.length > 0 ? (
                      <div className="anomaly-table-wrap"><div className="anomaly-table-head"><span>RANK</span><span>IMAGE TILE (X1, Y1)</span><span>SIZE</span><span>ANOMALY SCORE</span></div>
                        {(anomalyResult.anomalies as Record<string, unknown>[]).slice(0,12).map((item,index)=>(
                          <div className="anomaly-table-row" key={`${String(item.x1)}-${String(item.y1)}-${index}`}><strong>#{index+1}</strong><span>{numberFormat(Number(item.x1))}, {numberFormat(Number(item.y1))}</span><span>{numberFormat(Number(item.width))} × {numberFormat(Number(item.height))}</span><strong>{numberFormat(Number(item.anomaly_score))}</strong></div>
                        ))}
                      </div>
                    ) : <p className="page-note">The model completed but did not return anomaly records for this configuration.</p>}
                    {typeof anomalyResult.score_note === "string" && <p className="page-note">{anomalyResult.score_note}</p>}
                    {typeof anomalyResult.explanation_note === "string" && <p className="page-note">{anomalyResult.explanation_note}</p>}
                    {typeof anomalyResult.scientific_limitations === "string" && <p className="page-note">{anomalyResult.scientific_limitations}</p>}
                  </div>
                )}
              </div>

              {clusterResult && (
                <>
                  <div className="section-heading lower-heading">
                    <div><h2>Clustering results</h2><p>{numberFormat(clusterResult.records_used)} usable records · {clusterResult.model} · {clusterResult.learning_type}</p></div>
                    <span className="data-source">MODEL COMPLETED</span>
                  </div>
                  <div className="stats-grid">
                    <div className="stat-card"><div className="stat-top">Groups detected</div><div className="stat-value">{numberFormat(clusterResult.cluster_count)}</div></div>
                    <div className="stat-card"><div className="stat-top">Records used</div><div className="stat-value">{numberFormat(clusterResult.records_used)}</div></div>
                    <div className="stat-card"><div className="stat-top">Records loaded</div><div className="stat-value">{numberFormat(clusterResult.records_loaded)}</div></div>
                    <div className="stat-card"><div className="stat-top">Model inertia</div><div className="stat-value">{numberFormat(clusterResult.inertia)}</div></div>
                  </div>

                  <div className="cluster-grid">
                    {clusterResult.clusters.map((cluster)=>(
                      <article className="chart-card cluster-card" key={cluster.cluster_id}>
                        <div className="cluster-title"><span className="cluster-dot" /> <h3>Cluster {cluster.cluster_id + 1}</h3><strong>{numberFormat(cluster.observation_count)} records</strong></div>
                        <div className="cluster-metrics">
                          <div><small>Median RA</small><strong>{formatCoordinate(cluster.median_ra_deg)}</strong></div>
                          <div><small>Median Dec</small><strong>{formatCoordinate(cluster.median_dec_deg)}</strong></div>
                          <div><small>Median MJD</small><strong>{numberFormat(cluster.median_mjd_start)}</strong></div>
                          <div><small>Median exposure</small><strong>{numberFormat(cluster.median_exposure_seconds)} s</strong></div>
                        </div>
                        <div className="cluster-breakdown"><small>Band distribution</small><p>{Object.entries(cluster.band_distribution).map(([name,count])=>`${name}: ${numberFormat(count)}`).join(" · ") || "No band values"}</p></div>
                        <div className="cluster-breakdown"><small>Collection distribution</small><p>{Object.entries(cluster.collection_distribution).map(([name,count])=>`${name}: ${numberFormat(count)}`).join(" · ") || "No collection values"}</p></div>
                      </article>
                    ))}
                  </div>

                  <div className="section-heading lower-heading"><div><h2>Sample assignments</h2><p>First 250 records returned by the API, with their generated cluster IDs.</p></div></div>
                  <div className="data-panel">
                    <div className="table-scroll">
                      <div className="table-head cluster-table-head"><span>OBSERVATION ID</span><span>CLUSTER</span><span>BAND</span><span>RA / DEC</span><span>EXPOSURE</span></div>
                      {clusterResult.sample_assignments.slice(0,50).map((item)=>(
                        <div className="table-row cluster-table-head" key={item.id}>
                          <strong>{item.obs_id ?? item.id}</strong><span>Cluster {item.cluster_id + 1}</span><span>{item.band ?? "—"}</span><span>{formatCoordinate(item.ra_deg)} / {formatCoordinate(item.dec_deg)}</span><span>{numberFormat(item.exposure_seconds)} s</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="chart-card ai-notice">
                    <span className="new-tag">SCIENTIFIC INTERPRETATION</span>
                    <h3>How to read these groups</h3>
                    <p>{clusterResult.interpretation_note}</p>
                    <p>{clusterResult.limitations}</p>
                    <p><strong>Features used:</strong> {clusterResult.features_used.join(" · ")}</p>
                  </div>
                </>
              )}
            </section>
          ) : active === "Scientific Evidence" ? (
            <section className="page-section evidence-report-page">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span /> SCIENTIFIC RECORD · EXPORT CENTER</div>
                  <h1>Evidence <span>& Reports.</span></h1>
                  <p className="subtitle">Build a portable evidence package from the records and analyses currently loaded in XPLORERS.</p>
                </div>
                <div className="evidence-status"><span className={`status-dot ${health === "Connected" ? "online" : ""}`} /> {health.toUpperCase()}</div>
              </div>

              <div className="evidence-report-grid">
                <article className="chart-card report-intro-card">
                  <span className="new-tag">MISSION DATA PACKAGE</span>
                  <h2>Turn exploration into evidence.</h2>
                  <p>Export the currently loaded observation sample, image inventory, FITS summary and available analysis results. The package records what is present in this session; it does not create missing measurements.</p>
                  <div className="report-actions">
                    <button className="primary-button" type="button" onClick={exportEvidenceJson}>↓ Export full evidence · JSON</button>
                    <button className="outline-button" type="button" onClick={exportObservationsCsv} disabled={!observations.length}>↓ Export observations · CSV</button>
                    <button className="outline-button" type="button" onClick={printEvidenceReport}>Print / Save PDF</button>
                  </div>
                </article>
                <article className="chart-card report-count-card">
                  <span className="eyebrow">SESSION CONTENTS</span>
                  <div className="report-count"><strong>{observations.length.toLocaleString()}</strong><span>loaded observation records</span></div>
                  <div className="report-count"><strong>{images.length}</strong><span>image assets listed by API</span></div>
                  <div className="report-count"><strong>{[fitsAnalysis, roiAnalysis, pixelAnalysis, clusterResult, anomalyResult].filter(Boolean).length}</strong><span>analysis result types available</span></div>
                </article>
              </div>

              <div className="section-heading lower-heading"><div><h2>Evidence inventory</h2><p>Check which evidence sources are available before exporting.</p></div></div>
              <div className="evidence-inventory">
                {[
                  ["Observation metadata", `${observations.length.toLocaleString()} records loaded`, observations.length > 0],
                  ["Scientific image assets", `${images.length} assets returned`, images.length > 0],
                  ["FITS image analysis", fitsAnalysis ? "Analysis result available" : "Run Scientific Analysis to add this result", Boolean(fitsAnalysis)],
                  ["Epoch WCS comparison report", epochComparisonReport ? `${epochComparisonReport.eligibility_report?.state || "NOT EVALUATED"} · geometry ${epochComparisonReport.wcs_geometry_state || "NOT EVALUATED"}` : "No pair comparison report is loaded in this session", Boolean(epochComparisonReport)],
                  ["ROI region analysis", roiAnalysis ? "Analysis result available" : "No ROI result loaded in this session", Boolean(roiAnalysis)],
                  ["Pixel inspection", pixelAnalysis ? "Pixel result available" : "No pixel result loaded in this session", Boolean(pixelAnalysis)],
                  ["Observation clustering", clusterResult ? "Model result available" : "No clustering result loaded in this session", Boolean(clusterResult)],
                  ["Anomaly detection", anomalyResult ? "Model result available" : "No anomaly result loaded in this session", Boolean(anomalyResult)],
                ].map(([label, detail, available]) => (
                  <div className="evidence-inventory-row" key={String(label)}>
                    <span className={`evidence-check ${available ? "available" : ""}`}>{available ? "✓" : "○"}</span>
                    <div><strong>{label}</strong><small>{detail}</small></div>
                    <span className="evidence-state">{available ? "AVAILABLE" : "NOT LOADED"}</span>
                  </div>
                ))}
              </div>

              <div className="section-heading lower-heading"><div><h2>Source image inventory</h2><p>Files currently returned by the backend image endpoint.</p></div></div>
              <div className="data-panel file-list">
                {images.map((file)=><div className="file-row" key={file.name}><span className="file-icon">{file.format.replace(".","").toUpperCase()}</span><div><strong>{file.name}</strong><small>{formatBytes(file.size_bytes)} · {file.url}</small></div></div>)}
                {!images.length&&<div className="empty-state">No image assets returned.</div>}
              </div>

              <div className="section-heading lower-heading"><div><h2>Observation evidence sample</h2><p>First 25 records from the currently loaded API sample. Export CSV for the complete loaded sample.</p></div></div>
              <div className="data-panel">
                <div className="table-scroll">
                  <div className="table-head"><span>OBSERVATION ID</span><span>COLLECTION</span><span>BAND</span><span>RA / DEC</span><span>STATUS</span></div>
                  {observations.slice(0,25).map((obs,index)=><div className="table-row" key={obs.id??obs.obs_id??index}><strong>{obs.obs_id??obs.id??`Record ${index+1}`}</strong><span>{obs.collection??"—"}</span><span>{obs.band??"—"}</span><span>{formatCoordinate(obs.ra_deg)} / {formatCoordinate(obs.dec_deg)}</span><span>{obs.calibration_status??"Available"}</span></div>)}
                  {!observations.length&&<div className="empty-state">No observation records are currently loaded.</div>}
                </div>
              </div>
              <p className="page-note">Export scope: JSON includes the data and analysis results currently held in this browser session. CSV includes the observation records currently loaded by the API, not necessarily the entire database. Print / Save PDF uses the browser print dialog.</p>
            </section>
          ) : active === "Scientific Visualization" ? (
            <ScientificVisualizationWorkspace observations={observations} summary={summary} />
          ) : active === "Smart Search" ? (
            <SmartObservationSearchWorkspace observations={observations} />
          ) : active === "IRSA Archive" ? (
            <IrsaArchiveWorkspace initialTarget={targetQueryPreset} onEvidenceChange={setArchiveEvidence} />
          ) : active === "Explainable AI" ? (
            <ExplainableAIWorkspace clusterResult={clusterResult} anomalyResult={anomalyResult} observations={observations} />
          ) : active === "Galaxy Explorer" ? (
            <InteractiveGalaxyExplorer />
          ) : active === "Mission Readiness" ? (
            <section className="page-section readiness-page">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span /> FINAL SYSTEM VALIDATION</div>
                  <h1>Mission <span>Readiness.</span></h1>
                  <p className="subtitle">A final operational checklist for the XPLORERS demonstration environment.</p>
                </div>
                <span className="quality-chip quality-reject">NOT READY FOR JUDGING</span>
              </div>

              <div className="readiness-hero chart-card">
                <div><span className="new-tag">OPERATIONAL CHECK ONLY</span><h2>Check the local demo environment.</h2><p>A live backend check reports service availability. It does not certify scientific eligibility, a public deployment, or judging readiness.</p></div>
                <button className="primary-button" type="button" onClick={runReadinessCheck} disabled={readinessCheck === "checking"}>{readinessCheck === "checking" ? "Checking…" : "Run backend check ↗"}</button>
                {readinessCheck !== "idle" && <div className={`readiness-result ${readinessCheck}`}>{readinessCheck === "passed" ? "✓ " : readinessCheck === "failed" ? "⚠ " : ""}{readinessMessage || "Checking backend…"}</div>}
              </div>

              <div className="section-heading lower-heading"><div><h2>Live system checklist</h2><p>These indicators reflect current browser-session state; they are not a substitute for full end-to-end testing.</p></div></div>
              <div className="readiness-grid">
                {[
                  ["Backend API", health === "Connected" ? "Frontend connection reports connected" : `Current state: ${health}`, health === "Connected"],
                  ["Health endpoint", readinessCheck === "passed" ? "Live /health request succeeded" : readinessCheck === "failed" ? "Live /health request failed" : "Run the backend check above", readinessCheck === "passed"],
                  ["Database summary", summary ? `${Number(summary.total_rows ?? 0).toLocaleString()} rows reported` : "Summary not loaded", Boolean(summary)],
                  ["Observation data", observations.length ? `${observations.length.toLocaleString()} records loaded in this session` : "No observations loaded", observations.length > 0],
                  ["Image inventory", images.length ? `${images.length} image assets returned` : "No image assets loaded", images.length > 0],
                  ["AI clustering", clusterResult ? "A clustering result is available" : "Run clustering to create a session result", Boolean(clusterResult)],
                  ["Anomaly detection", anomalyResult ? "Anomaly result is available" : "Run anomaly detection to create a session result", Boolean(anomalyResult)],
                  ["Scientific evidence", "Export center exists; validated target measurements remain NOT EVALUATED", false],
                ].map(([title, detail, passed]) => <article className="readiness-item" key={String(title)}><span className={`readiness-indicator ${passed ? "passed" : ""}`}>{passed ? "✓" : "○"}</span><div><strong>{title}</strong><small>{detail}</small></div><span className={`readiness-label ${passed ? "passed" : ""}`}>{passed ? "READY" : "CHECK"}</span></article>)}
              </div>

              <div className="epoch-state-row"><div><span className="new-tag">SCIENTIFIC ACCEPTANCE</span><p>Same-sky long-baseline products, empirical source registration, calibration-compatible measurements, motion, light curves, spectra, and scientific change detection have not passed validation. See Target Coverage and the traceability checklist for the exact blockers.</p></div><span className="quality-chip quality-reject">NOT READY</span></div>

              <div className="section-heading lower-heading"><div><h2>Safe real-data demo route</h2><p>Demonstrate archive provenance and validation boundaries without claiming unevaluated science.</p></div></div>
              <div className="demo-route">
                {[
                  ["01","Target Coverage","Review sourced target coordinates and retained archive coverage","Target Coverage"],
                  ["02","IRSA Archive","Submit one bounded SIA query and inspect its completeness state","IRSA Archive"],
                  ["03","Scientific Analysis","Inspect an existing verified product and its FITS/WCS metadata","Scientific Analysis"],
                  ["04","WCS eligibility","Show geometry diagnostics separately from the REJECTed science gate","Scientific Analysis"],
                  ["05","Scientific Evidence","Export the current query, product and comparison evidence","Scientific Evidence"],
                ].map(([number,title,description,target])=><button type="button" className="demo-route-step" key={number} onClick={()=>setActive(target)}><span>{number}</span><div><strong>{title}</strong><small>{description}</small></div><b>↗</b></button>)}
              </div>
              <p className="page-note">A READY indicator means the related data or feature is available in the current session. It does not certify scientific validity, deployment security, or NASA approval. Complete a fresh end-to-end test before presenting.</p>
            </section>
          ) : (
            <section className="page-section"><div className="welcome-row"><div><div className="eyebrow"><span /> PLATFORM CONFIGURATION</div><h1>Settings<span>.</span></h1><p className="subtitle">Current local connection settings for the XPLORERS workspace.</p></div></div><div className="chart-card settings-card"><div className="settings-row"><span>Backend API</span><strong>{API}</strong></div><div className="settings-row"><span>Connection status</span><strong>{health}</strong></div><div className="settings-row"><span>Observation records loaded</span><strong>{observations.length.toLocaleString()}</strong></div><div className="settings-row"><span>Image files loaded</span><strong>{images.length}</strong></div><button className="refresh-button" onClick={()=>setRefreshKey((value)=>value+1)} disabled={loading} type="button">{loading?"Refreshing…":"↻ Test connection / Refresh data"}</button></div></section>
          )}
          <footer className="footer">
            <span>© 2026 Xplorers · Astronomy Intelligence Platform</span>
            <span>BUILT FOR DISCOVERY <b>✦</b></span>
          </footer>
        </div>
      </section>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box}
        body{margin:0;background:#080d19;color:#eaf1ff;font-family:'DM Sans',sans-serif}
        button{font:inherit;cursor:pointer}
        button:disabled{opacity:.55;cursor:wait}
        .x-shell{min-height:100vh;display:flex;position:relative;isolation:isolate;overflow:hidden;background:radial-gradient(ellipse at 78% 18%,#102c4a 0%,#0a1426 34%,#070c18 72%)}
        .cosmic-backdrop{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background-color:#050b18;background-image:radial-gradient(1px 1px at 7% 13%,#d8f6ff 98%,transparent),radial-gradient(1.5px 1.5px at 17% 72%,#91c9ff 98%,transparent),radial-gradient(1px 1px at 31% 28%,#fff 98%,transparent),radial-gradient(2px 2px at 47% 82%,#a9d8ff 98%,transparent),radial-gradient(1px 1px at 62% 11%,#fff 98%,transparent),radial-gradient(1.5px 1.5px at 83% 64%,#b9eaff 98%,transparent),radial-gradient(1px 1px at 94% 24%,#fff 98%,transparent);background-size:390px 310px;animation:star-drift 75s linear infinite;opacity:.88}
        .cosmic-backdrop:before{content:"";position:absolute;inset:-30%;background-image:radial-gradient(2px 2px at 12% 24%,#fff 98%,transparent),radial-gradient(1px 1px at 42% 58%,#9ceaff 98%,transparent),radial-gradient(2px 2px at 76% 32%,#d4dfff 98%,transparent),radial-gradient(1px 1px at 88% 78%,#fff 98%,transparent);background-size:520px 430px;opacity:.55;animation:star-drift-reverse 115s linear infinite}
        .cosmic-backdrop:after{content:"";position:absolute;inset:-25%;background:radial-gradient(ellipse at 72% 32%,#1479a52b 0%,transparent 35%),radial-gradient(ellipse at 20% 75%,#4734a52a 0%,transparent 38%),radial-gradient(ellipse at 88% 85%,#0c7b9d20 0%,transparent 28%);filter:blur(28px);animation:nebula-drift 34s ease-in-out infinite alternate}
        .cosmic-nebula{position:absolute;width:55vw;height:38vw;min-width:360px;min-height:260px;border-radius:50%;filter:blur(55px);opacity:.12;mix-blend-mode:screen}
        .cosmic-nebula-one{right:-10%;top:10%;background:radial-gradient(ellipse,#1c9ed0 0%,#214c9c 34%,transparent 72%);animation:nebula-float 27s ease-in-out infinite alternate}
        .cosmic-nebula-two{left:-20%;bottom:-15%;background:radial-gradient(ellipse,#5942b8 0%,#174e87 38%,transparent 72%);animation:nebula-float 35s ease-in-out infinite alternate-reverse}
        .cosmic-planet-system{position:absolute;width:clamp(300px,39vw,560px);aspect-ratio:1;right:0%;top:7%;opacity:.9;transform-origin:60% 48%;animation:system-float 16s ease-in-out infinite}
        .cosmic-planet{position:absolute;width:57%;aspect-ratio:1;left:22%;top:20%;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 31% 25%,#d7fbff 0%,#6bd3ef 5%,#287eb6 18%,#164a83 39%,#0c2852 65%,#050f29 84%);box-shadow:inset -27px -15px 38px #020716,inset 10px 7px 24px #b8f5ff66,0 0 45px #36c9ff3d,0 0 105px #1b9bd52a;animation:planet-spin 24s linear infinite}
        .planet-clouds{position:absolute;inset:-12%;border-radius:50%;background:repeating-linear-gradient(14deg,transparent 0 13px,#b6efff24 14px 17px,transparent 18px 29px),repeating-linear-gradient(172deg,transparent 0 25px,#031a3b48 26px 32px,transparent 33px 48px),radial-gradient(ellipse at 28% 43%,#b6f6ff35 0 7%,transparent 34%),radial-gradient(ellipse at 68% 66%,#63bde333 0 10%,transparent 38%);mix-blend-mode:screen;animation:cloud-spin 17s linear infinite}
        .planet-highlight{position:absolute;inset:0;border-radius:50%;background:linear-gradient(110deg,transparent 35%,#02091b15 54%,#0107159c 100%),radial-gradient(ellipse at 28% 22%,#e8ffff5c 0%,transparent 38%);box-shadow:inset -22px -4px 32px #020716a8}
        .cosmic-planet:after{content:"";position:absolute;left:-15%;top:38%;width:130%;height:22%;border:2px solid #8deaff55;border-left-color:#c8f8ff9c;border-right-color:#64d8ff25;border-radius:50%;transform:rotate(-22deg);box-shadow:0 0 13px #50dfff44;pointer-events:none}
        .cosmic-orbit{position:absolute;width:92%;height:31%;left:4%;top:34%;border:1px solid #64dfff42;border-radius:50%;transform:rotate(-24deg);animation:orbit-glow 7s ease-in-out infinite}
        .cosmic-orbit-two{width:106%;height:23%;left:-3%;top:39%;transform:rotate(29deg);border-color:#9aaaff2b;animation-delay:-3.5s}
        .orbit-moon{position:absolute;left:12%;top:4%;width:13px;height:13px;border-radius:50%;background:radial-gradient(circle at 30% 25%,#fff 0%,#a9eaff 20%,#397cae 62%,#102342 100%);box-shadow:0 0 14px #7de6ffb5;animation:moon-glow 4s ease-in-out infinite}
        @keyframes star-drift{from{background-position:0 0}to{background-position:390px 310px}}
        @keyframes star-drift-reverse{from{transform:translate3d(0,0,0)}to{transform:translate3d(-240px,180px,0)}}
        @keyframes nebula-drift{0%{transform:translate3d(-2%,1%,0) scale(1)}100%{transform:translate3d(3%,-2%,0) scale(1.12)}}
        @keyframes nebula-float{0%{transform:translate3d(-4%,2%,0) rotate(-8deg)}100%{transform:translate3d(5%,-5%,0) rotate(9deg)}}
        @keyframes system-float{0%,100%{transform:translate3d(0,0,0) rotate(-2deg)}50%{transform:translate3d(-12px,17px,0) rotate(2deg)}}
        @keyframes planet-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes cloud-spin{from{transform:rotate(0deg) scale(1.04)}to{transform:rotate(-360deg) scale(1.04)}}
        @keyframes orbit-glow{0%,100%{opacity:.38}50%{opacity:.95}}
        @keyframes moon-glow{0%,100%{box-shadow:0 0 9px #7de6ff88}50%{box-shadow:0 0 19px #7de6ffff}}

        .interactive-planet-widget{position:absolute;width:clamp(300px,39vw,560px);aspect-ratio:1;right:0%;top:7%;z-index:0;pointer-events:none;animation:system-float 16s ease-in-out infinite}
        .interactive-planet-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;cursor:grab;touch-action:none;filter:drop-shadow(0 0 34px #24bde955)}
        .interactive-planet-canvas:active{cursor:grabbing}
        .planet-widget-label{position:absolute;top:12%;right:15%;font:700 9px 'Space Grotesk';letter-spacing:2px;color:#8deaff;opacity:.8}
        .live-dot{display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:50%;background:#62f5cf;box-shadow:0 0 10px #62f5cf;animation:live-pulse 1.6s ease-in-out infinite}
        .planet-drag-hint{position:absolute;left:12%;bottom:22%;font:700 8px 'Space Grotesk';letter-spacing:2px;color:#b5eaff99;animation:hint-pulse 2.5s ease-in-out infinite}
        .planet-controls{position:absolute;right:12%;bottom:17%;display:flex;align-items:center;gap:8px;pointer-events:auto;padding:7px 9px;border:1px solid #6ddfff35;border-radius:30px;background:#061426bb;backdrop-filter:blur(12px);color:#bceeff;font:700 8px 'Space Grotesk';letter-spacing:1px}
        .planet-controls button,.planet-controls select{border:1px solid #5ed8f044;border-radius:20px;background:#0b2740;color:#d8f7ff;padding:6px 9px;font:inherit;cursor:pointer}
        .planet-controls label{display:flex;align-items:center;gap:5px}
        @keyframes live-pulse{0%,100%{opacity:.55;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
        @keyframes hint-pulse{0%,100%{opacity:.4}50%{opacity:1}}
        .sidebar,.main-content{position:relative;z-index:1}
        .sidebar{width:255px;flex-shrink:0;background:linear-gradient(180deg,#0b1425ee,#091222e8);backdrop-filter:blur(18px);border-right:1px solid #1c2940;padding:28px 17px;display:flex;flex-direction:column;min-height:100vh}
        .brand{display:flex;align-items:center;gap:12px;padding:0 10px 34px}
        .brand-icon{width:39px;height:39px;flex-shrink:0;border-radius:12px;background:linear-gradient(135deg,#19d5ed,#6e78ff);display:grid;place-items:center;color:#06101f;font-size:25px;box-shadow:0 0 25px #27cde544}
        .brand strong{font:700 21px 'Space Grotesk';letter-spacing:1.5px;white-space:nowrap}
        .brand strong span{color:#36d8ed}
        .brand small,.profile small{display:block;color:#7889a6;font-size:9px;letter-spacing:1.5px;margin-top:4px;white-space:nowrap}
        .workspace{border:1px solid #26344d;background:#111c30;padding:13px 12px;border-radius:9px;font-size:10px;letter-spacing:1px;color:#aebbd1;display:flex;align-items:center;gap:9px;margin-bottom:34px;white-space:nowrap}
        .workspace-dot,.status-dot{width:7px;height:7px;flex-shrink:0;border-radius:50%;background:#f3b85d}
        .workspace-arrow{margin-left:auto}
        .nav-label{font-size:10px;color:#62738e;letter-spacing:1.8px;padding:0 12px 12px}
        .nav-item{border:0;background:transparent;color:#94a3ba;width:100%;display:flex;align-items:center;gap:13px;text-align:left;padding:12px;border-radius:8px;font-size:13px;margin-bottom:4px;transition:.2s}
        .nav-item:hover{background:#14243a;color:white}
        .nav-item.selected{background:linear-gradient(90deg,#17364a,#15243a);color:#53dff1;border:1px solid #24536a}
        .nav-icon{width:20px;flex-shrink:0;text-align:center;font-size:18px;color:#4bd8ed}
        .nav-text{white-space:nowrap}
        .new-tag{margin-left:auto;background:#382e62;color:#c4a8ff;border-radius:5px;padding:3px 6px;font-size:9px}
        .second-label{margin-top:28px}
        .sidebar-bottom{margin-top:auto}
        .status-line{display:flex;align-items:center;gap:9px;color:#92a4bc;font-size:11px;padding:15px 9px;border-top:1px solid #1d2a40}
        .status-dot.online{background:#35d89c;box-shadow:0 0 10px #35d89c}
        .profile{border-top:1px solid #1d2a40;padding:18px 7px;display:flex;align-items:center;gap:10px}
        .avatar,.top-avatar{width:32px;height:32px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#2dd5e9,#7569ed);display:grid;place-items:center;color:#071321;font-weight:800}
        .profile strong{font-size:11px;white-space:nowrap}
        .profile small{letter-spacing:0;font-size:10px}
        .version{font-size:8px;letter-spacing:1px;color:#586b87;padding:0 8px;white-space:nowrap}
        .main-area{min-width:0;flex:1}
        .topbar{height:72px;border-bottom:1px solid #1b2940;display:flex;align-items:center;justify-content:space-between;padding:0 42px;background:#0b1220}
        .breadcrumb{font-size:12px;color:#8fa1ba}.breadcrumb span{padding:0 10px;color:#455670}
        .top-actions{display:flex;align-items:center;gap:22px}
        .live-indicator{font-size:9px;letter-spacing:1px;color:#8eabc2;display:flex;align-items:center;gap:8px}
        .live-indicator i{width:7px;height:7px;border-radius:50%;background:#35d89c;box-shadow:0 0 10px #35d89c}
        .icon-button{background:transparent;color:#a9b9d0;border:0;font-size:20px}
        .top-avatar{width:30px;height:30px}
        .content{width:100%;max-width:1500px;margin:auto;padding:38px 43px 20px}
        .welcome-row{display:flex;align-items:end;justify-content:space-between;margin-bottom:27px;gap:20px}
        .eyebrow{font-size:10px;color:#49d9eb;letter-spacing:2px;display:flex;gap:9px;align-items:center}
        .eyebrow span{width:18px;height:1px;background:#49d9eb}
        h1,h2,h3{font-family:'Space Grotesk',sans-serif}
        h1{font-size:36px;letter-spacing:-1.5px;margin:13px 0 7px}
        h1 span{color:#45d7e9}
        .subtitle,.section-heading p{color:#8394ae;font-size:12px;margin:0}
        .date-chip{border:1px solid #263650;border-radius:7px;padding:10px 14px;color:#9baec9;font-size:10px;letter-spacing:1px;white-space:nowrap}
        .hero-panel{height:270px;border:1px solid #24405a;border-radius:13px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 75% 48%,#163b58 0%,#111d35 37%,#10182b 70%);padding:30px 37px;margin-bottom:35px}
        .hero-glow{position:absolute;width:350px;height:260px;background:#20d6e9;filter:blur(130px);opacity:.10;right:15%;top:0}
        .hero-content{position:relative;z-index:2;max-width:480px}
        .hero-tag{font-size:9px;letter-spacing:1.7px;color:#4bdeed}
        .hero-content h2{font-size:34px;line-height:1.08;margin:13px 0 10px;letter-spacing:-1px}
        .hero-content p{font-size:11px;line-height:1.7;color:#9aabc4;max-width:380px}
        .primary-button{border:0;border-radius:6px;background:linear-gradient(100deg,#36d7e8,#6689f5);color:#081321;font-weight:700;font-size:11px;padding:11px 16px;margin-top:8px}
        .primary-button span{margin-left:17px}
        .orbit-art{position:absolute;right:10%;top:50%;transform:translateY(-50%);width:260px;height:220px}
        .orbit{position:absolute;border:1px solid #56d9e94a;border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-25deg)}
        .orbit-one{width:245px;height:95px}.orbit-two{width:200px;height:165px;transform:translate(-50%,-50%) rotate(45deg)}.orbit-three{width:140px;height:210px;transform:translate(-50%,-50%) rotate(65deg)}
        .planet{position:absolute;width:80px;height:80px;border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%);background:radial-gradient(circle at 32% 30%,#d3fbff,#4c9cc7 27%,#204a82 58%,#101b44 80%);box-shadow:0 0 40px #42d9ed88,inset -12px -8px 20px #080e2c}
        .planet div{position:absolute;inset:14px;border:1px solid #c7faff55;border-radius:50%}
        .orbit-star{position:absolute;color:#65eaff}.star-a{top:18px;right:26px}.star-b{bottom:18px;left:24px}.star-c{right:0;bottom:70px}
        .hero-caption{position:absolute;bottom:17px;right:22px;color:#6f8da9;font-size:8px;letter-spacing:2px}
        .hero-caption span{color:#39d7e8;padding:0 7px}
        .hero-actions{display:flex;align-items:center;gap:17px;flex-wrap:wrap;margin-top:8px}
        .hero-actions .primary-button{margin-top:0;cursor:pointer;transition:transform .2s,box-shadow .2s}
        .hero-actions .primary-button:hover{transform:translateY(-2px);box-shadow:0 8px 28px #36d7e844}
        .hero-secondary-button{background:#0c1a2b99;border:1px solid #3b617b;border-radius:6px;color:#c4d8eb;padding:10px 13px;font-size:10px;cursor:pointer;transition:background .2s,border-color .2s}
        .hero-secondary-button:hover{background:#17334a;border-color:#43d8e8}
        .hero-secondary-button span{color:#42d9e9;margin-left:9px}
        .discovery-launchpad{margin:0 0 34px;padding:24px;border:1px solid #233b55;border-radius:13px;background:linear-gradient(135deg,#0e1b2e 0%,#0c1525 65%,#111c31 100%);position:relative;overflow:hidden}
        .discovery-launchpad:before{content:"";position:absolute;width:360px;height:220px;right:-130px;top:-145px;background:#24c9e9;filter:blur(110px);opacity:.10;pointer-events:none}
        .launchpad-heading{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:19px;position:relative}
        .launchpad-heading h2{font:600 22px 'Space Grotesk';letter-spacing:-.6px;margin:10px 0 6px}
        .launchpad-heading h2 span{color:#43d7e9}
        .launchpad-heading p{font-size:10px;color:#8498b3;margin:0;line-height:1.6}
        .launchpad-hint{font-size:8px;letter-spacing:1.5px;color:#6885a4;white-space:nowrap}
        .launchpad-hint b{color:#42d9e9;font-size:14px;margin-left:7px}
        .launchpad-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;position:relative}
        .launch-card{position:relative;overflow:hidden;text-align:left;display:flex;flex-direction:column;align-items:flex-start;min-height:205px;padding:17px 16px 15px;border:1px solid #2a405b;border-radius:10px;background:linear-gradient(150deg,#14243a,#101a2b 75%);color:#eaf4ff;cursor:pointer;transition:transform .22s,border-color .22s,background .22s,box-shadow .22s}
        .launch-card:hover{transform:translateY(-5px);border-color:#45d9e9;background:linear-gradient(150deg,#19334b,#111d30 80%);box-shadow:0 12px 32px #02081266}
        .launch-card-featured{border-color:#32718a;background:linear-gradient(145deg,#14334a,#111c30 78%)}
        .launch-card-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;background:#1b4054;color:#53e2ef;font-size:19px;margin-bottom:15px}
        .launch-card-kicker{font-size:7px;letter-spacing:1.3px;color:#63cfe0;margin-bottom:7px}
        .launch-card strong{font:600 15px 'Space Grotesk';margin-bottom:7px;position:relative;z-index:1}
        .launch-card small{font-size:9px;line-height:1.55;color:#8fa3bd;max-width:220px;min-height:42px;position:relative;z-index:1}
        .launch-card-link{font-size:9px;color:#4ad8e9;margin-top:auto;padding-top:12px;position:relative;z-index:2}
        .launch-card-link b{margin-left:7px}
        .launch-card-art{position:absolute;right:-13px;top:45px;width:105px;height:105px;opacity:.20;pointer-events:none}
        .launch-art-globe{border:1px solid #4cdaeb;border-radius:50%;box-shadow:inset 0 0 25px #43d9e922}
        .launch-art-globe:before,.launch-art-globe:after{content:"";position:absolute;inset:10px 27px;border:1px solid #4cdaeb;border-radius:50%}
        .launch-art-globe:after{inset:27px 2px;border-radius:50%}
        .launch-art-globe i{position:absolute;left:50%;top:50%;width:4px;height:4px;background:#7af3ff;border-radius:50%}
        .launch-art-globe i:nth-child(1){transform:translate(-23px,-28px)}.launch-art-globe i:nth-child(2){transform:translate(25px,15px)}.launch-art-globe i:nth-child(3){transform:translate(-5px,36px)}
        .launch-art-image{font-size:90px;line-height:1;color:#53dff0;right:0;top:54px}
        .launch-art-compare:before,.launch-art-compare:after{content:"";position:absolute;width:55px;height:75px;border:1px solid #52dff0;border-radius:5px;top:12px;left:12px;transform:rotate(-12deg);background:linear-gradient(135deg,#4bd7e922,transparent)}
        .launch-art-compare:after{left:39px;top:22px;transform:rotate(10deg)}
        .launch-art-ai{display:grid;grid-template-columns:repeat(2,12px);grid-template-rows:repeat(2,12px);gap:15px;place-content:center;transform:rotate(25deg)}
        .launch-art-ai i{border:1px solid #55dff0;border-radius:50%;box-shadow:0 0 12px #55dff044}
        .mission-strip{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:21px 0 6px;padding:15px 18px;border:1px solid #24445a;border-radius:9px;background:linear-gradient(90deg,#102b3b,#101c2e)}
        .mission-strip-copy{display:flex;align-items:center;gap:12px}
        .mission-pulse{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:#39d9a5;box-shadow:0 0 13px #39d9a5}
        .mission-strip-copy div{display:flex;flex-direction:column;gap:4px}
        .mission-strip-copy strong{font-size:11px;color:#e6f4ff}
        .mission-strip-copy small{font-size:9px;color:#8da4bd;line-height:1.5}
        .mission-strip button{border:1px solid #356078;background:#0c1b2d;color:#55d9eb;border-radius:6px;padding:9px 12px;font-size:9px;white-space:nowrap;cursor:pointer}
        .mission-strip button:hover{background:#17364b}
        .mission-strip button b{margin-left:8px}
        .section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px;gap:15px}
        .section-heading h2{font-size:18px;margin:0 0 5px}
        .section-heading p{font-size:10px}
        .heading-actions{display:flex;align-items:center;gap:13px}
        .data-source{color:#40d7a7;font-size:9px;letter-spacing:1px;white-space:nowrap}
        .source-offline{color:#f0b45a}
        .refresh-button{background:#10243a;border:1px solid #28516a;border-radius:6px;color:#55d9eb;padding:8px 11px;font-size:10px;white-space:nowrap}
        .error-banner{display:flex;flex-direction:column;gap:5px;margin-bottom:16px;padding:13px 15px;border:1px solid #704b36;border-radius:8px;background:#2a1d1a;color:#f0c39a;font-size:11px}
        .error-banner span{color:#c7a78d}
        .stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
        .stat-card{background:#101a2c;border:1px solid #23334c;border-radius:9px;padding:18px;min-height:125px;min-width:0}
        .stat-top{display:flex;justify-content:space-between;align-items:center;gap:8px;color:#93a4bd;font-size:10px}
        .stat-icon{font-size:19px;color:#4bd9ed}
        .color-1{color:#9b8bff}.color-2{color:#49d9aa}.color-3{color:#e3b56e}
        .stat-value{font:600 24px 'Space Grotesk';margin-top:13px;color:#eef5ff;overflow-wrap:anywhere}
        .stat-foot{font-size:9px;color:#627793;margin-top:5px}
        .lower-heading{margin-top:36px}
        .charts-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}
        .chart-card{background:#101a2c;border:1px solid #233b55;border-radius:11px;padding:20px;min-width:0;min-height:235px}
        .timeline-card{grid-column:1/-1;min-height:250px}

        .ai-model-card{margin-top:22px}
        .ai-controls{display:flex;align-items:end;gap:15px;flex-wrap:wrap;margin:18px 0 8px}
        .ai-select-label{display:flex;flex-direction:column;gap:8px;color:#9aabc4;font-size:10px}
        .ai-select-label select{min-width:180px;background:#0b1526;border:1px solid #2a4562;border-radius:6px;color:#eaf1ff;padding:11px 12px}
        .cluster-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}
        .cluster-card{min-height:0}
        .cluster-title{display:flex;align-items:center;gap:9px;margin-bottom:18px}
        .cluster-title h3{font-size:15px;margin:0}
        .cluster-title strong{margin-left:auto;color:#51d9e9;font-size:10px}
        .cluster-dot{width:9px;height:9px;border-radius:50%;background:#4bd9ed;box-shadow:0 0 12px #4bd9ed88}
        .cluster-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .cluster-metrics div{background:#0b1526;border:1px solid #20344d;border-radius:7px;padding:11px}
        .cluster-metrics small,.cluster-breakdown small{display:block;color:#7186a4;font-size:9px;margin-bottom:6px}
        .cluster-metrics strong{font-size:12px;color:#e7f1ff;overflow-wrap:anywhere}
        .cluster-breakdown{margin-top:15px}
        .cluster-breakdown p{color:#9aabc4;font-size:10px;line-height:1.7;margin:0;overflow-wrap:anywhere}
        .cluster-table-head{grid-template-columns:1.3fr .8fr .7fr 1.4fr .8fr}
        @media(max-width:900px){.cluster-grid{grid-template-columns:1fr}}
        @media(max-width:650px){.ai-controls{align-items:stretch}.ai-select-label select{width:100%}.cluster-table-head{min-width:700px}}

        .chart-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:22px}
        .chart-title-row h3{font-size:14px;margin:0 0 5px;color:#eaf2ff}
        .chart-title-row p{font-size:10px;color:#8093ad;margin:0}
        .chart-mark{font:600 11px 'Space Grotesk';color:#4bd9ed;border:1px solid #28516a;border-radius:6px;padding:5px 7px}
        .bar-list{display:flex;flex-direction:column;gap:16px}
        .bar-item{min-width:0}
        .bar-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:7px;color:#aabbd1;font-size:10px}
        .bar-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .bar-label strong{color:#e5efff;font-weight:600;white-space:nowrap}
        .bar-track{height:9px;background:#26364d;border-radius:20px;overflow:hidden}
        .bar-fill{height:100%;border-radius:20px;transition:width .35s ease}
        .collection-fill{background:linear-gradient(90deg,#2875e8,#36c9e8)}
        .chart-empty{min-height:135px;display:grid;place-items:center;text-align:center;color:#8295af;font-size:11px}
        .timeline-chart{height:160px;display:flex;align-items:stretch;gap:clamp(5px,1.4vw,15px);overflow-x:auto;padding:4px 2px 0}
        .timeline-column{height:100%;min-width:34px;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px}
        .timeline-value{font-size:9px;color:#9aabc4;white-space:nowrap}
        .timeline-bar-wrap{height:105px;width:100%;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #40516a}
        .timeline-bar{width:min(65%,25px);min-height:4px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#36c9e8,#2875e8);box-shadow:0 0 13px #36c9e833}
        .timeline-date{font-size:9px;color:#9aabc4;white-space:nowrap}
        .axis-caption{display:flex;justify-content:space-between;gap:10px;margin-top:12px;color:#6f829e;font-size:9px}
        .record-count{color:#8295af;font-size:10px;white-space:nowrap}
        .outline-button{background:transparent;border:1px solid #34465f;border-radius:6px;color:#9eafc7;padding:9px 13px;font-size:10px}
        .outline-button:hover{border-color:#43d7e8;color:#43d7e8}
        .data-panel{border:1px solid #23334b;border-radius:9px;background:#0e1829;overflow:hidden;min-height:180px}
        .table-scroll{overflow-x:auto}
        .table-head,.table-row{display:grid;grid-template-columns:1.35fr 1.15fr .65fr 1.25fr 1fr;gap:12px;align-items:center;padding:14px 18px;min-width:720px}
        .table-head{background:#142138;color:#7488a5;font-size:8px;letter-spacing:1px}
        .table-row{border-top:1px solid #202f45;font-size:10px;color:#a5b4c9}
        .table-row strong{color:#e0eafa;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .table-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .record-status{color:#e8b86a}.record-status.calibrated{color:#46d8a3}
        .empty-state{padding:30px;text-align:center;color:#879ab4}
        .empty-icon{font-size:26px;color:#4ad8eb;margin-bottom:10px}
        .empty-state strong{display:block;font-size:12px;color:#c6d3e5}
        .empty-state p{font-size:10px}
        .table-note{padding:10px 18px;border-top:1px solid #202f45;color:#7588a4;font-size:9px}
        .footer{display:flex;justify-content:space-between;padding:27px 0 10px;color:#60718a;font-size:9px;letter-spacing:.5px;gap:12px}
        .footer b{color:#48d9e9}
        .page-section{min-height:65vh}.image-stats{margin-bottom:30px}.image-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.image-card{background:#101a2c;border:1px solid #233b55;border-radius:11px;padding:14px;min-width:0}.image-preview{display:block;height:270px;background:#070d18;border-radius:7px;overflow:hidden}.image-preview img{width:100%;height:100%;object-fit:contain;display:block}.image-card-info{display:flex;flex-direction:column;gap:6px;padding:13px 2px 8px}.image-card-info strong{font-size:12px;overflow-wrap:anywhere}.image-card-info span,.file-row small{font-size:10px;color:#8295af}.text-link{display:inline-block;color:#49d9eb;font-size:10px;text-decoration:none;margin-top:5px}.text-link:hover{text-decoration:underline}.file-list{padding:5px 18px}.file-row{display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid #202f45}.file-row:last-child{border-bottom:0}.file-row>div{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.file-row strong{font-size:11px;overflow-wrap:anywhere}.file-icon{display:grid;place-items:center;width:45px;height:38px;border:1px solid #28516a;border-radius:7px;color:#4bd9ed;font-size:9px;font-weight:700}.page-note{color:#8295af;font-size:11px;line-height:1.7;margin-top:18px}.sky-table-head,.sky-table-row{grid-template-columns:1.3fr 1fr 1fr .7fr 1.3fr}.compare-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:20px 0}.compare-controls label{display:flex;flex-direction:column;gap:8px;color:#9eafc7;font-size:11px}.compare-controls select{background:#101a2c;border:1px solid #34465f;border-radius:7px;color:#eaf1ff;padding:11px}.compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.compare-card p,.overlay-card p{color:#8295af;font-size:10px;overflow-wrap:anywhere}.compare-viewport,.overlay-viewport{height:340px;position:relative;overflow:hidden;display:grid;place-items:center;background:#070d18;border-radius:8px;margin-top:12px}.compare-viewport img{width:100%;height:100%;object-fit:contain;transform-origin:center;transition:transform .12s ease}.compare-toolbar{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:14px 16px;margin:0 0 16px;background:#101a2c;border:1px solid #233b55;border-radius:9px}.mode-switch{display:flex;gap:5px;padding:4px;background:#080f1d;border-radius:7px}.mode-switch button{border:0;border-radius:5px;padding:8px 11px;background:transparent;color:#91a4bf;font-size:10px}.mode-switch button.active{background:#17364a;color:#54dff1}.range-control{display:flex;flex-direction:column;gap:7px;min-width:145px;flex:1;color:#9eafc7;font-size:10px}.range-control span{display:flex;justify-content:space-between;gap:12px}.range-control strong{color:#eaf1ff}.range-control input{width:100%;accent-color:#36c9e8}.overlay-stack{width:100%;height:100%;position:relative;transform-origin:center;transition:transform .12s ease}.overlay-stack img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.overlay-caption{color:#8295af;font-size:10px;margin-top:12px}.universe-toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding:14px;margin:18px 0;background:#101a2c;border:1px solid #233b55;border-radius:10px}
        .universe-toolbar label{display:flex;flex-direction:column;gap:7px;color:#91a4bf;font-size:10px;min-width:145px}
        .universe-toolbar select,.universe-toolbar input{background:#0b1424;border:1px solid #34465f;border-radius:6px;color:#eaf1ff;padding:10px;min-width:0}
        .universe-toolbar .universe-search{flex:1}
        .universe-toolbar .universe-search input{width:100%}
        .universe-active{border-color:#36d6a5!important;color:#36d6a5!important}
        .universe-layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(245px,.8fr);gap:15px;align-items:stretch}
        .universe-panel{height:510px;position:relative;overflow:hidden;border:1px solid #24405a;border-radius:13px;background:radial-gradient(ellipse at 50% 50%,#153b59 0%,#0d1930 48%,#080d19 100%);display:grid;place-items:center}.universe-stars{position:absolute;inset:25px;color:#6de8f5;letter-spacing:18px;opacity:.65}.universe-orbit{position:absolute;border:1px solid #55d9e966;border-radius:50%;width:360px;height:150px}.orbit-a{transform:rotate(25deg)}.orbit-b{transform:rotate(-35deg);width:430px;height:210px}.orbit-c{transform:rotate(75deg);width:260px;height:390px}.universe-sphere{width:125px;height:125px;border-radius:50%;background:radial-gradient(circle at 30% 28%,#e1fbff,#4d9ec9 30%,#204b83 62%,#0b1536 82%);box-shadow:0 0 70px #42d9ed99,inset -15px -12px 25px #080e2c;z-index:1}.universe-caption{position:absolute;bottom:20px;color:#8ca8c5;font-size:10px;letter-spacing:2px}
        .universe-globe-stage{position:absolute;inset:25px 20px 55px;display:grid;place-items:center;perspective:900px}
        .universe-globe{width:min( min(68vw,430px), 78% );aspect-ratio:1;position:relative;border-radius:50%;transform-style:preserve-3d;transition:transform .18s ease}
        .universe-globe .universe-sphere{position:absolute;inset:0;width:100%;height:100%;z-index:0}
        .universe-point{position:absolute;z-index:3;width:8px;height:8px;padding:0;border:1px solid #e8fbff;border-radius:50%;background:var(--point-color);box-shadow:0 0 9px var(--point-color);transform:translate(-50%,-50%);cursor:pointer;transition:width .15s,height .15s,box-shadow .15s}
        .universe-point:hover,.universe-point.selected{width:15px;height:15px;box-shadow:0 0 18px 5px var(--point-color)}
        .auto-rotating{animation:universe-spin 24s linear infinite}
        @keyframes universe-spin{from{transform:scale(var(--universe-zoom,1)) rotateX(-12deg) rotateY(0deg)}to{transform:scale(var(--universe-zoom,1)) rotateX(-12deg) rotateY(360deg)}}
        .universe-zoom{position:absolute;bottom:48px;left:18px;display:flex;align-items:center;gap:9px;color:#8ca8c5;font-size:12px}
        .universe-zoom input,.universe-rotation input{accent-color:#36c9e8}
        .universe-zoom input{width:115px}
        .universe-inspector{min-width:0}
        .universe-observation{display:flex;flex-direction:column;gap:12px;padding:10px 0}
        .universe-observation>strong{font:600 15px 'Space Grotesk';color:#eaf1ff;overflow-wrap:anywhere}
        .universe-observation>div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #26364d;padding-bottom:9px;font-size:10px}
        .universe-observation span{color:#8295af}.universe-observation b{color:#eaf1ff;text-align:right;overflow-wrap:anywhere}
        .universe-empty{min-height:160px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;gap:8px;color:#8295af}
        .universe-empty span{font-size:26px;color:#43d9eb}.universe-empty strong{color:#eaf1ff;font-size:12px}.universe-empty p{font-size:10px;line-height:1.6}
        .universe-legend{border-top:1px solid #26364d;margin-top:12px;padding-top:13px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;color:#9aabc4;font-size:10px}
        .universe-legend strong{grid-column:1/-1;color:#eaf1ff;font-size:11px}
        .universe-legend div{display:flex;align-items:center;gap:7px}.universe-legend i{width:8px;height:8px;border-radius:50%;display:inline-block}
        .universe-rotation{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:14px}
        .universe-rotation label{display:flex;flex-direction:column;gap:8px;color:#91a4bf;font-size:10px}
        .universe-rotation input{width:100%}
.ai-notice{margin-top:22px}.ai-notice h2{font:600 19px 'Space Grotesk';margin:15px 0 8px}.ai-notice p{color:#9aabc4;font-size:12px;line-height:1.8;max-width:850px}.settings-card{max-width:800px}.settings-row{display:flex;justify-content:space-between;gap:20px;padding:15px 0;border-bottom:1px solid #26364d;font-size:11px;color:#91a4bf}.settings-row strong{color:#eaf1ff;text-align:right;overflow-wrap:anywhere}.settings-card .refresh-button{margin-top:18px}
                 .fits-selector-card{display:flex;align-items:center;gap:14px;flex-wrap:wrap;min-height:auto}.fits-select-label{font-size:11px;color:#9eafc7}.fits-selector-card select{min-width:260px;max-width:100%;background:#0b1424;border:1px solid #34465f;border-radius:7px;color:#eaf1ff;padding:10px 12px}.fits-source-note{font-size:10px;color:#7489a6}.fits-state{min-height:auto;margin-top:16px;color:#55d9eb;font-size:12px}.fits-stats{margin-top:18px}.fits-unit{font-size:17px}.fits-analysis-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.fits-metric{min-height:115px;display:flex;flex-direction:column;justify-content:space-between}.fits-metric span{font-size:10px;color:#91a4bf}.fits-metric strong{font:600 17px 'Space Grotesk';color:#eaf1ff;overflow-wrap:anywhere}.fits-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.fits-detail-grid span{display:flex;flex-direction:column;gap:7px;color:#8194ae;font-size:10px}.fits-detail-grid strong{color:#eaf1ff;font-size:12px;overflow-wrap:anywhere}.flag-list{display:flex;flex-direction:column;gap:0}.flag-row{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #26364d;color:#a8b8ce;font-size:10px}.flag-row strong{color:#eaf1ff}.wcs-table{grid-template-columns:1.2fr 1fr 1fr;min-width:560px}.fits-metadata{min-height:auto}.fits-metadata .chart-title-row{margin-bottom:18px}
         .pixel-inspector{margin-top:18px}
         .pixel-image-frame{display:flex;justify-content:center;align-items:center;overflow:auto;max-height:620px;padding:10px;background:#070d18;border:1px solid #263b55;border-radius:8px}
         .pixel-inspection-image{display:block;width:100%;max-width:900px;height:auto;cursor:crosshair;image-rendering:auto}
         .pixel-hint{margin:12px 0 0;color:#8295af;font-size:10px;line-height:1.6}
         .pixel-result{margin-top:16px;padding:16px;border:1px solid #28516a;border-radius:8px;background:#0b1728}
         .pixel-result-heading{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:15px;color:#4bd9ed;font-size:11px}
         .pixel-result-heading span{color:#8295af;font-size:10px}
         .pixel-result-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
         .pixel-result-grid div{display:flex;flex-direction:column;gap:6px;min-width:0}
         .pixel-result-grid span{color:#8194ae;font-size:10px}
         .pixel-result-grid strong{color:#eaf1ff;font-size:12px;overflow-wrap:anywhere}
        .roi-panel{margin-top:20px;padding:18px;border:1px solid #28516a;border-radius:9px;background:#0b1728}
        .roi-controls{display:grid;grid-template-columns:repeat(4,minmax(90px,1fr)) auto;gap:10px;align-items:end}
        .roi-controls label{display:flex;flex-direction:column;gap:7px;color:#91a4bf;font-size:10px}
        .roi-controls input{width:100%;min-width:0;background:#0b1424;border:1px solid #34465f;border-radius:6px;color:#eaf1ff;padding:10px}
        .roi-button{min-height:38px;padding:10px 13px;white-space:nowrap}
        .roi-button:disabled{opacity:.6;cursor:wait}
        .roi-result{margin-top:18px;padding-top:16px;border-top:1px solid #263b55}
        .roi-summary-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}
        .roi-summary-grid div{display:flex;flex-direction:column;gap:6px;min-width:0}
        .roi-summary-grid span{font-size:10px;color:#8194ae}
        .roi-summary-grid strong{font-size:12px;color:#eaf1ff;overflow-wrap:anywhere}
        .roi-histogram{margin-top:22px}
        .roi-bars{height:150px;display:flex;align-items:stretch;gap:8px;padding:8px 4px 0;border-bottom:1px solid #40516a}
        .roi-bin{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px}
        .roi-bar-track{height:112px;width:100%;display:flex;align-items:flex-end;justify-content:center}
        .roi-bar-fill{width:min(80%,30px);min-height:2px;border-radius:4px 4px 0 0;background:linear-gradient(180deg,#36d9e8,#2875e8)}
        .roi-bin span{font-size:8px;color:#91a4bf;white-space:nowrap}
        @media(max-width:1000px){.roi-controls{grid-template-columns:repeat(2,minmax(0,1fr))}.roi-button{grid-column:1/-1}.roi-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media(max-width:520px){.roi-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
         @media(max-width:760px){.pixel-result-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
         @media(max-width:760px){.fits-analysis-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fits-detail-grid{grid-template-columns:1fr}.fits-selector-card{align-items:stretch;flex-direction:column}.fits-selector-card select{width:100%;min-width:0}}
         @media(max-width:1050px){.launchpad-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n        @media(max-width:760px){.launchpad-grid{grid-template-columns:1fr}.discovery-launchpad{padding:18px}.launchpad-heading{align-items:flex-start;flex-direction:column}.launch-card{min-height:175px}.mission-strip{align-items:flex-start;flex-direction:column}.hero-actions{align-items:flex-start;flex-direction:column}.universe-layout,.universe-rotation{grid-template-columns:1fr}.universe-panel{height:390px}.universe-toolbar label{flex:1 1 140px}.image-grid,.compare-grid,.compare-controls{grid-template-columns:1fr}.image-preview{height:220px}.compare-viewport,.overlay-viewport{height:230px}.universe-panel{height:350px}.universe-orbit{max-width:90%}}
                @media(max-width:1100px){.sidebar{width:220px}.content{padding:30px 25px}.topbar{padding:0 25px}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.orbit-art{right:2%;opacity:.7}}
        @media(max-width:760px){.sidebar{width:68px;padding:20px 7px}.brand{padding:0 7px 30px}.brand-copy,.workspace,.nav-label,.nav-text,.new-tag,.sidebar-bottom .profile,.sidebar-bottom .version{display:none}.nav-item{justify-content:center;padding:13px 4px}.nav-icon{font-size:19px}.status-line{font-size:0;justify-content:center;padding:15px 0}.content{padding:25px 15px}.topbar{padding:0 15px}.welcome-row{align-items:flex-start;gap:12px;flex-direction:column}h1{font-size:29px}.hero-panel{padding:24px;height:290px}.hero-content{max-width:100%}.hero-content h2{font-size:29px}.orbit-art{opacity:.2;right:-80px}.charts-grid{grid-template-columns:1fr}.timeline-card{grid-column:auto}.section-heading{align-items:flex-start}.heading-actions{align-items:flex-end;flex-direction:column;gap:8px}.data-source{font-size:8px}.date-chip{font-size:9px}}
        @media(max-width:480px){.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stat-card{padding:12px;min-height:115px}.stat-top{font-size:9px}.stat-value{font-size:20px}.chart-card{padding:15px}.footer{flex-direction:column}.live-indicator{font-size:8px}.top-actions{gap:12px}.breadcrumb{font-size:10px}}
        /* HOMEPAGE VISUAL PASS — cinematic mission-control direction */
        .home-page,.dashboard-shell{background:radial-gradient(ellipse at 78% 2%,#0c2d45 0%,transparent 33%),linear-gradient(180deg,#050d19 0%,#081321 48%,#070f1c 100%)}
        .hero-panel{
          min-height:330px;height:auto;display:flex;align-items:center;
          background:
            radial-gradient(ellipse at 78% 52%,#123c59 0%,#0c2239 28%,transparent 58%),
            linear-gradient(112deg,#0d1b2d 0%,#0a1728 48%,#0c1d31 100%);
          border:1px solid #28506b;box-shadow:0 18px 55px #02081288,inset 0 1px #7bdcf21a;
          padding:42px 42px;margin-bottom:26px
        }
        .hero-panel:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,#071321 0%,transparent 65%),repeating-linear-gradient(0deg,transparent 0 39px,#5ccde708 40px);pointer-events:none}
        .hero-content{max-width:520px;z-index:3}
        .hero-tag{display:inline-flex;align-items:center;gap:9px;padding:7px 11px;border:1px solid #2c6277;border-radius:30px;background:#0d2b3c99;color:#61e5f0;font-size:8px;letter-spacing:2px}
        .hero-content h2{font-size:clamp(36px,4.3vw,54px);line-height:1.02;letter-spacing:-1.8px;margin:19px 0 13px;text-shadow:0 4px 28px #0008}
        .hero-content p{font-size:12px;line-height:1.85;color:#a9bfd2;max-width:410px}
        .orbit-art{right:5%;width:40%;height:100%;opacity:.95;z-index:2}
        .planet{width:112px;height:112px;box-shadow:0 0 35px #45d7f777,0 0 90px #239fc655,inset -15px -12px 30px #020d20}
        .orbit{border-color:#45c9e64a;box-shadow:0 0 12px #3bd5eb13}
        .orbit-one{width:310px;height:145px}
        .orbit-two{width:340px;height:180px}
        .orbit-three{width:280px;height:230px}
        .hero-caption{z-index:3;color:#7da5c2;letter-spacing:2.5px}
        .hero-actions{gap:12px;margin-top:20px}
        .hero-actions .primary-button{padding:13px 17px;border-radius:7px;background:linear-gradient(110deg,#27c9dc,#5288f4);box-shadow:0 8px 25px #20c6dc33}
        .hero-secondary-button{padding:12px 15px;background:#0b1b2bbd;border-color:#31546e}
        .discovery-launchpad{padding:25px 25px 23px;background:linear-gradient(135deg,#0c1a2b,#0a1524 60%,#0c1d30);border-color:#203f58;box-shadow:0 15px 40px #02081255}
        .launchpad-heading h2{font-size:25px}
        .launchpad-grid{gap:13px}
        .launch-card{min-height:218px;padding:19px 18px;background:linear-gradient(150deg,#13273d,#0d192a 78%);border-color:#29465f;box-shadow:inset 0 1px #ffffff08}
        .launch-card:hover{transform:translateY(-6px);box-shadow:0 16px 32px #02081288,0 0 0 1px #44d6e533}
        .launch-card-icon{width:36px;height:36px;background:linear-gradient(145deg,#16435a,#153149);border:1px solid #28617a}
        .launch-card strong{font-size:16px}
        .launch-card small{font-size:9.5px;line-height:1.7}
        .stat-card{background:linear-gradient(145deg,#12253a,#0c192a);border:1px solid #27435c;box-shadow:0 10px 28px #02081255,inset 0 1px #ffffff08;transition:transform .2s,border-color .2s}
        .stat-card:hover{transform:translateY(-3px);border-color:#42cfe2}
        .mission-strip{padding:18px 20px;background:linear-gradient(100deg,#102b3c,#0d1d30 65%,#10283a);border-color:#28546b;box-shadow:inset 0 1px #ffffff08}
        .mission-strip-copy strong{font-size:12px;letter-spacing:.1px}
        .mission-strip-copy small{font-size:9.5px}
        .mission-pulse{box-shadow:0 0 0 5px #39d9a51a,0 0 16px #39d9a5}
        .chart-card{background:linear-gradient(145deg,#101f32,#0b1727);border-color:#233e57;box-shadow:0 12px 30px #02081244}
        .section-heading h2{letter-spacing:-.5px}
        .data-source,.date-chip{border:1px solid #28536b;background:#0d2638;color:#5dd8e9;padding:7px 10px;border-radius:5px}
        .hero-panel,.discovery-launchpad,.stat-card,.mission-strip,.chart-card{backdrop-filter:blur(10px)}
        @media(max-width:900px){.hero-panel{padding:30px 25px}.orbit-art{right:-4%;opacity:.55}.hero-content{max-width:65%}}
        @media(max-width:600px){.hero-panel{min-height:390px;padding:25px 20px;align-items:flex-start}.hero-content{max-width:100%}.orbit-art{width:100%;height:52%;right:-5%;bottom:0;top:auto;opacity:.42}.hero-content h2{font-size:36px}.hero-caption{font-size:7px}.discovery-launchpad{padding:18px}.launch-card{min-height:185px}}

        /* IMAGE EXPLORER — interactive image library */
        .image-library-toolbar{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-top:25px}
        .image-library-toolbar .section-heading{flex:1;margin-bottom:12px}
        .image-search{display:flex;align-items:center;gap:9px;min-width:245px;max-width:330px;margin-bottom:12px;padding:0 11px;border:1px solid #29465f;border-radius:7px;background:#0c1929;color:#5bd9e9}
        .image-search input{width:100%;min-width:0;padding:11px 0;background:transparent;border:0;outline:0;color:#eaf4ff;font-size:10px}
        .image-search input::placeholder{color:#7188a4}
        .image-search button{background:transparent;border:0;color:#55d8e9;font-size:9px;cursor:pointer}
        .image-grid-enhanced{gap:15px}
        .image-card-enhanced{padding:12px;background:linear-gradient(145deg,#12243a,#0b1727);border:1px solid #29465f;box-shadow:0 12px 30px #02081244;transition:transform .2s,border-color .2s,box-shadow .2s}
        .image-card-enhanced:hover{transform:translateY(-4px);border-color:#46d8e8;box-shadow:0 17px 35px #02081277,0 0 0 1px #46d8e81c}
        .image-preview-button{display:block;position:relative;width:100%;padding:0;border:0;overflow:hidden;background:#050c17;cursor:zoom-in}
        .image-preview-button img{transition:transform .35s,filter .35s}
        .image-card-enhanced:hover .image-preview-button img{transform:scale(1.035);filter:brightness(1.12)}
        .image-hover-action{position:absolute;right:12px;bottom:12px;padding:8px 10px;border:1px solid #6be5f066;border-radius:5px;background:#071827d9;color:#7be9f2;font-size:8px;letter-spacing:1.2px;opacity:0;transform:translateY(5px);transition:opacity .2s,transform .2s}
        .image-card-enhanced:hover .image-hover-action{opacity:1;transform:translateY(0)}
        .image-hover-action b{margin-left:8px}
        .image-index{position:absolute;top:10px;left:10px;padding:5px 7px;border:1px solid #ffffff26;border-radius:4px;background:#071321b8;color:#b8d6e7;font-size:7px;letter-spacing:1px}
        .image-card-actions{display:flex;justify-content:space-between;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid #263b52}
        .image-card-actions button{background:transparent;border:0;padding:0;cursor:pointer}
        .image-lightbox{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:22px;background:#020711eF;backdrop-filter:blur(14px)}
        .image-lightbox-panel{width:min(1100px,96vw);max-height:92vh;display:flex;flex-direction:column;border:1px solid #31536c;border-radius:13px;overflow:hidden;background:linear-gradient(145deg,#102138,#071321);box-shadow:0 25px 90px #000b}
        .image-lightbox-header{display:flex;justify-content:space-between;align-items:center;gap:15px;padding:16px 19px;border-bottom:1px solid #28445b}
        .image-lightbox-header>div{display:flex;flex-direction:column;gap:5px;min-width:0}
        .image-lightbox-header strong{font:600 14px 'Space Grotesk';color:#eaf5ff;overflow-wrap:anywhere}
        .image-lightbox-header small{font-size:9px;color:#819ab5}
        .image-lightbox-close{width:34px;height:34px;flex:0 0 34px;border:1px solid #34536c;border-radius:7px;background:#10253a;color:#c7e8f4;font-size:23px;cursor:pointer}
        .image-lightbox-stage{min-height:220px;max-height:68vh;display:grid;place-items:center;overflow:auto;padding:18px;background:radial-gradient(ellipse at center,#10243a,#040b15 75%)}
        .image-lightbox-stage img{max-width:100%;max-height:62vh;object-fit:contain;transform-origin:center;transition:transform .15s ease}
        .image-lightbox-controls{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:13px 18px;border-top:1px solid #28445b}
        .image-zoom-control{display:flex;align-items:center;gap:10px;color:#9ab2c9;font-size:9px}
        .image-zoom-control span{letter-spacing:1.2px;color:#5fd8e8}
        .image-zoom-control button{min-width:27px;height:27px;border:1px solid #34536c;border-radius:5px;background:#10253a;color:#d9f4ff;cursor:pointer}
        .image-zoom-control input{width:140px;accent-color:#42d5e8}
        .image-lightbox-controls .primary-button{white-space:nowrap;text-decoration:none}
        @media(max-width:760px){.image-library-toolbar{align-items:stretch;flex-direction:column;gap:0}.image-search{max-width:none;margin:0 0 14px}.image-lightbox{padding:8px}.image-lightbox-controls{align-items:stretch;flex-direction:column}.image-zoom-control input{flex:1;min-width:50px}}


        /* COMPARISON LAB — mission-control visual comparison tools */
        .compare-controls-enhanced{display:grid;grid-template-columns:minmax(0,1fr) 42px minmax(0,1fr);align-items:end;gap:12px;padding:15px;border:1px solid #29465f;border-radius:10px;background:linear-gradient(130deg,#102238,#0a1727)}
        .compare-controls-enhanced label{display:flex;flex-direction:column;gap:8px;color:#91a9c0;font-size:9px}
        .compare-controls-enhanced select{width:100%;padding:11px;border:1px solid #34536d;border-radius:6px;background:#091625;color:#eaf5ff;font-size:10px}
        .compare-source-label{display:flex;align-items:center;gap:7px;letter-spacing:1px;font-size:8px}
        .compare-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
        .compare-dot-a{background:#42d5e8;box-shadow:0 0 9px #42d5e8}
        .compare-dot-b{background:#b58aff;box-shadow:0 0 9px #b58aff}
        .compare-swap{height:36px;border:1px solid #34536d;border-radius:7px;background:#122940;color:#65deed;font-size:19px;cursor:pointer;transition:background .2s,transform .2s}
        .compare-swap:hover{background:#1a4056;transform:rotate(180deg)}
        .compare-toolbar-enhanced{align-items:center;gap:15px;padding:12px 14px;border:1px solid #253f57;border-radius:9px;background:#0b1929;margin:13px 0}
        .mode-switch-enhanced{flex-wrap:wrap;gap:5px}
        .mode-switch-enhanced button{padding:8px 10px;border:1px solid transparent;border-radius:5px;background:transparent;color:#8fa6bd;font-size:9px;cursor:pointer;transition:all .2s}
        .mode-switch-enhanced button.active{border-color:#34758a;background:#12364a;color:#6ce5ef;box-shadow:inset 0 0 15px #36c9e811}
        .compare-stage-card{overflow:hidden}
        .wipe-viewport{position:relative}
        .wipe-stack{position:relative;width:100%;height:100%;display:grid;place-items:center;transform-origin:center;transition:transform .15s}
        .wipe-stack>img{grid-area:1/1;max-width:100%;max-height:100%;object-fit:contain}
        .wipe-reveal{position:absolute;inset:0;overflow:hidden}
        .wipe-reveal img{width:100%;height:100%;object-fit:contain}
        .wipe-divider{position:absolute;top:0;bottom:0;width:2px;background:#62e5f2;box-shadow:0 0 12px #62e5f2;transform:translateX(-1px);pointer-events:none}
        .wipe-divider span{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:grid;place-items:center;width:28px;height:28px;border:1px solid #8af4ff;border-radius:50%;background:#0a2235;color:#8af4ff;font-size:14px}
        .wipe-label{position:absolute;top:12px;padding:6px 8px;border:1px solid #ffffff26;border-radius:4px;background:#071321c9;color:#d5f2fa;font-size:8px;letter-spacing:1px}
        .wipe-label-a{left:12px}.wipe-label-b{right:12px}
        .difference-top{mix-blend-mode:difference;opacity:1!important}
        .difference-stack{background:#080d18}
        @media(max-width:850px){.compare-toolbar-enhanced{align-items:stretch;flex-direction:column}.mode-switch-enhanced{display:flex}.compare-controls-enhanced{grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr)}}
        @media(max-width:520px){.compare-controls-enhanced{grid-template-columns:1fr}.compare-swap{width:100%}.mode-switch-enhanced button{flex:1 1 42%}.compare-controls-enhanced label{min-width:0}}


        .anomaly-model-card{border-color:#31506c;background:linear-gradient(145deg,#101f32,#0b1727)}
        .anomaly-controls{display:flex;align-items:end;flex-wrap:wrap;gap:14px}
        .anomaly-controls .ai-select-label{min-width:150px;flex:1}
        .anomaly-result-panel{margin-top:18px;padding:16px;border:1px solid #2b4b64;border-radius:9px;background:#081625}
        .anomaly-result-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .anomaly-result-top h3{margin:8px 0 0;font-size:16px}
        .anomaly-result-top>strong{color:#65e1ed;font-size:25px}
        .anomaly-result-top>strong small{color:#8ba5bc;font-size:10px;font-weight:500}
        .anomaly-progress{height:6px;margin:15px 0;background:#1b3044;border-radius:10px;overflow:hidden}
        .anomaly-progress span{display:block;height:100%;border-radius:10px;background:linear-gradient(90deg,#35c9e4,#9b8cff)}
        .anomaly-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
        .anomaly-summary-grid>div{padding:11px;border:1px solid #243e56;border-radius:7px;background:#0e2033}
        .anomaly-summary-grid small,.anomaly-summary-grid strong{display:block}
        .anomaly-summary-grid small{color:#839db5;font-size:9px}
        .anomaly-summary-grid strong{margin-top:7px;color:#e6f4ff;font-size:13px;overflow-wrap:anywhere}
        .anomaly-table-wrap{margin-top:15px;overflow:auto}
        .anomaly-table-head,.anomaly-table-row{display:grid;grid-template-columns:.55fr 1.2fr 1fr 1fr;gap:12px;min-width:470px;align-items:center;padding:10px;border-bottom:1px solid #20374d;font-size:10px}
        .anomaly-table-head{color:#7e9bb4;font-size:8px;letter-spacing:1px}
        .anomaly-table-row{color:#c9d9e8}
        .anomaly-table-row strong:last-child{color:#6de0eb}
        @media(max-width:650px){.anomaly-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.anomaly-result-top{align-items:flex-start;flex-direction:column}}


        /* SCIENTIFIC EVIDENCE REPORT CENTER */
        .evidence-report-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(240px,.8fr);gap:14px;margin-top:20px}
        .report-intro-card{padding:24px;background:radial-gradient(circle at 88% 12%,#1b4960 0,transparent 38%),linear-gradient(135deg,#10263b,#0b1728)}
        .report-intro-card h2{margin:15px 0 8px;font-size:25px;color:#f0f8ff}
        .report-intro-card p{max-width:680px;color:#9db3c9;line-height:1.7;font-size:12px}
        .report-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}
        .report-count-card{display:flex;flex-direction:column;gap:13px;padding:20px}
        .report-count{display:flex;flex-direction:column;gap:3px;padding-bottom:11px;border-bottom:1px solid #294057}
        .report-count:last-child{border:0;padding:0}
        .report-count strong{font-size:25px;color:#eaf7ff}
        .report-count span{font-size:10px;color:#829db8}
        .evidence-status{display:flex;align-items:center;gap:8px;color:#8ba9c2;font-size:9px;letter-spacing:1px}
        .evidence-inventory{display:grid;grid-template-columns:1fr 1fr;gap:9px}
        .evidence-inventory-row{display:flex;align-items:center;gap:11px;min-width:0;padding:13px;border:1px solid #243c54;border-radius:8px;background:#0c1929}
        .evidence-check{display:grid;place-items:center;flex:0 0 25px;width:25px;height:25px;border:1px solid #40536a;border-radius:50%;color:#8da4ba}
        .evidence-check.available{border-color:#237d78;background:#103c3c;color:#65e6c3}
        .evidence-inventory-row>div{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
        .evidence-inventory-row strong{color:#dceaf6;font-size:11px}
        .evidence-inventory-row small{color:#7892aa;font-size:9px}
        .evidence-state{color:#7f9bb2;font-size:8px;letter-spacing:.6px;white-space:nowrap}
        @media(max-width:760px){.evidence-report-grid{grid-template-columns:1fr}.evidence-inventory{grid-template-columns:1fr}}
        @media print{.sidebar,.report-actions,.evidence-status{display:none!important}.page-section{color:#111;background:#fff}.chart-card,.data-panel,.evidence-inventory-row{break-inside:avoid;background:#fff!important;border:1px solid #bbb!important;color:#111}.report-intro-card h2,.report-intro-card p,.report-count strong,.evidence-inventory-row strong{color:#111!important}}


        /* MISSION READINESS / FINAL DEMO CHECKLIST */
        .readiness-hero{display:flex;align-items:center;justify-content:space-between;gap:22px;flex-wrap:wrap;padding:23px;background:radial-gradient(circle at 82% 18%,#17465b 0,transparent 36%),linear-gradient(130deg,#10263b,#0b1728)}
        .readiness-hero>div:first-child{max-width:650px}
        .readiness-hero h2{margin:12px 0 7px;color:#eef8ff;font-size:23px}
        .readiness-hero p{margin:0;color:#91a9c0;font-size:11px;line-height:1.7}
        .readiness-result{flex-basis:100%;padding:10px 12px;border-radius:6px;font-size:10px}
        .readiness-result.passed{border:1px solid #277d70;background:#10362f;color:#75e6c2}
        .readiness-result.failed{border:1px solid #92514b;background:#3a211f;color:#ffb0a6}
        .readiness-result.checking{border:1px solid #345a78;background:#122a40;color:#9ddcf0}
        .readiness-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .readiness-item{display:flex;align-items:center;gap:11px;min-width:0;padding:14px;border:1px solid #263f57;border-radius:8px;background:linear-gradient(130deg,#102137,#0b1727)}
        .readiness-indicator{display:grid;place-items:center;flex:0 0 27px;width:27px;height:27px;border:1px solid #40566d;border-radius:50%;color:#91a7bd}
        .readiness-indicator.passed{border-color:#277b70;background:#103a36;color:#72e6c2}
        .readiness-item>div{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
        .readiness-item strong{color:#e4f1fb;font-size:11px}
        .readiness-item small{color:#829ab2;font-size:9px;line-height:1.5}
        .readiness-label{font-size:8px;letter-spacing:.8px;color:#8ba1b6}
        .readiness-label.passed{color:#6ee0bf}
        .demo-route{display:flex;flex-direction:column;gap:8px}
        .demo-route-step{display:flex;align-items:center;gap:13px;width:100%;padding:13px 15px;text-align:left;border:1px solid #29445d;border-radius:8px;background:#0d1b2c;color:#eaf4ff;cursor:pointer;transition:border-color .2s,transform .2s,background .2s}
        .demo-route-step:hover{transform:translateX(4px);border-color:#45d8e8;background:#11283b}
        .demo-route-step>span{font:600 12px 'Space Grotesk';color:#4bd6e7}
        .demo-route-step>div{display:flex;flex:1;flex-direction:column;gap:4px}
        .demo-route-step strong{font-size:11px}
        .demo-route-step small{font-size:9px;color:#8ba2ba}
        .demo-route-step>b{color:#55d8e8}

        .galaxy-page{display:flex;flex-direction:column;gap:20px;position:relative;z-index:1}
        .galaxy-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}
        .galaxy-heading h1{font-size:clamp(30px,4vw,48px);letter-spacing:-1.8px;margin:10px 0 8px;color:#edf7ff}
        .galaxy-heading h1 span{color:#50d8e8}
        .galaxy-live{border:1px solid #42d6c344;background:#0b2830;border-radius:30px;padding:9px 13px;color:#8df4df;font:700 9px 'Space Grotesk';letter-spacing:1.2px;white-space:nowrap}
        .galaxy-live i{display:inline-block;width:7px;height:7px;background:#53e9c5;border-radius:50%;margin-right:8px;box-shadow:0 0 12px #53e9c5;animation:live-pulse 1.6s infinite}
        .galaxy-layout{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:16px;align-items:stretch}
        .galaxy-view-card,.galaxy-info-card{border:1px solid #294966;background:linear-gradient(145deg,#0c2034eF,#071426ed);border-radius:16px;overflow:hidden;box-shadow:0 18px 55px #0004}
        .galaxy-canvas-top{height:42px;display:flex;align-items:center;justify-content:space-between;padding:0 15px;color:#8bb7d0;font:700 8px 'Space Grotesk';letter-spacing:1.1px;border-bottom:1px solid #24415b}
        .galaxy-canvas{display:block;width:100%;height:clamp(340px,48vh,520px);cursor:grab;touch-action:none}
        .galaxy-canvas:active{cursor:grabbing}
        .galaxy-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px;border-top:1px solid #24415b;background:#081629}
        .galaxy-controls button{border:1px solid #31516d;background:#102a42;color:#d8f3ff;border-radius:7px;padding:8px 10px;font-size:10px;cursor:pointer}
        .galaxy-controls button:hover{border-color:#52d9e8;background:#123650}
        .galaxy-controls label{display:flex;align-items:center;gap:8px;margin-left:auto;color:#8fb4ce;font:700 8px 'Space Grotesk';letter-spacing:1px}
        .galaxy-controls input{width:85px;accent-color:#4dd8e8}
        .galaxy-info-card{padding:18px;display:flex;flex-direction:column;align-items:flex-start}
        .galaxy-info-kicker{font:700 9px 'Space Grotesk';letter-spacing:1.7px;color:#69d9e8}
        .spherex-observation-detail{width:100%}
        .spherex-observation-detail h2{font-size:18px;line-height:1.35;overflow-wrap:anywhere;margin:14px 0 5px;color:#eaf8ff}
        .spherex-access-link{display:inline-block;margin:13px 0;padding:9px 11px;border:1px solid #3d9db5;border-radius:7px;background:#103448;color:#a8efff;text-decoration:none;font-size:10px}
        .spherex-clear-selection{width:100%;margin-top:10px;padding:9px;border:1px solid #31536c;border-radius:7px;background:#0b1d30;color:#c4e5f4;font-size:10px;cursor:pointer}

        .galaxy-object-orb{width:76px;height:76px;border-radius:50%;margin:18px auto 13px;align-self:center;box-shadow:inset -12px -8px 20px #02091b99,0 0 38px #49c7ff44}
        .galaxy-info-card h2{font-size:23px;color:#eff9ff;margin:0 0 4px}
        .galaxy-object-type{color:#8fb1ca;font-size:11px;margin-bottom:17px}
        .galaxy-fact{width:100%;display:flex;justify-content:space-between;gap:8px;padding:9px 0;border-top:1px solid #24415b;color:#7899b4;font-size:9px}
        .galaxy-fact strong{color:#d5eaf7;text-align:right;font-size:9px}
        .galaxy-object-detail{color:#9ab2c7;font-size:10px;line-height:1.65;margin:13px 0}
        .galaxy-demo-note{padding:7px 9px;border:1px solid #8c6c354d;background:#352a1838;color:#e8bd77;border-radius:5px;font:700 8px 'Space Grotesk';letter-spacing:.8px}
        .galaxy-object-list{width:100%;display:flex;flex-direction:column;gap:5px;margin-top:18px}
        .galaxy-object-list>strong{font:700 8px 'Space Grotesk';letter-spacing:1.4px;color:#7f9fb8;margin-bottom:5px}
        .galaxy-object-list button{display:flex;align-items:center;gap:9px;width:100%;border:1px solid transparent;border-radius:6px;padding:8px;background:#0b1a2b;color:#bcd3e4;text-align:left;font-size:10px;cursor:pointer}
        .galaxy-object-list button.active,.galaxy-object-list button:hover{border-color:#3c9fb7;background:#102b40;color:#effaff}
        .galaxy-object-list button i{width:8px;height:8px;border-radius:50%;box-shadow:0 0 10px currentColor}
        .galaxy-object-list button span{margin-left:auto;color:#5ed9e8}
        .galaxy-bottom-note{color:#819bb1;font-size:9px;line-height:1.6}
        .observation-compare-card{border:1px solid #2b4b68;border-radius:16px;padding:20px;background:linear-gradient(130deg,#0b2035ed,#091629ed);box-shadow:0 18px 55px #0003}
        .observation-compare-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px}
        .observation-compare-heading h2{font-size:24px;letter-spacing:-.8px;color:#edf8ff;margin:8px 0 5px}
        .observation-compare-heading h2 span{color:#52d7e7}
        .observation-compare-heading p{font-size:10px;color:#8faec5;margin:0}
        .compare-count{padding:8px 10px;border:1px solid #31536b;border-radius:20px;color:#8dd9e8;font:700 8px 'Space Grotesk';letter-spacing:.8px;white-space:nowrap}
        .compare-selectors{display:grid;grid-template-columns:minmax(0,1fr) 38px minmax(0,1fr) auto;gap:10px;align-items:end;margin-bottom:15px}
        .compare-selectors label{display:flex;flex-direction:column;gap:7px;color:#81a8c0;font:700 8px 'Space Grotesk';letter-spacing:1px}
        .compare-selectors select{width:100%;min-width:0;padding:10px;border:1px solid #31536c;border-radius:7px;background:#0a1b2d;color:#d9effb;font-size:10px}
        .compare-versus{display:grid;place-items:center;height:36px;color:#5ed9e8;font:800 10px 'Space Grotesk'}
        .compare-swap{height:36px;padding:0 12px;border:1px solid #3b8097;border-radius:7px;background:#103448;color:#9beafa;font-size:10px;cursor:pointer}
        .compare-table-wrap{width:100%;overflow-x:auto;border:1px solid #27465f;border-radius:9px}
        .compare-table{width:100%;border-collapse:collapse;min-width:560px;text-align:left}
        .compare-table th{padding:11px 12px;background:#102941;color:#7ddbea;font:700 8px 'Space Grotesk';letter-spacing:.8px}
        .compare-table td{padding:10px 12px;border-top:1px solid #203c54;color:#c4dceb;font-size:9px}
        .compare-table td:first-child{color:#83a7c0;font-weight:700}
        .compare-table td:last-child{color:#7fe3c6}
        .compare-footnote{margin-top:12px;color:#7898b1;font-size:9px;line-height:1.5}
        .compare-empty{padding:18px;border:1px dashed #35536b;border-radius:8px;color:#9bb7cb;font-size:10px;line-height:1.6}
        @media(max-width:720px){.observation-compare-heading{flex-direction:column}.compare-selectors{grid-template-columns:1fr}.compare-versus{height:auto}}

        .galaxy-controls .spherex-toggle{border-color:#267f91;background:#103849;color:#8cefff}
        .galaxy-controls .spherex-toggle.active{background:#1a5664;border-color:#66e6f2;color:#efffff}
        .galaxy-controls button:disabled{opacity:.45;cursor:not-allowed}
        .spherex-data-status{display:flex;align-items:center;gap:7px;min-height:31px;padding:0 13px;border-top:1px solid #1e3c55;background:#071321;color:#8db1c8;font-size:9px}
        .status-dot{width:6px;height:6px;border-radius:50%;background:#e6bd68;box-shadow:0 0 8px #e6bd68}
        .status-dot.ready{background:#58e5bd;box-shadow:0 0 8px #58e5bd}
        .status-dot.error{background:#f08b8b;box-shadow:0 0 8px #f08b8b}

        .galaxy-bottom-note span{color:#57d9e9;margin-right:7px}
        @media(max-width:980px){.galaxy-layout{grid-template-columns:1fr}.galaxy-info-card{display:grid;grid-template-columns:80px 1fr;column-gap:14px}.galaxy-object-orb{grid-row:span 2;margin:auto}.galaxy-info-card h2{align-self:end}.galaxy-object-type{align-self:start}.galaxy-fact,.galaxy-object-detail,.galaxy-demo-note,.galaxy-object-list{grid-column:1/-1}}
        @media(max-width:620px){.galaxy-heading{align-items:flex-start;flex-direction:column}.galaxy-canvas{height:340px}.galaxy-controls label{margin-left:0}.galaxy-canvas-top span:last-child{display:none}}


        .mission-mode-card{border:1px solid #2b4b68;border-radius:16px;padding:20px;background:linear-gradient(130deg,#0b2035ed,#091629ed);box-shadow:0 18px 55px #0003}
        .mission-mode-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:17px}
        .mission-mode-heading h2{font-size:25px;letter-spacing:-.8px;color:#edf8ff;margin:8px 0 5px}
        .mission-mode-heading h2 span{color:#52d7e7}
        .mission-mode-heading p{font-size:10px;color:#8faec5;margin:0}
        .mission-mode-status{border:1px solid #46d8bb44;background:#0c2b2c;color:#86f0d8;border-radius:20px;padding:8px 11px;font:700 8px 'Space Grotesk';letter-spacing:.9px;white-space:nowrap}
        .mission-mode-status i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#5de8c4;margin-right:6px;box-shadow:0 0 9px #5de8c4}
        .mission-mode-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,.85fr);gap:14px}
        .mission-list{display:flex;flex-direction:column;gap:8px}
        .mission-option{display:flex;align-items:center;gap:10px;text-align:left;width:100%;padding:12px;border:1px solid #294761;border-radius:9px;background:#0a192a;color:#d8eaf7;cursor:pointer}
        .mission-option.active,.mission-option:hover{border-color:#4acddd;background:#10283d}
        .mission-option-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#12364b;color:#62ddec;font-size:14px;flex-shrink:0}
        .mission-option-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
        .mission-option-copy strong{font-size:11px}
        .mission-option-copy small{font-size:9px;color:#8ba9bf;line-height:1.4}
        .mission-option-arrow{margin-left:auto;color:#65ddeb;font-size:19px}
        .mission-detail{padding:15px;border:1px solid #2c506c;border-radius:10px;background:linear-gradient(145deg,#102943,#0a192b)}
        .mission-detail-top{display:flex;justify-content:space-between;color:#72dce9;font:700 8px 'Space Grotesk';letter-spacing:1.1px}
        .mission-detail h3{font-size:19px;color:#f0f9ff;margin:12px 0 6px}
        .mission-detail p{font-size:10px;line-height:1.6;color:#9ab5ca;margin:0 0 14px}
        .mission-progress-track{height:6px;border-radius:9px;background:#1a344c;overflow:hidden;margin-bottom:15px}
        .mission-progress-track span{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#35c9df,#6e9dff);transition:width .3s ease}
        .mission-target-line{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #29445c}
        .mission-target-line span{color:#7d9bb3;font:700 8px 'Space Grotesk';letter-spacing:.8px}
        .mission-target-line strong{color:#d9edf8;font-size:9px;text-align:right}
        .mission-action-button{margin-top:12px;border:0;border-radius:7px;background:linear-gradient(100deg,#27c7d8,#638cf5);color:#061629;padding:9px 13px;font-size:10px;font-weight:800;cursor:pointer}
        .mission-complete-message{margin-top:12px;padding:9px;border:1px solid #48d9ae55;border-radius:7px;background:#0b322b;color:#8af0d1;font-size:10px}
        .mission-inline-message{margin-top:9px;color:#83dceb;font-size:9px;line-height:1.5}
        .mission-visited-count{display:flex;justify-content:space-between;margin-top:14px;padding-top:10px;border-top:1px solid #29445c;color:#7f9fb8;font:700 8px 'Space Grotesk';letter-spacing:.8px}
        .mission-visited-count strong{color:#ccecf9}
        @media(max-width:760px){.mission-mode-heading{flex-direction:column}.mission-mode-grid{grid-template-columns:1fr}}

        @media(prefers-reduced-motion:reduce){.cosmic-backdrop,.cosmic-backdrop:before,.cosmic-backdrop:after,.cosmic-nebula,.interactive-planet-widget{animation:none!important}}
        @media(max-width:720px){.interactive-planet-widget{right:-38%;top:7%;opacity:.55}.planet-controls{display:none}.readiness-grid{grid-template-columns:1fr}.readiness-hero{align-items:flex-start;flex-direction:column}.readiness-item{padding:12px}}

        .added-workspace{position:relative;z-index:1}
        .added-two-col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0}
        .added-bars{display:flex;flex-direction:column;gap:14px;margin-top:18px}
        .added-bar-row{display:grid;grid-template-columns:minmax(75px,1fr) minmax(90px,2fr) 55px;align-items:center;gap:10px;color:#a9c3d8;font-size:10px}
        .added-bar-row>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.added-bar-row strong{text-align:right;color:#d8f0fc;font-size:10px}
        .added-bar-track{height:9px;border-radius:10px;background:#152c43;overflow:hidden}.added-bar-track i{display:block;height:100%;border-radius:10px;transition:width .3s ease}
        .sky-scatter-wrap{padding:12px;background:#071526;border:1px solid #203e57;border-radius:10px;overflow:hidden}.sky-scatter-wrap svg{display:block;width:100%;height:auto;min-width:420px}.sky-scatter-wrap{overflow-x:auto}.scatter-axis-labels{display:flex;justify-content:space-between;color:#89a9c2;font-size:9px;padding:6px 4px 0}
        .search-filter-card{margin-bottom:18px}.search-filter-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.search-filter-grid label{display:flex;flex-direction:column;gap:6px;color:#89a9c2;font-size:9px;font-weight:700;letter-spacing:.4px}.search-filter-grid input,.search-filter-grid select{width:100%;min-width:0;padding:10px;border:1px solid #294963;border-radius:7px;background:#08192b;color:#e3f3fc;font:inherit;font-size:11px;outline:none}.search-filter-grid input:focus,.search-filter-grid select:focus{border-color:#48cfe1;box-shadow:0 0 0 2px #48cfe122}.search-filter-grid .search-wide{grid-column:span 2}.search-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:15px}.search-results-head{grid-template-columns:1.25fr 1.3fr .6fr 1.2fr .9fr .8fr;min-width:850px}.archive-table-head{grid-template-columns:1.3fr 1.05fr 1fr .8fr 1.45fr .8fr;min-width:1120px}.archive-access-format{display:block;color:#7389a4;font-size:8px;margin-top:4px;overflow-wrap:anywhere}.archive-table-head .outline-button{white-space:nowrap;padding:8px}.quality-gate-list{padding:4px 18px}.quality-gate-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 2px;border-bottom:1px solid #202f45}.quality-gate-row:last-child{border-bottom:0}.quality-gate-row>div{display:flex;flex-direction:column;gap:5px;min-width:0}.quality-gate-row strong{font-size:10px;color:#dbe8f7}.quality-gate-row small{font-size:9px;color:#8295af;line-height:1.5}.quality-chip{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border:1px solid #34465f;border-radius:999px;padding:5px 9px;color:#a8b6c9;font-size:8px;font-weight:700;letter-spacing:.6px;white-space:nowrap}.quality-pass{border-color:#246d5a;color:#56d7aa;background:#0d2c28}.quality-warning{border-color:#765c32;color:#efc27a;background:#30271a}.quality-reject{border-color:#784248;color:#f09da4;background:#321d24}.quality-not-evaluated{border-color:#34465f;color:#9cadc2;background:#142032}
        .explain-card h2,.explain-caution h2{color:#e8f5ff;font-size:19px;margin:12px 0}.explain-card p,.explain-caution li{color:#a1bbce;font-size:11px;line-height:1.7}.explain-metric{display:flex;align-items:baseline;gap:12px;padding:14px 0;border-bottom:1px solid #29445c}.explain-metric strong{font:700 30px 'Space Grotesk';color:#61ddeb}.explain-metric span{color:#9bb6c9;font-size:10px}.feature-chips{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 14px}.feature-chips span{padding:6px 9px;border:1px solid #31536d;border-radius:20px;background:#0c2033;color:#b9e7f3;font-size:9px}.explain-cluster-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}.explain-cluster-list>div{display:grid;grid-template-columns:1fr auto;gap:5px;padding:10px;border:1px solid #29465f;border-radius:8px;background:#091a2c}.explain-cluster-list span{color:#d7effa;font-size:10px;font-weight:700}.explain-cluster-list strong{color:#64dce9;font-size:10px}.explain-cluster-list small{grid-column:1/-1;color:#8da9bf;font-size:9px}.explain-caution{margin-top:16px}.explain-caution ul{padding-left:19px}.explain-caution li{padding:4px 0}
        .epoch-workspace{margin-top:28px;padding-top:22px;border-top:1px solid #243b54}.epoch-pair-selector{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:end;gap:12px}.epoch-pair-selector>label{display:flex;flex-direction:column;gap:7px;color:#9bb3c9;font-size:9px;font-weight:700;letter-spacing:.6px}.epoch-pair-selector select{width:100%;min-width:0;padding:10px 12px;border:1px solid #31506a;border-radius:7px;background:#08192b;color:#e3f3fc;font:inherit;font-size:10px}.epoch-pair-selector>.primary-button{justify-self:start}.epoch-selected-products{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:4px}.epoch-product-summary{display:flex;min-width:0;flex-direction:column;gap:7px;padding:13px;border:1px solid #23405a;border-radius:8px;background:#091a2b;color:#9db4c8;font-size:9px;line-height:1.5;overflow-wrap:anywhere}.epoch-product-summary strong{color:#dcf3fc;font-size:10px}.epoch-product-summary small{color:#728aa4;overflow-wrap:anywhere}.epoch-state-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:16px 0;padding:13px 15px;border:1px solid #263e57;border-radius:9px;background:#0a192a}.epoch-state-row>div{min-width:0}.epoch-state-row p{margin:7px 0 0;color:#8fa8bf;font-size:9px;line-height:1.6}.epoch-metrics-grid{margin:12px 0}.epoch-metric-lines{display:flex;flex-direction:column;gap:12px;margin:16px 0}.epoch-metric-lines>span{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#8fa5bb;font-size:9px}.epoch-metric-lines strong{color:#ddf3fa;font-size:10px;text-align:right}.epoch-eligibility-list{margin:0 0 12px}.epoch-check-evidence{margin-top:5px;color:#7189a4!important;overflow-wrap:anywhere;font-family:monospace}
        @media(max-width:900px){.search-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.added-two-col{grid-template-columns:1fr}}
        @media(max-width:560px){.search-filter-grid{grid-template-columns:1fr}.search-filter-grid .search-wide{grid-column:span 1}.search-actions{flex-direction:column}.search-actions button{width:100%}.epoch-pair-selector,.epoch-selected-products{grid-template-columns:1fr}.epoch-selected-products{grid-column:1}.epoch-state-row{align-items:flex-start;flex-direction:column}}

      `}

      </style>
    </main>
  );
}

export default Home;
