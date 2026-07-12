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
const TYPE_PIN = { food: "#ff7a59", attraction: "#4f8cff", culture: "#7c5cff", shopping: "#35c88b", beauty: "#f25c9a", custom: "#ffd27a", photo: "#ff8ac2" };
// saturated awning/storefront tints — Myeongdong street level is colourful
const SHOPS = [0xff7a59, 0x35c88b, 0x4f8cff, 0xffd27a, 0xf25c9a, 0x7c5cff, 0xffb347];
// building style — diorama ("architect's model": muted greige palette, contact
// AO, glass towers, rooftop clutter) is the DEFAULT; ?style=classic reverts,
// ?style=split shows old vs new half-and-half
const STYLE = new URLSearchParams(location.search).get("style") || "diorama";
const CREAMS_P = [0xe7e3da, 0xdedad1, 0xd6d1c5, 0xe3dcd0, 0xd0cabf, 0xeae7e1];
const ACCENTS_P = [0xc9b8a8, 0xaab3ab, 0xa6aebc, 0xd3bfae, 0x9aa1a9];
const SHOPS_P = [0xc26a4e, 0x3f8f72, 0x51709f, 0xc9a05a, 0xa85878, 0x7e6ca8, 0xbd854d];

const S = {
  renderer: null, scene: null, camera: null,
  center: null, kx: 1,
  avatar: null, avatarHeading: 0, bobT: 0,
  pins: new Map(), pinGroups: new Map(), pinActive: null, routeMeshes: [],
  camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), camInit: false,
  orbitAngle: 20, orbitEl: 34, orbitTarget: new THREE.Vector3(0, 0, 0), lastCamTouch: 0, zoom: 1,
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
    if (STYLE === "diorama" || STYLE === "split") {
      c.fillStyle = "rgba(8,14,26,.42)"; c.fillRect(x + 32, y + 21, 64, 10);   // inset shadow (depth)
      c.fillStyle = "rgba(255,255,255,.16)"; c.fillRect(x + 32, y + 66, 64, 8); // sill light catch
    }
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
  const props = [];            // rooftop water tanks / AC units (diorama style)
  const tintGeo = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const col = new THREE.Color(), shopCol = new THREE.Color();
  const SHOP_H = 3.6;
  S.bIndex = [];               // per-building centroid + colour ranges (for course highlight)
  let roofVerts = 0;

  // cb = colour at the ground, ct = colour at the top (AO gradient when they differ)
  const pushQuad = (B, x1, z1, x2, z2, y0, y1, u0, u1, v0, v1, nx, nz, cb, ct) => {
    const i = B.pos.length / 3;
    B.pos.push(x1, y0, z1, x2, y0, z2, x2, y1, z2, x1, y1, z1);
    for (let k = 0; k < 4; k++) B.nor.push(nx, 0, nz);
    B.col.push(cb.r, cb.g, cb.b, cb.r, cb.g, cb.b, ct.r, ct.g, ct.b, ct.r, ct.g, ct.b);
    B.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    B.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };

  for (const f of geojson.features) {
    const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates] :
      f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    const h = Math.max(4, f.properties.height || 10);
    const seed = (f.properties.id || 1) % 97;
    const bRec = { w0: walls.col.length / 3, r0: roofVerts, cx: 0, cz: 0, pts: null, h };
    const first = rings[0]?.[0]?.[0];
    const prem = STYLE === "diorama" || (STYLE === "split" && first && toXZ(first[0], first[1])[0] > 0);
    if (prem) {
      // tall towers read as cool glass offices, low-rise stays warm greige
      if (h >= 40) col.setHex([0xaec2d2, 0x9cb2c6, 0xbccbd8][seed % 3]);
      else col.setHex(seed % 9 === 0 ? ACCENTS_P[seed % ACCENTS_P.length] : CREAMS_P[seed % CREAMS_P.length]);
      shopCol.setHex(SHOPS_P[seed % SHOPS_P.length]);
    } else {
      col.setHex(seed % 11 === 0 ? ACCENTS[seed % ACCENTS.length] : CREAMS[seed % CREAMS.length]);
      shopCol.setHex(SHOPS[seed % SHOPS.length]);
    }
    col.multiplyScalar(0.94 + (seed % 7) * 0.015);
    if (prem) shopCol.multiplyScalar(0.82);
    // AO concentrated at ground contact (0..8m), not diluted over the full wall
    const cAO = prem ? col.clone().multiplyScalar(0.3) : null;
    const cTop = prem ? col.clone().multiplyScalar(1.08) : null;
    const roofK = prem ? 0.8 : 0.6;

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
      // a quarter of the low-rise gets Korea's signature green waterproof roof paint
      const rc = prem && h <= 13 && seed % 4 === 0
        ? new THREE.Color(0x4b8a5f).multiplyScalar(0.78 + (seed % 5) * 0.035)
        : col.clone().multiplyScalar(roofK);
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
          if (prem) {
            const yb = Math.min(8, h * 0.6);
            pushQuad(walls, x1, z1, x2, z2, 0, yb, acc / FAC_W, (acc + len) / FAC_W, 0, yb / FAC_H, nx, nz, cAO, col);
            if (h > yb) pushQuad(walls, x1, z1, x2, z2, yb, h, acc / FAC_W, (acc + len) / FAC_W, yb / FAC_H, h / FAC_H, nx, nz, col, cTop);
          } else {
            pushQuad(walls, x1, z1, x2, z2, 0, h, acc / FAC_W, (acc + len) / FAC_W, 0, h / FAC_H, nx, nz, col, col);
          }
          const off = 0.14;
          pushQuad(shops, x1 + nx * off, z1 + nz * off, x2 + nx * off, z2 + nz * off,
            0, SHOP_H, acc / 4.5, (acc + len) / 4.5, 0, 1, nx, nz, shopCol, shopCol);
          acc += len;
        }
      }
    }
    bRec.w1 = walls.col.length / 3; bRec.r1 = roofVerts;
    S.bIndex.push(bRec);

    // rooftop clutter on larger roofs — the detail that sells the "model city" look
    if (prem && bRec.pts && h >= 6) {
      let pa = 0; const P = bRec.pts;
      for (let i = 0; i < P.length - 1; i++) pa += P[i][0] * P[i + 1][1] - P[i + 1][0] * P[i][1];
      if (Math.abs(pa) / 2 > 130) {
        const jx = ((seed % 7) - 3) * 0.6, jz = ((seed % 5) - 2) * 0.7;
        const tank = new THREE.CylinderGeometry(1.25, 1.25, 2.3, 10);
        tank.translate(bRec.cx + jx, h + 1.15, bRec.cz + jz);
        props.push(tintGeo(tank, seed % 3 === 0 ? 0xe3c268 : 0xd9dee3));
        for (let a2 = 0, nAc = 1 + (seed % 3); a2 < nAc; a2++) {
          const ac = new THREE.BoxGeometry(1.6, 0.8, 0.7);
          ac.translate(bRec.cx - jx + 2.4 - a2 * 2.1, h + 0.4, bRec.cz - jz + (a2 % 2) * 1.6 - 0.8);
          props.push(tintGeo(ac, 0xc6ccd4));
        }
      }
    }
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

  if (props.length) {
    const pm = new THREE.Mesh(mergeGeometries(props, false),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }));
    pm.castShadow = true; pm.receiveShadow = true;
    S.scene.add(pm);
  }

  S.wallMesh = wallMesh; S.roofMesh = roofMesh;
  S.origWallCol = Float32Array.from(wallMesh.geometry.attributes.color.array);
  S.origRoofCol = Float32Array.from(roofMesh.geometry.attributes.color.array);
}

// tint the buildings that belong to the active course (honey gold — sits well
// next to the yellow route) + a glow disc at their feet so it reads at night too
// course-highlight colour: mint at night (reads against the dark city), warm
// coral by day (mint would blend into the green rooftops)
const HL_NIGHT = new THREE.Color(0x4fd6a8), HL_DAY = new THREE.Color(0x8f7cf5); // mint night / violet day (nothing else in the city is violet)
const HL = new THREE.Color(0x4fd6a8);
export function highlightCourse(lngLats) {
  if (!S.wallMesh) return;
  S._hlLL = lngLats;
  const isDay = (S.env?.glow ?? 1) < 0.5;
  HL.copy(isDay ? HL_DAY : HL_NIGHT);
  const shellOpacity = isDay ? 0.13 : 0.22, discOpacity = isDay ? 0.2 : 0.3;
  const wc = S.wallMesh.geometry.attributes.color;
  const rc = S.roofMesh.geometry.attributes.color;
  wc.array.set(S.origWallCol); rc.array.set(S.origRoofCol);
  if (!S.hl) { S.hl = new THREE.Group(); S.scene.add(S.hl); }
  S.hl.clear();
  const discGeo = new THREE.CircleGeometry(11, 24);
  const discMat = new THREE.MeshBasicMaterial({ color: HL, transparent: true, opacity: discOpacity, toneMapped: false, side: THREE.DoubleSide });
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
        color: HL, transparent: true, opacity: shellOpacity, toneMapped: false,
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
  c.fillStyle = "#4f9fd8"; c.fillRect(0, 0, 256, 64);
  // lively current: many bright streaks + white foam glints
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * 64, len = 40 + Math.random() * 90;
    const g = c.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(190,230,255,0)");
    g.addColorStop(0.5, `rgba(195,235,255,${0.28 + Math.random() * 0.3})`);
    g.addColorStop(1, "rgba(190,230,255,0)");
    c.fillStyle = g;
    c.save(); c.translate(Math.random() * 256, y);
    c.fillRect(0, -1.4, len, 2.8); c.restore();
  }
  for (let i = 0; i < 14; i++) {                       // sparkling foam dashes
    c.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.35})`;
    c.fillRect(Math.random() * 256, Math.random() * 64, 6 + Math.random() * 14, 1.3);
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
      map: S.waterTex, color: 0xaee2ff, roughness: 0.15, metalness: 0.1, side: THREE.DoubleSide,
      emissive: 0x2a6a9e, emissiveIntensity: 0.35,   // stays visibly blue even at night
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
  // x-ray pass: the yellow route must NEVER vanish behind a building —
  // occluded stretches still glow through whatever hides them
  const xray = new THREE.Mesh(ribbonGeometry(pts, 6, 0.6),
    new THREE.MeshBasicMaterial({
      color: ROUTE, transparent: true, opacity: 0.35, toneMapped: false, side: THREE.DoubleSide,
      depthWrite: false, depthFunc: THREE.GreaterDepth,
    }));
  xray.renderOrder = 8;
  // painted direction chevrons every ~16 m — at a fork you SEE which branch is yours
  const A = { pos: [], idx: [] };
  const pushArrow = (ax, az, ux, uz) => {
    // one SOLID triangle — reads as an arrow from any distance, never as an "x"
    const px = -uz, pz = ux, i = A.pos.length / 3, y = 0.78;
    A.pos.push(
      ax + ux * 2.4, y, az + uz * 2.4,
      ax - ux * 1.4 + px * 1.7, y, az - uz * 1.4 + pz * 1.7,
      ax - ux * 1.4 - px * 1.7, y, az - uz * 1.4 - pz * 1.7,
    );
    A.idx.push(i, i + 1, i + 2);
  };
  let acc = 0, next = 8;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const seg = Math.hypot(x2 - x1, z2 - z1);
    if (seg < 0.01) continue;
    const ux = (x2 - x1) / seg, uz = (z2 - z1) / seg;
    while (next <= acc + seg) {
      const d = next - acc;
      pushArrow(x1 + ux * d, z1 + uz * d, ux, uz);
      next += 16;
    }
    acc += seg;
  }
  const arrowGeo = new THREE.BufferGeometry();
  arrowGeo.setAttribute("position", new THREE.Float32BufferAttribute(A.pos, 3));
  arrowGeo.setIndex(A.idx);
  const arrows = new THREE.Mesh(arrowGeo,
    new THREE.MeshBasicMaterial({ color: 0x6b4a00, toneMapped: false, side: THREE.DoubleSide }));
  S.scene.add(mesh); S.scene.add(glow); S.scene.add(xray); S.scene.add(arrows);
  S.routeMeshes = [mesh, glow, xray, arrows];
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
  // two lines: station name + "SUBWAY STATION", sized so text never touches the box
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 150;
  const c = cv.getContext("2d");
  c.font = "800 42px 'Segoe UI', sans-serif";
  const tw1 = c.measureText(st.en).width;
  c.font = "700 25px 'Segoe UI', sans-serif";
  const tw2 = c.measureText("SUBWAY STATION").width;
  const textW = Math.max(tw1, tw2);
  const w = 22 + st.lines.length * 58 + 14 + textW + 30;   // pad · line badges · gap · text · pad
  const x0 = (512 - w) / 2;
  c.fillStyle = "rgba(10,14,24,0.95)";
  c.strokeStyle = "#ffffff"; c.lineWidth = 6;
  c.beginPath(); c.roundRect(x0, 10, w, 130, 40); c.fill(); c.stroke();
  let x = x0 + 22;
  for (const ln of st.lines) {
    c.fillStyle = ln.c; c.beginPath(); c.arc(x + 26, 75, 26, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff"; c.font = "800 36px 'Segoe UI', sans-serif";
    c.textAlign = "center"; c.fillText(ln.n, x + 26, 88); c.textAlign = "left";
    x += 58;
  }
  c.fillStyle = "#ffffff"; c.font = "800 42px 'Segoe UI', sans-serif";
  c.fillText(st.en, x + 14, 70);
  c.fillStyle = "#a9bbd2"; c.font = "700 25px 'Segoe UI', sans-serif";
  c.fillText("SUBWAY STATION", x + 14, 110);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(46, 13.5, 1);
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
  // the player is the protagonist: buildings stay untouched, but the character
  // must ALWAYS be fully visible. Second x-ray pass per part in the part's OWN
  // colour (GreaterDepth ⇒ drawn only where something covers it) — behind a
  // building the character looks exactly like themselves, not a dim ghost; the
  // x-ray route + feet ring below give the "behind, not on the roof" context.
  const bodies = [];
  g.traverse((o) => { if (o.isMesh) bodies.push(o); });
  for (const o of bodies) {
    const gh = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({
      color: o.material.color.clone(),
      transparent: true, opacity: o.material === ring.material ? 0.55 : 0.96,
      depthWrite: false, depthFunc: THREE.GreaterDepth, toneMapped: false,
    }));   // child ⇒ follows animation
    gh.renderOrder = 9;
    o.add(gh);
  }
  S.scene.add(g);
  S.avatar = g;
}

// ---------- landmarks: Namsan, name plates, cathedral, LED billboards ----------
function landmarkSprite(name) {
  const cv = document.createElement("canvas"); cv.width = 640; cv.height = 112;
  const c = cv.getContext("2d");
  c.font = "800 40px 'Segoe UI', sans-serif";
  let t = name;
  while (t.length > 2 && c.measureText("★ " + t).width > 520) t = t.slice(0, -1);
  const starW = c.measureText("★ ").width, tw = c.measureText(t).width;
  const w = 28 + starW + tw + 28, x0 = (640 - w) / 2;
  c.fillStyle = "rgba(26,21,12,0.93)";
  c.strokeStyle = "#e9c46a"; c.lineWidth = 5;
  c.beginPath(); c.roundRect(x0, 14, w, 84, 42); c.fill(); c.stroke();
  c.fillStyle = "#e9c46a"; c.fillText("★ ", x0 + 28, 70);
  c.fillStyle = "#f7f3e8"; c.fillText(t, x0 + 28 + starW, 70);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(52, 9.1, 1);
  return sp;
}

// famous big buildings get a name plate on the roof
const LANDMARKS = [
  ["Lotte Hotel Seoul", 126.98111, 37.56536],
  ["Lotte Department Store", 126.98210, 37.56465],
  ["Shinsegae Department Store", 126.98095, 37.56060],
  ["Myeongdong Cathedral (1898)", 126.98737, 37.56358],
  ["The Westin Josun Seoul", 126.97980, 37.56440],
  ["Bank of Korea Museum (1912)", 126.98185, 37.55975],
  ["Seoul City Hall", 126.97830, 37.56640],
];
const nearestBuilding = (x, z, r) => {
  let best = null, bd = r;
  for (const b of S.bIndex) { const d = Math.hypot(b.cx - x, b.cz - z); if (d < bd) { bd = d; best = b; } }
  return best;
};
function makeLandmarks() {
  for (const [name, lng, lat] of LANDMARKS) {
    const [x, z] = toXZ(lng, lat);
    const b = nearestBuilding(x, z, 80);
    const sp = landmarkSprite(name);
    sp.position.set(b ? b.cx : x, (b ? b.h : 20) + 14, b ? b.cz : z);
    sp.renderOrder = 5;
    S.scene.add(sp);
  }
}

// Namsan rises just south of Myeongdong — the one thing every visitor recognises
// forest-y hill: jitter the cone vertices + blend two greens so it isn't a smooth blob
function forestCone(r, h, seg) {
  // low-poly faceted mountain: hash-jittered vertices + flat shading
  const geo = new THREE.ConeGeometry(r, h, seg, 5).toNonIndexed();
  const p = geo.attributes.position, n = p.count;
  const cA = new THREE.Color(0x33523d), cB = new THREE.Color(0x466a4a), t = new THREE.Color();
  const colors = new Float32Array(n * 3);
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rim = 1 - Math.abs(y) / (h / 2);           // keep apex + base ring in place
    const j = (hash(x, z) - 0.5) * 2;
    p.setX(i, x + j * r * 0.06 * rim);
    p.setZ(i, z + (hash(z, x) - 0.5) * 2 * r * 0.06 * rim);
    p.setY(i, Math.max(-h / 2, y + j * h * 0.06 * rim));
  }
  // flat facets: one colour per triangle
  for (let f = 0; f < n; f += 3) {
    const m = hash(p.getX(f), p.getZ(f));
    t.copy(cA).lerp(cB, m);
    for (let k = 0; k < 3; k++) t.toArray(colors, (f + k) * 3);
  }
  geo.computeVertexNormals();
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}
function makeNamsan() {
  const [px, pz] = toXZ(126.9882, 37.5512);
  const g = new THREE.Group();
  const hillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const hill = new THREE.Mesh(forestCone(400, 215, 26), hillMat);
  hill.position.set(px, 107, pz); g.add(hill);
  const side = new THREE.Mesh(forestCone(280, 120, 20), hillMat);
  side.position.set(px - 270, 59, pz + 70); g.add(side);
  const side2 = new THREE.Mesh(forestCone(240, 100, 18), hillMat);
  side2.position.set(px + 250, 49, pz + 90); g.add(side2);
  // summit pad grounds the tower into the ridge (no floating gap)
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(30, 44, 14, 18),
    new THREE.MeshStandardMaterial({ color: 0x3c5a44, roughness: 1, flatShading: true }));
  pad.position.set(px, 198, pz); g.add(pad);
  const BASE = 190; // tower rises out of the summit, well below the jittered peak
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf1, roughness: 0.5 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5, 9, 100, 12), towerMat);
  shaft.position.set(px, BASE + 50, pz); g.add(shaft);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(16, 13, 15, 12), towerMat);
  deck.position.set(px, BASE + 107, pz); g.add(deck);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.4, 42, 8),
    new THREE.MeshStandardMaterial({ color: 0xd95f4b, roughness: 0.6 }));
  ant.position.set(px, BASE + 136, pz); g.add(ant);
  const sp = landmarkSprite("N Seoul Tower · Namsan");
  sp.position.set(px, BASE + 176, pz); sp.scale.multiplyScalar(1.7); g.add(sp);
  S.scene.add(g);
}

// Cheonggyecheon has no roof to hang a plate on — float its name over the
// stream head (Cheonggye Plaza) so you know what that blue ribbon IS
function labelCheonggyecheon() {
  const [x, z] = toXZ(126.9779, 37.5689);
  const sp = landmarkSprite("Cheonggyecheon Stream · 청계천");
  sp.position.set(x, 26, z);
  S.scene.add(sp);
}

// Myeongdong Cathedral — Korea's first Gothic church deserves better than a box:
// brick-tinted walls + a spire with a cross
function designCathedral() {
  const [x, z] = toXZ(126.98737, 37.56358);
  const b = nearestBuilding(x, z, 70);
  if (!b) { console.warn("[cathedral] no building matched"); return; }
  const brick = new THREE.Color(0xa8705c), roofBrick = new THREE.Color(0x6e4a3c);
  const tmp = new THREE.Color();
  for (let i = b.w0; i < b.w1; i++)
    tmp.fromArray(S.origWallCol, i * 3).lerp(brick, 0.8).toArray(S.origWallCol, i * 3);
  for (let i = b.r0; i < b.r1; i++)
    tmp.fromArray(S.origRoofCol, i * 3).lerp(roofBrick, 0.85).toArray(S.origRoofCol, i * 3);
  S.wallMesh.geometry.attributes.color.array.set(S.origWallCol);
  S.roofMesh.geometry.attributes.color.array.set(S.origRoofCol);
  S.wallMesh.geometry.attributes.color.needsUpdate = true;
  S.roofMesh.geometry.attributes.color.needsUpdate = true;
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 4.6, 26, 4),
    new THREE.MeshStandardMaterial({ color: 0x9b6b58, roughness: 0.8 }));
  spire.position.set(b.cx, b.h + 13, b.cz); spire.rotation.y = Math.PI / 4;
  spire.castShadow = true;
  const cm = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.5 });
  const cv = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), cm);
  cv.position.set(b.cx, b.h + 28.5, b.cz);
  const ch = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.5), cm);
  ch.position.set(b.cx, b.h + 29.4, b.cz);
  S.scene.add(spire, cv, ch);
}

// animated LED marquees on the main shopping drag — Myeongdong at full volume
function billboardTexture() {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 128;
  const c = cv.getContext("2d");
  c.fillStyle = "#140a2e"; c.fillRect(0, 0, 1024, 128);
  const msgs = [["MYEONGDONG", "#ff5fa2"], ["K-BEAUTY", "#5fd3ff"], ["SEOUL ♥", "#ffd25f"], ["SALE 50%", "#7dffb0"]];
  c.font = "900 62px 'Segoe UI', sans-serif"; c.textBaseline = "middle";
  let x = 30;
  for (const [t, col] of msgs) {
    c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 16;
    c.fillText(t, x, 66);
    x += c.measureText(t).width + 72;
  }
  c.shadowBlur = 0;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(0.55, 1);
  return tex;
}
const BILLBOARDS = [[126.98530, 37.56320], [126.98430, 37.56435], [126.98625, 37.56180]];
function makeBillboards() {
  S.bbTex = billboardTexture();
  const mat = new THREE.MeshBasicMaterial({ map: S.bbTex, toneMapped: false, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x30363f, roughness: 0.8 });
  for (const [lng, lat] of BILLBOARDS) {
    const [x, z] = toXZ(lng, lat);
    // tallest building within 90 m (the nearest one is often a tiny shop)
    let b = null;
    for (const c of S.bIndex) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (d < 90 && (!b || c.h > b.h)) b = c;
    }
    if (!b || b.h < 8) { console.warn("[billboard] no building near", lng, lat); continue; }
    const w = 20, hgt = 6;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), mat);
    panel.position.set(b.cx, b.h + 4 + hgt / 2, b.cz);
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4 + hgt, 0.5), frameMat);
    p1.position.set(b.cx - w / 2 + 1, b.h + (4 + hgt) / 2, b.cz - 0.3);
    const p2 = p1.clone(); p2.position.x = b.cx + w / 2 - 1;
    S.scene.add(panel, p1, p2);
  }
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
  makeNamsan();
  makeLandmarks();
  labelCheonggyecheon();
  designCathedral();
  makeBillboards();

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
    S.lastCamTouch = Date.now();       // pause the idle spin while inspecting
  }, { passive: false });
  // idle-orbit camera control: drag = rotate/tilt, right-drag = pan, wheel = zoom
  const cv = S.renderer.domElement;
  let drag = null;
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, btn: e.button };
    S.lastCamTouch = Date.now();
    S._orbitGoal = null;               // manual control beats an in-flight glide
  });
  addEventListener("pointerup", () => { drag = null; });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    S.lastCamTouch = Date.now();
    if (drag.btn === 2) {                            // pan — grab the map
      const a = S.orbitAngle * Math.PI / 180, k = 1.1 * S.zoom;
      S.orbitTarget.x += (Math.cos(a) * dx - Math.sin(a) * dy) * k;
      S.orbitTarget.z += (-Math.sin(a) * dx - Math.cos(a) * dy) * k;
      S.orbitTarget.x = Math.min(1300, Math.max(-1300, S.orbitTarget.x));
      S.orbitTarget.z = Math.min(1500, Math.max(-1300, S.orbitTarget.z));
    } else {                                         // rotate + tilt
      S.orbitAngle = (S.orbitAngle - dx * 0.25) % 360;
      S.orbitEl = Math.min(80, Math.max(14, S.orbitEl + dy * 0.18));
    }
  });
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

// glide the idle camera to a place (sidebar click → "show me where that is")
export function flyTo(lng, lat) {
  const [x, z] = toXZ(lng, lat);
  S._orbitGoal = { x, z, zoom: 0.34 };   // close enough that the spot fills the view
  S.lastCamTouch = Date.now();
}

// mid-walk peek: hand the camera from the follow rig to the orbit rig
// seamlessly — seed angle/elevation/zoom from the current camera transform
export function beginPeek() {
  const c = S.camera.position;
  S.orbitTarget.copy(S.camLook); S.orbitTarget.y = 0;
  const dx = c.x - S.orbitTarget.x, dz = c.z - S.orbitTarget.z;
  const R = Math.max(Math.hypot(dx, c.y, dz), 40);
  S.orbitEl = Math.asin(Math.min(0.95, Math.max(0.06, c.y / R))) * 180 / Math.PI;
  S.orbitAngle = Math.atan2(dx, dz) * 180 / Math.PI;
  S.zoom = Math.min(5.5, Math.max(0.3, R / 940));
  S._orbitGoal = null;
  S.lastCamTouch = Date.now();
}
// ...and glide the follow camera back from wherever the peek ended
export function endPeekCam() {
  S.camPos.copy(S.camera.position);
  S.camLook.copy(S.orbitTarget); S.camLook.y = 6;
  S.camInit = true;
  S._orbitGoal = null;
}

export function orbitCam(dt, speedDeg) {
  S.camInit = false;
  if (S._orbitGoal) {
    const g = S._orbitGoal, k = 1 - Math.exp(-dt * 3);
    S.orbitTarget.x += (g.x - S.orbitTarget.x) * k;
    S.orbitTarget.z += (g.z - S.orbitTarget.z) * k;
    S.zoom += (g.zoom - S.zoom) * k;
    S.lastCamTouch = Date.now();          // hold the auto-spin while flying
    if (Math.hypot(g.x - S.orbitTarget.x, g.z - S.orbitTarget.z) < 2 && Math.abs(g.zoom - S.zoom) < 0.02)
      S._orbitGoal = null;
  }
  // auto-spin only when the user hasn't touched the camera for a while
  if (Date.now() - S.lastCamTouch > 10000) S.orbitAngle = (S.orbitAngle + speedDeg * dt) % 360;
  const a = S.orbitAngle * Math.PI / 180, el = S.orbitEl * Math.PI / 180;
  const R = 940 * S.zoom, t = S.orbitTarget;
  S.camera.position.set(
    t.x + Math.sin(a) * Math.cos(el) * R,
    Math.sin(el) * R,
    t.z + Math.cos(a) * Math.cos(el) * R);
  S.camera.lookAt(t);
}

// back to the classic slowly-spinning overview (Reset button)
export function resetOrbit() {
  S.orbitTarget.set(0, 0, 0); S.orbitAngle = 20; S.orbitEl = 34; S.zoom = 1;
  S.lastCamTouch = 0; S._orbitGoal = null;
}

export function markVisited(id) {
  const sp = S.pins.get(id);
  if (sp) { sp.material.color.set(0x8a8f99); sp.material.opacity = 0.55; sp.material.transparent = true; }
}

// dim every pin that isn't part of the chosen course
export function setPinActive(ids) {
  S.pinActive = ids;
  for (const [id, sp] of S.pins) {
    // photo spots stay visible on every course
    const on = !ids || ids.has(id) || String(id).startsWith("ps-");
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
  if (STYLE === "diorama") {
    // film-miniature daylight: stronger golden sun, lower ambient → deeper shadows
    T.sunI = (0.05 + 2.05 * day) * dim;
    T.hemi = (0.38 + 0.5 * day) * (1 - 0.25 * cloud);
    T.sunColor.lerp(new THREE.Color(0xffdba8), 0.35 * day);
  }
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
  // day/night flip → re-tint the course highlight in the right colour
  const dayHL = E.glow < 0.5;
  if (S._hlIsDay !== dayHL) { S._hlIsDay = dayHL; if (S._hlLL?.length) highlightCourse(S._hlLL); }

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
  if (S.waterTex) S.waterTex.offset.x -= dt * 0.085;
  if (S.bbTex) S.bbTex.offset.x = (S.bbTex.offset.x + dt * 0.045) % 1;
  // avatar walk bob + YOU-ARE-HERE pulse (find yourself at a glance)
  if (S.avatar) {
    S.bobT += dt * 9;
    S.avatar.position.y = Math.abs(Math.sin(S.bobT)) * 0.9;
    const s = 1 + 0.055 * Math.sin(S.bobT * 0.35);
    // label scales with zoom: dominant when zoomed out, out of the way up close
    // big on the idle overview (find yourself at a glance), modest while
    // walking, and GONE when you zoom right onto the avatar — you can see
    // yourself, the label would just block the view
    const w = S.camInit
      ? Math.min(68, Math.max(14, 48 * S.zoom)) * s
      : Math.min(130, Math.max(22, 86 * S.zoom)) * s;
    if (S.youLabel) {
      const m = S.youLabel.material;
      const show = S.zoom > (S.camInit ? 0.62 : 0.4);
      m.transparent = true;
      m.opacity += ((show ? 1 : 0) - m.opacity) * 0.14;
      S.youLabel.visible = m.opacity > 0.04;
    }
    S.youLabel?.scale.set(w, w * 0.2, 1);
    if (S.avatarRing) S.avatarRing.scale.setScalar(1 + 0.25 * Math.abs(Math.sin(S.bobT * 0.35)));
  }
  envTick(dt);
  S.renderer.render(S.scene, S.camera);
}
