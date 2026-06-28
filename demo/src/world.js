// src/world.js — static environment: floor, concourse grid, pillars, crates.
import * as THREE from 'three';

export function buildWorld(scene) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x14141b, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  const grid = new THREE.GridHelper(60, 60, 0x2a2a3a, 0x16161f);   // mall-concourse tiling
  grid.position.y = 0.01; scene.add(grid);

  // storefront pillars flanking a central concourse
  const pillarGeo = new THREE.BoxGeometry(1.1, 6, 1.1);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1b1b24, roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    for (const x of [-5.5, 5.5]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(x, 3, -2 - i * 5); p.castShadow = true; p.receiveShadow = true; scene.add(p);
    }
  }

  // a couple of toppled crates near the survivor
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 1 });
  for (const [x, z, ry] of [[-1.6, 2.2, 0.4], [1.8, 1.0, -0.7]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), crateMat);
    c.position.set(x, 0.45, z); c.rotation.y = ry; c.castShadow = true; c.receiveShadow = true; scene.add(c);
  }
}
