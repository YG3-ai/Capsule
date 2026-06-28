// src/lights.js — the lighting rig. Returns the animatable lights for the loop.
import * as THREE from 'three';

export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0x4a5a82, 0x06070c, 1.0));   // cold ambient

  const moon = new THREE.DirectionalLight(0x9db4dc, 0.8);          // cold rim
  moon.position.set(-8, 12, -6); moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048); moon.shadow.camera.far = 40;
  scene.add(moon);

  const fill = new THREE.DirectionalLight(0xbfd0ff, 0.95);         // soft frontal fill (faces read)
  fill.position.set(2, 4, 11); scene.add(fill);

  const lamp = new THREE.PointLight(0xffb066, 34, 22, 2);          // flickering emergency light
  lamp.position.set(0.5, 3.8, 4.5); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024);
  scene.add(lamp);

  const dread = new THREE.PointLight(0xff2a2a, 14, 16, 2);         // red menace, deep in the mall
  dread.position.set(1.6, 2.2, -10); scene.add(dread);

  return { lamp, dread };
}
