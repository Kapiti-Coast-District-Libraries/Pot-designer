import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise2D } from 'simplex-noise';

export type TextureType = 'none' | 'ribbed' | 'rings' | 'diamond' | 'organic' | 'perlin' | 'spiral' | 'waves' | 'dots' | 'scales' | 'honeycomb' | 'voronoi' | 'faceted' | 'grid' | 'bricks' | 'chevron' | 'herringbone';

export interface PotParameters {
  topRadius: number;
  bottomRadius: number;
  height: number;
  wallThickness: number;
  bottomThickness: number;
  drainageHoleDiameter: number;
  shapeProfile: 'linear' | 'curved' | 'geometric';
  segments: number;
  // Texture parameters
  textureType: TextureType;
  textureDepth: number;
  textureScale: number;
  textureSmoothing: number;
  // Advanced Texture parameters
  textureRotation: number;
  textureTwist: number;
  textureXScale: number;
  textureYScale: number;
  textureZOffset: number;
  enforceOverhangLimit: boolean;
  // Embossing controls
  textureMode: 'smooth' | 'emboss' | 'engrave';
  textureBandStart: number;
  textureBandEnd: number;
  infill: number;
  materialDensity: number;
  attachments: Attachment[];
}

export interface Attachment {
  id: string;
  stlUrl: string;
  name: string;
  angle: number;
  heightPos: number; // 0 to 1 (normalized height)
  distanceOffset: number; // mm from surface
  mountingWidth: number; // mm
  mountingHeight: number; // mm
  tilt: number; // manual tilt adjustment
  geometry?: THREE.BufferGeometry; // Loaded geometry
}

const noise2D = createNoise2D();

// Fractal Brownian Motion for "Perlin-like" noise
function fractalNoise(x: number, y: number, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += noise2D(x * frequency, y * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

export function getBaseRadius(t: number, bottomRadius: number, topRadius: number, shapeProfile: string = 'linear'): number {
  if (shapeProfile === 'curved') {
    const curve = Math.sin(t * Math.PI);
    return bottomRadius + (topRadius - bottomRadius) * t + curve * 15;
  }
  if (shapeProfile === 'geometric') {
    const steps = 5;
    const steppedT = Math.floor(t * steps) / steps;
    return bottomRadius + (topRadius - bottomRadius) * steppedT;
  }
  return bottomRadius + (topRadius - bottomRadius) * t;
}

export function buildPotGeometry(params: PotParameters): THREE.BufferGeometry {
  const {
    topRadius,
    bottomRadius,
    height,
    wallThickness,
    bottomThickness,
    drainageHoleDiameter,
    shapeProfile,
    segments: baseSegments,
    textureType,
    textureDepth,
    textureScale,
    textureSmoothing,
    textureRotation,
    textureTwist,
    textureXScale,
    textureYScale,
    textureZOffset,
    enforceOverhangLimit,
    textureMode,
    textureBandStart,
    textureBandEnd,
    attachments,
  } = params;

  const getBaseRadiusLocal = (t: number) => getBaseRadius(t, bottomRadius, topRadius, shapeProfile);

  // Resolution Scaling
  let segments = baseSegments;
  let heightSegments = 32;

  if (textureType !== 'none') {
    segments = Math.max(segments, 128);
    heightSegments = 128;
    
    // For ribbed patterns, align segments to frequency for perfect symmetry
    if (textureType === 'ribbed') {
      const freq = Math.round(textureScale * textureXScale);
      // Ensure segments is a multiple of frequency * 4 for clean geometry
      segments = Math.ceil(segments / (freq * 4)) * (freq * 4);
    }
  }

  if (shapeProfile === 'geometric') {
    segments = Math.max(3, Math.min(8, baseSegments));
    heightSegments = 1;
  }

  const vertices: number[] = [];
  const indices: number[] = [];

  const drainageHoleRadius = drainageHoleDiameter / 2;

  const getTextureOffset = (t: number, theta: number) => {
    if (textureType === 'none' || textureDepth === 0) return 0;

    const y = t * height;
    const baseR = getBaseRadiusLocal(t);

    // Check if we are in an attachment mask
    for (const att of attachments) {
      const attY = att.heightPos * height;
      const dy = Math.abs(y - attY);
      
      // Angular distance
      let dTheta = Math.abs(theta - att.angle);
      if (dTheta > Math.PI) dTheta = Math.PI * 2 - dTheta;
      
      const dx = dTheta * baseR;
      
      // We use a slightly larger area for the mask to ensure clearance
      if (dx < att.mountingWidth * 0.6 && dy < att.mountingHeight * 0.6) {
        return 0; // Flatten the surface for the attachment
      }
    }

    let v = 0; // Normalized pattern value (-1 to 1)
    
    // Apply Advanced Controls: Rotation and Twist
    const angle = theta + textureRotation + (t * textureTwist);
    const verticalPos = t + textureZOffset;

    // Ensure frequency is an integer for patterns that wrap around to prevent seams
    const freqX = textureScale * textureXScale;
    const freqY = textureScale * textureYScale;
    
    const freq = ['ribbed', 'spiral', 'waves', 'dots', 'scales', 'honeycomb', 'diamond', 'grid', 'bricks', 'chevron', 'herringbone'].includes(textureType) 
      ? Math.round(freqX) 
      : freqX;
    const amp = textureDepth;

    switch (textureType) {
      case 'ribbed':
        const rawSin = Math.sin(angle * freq);
        const s = textureSmoothing;
        v = Math.sign(rawSin) * Math.pow(Math.abs(rawSin), s);
        break;
      case 'rings':
        v = Math.sin(verticalPos * Math.PI * freqY);
        break;
      case 'diamond':
        v = Math.sin(angle * freq) * Math.sin(verticalPos * Math.PI * freqY * 0.5);
        break;
      case 'organic':
        const nx = Math.cos(angle) * freqX * 0.1;
        const nz = Math.sin(angle) * freqX * 0.1;
        const ny = verticalPos * freqY * 0.5;
        v = noise2D(nx, ny + nz);
        break;
      case 'perlin':
        const px = Math.cos(angle) * freqX * 0.05;
        const pz = Math.sin(angle) * freqX * 0.05;
        const py = verticalPos * freqY * 0.2;
        v = fractalNoise(px, py + pz);
        break;
      case 'spiral':
        v = Math.sin(angle * freq + verticalPos * Math.PI * 4);
        break;
      case 'waves':
        v = (Math.sin(angle * freq) + Math.sin(verticalPos * Math.PI * freqY * 0.3)) * 0.5;
        break;
      case 'dots':
        const dotTheta = Math.sin(angle * freq);
        const dotT = Math.sin(verticalPos * Math.PI * freqY * 0.5);
        v = (dotTheta > 0.7 && dotT > 0.7) ? 1 : 0;
        break;
      case 'scales':
        const sTheta = (angle * freq) % (Math.PI * 2);
        const sT = (verticalPos * freqY * 2) % (Math.PI * 2);
        v = Math.max(0, Math.sin(sTheta) * Math.cos(sT));
        break;
      case 'honeycomb':
        // Improved Hexagonal Grid
        const hScale = freq / Math.PI;
        const hx = angle * freq;
        const hy = verticalPos * freqY * 1.732; // sqrt(3)
        const hrow = Math.floor(hy);
        const hcol = Math.floor(hx + (hrow % 2) * 0.5);
        const hdx = (hx + (hrow % 2) * 0.5) - (hcol + 0.5);
        const hdy = hy - (hrow + 0.5);
        v = (hdx * hdx + hdy * hdy < 0.16) ? 1 : 0;
        break;
      case 'voronoi':
        const vx = Math.cos(angle) * freqX * 0.2;
        const vy = verticalPos * freqY * 0.2;
        v = noise2D(vx, vy) > 0.5 ? 1 : 0;
        break;
      case 'faceted':
        const fTheta = Math.floor(angle * freq) / freq;
        const fT = Math.floor(verticalPos * freqY) / freqY;
        v = noise2D(fTheta, fT);
        break;
      case 'grid':
        const gx = Math.abs(Math.sin(angle * freq));
        const gy = Math.abs(Math.sin(verticalPos * Math.PI * freqY));
        v = (gx > 0.9 || gy > 0.9) ? 1 : 0;
        break;
      case 'bricks':
        const by = Math.floor(verticalPos * freqY);
        const bShift = (by % 2) * 0.5 * (Math.PI * 2 / freq);
        const bLine = Math.abs(Math.sin((angle + bShift) * freq));
        const bRow = Math.abs(Math.sin(verticalPos * Math.PI * freqY));
        v = (bLine > 0.9 || bRow > 0.9) ? 1 : 0;
        break;
      case 'chevron':
        const cx = Math.abs((angle * freq) % (Math.PI * 2) - Math.PI) / Math.PI;
        const cy = verticalPos * freqY;
        v = Math.abs(Math.sin((cx + cy) * Math.PI)) > 0.8 ? 1 : 0;
        break;
      case 'herringbone':
        const hbx = Math.floor(angle * freq / Math.PI);
        const hby = verticalPos * freqY;
        const hbDir = (hbx % 2 === 0) ? 1 : -1;
        v = Math.abs(Math.sin((angle * freq + hby * hbDir) * Math.PI)) > 0.8 ? 1 : 0;
        break;
    }

    // Apply Embossing Modes
    let offset = 0;
    if (textureMode === 'smooth') {
      offset = v * amp;
    } else if (textureMode === 'emboss') {
      // Threshold for continuous patterns, keep binary patterns as is
      offset = v > 0 ? amp : 0;
    } else if (textureMode === 'engrave') {
      // Threshold and invert
      offset = v > 0 ? -amp : 0;
    }

    // Apply Band Masking
    const bandMask = (t >= textureBandStart && t <= textureBandEnd) ? 1 : 0;
    const edgeTaper = Math.min(1.0, t * 10) * Math.min(1.0, (1.0 - t) * 10);
    return offset * bandMask * edgeTaper;
  };

  const addVertex = (x: number, y: number, z: number) => {
    vertices.push(x, y, z);
    return (vertices.length / 3) - 1;
  };

  // Vertex generation
  const outerVertices: number[][] = [];
  const lastRadii: number[] = [];
  const heightStep = height / heightSegments;

  for (let i = 0; i <= heightSegments; i++) {
    const t = i / heightSegments;
    const y = t * height;
    const baseR = getBaseRadiusLocal(t);
    const innerR = Math.max(0, baseR - wallThickness);
    const row: number[] = [];
    const currentRowRadii: number[] = [];

    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      // Safety Clamp: Ensure outer radius never penetrates the inner shell.
      // We maintain a minimum wall thickness of 0.5mm even at the deepest part of the texture.
      const offset = getTextureOffset(t, theta);
      let r = Math.max(innerR + 0.5, baseR + offset);

      // Enforce Overhang Limit (45 degrees)
      // For 3D printing, an overhang is when the radius increases faster than the height.
      // A 45-degree angle means deltaR <= deltaH.
      if (enforceOverhangLimit && i > 0) {
        const prevR = lastRadii[j];
        const maxR = prevR + heightStep;
        r = Math.min(r, maxR);
      }

      currentRowRadii.push(r);
      row.push(addVertex(Math.cos(theta) * r, y, Math.sin(theta) * r));
    }
    outerVertices.push(row);
    lastRadii.length = 0;
    lastRadii.push(...currentRowRadii);
  }

  const innerVertices: number[][] = [];
  for (let i = 0; i <= heightSegments; i++) {
    const t = i / heightSegments;
    const y = Math.max(bottomThickness, t * height);
    const baseR = getBaseRadiusLocal(t);
    const innerR = Math.max(0, baseR - wallThickness);
    const row: number[] = [];
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      row.push(addVertex(Math.cos(theta) * innerR, y, Math.sin(theta) * innerR));
    }
    innerVertices.push(row);
  }

  const holeBottomVertices: number[] = [];
  const holeTopVertices: number[] = [];
  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    holeBottomVertices.push(addVertex(Math.cos(theta) * drainageHoleRadius, 0, Math.sin(theta) * drainageHoleRadius));
    holeTopVertices.push(addVertex(Math.cos(theta) * drainageHoleRadius, bottomThickness, Math.sin(theta) * drainageHoleRadius));
  }

  // Winding helpers
  const addTri = (a: number, b: number, c: number) => indices.push(a, b, c);
  
  const addQuad = (v0: number, v1: number, v2: number, v3: number, flip = false) => {
    // v0: BL, v1: BR, v2: TL, v3: TR
    if (flip) {
      addTri(v0, v2, v1);
      addTri(v2, v3, v1);
    } else {
      addTri(v0, v1, v3);
      addTri(v0, v3, v2);
    }
  };

  // 1. Outer Shell (Facing OUT)
  for (let i = 0; i < heightSegments; i++) {
    for (let j = 0; j < segments; j++) {
      addQuad(outerVertices[i][j], outerVertices[i][j + 1], outerVertices[i + 1][j], outerVertices[i + 1][j + 1]);
    }
  }

  // 2. Inner Shell (Facing IN)
  for (let i = 0; i < heightSegments; i++) {
    for (let j = 0; j < segments; j++) {
      addQuad(innerVertices[i][j], innerVertices[i][j + 1], innerVertices[i + 1][j], innerVertices[i + 1][j + 1], true);
    }
  }

  // 3. Rim (Facing UP)
  for (let j = 0; j < segments; j++) {
    addQuad(outerVertices[heightSegments][j], outerVertices[heightSegments][j + 1], innerVertices[heightSegments][j], innerVertices[heightSegments][j + 1], true);
  }

  // 4. Bottom Face (Facing DOWN)
  for (let j = 0; j < segments; j++) {
    addQuad(outerVertices[0][j], outerVertices[0][j + 1], holeBottomVertices[j], holeBottomVertices[j + 1], true);
  }

  // 5. Inner Floor (Facing UP)
  for (let j = 0; j < segments; j++) {
    addQuad(innerVertices[0][j], innerVertices[0][j + 1], holeTopVertices[j], holeTopVertices[j + 1]);
  }

  // 6. Hole Wall (Facing IN)
  for (let j = 0; j < segments; j++) {
    addQuad(holeBottomVertices[j], holeBottomVertices[j + 1], holeTopVertices[j], holeTopVertices[j + 1]);
  }

  let geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  
  // Merge vertices to ensure manifold mesh
  geometry = BufferGeometryUtils.mergeVertices(geometry);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Calculates the volume of a closed BufferGeometry in cubic millimeters.
 * Uses the signed volume of tetrahedra method.
 */
export function calculateVolume(geometry: THREE.BufferGeometry): number {
  let volume = 0;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      vA.fromBufferAttribute(position, index.getX(i));
      vB.fromBufferAttribute(position, index.getX(i + 1));
      vC.fromBufferAttribute(position, index.getX(i + 2));
      volume += vA.dot(vB.cross(vC)) / 6.0;
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      vA.fromBufferAttribute(position, i);
      vB.fromBufferAttribute(position, i + 1);
      vC.fromBufferAttribute(position, i + 2);
      volume += vA.dot(vB.cross(vC)) / 6.0;
    }
  }

  return Math.abs(volume);
}

export function buildAttachmentBridge(attachment: Attachment, params: PotParameters): THREE.BufferGeometry {
  const { height, bottomRadius, topRadius, wallThickness, shapeProfile } = params;
  const t = attachment.heightPos;
  const y = t * height;
  const baseR = getBaseRadius(attachment.heightPos, bottomRadius, topRadius, shapeProfile);
  
  // Calculate local slope for shearing the bridge to match the wall taper
  const delta = 0.01;
  const t1 = Math.max(0, t - delta);
  const t2 = Math.min(1, t + delta);
  const r1 = getBaseRadius(t1, bottomRadius, topRadius, shapeProfile);
  const r2 = getBaseRadius(t2, bottomRadius, topRadius, shapeProfile);
  const slope = (r2 - r1) / ((t2 - t1) * height);

  // The bridge starts at the clip (baseR + distanceOffset)
  // and ends exactly at the inner wall (baseR - wallThickness)
  const startR = baseR + attachment.distanceOffset;
  const endR = baseR - wallThickness; 
  const depth = Math.max(0.1, Math.abs(startR - endR));
  const centerR = (startR + endR) / 2;
  
  const bridgeGeom = new THREE.BoxGeometry(attachment.mountingWidth, attachment.mountingHeight, depth);
  
  // Apply custom deformations for one-sided angle and 45-degree support
  const position = bridgeGeom.attributes.position;
  const halfDepth = depth / 2;
  const totalSlope = slope + Math.tan(attachment.tilt || 0);

  for (let i = 0; i < position.count; i++) {
    let px = position.getX(i);
    let py = position.getY(i);
    let pz = position.getZ(i);

    // t_z is 0 at the outer edge (clip) and 1 at the inner edge (pot)
    const t_z = (halfDepth - pz) / depth;

    // 1. One-sided angle: Shear only increases towards the pot side
    // This keeps the clip-side face perfectly vertical
    pz += t_z * py * totalSlope;

    // 2. 45-degree printing support: Drop the bottom face as it approaches the pot
    if (py < 0) {
      // We drop the Y coordinate by the distance from the outer edge
      // This creates a 45-degree ramp for support-less printing
      py -= t_z * depth;
    }

    position.setXYZ(i, px, py, pz);
  }
  
  position.needsUpdate = true;
  bridgeGeom.computeVertexNormals();

  // Position and rotate
  bridgeGeom.translate(0, 0, centerR);
  bridgeGeom.rotateY(-attachment.angle + Math.PI / 2);
  bridgeGeom.translate(0, y, 0);
  
  return bridgeGeom;
}


