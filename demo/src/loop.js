// src/loop.js — the per-frame update (light flicker, dread pulse) and render.
import * as THREE from 'three';

export function startLoop({ renderer, scene, camera, rig }) {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    rig.lamp.intensity = 30 + Math.sin(t * 13) * 3 + (Math.random() < 0.04 ? -16 : 0);   // emergency-light flicker
    rig.dread.intensity = 8 + Math.sin(t * 1.7) * 3;                                      // slow dread pulse
    renderer.render(scene, camera);
  });
}
