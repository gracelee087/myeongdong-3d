// Myeongdong diorama — stylised Tokyo-Metro-3D-style renderer (Three.js).
// 1,408 real OSM building footprints extruded to their real heights,
// warm cream palette + soft shadows + neon route, game 3rd-person follow cam.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const BG = 0x0b0d12;
const GROUND = 0x353d58;
const ROAD = 0x5a6484;
const ROUTE = 0xffd27a;
// warm pastel palette (Tokyo-diorama): mostly cream, a few soft accents
const CREAMS = [0xe9e2d3, 0xe3dbc9, 0xefe8da, 0xded5c2, 0xe6e0d5];
const ACCENTS = [0xf5c8b8, 0xbcd9d0, 0xc7cfe8, 0xe8d3ba, 0xd9c8e0];
const TYPE_PIN = { food: "#ff7a59", attraction: "#4f8cff", culture: "#7c5cff", shopping: "#35c88b", beauty: "#f25c9a", custom: "#ffd27a" };
// saturated awning/storefront tints — Myeongdong street level is colourful
const SHOPS = [0xff7a59, 0x35c88b, 0x4f8cff, 0xffd27a, 0xf25c9a, 0x7c5cff, 0xffb347];

const S = {
  renderer: null, scene: null, camera: null,
  center: null, kx: 1,
  avatar: null, avatarHeading: 0, bobT: 0,
  pins: new Map(), pinGroups: new Map(), pinActive: null, routeMeshes: [],
  camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), camInit: false,
  orbitAngle: 20, zoom: 1,
  wallMat: null, shopMat: null, sun: null, hemi: null,
  // environment: current (lerped every frame) vs target (set by clock/weather)
  env: null, envT: null, particles: null, particleKind: "none", pVel: null,
};

// lng/lat → local metres (x east, z south so north = -z)
function toXZ(lng, lat) {
  return [(lng - S.center.lng) * S.kx, -(lat - S.center.lat) * 111320];
}

// ---------- procedural facade textures ----------
// window grid — canvas covers 32m (8 windows) × 12.8m (4 floors), tiled in metres
const FAC_W = 32, FAC_H = 12.8;
function facadeTexture() {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 384;
  const c = cv.getContext("2d");
  c.fillStyle = "#fafaf8"; c.fillRect(0, 0, 1024, 384);
  for (let row = 0; row < 4; row++) for (let i = 0; i < 8; i++) {
    const x = i * 128, y = row * 96;
    c.fillStyle = "#d9dfe8"; c.fillRect(x + 26, y + 16, 76, 64);      // frame
    c.fillStyle = ["#3b4a66", "#42526f", "#38465f"][(i * 7 + row * 13) % 3];
    c.fillRect(x + 32, y + 21, 64, 54);                               // glass
    c.fillStyle = "rgba(255,255,255,.28)"; c.fillRect(x + 32, y + 21, 64, 11); // sky reflection
    c.fillStyle = "#e2e0da"; c.fillRect(0, y + 90, 1024, 6);          // floor slab line
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// night lights — same grid, black except randomly lit warm windows (emissiveMap)
function facadeNightTexture() {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 384;
  const c = cv.getContext("2d");
  c.fillStyle = "#000"; c.fillRect(0, 0, 1024, 384);
  const warm = ["#ffd9a0", "#ffca7a", "#ffe7c0", "#ffb45e"];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 8; i++) {
    if (Math.random() > 0.42) continue;
    const x = i * 128, y = row * 96;
    c.fillStyle = warm[(Math.random() * warm.length) | 0];
    c.globalAlpha = 0.55 + Math.random() * 0.45;
    c.fillRect(x + 32, y + 21, 64, 54);
    c.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// street-level storefront — 4.5m × 3.6m: awning band (takes vertex tint) + glass shopfront
function shopTexture() {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const c = cv.getContext("2d");
  c.fillStyle = "#ffffff"; c.fillRect(0, 0, 128, 40);                 // awning (tinted per building)
  c.fillStyle = "rgba(0,0,0,.14)"; c.fillRect(0, 34, 128, 6);         // awning shadow
  c.fillStyle = "#20293a"; c.fillRect(0, 40, 128, 80);                // glass
  c.fillStyle = "rgba(255,255,255,.7)";
  c.fillRect(0, 40, 4, 80); c.fillRect(62, 40, 4, 80); c.fillRect(124, 40, 4, 80); // mullions
  c.fillStyle = "rgba(255,220,150,.30)"; c.fillRect(8, 52, 50, 60);   // warm shop light
  c.fillStyle = "#cfd2d8"; c.fillRect(0, 120, 128, 8);                // base skirt
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- build steps ----------
// walls built edge-by-edge with metre UVs (u along street, v up) so the
// window/storefront textures land at real-world scale on every building
function makeBuildings(geojson) {
  const walls = { pos: [], nor: [], uv: [], col: [], idx: [] };
  const shops = { pos: [], nor: [], uv: [], col: [], idx: [] };
  const roofG = [];
  const col = new THREE.Color(), shopCol = new THREE.Color();
  const SHOP_H = 3.6;
  S.bIndex = [];               // per-building centroid + colour ranges (for course highlight)
  let roofVerts = 0;

  const pushQuad = (B, x1, z1, x2, z2, y0, y1, u0, u1, v0, v1, nx, nz, c) => {
    const i = B.pos.length / 3;
    B.pos.push(x1, y0, z1, x2, y0, z2, x2, y1, z2, x1, y1, z1);
    for (let k = 0; k < 4; k++) { B.nor.push(nx, 0, nz); B.col.push(c.r, c.g, c.b); }
    B.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    B.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };

  for (const f of geojson.features) {
    const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates] :
      f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    const h = Math.max(4, f.properties.height || 10);
    const seed = (f.properties.id || 1) % 97;
    const bRec = { w0: walls.col.length / 3, r0: roofVerts, cx: 0, cz: 0, pts: null, h };
    col.setHex(seed % 11 === 0 ? ACCENTS[seed % ACCENTS.length] : CREAMS[seed % CREAMS.length]);
    col.multiplyScalar(0.94 + (seed % 7) * 0.015);
    shopCol.setHex(SHOPS[seed % SHOPS.length]);

    for (const poly of rings) {
      // roof (with holes) at height h
      const shape = new THREE.Shape();
      poly[0].forEach(([lng, lat], i) => {
        const [x, z] = toXZ(lng, lat);
        i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z);
      });
      for (let r = 1; r < poly.length; r++) {
        const hole = new THREE.Path();
        poly[r].forEach(([lng, lat], i) => {
          const [x, z] = toXZ(lng, lat);
          i === 0 ? hole.moveTo(x, -z) : hole.lineTo(x, -z);
        });
        shape.holes.push(hole);
      }
      const rg = new THREE.ShapeGeometry(shape);
      rg.rotateX(-Math.PI / 2); rg.translate(0, h, 0);
      const rc = col.clone().multiplyScalar(0.6);
      const n = rg.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = rc.r; arr[i * 3 + 1] = rc.g; arr[i * 3 + 2] = rc.b; }
      rg.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      roofG.push(rg);
      roofVerts += n;
      // centroid + outer ring (for POI → building matching and the glow shell)
      let sx = 0, sz = 0;
      const ringXZ = poly[0].map(([lng, lat]) => toXZ(lng, lat));
      for (const [x, z] of ringXZ) { sx += x; sz += z; }
      bRec.cx = sx / ringXZ.length; bRec.cz = sz / ringXZ.length;
      bRec.pts = ringXZ;

      // walls + storefront strip per ring edge
      for (const ring of poly) {
        // normalise winding so edge normals point outward consistently
        const pts = ring.map(([lng, lat]) => toXZ(lng, lat));
        let area = 0;
        for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
        if (area > 0) pts.reverse();
        let acc = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
          const len = Math.hypot(x2 - x1, z2 - z1); if (len < 0.01) continue;
          const nx = (z1 - z2) / len, nz = (x2 - x1) / len; // outward for CW-normalised ring
          pushQuad(walls, x1, z1, x2, z2, 0, h, acc / FAC_W, (acc + len) / FAC_W, 0, h / FAC_H, nx, nz, col);
          const off = 0.14;
          pushQuad(shops, x1 + nx * off, z1 + nz * off, x2 + nx * off, z2 + nz * off,
            0, SHOP_H, acc / 4.5, (acc + len) / 4.5, 0, 1, nx, nz, shopCol);
          acc += len;
        }
      }
    }
    bRec.w1 = walls.col.length / 3; bRec.r1 = roofVerts;
    S.bIndex.push(bRec);
  }

  const build = (B) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(B.col, 3));
    g.setIndex(B.idx);
    return g;
  };
  S.wallMat = new THREE.MeshStandardMaterial({
    map: facadeTexture(), emissiveMap: facadeNightTexture(), emissive: 0xffd9a0,
    emissiveIntensity: 0, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
  });
  const wallMesh = new THREE.Mesh(build(walls), S.wallMat);
  wallMesh.castShadow = true; wallMesh.receiveShadow = true;
  S.scene.add(wallMesh);

  const shopTex = shopTexture();
  S.shopMat = new THREE.MeshStandardMaterial({
    map: shopTex, emissiveMap: shopTex, emissive: 0xffb45e,
    emissiveIntensity: 0, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
  });
  const shopMesh = new THREE.Mesh(build(shops), S.shopMat);
  S.scene.add(shopMesh);

  const roofMesh = new THREE.Mesh(mergeGeometries(roofG, false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  roofMesh.castShadow = true; roofMesh.receiveShadow = true;
  S.scene.add(roofMesh);

  S.wallMesh = wallMesh; S.roofMesh = roofMesh;
  S.origWallCol = Float32Array.from(wallMesh.geometry.attributes.color.array);
  S.origRoofCol = Float32Array.from(roofMesh.geometry.attributes.color.array);
}

// tint the buildings that belong to the active course (honey gold — sits well
// next to the yellow route) + a glow disc at their feet so it reads at night too
// course-highlight colour: cool mint — complementary to the warm route/windows,
// matches the UI's green accent, and is easy on the eyes at night
const HL = new THREE.Color(0x4fd6a8);
export function highlightCourse(lngLats) {
  if (!S.wallMesh) return;
  const wc = S.wallMesh.geometry.attributes.color;
  const rc = S.roofMesh.geometry.attributes.color;
  wc.array.set(S.origWallCol); rc.array.set(S.origRoofCol);
  if (!S.hl) { S.hl = new THREE.Group(); S.scene.add(S.hl); }
  S.hl.clear();
  const discGeo = new THREE.CircleGeometry(11, 24);
  const discMat = new THREE.MeshBasicMaterial({ color: HL, transparent: true, opacity: 0.3, toneMapped: false, side: THREE.DoubleSide });
  const tmp = new THREE.Color();
  const shellGeoms = [];
  for (const [lng, lat] of lngLats) {
    const [x, z] = toXZ(lng, lat);
    // nearest building centroid within 55 m
    let best = null, bd = 55;
    for (const b of S.bIndex) {
      const d = Math.hypot(b.cx - x, b.cz - z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      // daytime: gently tint the building's own walls/roof toward mint
      for (let i = best.w0; i < best.w1; i++)
        tmp.fromArray(S.origWallCol, i * 3).lerp(HL, 0.45).toArray(wc.array, i * 3);
      for (let i = best.r0; i < best.r1; i++)
        tmp.fromArray(S.origRoofCol, i * 3).lerp(HL, 0.6).toArray(rc.array, i * 3);
      // night-proof: translucent glow shell slightly larger than the building
      if (best.pts) {
        const pos = [], idx = [];
        const grow = (p) => [best.cx + (p[0] - best.cx) * 1.07, best.cz + (p[1] - best.cz) * 1.07];
        const hh = best.h + 2.5;
        for (let i = 0; i < best.pts.length; i++) {
          const [gx, gz] = grow(best.pts[i]);
          pos.push(gx, 0, gz, gx, hh, gz);
          if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx); g.computeVertexNormals();
        shellGeoms.push(g);
      }
    }
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.4, z);
    S.hl.add(disc);
  }
  if (shellGeoms.length) {
    const shell = new THREE.Mesh(mergeGeometries(shellGeoms, false),
      new THREE.MeshBasicMaterial({
        color: HL, transparent: true, opacity: 0.22, toneMapped: false,
        side: THREE.DoubleSide, depthWrite: false,
      }));
    S.hl.add(shell);
  }
  wc.needsUpdate = true; rc.needsUpdate = true;
}

function ribbonGeometry(points, width, y) {
  // points: [[x,z],...] → flat quad strip at height y; u = metres along, v across
  const pos = [], idx = [], uv = [];
  const hw = width / 2;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)];
    const r = points[Math.max(i - 1, 0)];
    let dx = q[0] - r[0], dz = q[1] - r[1];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    if (i > 0) acc += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    pos.push(p[0] - dz * hw, y, p[1] + dx * hw, p[0] + dz * hw, y, p[1] - dx * hw);
    uv.push(acc, 0, acc, 1);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function makeRoads(streets) {
  const geoms = [];
  for (const way of streets.ways) {
    if (way.length < 2) continue;
    const pts = way.map(([, lng, lat]) => toXZ(lng, lat));
    geoms.push(ribbonGeometry(pts, 9, 0.15));
  }
  const mesh = new THREE.Mesh(mergeGeometries(geoms, false),
    new THREE.MeshStandardMaterial({ color: ROAD, roughness: 1, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  S.scene.add(mesh);
}

// Cheonggyecheon + other waterways — FLOWING water (animated streak texture)
function waterTexture() {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64;
  const c = cv.getContext("2d");
  c.fillStyle = "#3f7fb8"; c.fillRect(0, 0, 256, 64);
  // soft current streaks, brighter mid-channel
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 64, len = 40 + Math.random() * 90;
    const g = c.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(160,210,240,0)");
    g.addColorStop(0.5, `rgba(160,215,245,${0.14 + Math.random() * 0.22})`);
    g.addColorStop(1, "rgba(160,210,240,0)");
    c.fillStyle = g;
    c.save(); c.translate(Math.random() * 256, y);
    c.fillRect(0, -1.2, len, 2.4); c.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / 46, 1);   // one streak-cycle every ~46 m along the stream
  return tex;
}
function makeWater(water) {
  if (!water?.lines?.length) return;
  const geoms = [];
  for (const line of water.lines) {
    if (line.pts.length < 2) continue;
    const pts = line.pts.map(([lng, lat]) => toXZ(lng, lat));
    geoms.push(ribbonGeometry(pts, /청계천/.test(line.name) ? 16 : 8, 0.28));
  }
  if (!geoms.length) return;
  S.waterTex = waterTexture();
  const mesh = new THREE.Mesh(mergeGeometries(geoms, false),
    new THREE.MeshStandardMaterial({
      map: S.waterTex, color: 0xbdd6ea, roughness: 0.2, metalness: 0.15, side: THREE.DoubleSide,
    }));
  mesh.receiveShadow = true;
  S.scene.add(mesh);
}

function makeRoute(walkPath) {
  for (const m of S.routeMeshes || []) { S.scene.remove(m); m.geometry.dispose(); }
  S.routeMeshes = [];
  const pts = walkPath.map(([lng, lat]) => toXZ(lng, lat));
  const mesh = new THREE.Mesh(ribbonGeometry(pts, 6, 0.6),
    new THREE.MeshBasicMaterial({ color: ROUTE, toneMapped: false, side: THREE.DoubleSide }));
  // faint glow underlay
  const glow = new THREE.Mesh(ribbonGeometry(pts, 14, 0.35),
    new THREE.MeshBasicMaterial({ color: ROUTE, transparent: true, opacity: 0.18, toneMapped: false, side: THREE.DoubleSide }));
  S.scene.add(mesh); S.scene.add(glow);
  S.routeMeshes = [mesh, glow];
}
export function updateRoute(walkPath) { makeRoute(walkPath); }

function pinSprite(poi, glyph) {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 112;
  const c = cv.getContext("2d");
  c.font = "700 40px 'Segoe UI', sans-serif";
  // truncate BY MEASURED WIDTH so text can never touch or escape the box
  let name = poi.enName || poi.title;
  const maxTextW = 330;
  if (c.measureText(name).width > maxTextW) {
    while (name.length > 2 && c.measureText(name + "…").width > maxTextW) name = name.slice(0, -1);
    name += "…";
  }
  const tw = c.measureText(name).width;
  const w = 20 + 48 + 16 + tw + 28;          // pad · glyph · gap · text · pad
  const x0 = (512 - w) / 2;
  c.fillStyle = "rgba(15,18,26,0.92)";
  c.strokeStyle = TYPE_PIN[poi.type] || "#4f8cff"; c.lineWidth = 5;
  c.beginPath(); c.roundRect(x0, 14, w, 84, 42); c.fill(); c.stroke();
  c.font = "44px 'Segoe UI Emoji'"; c.fillText(glyph, x0 + 20, 74);
  c.font = "700 40px 'Segoe UI', sans-serif"; c.fillStyle = "#f4f6fb";
  c.fillText(name, x0 + 84, 74);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(42, 9.2, 1);
  return sp;
}

function makePins(pois, glyphs) {
  const poleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 });
  for (const p of pois) {
    const [x, z] = toXZ(p.lng, p.lat);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 46, 5), poleMat);
    pole.position.y = 23; g.add(pole);
    const sp = pinSprite(p, glyphs[p.type] || "📍");
    sp.position.y = 52; g.add(sp);
    g.position.set(x, 0, z);
    S.scene.add(g);
    S.pins.set(p.id, sp);
    S.pinGroups.set(p.id, g);
  }
}

// subway stations — every tourist arrives underground, so mark them clearly
function subwaySprite(st) {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 112;
  const c = cv.getContext("2d");
  c.font = "800 42px 'Segoe UI', sans-serif";
  const tw = c.measureText(st.en).width;
  const w = 22 + st.lines.length * 58 + 12 + tw + 30;   // pad · line badges · gap · text · pad
  const x0 = (512 - w) / 2;
  c.fillStyle = "rgba(10,14,24,0.95)";
  c.strokeStyle = "#ffffff"; c.lineWidth = 6;
  c.beginPath(); c.roundRect(x0, 14, w, 84, 42); c.fill(); c.stroke();
  let x = x0 + 22;
  for (const ln of st.lines) {
    c.fillStyle = ln.c; c.beginPath(); c.arc(x + 26, 56, 26, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff"; c.font = "800 36px 'Segoe UI', sans-serif";
    c.textAlign = "center"; c.fillText(ln.n, x + 26, 69); c.textAlign = "left";
    x += 58;
  }
  c.fillStyle = "#ffffff"; c.font = "800 42px 'Segoe UI', sans-serif";
  c.fillText(st.en, x + 12, 71);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(46, 10, 1);
  return sp;
}
function makeSubway(stations) {
  for (const st of stations) {
    const [x, z] = toXZ(st.lng, st.lat);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 26, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    pole.position.y = 13; g.add(pole);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6, 24),
      new THREE.MeshBasicMaterial({ color: st.lines[0].c, transparent: true, opacity: 0.85, toneMapped: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.7; g.add(disc);
    const sp = subwaySprite(st); sp.position.y = 30; g.add(sp);
    g.position.set(x, 0, z);
    S.scene.add(g);
  }
}

function makeAvatar() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: .6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xffd9b8, roughness: .8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.1, 4.2, 4, 10), mat);
  body.position.y = 5.5; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(2, 14, 12), skin);
  head.position.y = 10.7; head.castShadow = true; g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xff7a59, roughness: .6 }));
  cap.position.y = 11.1; g.add(cap);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.8, 32),
    new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: .6, side: THREE.DoubleSide, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6; g.add(ring);
  S.avatarRing = ring;
  // YOU ARE HERE — the loudest label on the map (no live GPS on desktop, so this IS you)
  const cv = document.createElement("canvas"); cv.width = 560; cv.height = 112;
  const c = cv.getContext("2d");
  c.font = "900 42px 'Segoe UI', sans-serif";
  const tw = c.measureText("📍 YOU ARE HERE").width;
  const pw = tw + 76, x0 = (560 - pw) / 2;      // generous padding so the text breathes
  const grad = c.createLinearGradient(x0, 0, x0 + pw, 0);
  grad.addColorStop(0, "#4f8cff"); grad.addColorStop(1, "#7c5cff");
  c.fillStyle = grad;
  c.beginPath(); c.roundRect(x0, 10, pw, 78, 39); c.fill();
  c.strokeStyle = "#ffffff"; c.lineWidth = 7; c.stroke();
  c.beginPath(); c.moveTo(250, 88); c.lineTo(310, 88); c.lineTo(280, 112); c.fill(); // tail
  c.fillStyle = "#ffffff"; c.textAlign = "center";
  c.fillText("📍 YOU ARE HERE", 280, 63);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(76, 15.2, 1); sp.position.y = 26; sp.renderOrder = 10;
  g.add(sp);
  S.youLabel = sp;
  S.scene.add(g);
  S.avatar = g;
}

// ---------- public API ----------
export function initScene({ container, buildings, streets, walkPath, pois, center, glyphs, subway, water }) {
  S.center = center;
  S.kx = 111320 * Math.cos((center.lat * Math.PI) / 180);

  S.renderer = new THREE.WebGLRenderer({ antialias: true });
  S.renderer.setSize(innerWidth, innerHeight);
  S.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  S.renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(S.renderer.domElement);

  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color(BG);
  S.scene.fog = new THREE.Fog(BG, 850, 2100);

  S.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 16000);

  // lights — warm sun + cool sky bounce (driven by the real Seoul clock)
  S.hemi = new THREE.HemisphereLight(0xbfd0ff, 0x2c3040, 1.0);
  S.scene.add(S.hemi);
  S.sun = new THREE.DirectionalLight(0xfff0da, 1.6);
  S.sun.position.set(-420, 560, 300);
  S.sun.castShadow = true;
  S.sun.shadow.mapSize.set(2048, 2048);
  Object.assign(S.sun.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, far: 2600 });
  S.sun.shadow.bias = -0.0004;
  S.scene.add(S.sun);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(2600, 48),
    new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  S.scene.add(ground);

  makeRoads(streets);
  makeWater(water);
  makeBuildings(buildings);
  makeRoute(walkPath);
  makePins(pois, glyphs);
  if (subway) makeSubway(subway);
  makeAvatar();

  addEventListener("resize", () => {
    S.camera.aspect = innerWidth / innerHeight;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(innerWidth, innerHeight);
  });

  // zoom — mouse wheel + touch pinch (works in simulation and idle orbit)
  const clampZoom = (z) => Math.min(5.5, Math.max(0.3, z));
  S.renderer.domElement.addEventListener("wheel", (e) => {
    e.preventDefault();
    S.zoom = clampZoom(S.zoom * (e.deltaY > 0 ? 1.13 : 0.885));
  }, { passive: false });
  let pinchD = 0;
  S.renderer.domElement.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchD) S.zoom = clampZoom(S.zoom * (pinchD / d));
    pinchD = d;
  }, { passive: false });
  S.renderer.domElement.addEventListener("touchend", () => { pinchD = 0; });
}

export function moveAvatar3d(lng, lat, headingDeg) {
  const [x, z] = toXZ(lng, lat);
  S.avatar.position.set(x, 0, z);
  S.avatarHeading = headingDeg;
  S.avatar.rotation.y = -headingDeg * Math.PI / 180;
}

// game 3rd-person follow: camera behind+above avatar, looking past it
export function followCam(lng, lat, headingDeg, dt) {
  moveAvatar3d(lng, lat, headingDeg);
  const [x, z] = toXZ(lng, lat);
  const h = headingDeg * Math.PI / 180;
  const fx = Math.sin(h), fz = -Math.cos(h); // forward
  // stay above the dense low-rise roofline so the cam never enters a building
  const zm = S.zoom;
  const target = new THREE.Vector3(x - fx * 80 * zm, 96 * zm, z - fz * 80 * zm);
  const look = new THREE.Vector3(x + fx * 32, 6, z + fz * 32);
  if (!S.camInit) { S.camPos.copy(target); S.camLook.copy(look); S.camInit = true; }
  const k = 1 - Math.exp(-dt * 3.2);
  S.camPos.lerp(target, k); S.camLook.lerp(look, k);
  S.camera.position.copy(S.camPos);
  S.camera.lookAt(S.camLook);
}

export function orbitCam(dt, speedDeg) {
  S.camInit = false;
  S.orbitAngle = (S.orbitAngle + speedDeg * dt) % 360;
  const a = S.orbitAngle * Math.PI / 180, zm = S.zoom;
  S.camera.position.set(Math.sin(a) * 780 * zm, 520 * zm, Math.cos(a) * 780 * zm);
  S.camera.lookAt(0, 0, 0);
}

export function markVisited(id) {
  const sp = S.pins.get(id);
  if (sp) { sp.material.color.set(0x8a8f99); sp.material.opacity = 0.55; sp.material.transparent = true; }
}

// dim every pin that isn't part of the chosen course
export function setPinActive(ids) {
  S.pinActive = ids;
  for (const [id, sp] of S.pins) {
    const on = !ids || ids.has(id);
    sp.material.color.set(0xffffff);
    sp.material.transparent = true;
    sp.material.opacity = on ? 1 : 0.12;
    S.pinGroups.get(id).children[0].visible = on; // pole
  }
}

export function resetPins() { setPinActive(S.pinActive); }

export function removePin(id) {
  const g = S.pinGroups.get(id);
  if (g) { S.scene.remove(g); S.pinGroups.delete(id); S.pins.delete(id); }
}

// dynamically add a pin for a Google-searched custom place
export function addPin(poi, glyph) {
  if (S.pins.has(poi.id)) return;
  const [x, z] = toXZ(poi.lng, poi.lat);
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 46, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }));
  pole.position.y = 23; g.add(pole);
  const sp = pinSprite(poi, glyph);
  sp.position.y = 52; g.add(sp);
  g.position.set(x, 0, z);
  S.scene.add(g);
  S.pins.set(poi.id, sp);
  S.pinGroups.set(poi.id, g);
}

// ---------- real-time environment (Seoul sun + live weather) ----------
// solar elevation/azimuth from date + Myeongdong lat/lng (NOAA approximation)
function sunAngles(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = Math.floor((date - start) / 864e5);
  const hours = date.getHours() + date.getMinutes() / 60;
  const decl = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365) * Math.PI / 180;
  const solarT = hours + (S.center.lng - 135) / 15;          // KST meridian = 135°E
  const H = (solarT - 12) * 15 * Math.PI / 180;
  const lat = S.center.lat * Math.PI / 180;
  const elev = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  return { elev: elev * 180 / Math.PI, az: az * 180 / Math.PI };
}

const lerpN = (a, b, t) => a + (b - a) * t;
function envDefaults() {
  return {
    bg: new THREE.Color(BG), fogNear: 850, fogFar: 2100,
    hemi: 1.0, sunI: 1.6, sunColor: new THREE.Color(0xfff0da),
    sunPos: new THREE.Vector3(-420, 560, 300), glow: 0,
  };
}

// date = Seoul wall-clock time, weather = {kind, cloud} from Open-Meteo
export function setEnvironment(date, weather) {
  if (!S.envT) { S.env = envDefaults(); S.envT = envDefaults(); }
  const { elev, az } = sunAngles(date);
  const day = Math.min(1, Math.max(0, (elev + 6) / 18));     // 0 night → 1 day
  const cloud = weather?.cloud ?? 0;
  const dim = 1 - 0.45 * cloud;
  const T = S.envT;

  const r = 900, e = Math.max(elev, 8) * Math.PI / 180, a = az * Math.PI / 180;
  T.sunPos.set(r * Math.cos(e) * Math.sin(a), r * Math.sin(e), -r * Math.cos(e) * Math.cos(a));
  T.sunColor.setHex(0xffb46b).lerp(new THREE.Color(0xfff2dd), Math.min(1, Math.max(0, elev / 35)));
  T.sunI = (0.05 + 1.7 * day) * dim;
  T.hemi = (0.38 + 0.75 * day) * (1 - 0.25 * cloud);
  T.bg.setHex(0x0b0d12).lerp(new THREE.Color(0xa9c2ea), day).multiplyScalar(1 - 0.3 * cloud * day);
  T.glow = 1 - day;                                           // window lights at night

  const k = weather?.kind || "clear";
  [T.fogNear, T.fogFar] =
    k === "fog" ? [220, 900] : k === "rain" ? [500, 1500] : k === "snow" ? [420, 1300] : [850, 2200];
  setParticles(k === "rain" ? "rain" : k === "snow" ? "snow" : "none");
}

function setParticles(kind) {
  if (kind === S.particleKind) return;
  S.particleKind = kind;
  if (S.particles) { S.scene.remove(S.particles); S.particles = null; }
  if (kind === "none") return;
  const N = 3200, pos = new Float32Array(N * 3);
  S.pVel = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 640;
    pos[i * 3 + 1] = Math.random() * 300;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 640;
    S.pVel[i] = kind === "rain" ? 90 + Math.random() * 50 : 9 + Math.random() * 7;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  S.particles = new THREE.Points(g, new THREE.PointsMaterial({
    color: kind === "rain" ? 0xaac3e8 : 0xffffff,
    size: kind === "rain" ? 2.1 : 2.8,
    transparent: true, opacity: kind === "rain" ? 0.75 : 0.9, depthWrite: false,
  }));
  S.scene.add(S.particles);
}

function envTick(dt) {
  if (!S.env) return;
  const E = S.env, T = S.envT, k = 1 - Math.exp(-dt * 1.6);
  E.bg.lerp(T.bg, k); E.sunColor.lerp(T.sunColor, k); E.sunPos.lerp(T.sunPos, k);
  E.hemi = lerpN(E.hemi, T.hemi, k); E.sunI = lerpN(E.sunI, T.sunI, k);
  E.fogNear = lerpN(E.fogNear, T.fogNear, k); E.fogFar = lerpN(E.fogFar, T.fogFar, k);
  E.glow = lerpN(E.glow, T.glow, k);

  S.scene.background.copy(E.bg); S.scene.fog.color.copy(E.bg);
  // scale fog with zoom so a far zoom-out never swallows the whole city
  const zf = Math.max(1, S.zoom * 1.15);
  S.scene.fog.near = E.fogNear * zf; S.scene.fog.far = E.fogFar * zf;
  S.hemi.intensity = E.hemi;
  S.sun.intensity = E.sunI; S.sun.color.copy(E.sunColor); S.sun.position.copy(E.sunPos);
  if (S.wallMat) { S.wallMat.emissiveIntensity = E.glow * 1.15; S.shopMat.emissiveIntensity = E.glow * 0.8; }

  if (S.particles) {
    const p = S.particles.geometry.attributes.position, c = S.camLook;
    S.particles.position.set(c.x, 0, c.z);
    for (let i = 0; i < S.pVel.length; i++) {
      let y = p.array[i * 3 + 1] - S.pVel[i] * dt;
      if (y < 0) y = 320;
      p.array[i * 3 + 1] = y;
      if (S.particleKind === "snow") p.array[i * 3] += Math.sin(y * 0.05 + i) * 0.35;
    }
    p.needsUpdate = true;
  }
}

export function render(dt) {
  // river current — slide the streak texture along the stream
  if (S.waterTex) S.waterTex.offset.x -= dt * 0.055;
  // avatar walk bob + YOU-ARE-HERE pulse (find yourself at a glance)
  if (S.avatar) {
    S.bobT += dt * 9;
    S.avatar.position.y = Math.abs(Math.sin(S.bobT)) * 0.9;
    const s = 1 + 0.055 * Math.sin(S.bobT * 0.35);
    // label scales with zoom: dominant when zoomed out, out of the way up close
    const w = Math.min(96, Math.max(15, 62 * S.zoom)) * s;
    S.youLabel?.scale.set(w, w * 0.2, 1);
    if (S.avatarRing) S.avatarRing.scale.setScalar(1 + 0.25 * Math.abs(Math.sin(S.bobT * 0.35)));
  }
  envTick(dt);
  S.renderer.render(S.scene, S.camera);
}
