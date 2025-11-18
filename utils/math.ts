
import { Point3D, Point2D } from '../types';

// Default, can be overridden
export const DEFAULT_FOCAL_LENGTH = 800;

export const project3DTo2D = (
  point: Point3D,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  centerX: number,
  centerY: number,
  focalLength: number = DEFAULT_FOCAL_LENGTH
): Point2D => {
  const x = point.x - cameraX;
  const y = point.y - cameraY;
  const z = point.z - cameraZ;

  // Prevent division by zero or negative scale behind camera
  // We clip slightly in front of the camera (z + focalLength > 0 usually, but here z is relative)
  // Standard perspective projection: scale = focal / (focal + z) or focal / z depending on system.
  // Here we assume camera is at 0, looking at +Z or -Z.
  // Based on previous logic: depth = z + focalLength implies camera is at z = -focalLength relative to object?
  // Let's stick to the previous working formula but parameterize focal length.
  
  const depth = Math.max(1, z + focalLength); 
  const scale = focalLength / depth;

  return {
    x: centerX + x * scale,
    y: centerY + y * scale,
    scale: scale,
  };
};

export const randomRange = (min: number, max: number) => {
  return Math.random() * (max - min) + min;
};

export const mapRange = (value: number, inMin: number, inMax: number, outMin: number, outMax: number) => {
  return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
};
