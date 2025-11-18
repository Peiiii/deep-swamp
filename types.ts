
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
  scale: number;
}

export type PlantType = 'ribbon' | 'stalk' | 'bulb';

export interface Plant {
  id: number;
  type: PlantType;
  x: number; // Root X position in 3D space
  z: number; // Root Z position in 3D space
  yBase: number;
  height: number;
  width: number;
  colorHue: number;
  segments: number;
  phaseOffset: number;
  stiffness: number;
}

export interface Particle {
  x: number;
  y: number;
  z: number;
  radius: number;
  speedX: number;
  speedY: number;
  alpha: number;
  glow: boolean;
}

export interface Fish {
  id: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  size: number;
  hue: number;
  tailPhase: number;
  targetY: number; // For smooth wandering
  targetX: number; // Add targetX for AI wandering
  targetZ: number; // Add targetZ for AI wandering
}

export interface Crab {
  id: number;
  x: number;
  y: number; // Floor height
  z: number;
  size: number;
  walkPhase: number;
  targetX: number;
  targetZ: number;
  speed: number;
  state: 'idle' | 'walking';
  idleTimer: number;
}

export interface Chunk {
  id: string;
  xIndex: number;
  zIndex: number;
  plants: Plant[];
  fishes: Fish[];
  crabs: Crab[];
}

export interface Hologram {
  id: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  image: HTMLImageElement;
  opacity: number;
}
