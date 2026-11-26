import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { classOfColor, classOfName, writeCurvature, writeMaterialClasses } from "../../../src/ui/viewport3d/landmarkFinish";

describe("landmark finish classes", () => {
  it("reads a material's name for its class", () => {
    expect(classOfName("Marble_White")).toBe(1);
    expect(classOfName("brick_red")).toBe(2);
    expect(classOfName("Verdigris_Copper")).toBe(3);
    expect(classOfName("Lacquered_Timber")).toBe(4);
    expect(classOfName("Gold_Dial")).toBe(5);
    expect(classOfName("Material.001")).toBeNull();
  });
  it("falls back to the colour signature", () => {
    expect(classOfColor(0.92, 0.9, 0.86)).toBe(1);
    expect(classOfColor(0.6, 0.32, 0.25)).toBe(2);
    expect(classOfColor(0.35, 0.55, 0.5)).toBe(3);
    expect(classOfColor(0.8, 0.2, 0.1)).toBe(4);
    expect(classOfColor(0.85, 0.7, 0.25)).toBe(5);
    expect(classOfColor(0.3, 0.3, 0.32)).toBe(3);
  });
  it("writes a class a vertex, and leaves other models with none", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 3).fill(0.9), 3));
    writeMaterialClasses(geometry, null);
    expect(new Set(Array.from(geometry.getAttribute("aMat").array))).toEqual(new Set([1]));
    const plain = new THREE.BoxGeometry(1, 1, 1);
    expect(plain.getAttribute("aMat")).toBeUndefined();
  });
});

describe("landmark curvature", () => {
  const tri = (a: number[], b: number[], c: number[]) => [...a, ...b, ...c];
  function geometryOf(points: number[]): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
    return geometry;
  }
  it("marks a ridge negative, a recess positive, and a plane zero", () => {
    // Two faces meeting along an edge at the origin, folded up (a recess, a V) or down (a ridge, a roof).
    const recess = geometryOf([...tri([0, 0, 0], [1, 0, 0], [0.5, 1, 0]), ...tri([0, 0, 0], [0.5, -1, 1], [1, 0, 0])]);
    writeCurvature(recess);
    const ridge = geometryOf([...tri([0, 0, 0], [1, 0, 0], [0.5, 1, 0]), ...tri([0, 0, 0], [0.5, -1, -1], [1, 0, 0])]);
    writeCurvature(ridge);
    const plane = geometryOf([...tri([0, 0, 0], [1, 0, 0], [0.5, 1, 0]), ...tri([0, 0, 0], [0.5, -1, 0], [1, 0, 0])]);
    writeCurvature(plane);
    const at = (g: THREE.BufferGeometry) => g.getAttribute("aCurve").getX(0);
    expect(at(plane)).toBeCloseTo(0, 6);
    expect(at(recess) * at(ridge)).toBeLessThan(0);
    expect(Math.abs(at(recess))).toBeGreaterThan(0.2);
  });
});
