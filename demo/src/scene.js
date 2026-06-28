// src/scene.js — renderer, scene, and camera (the moody PSX dead-mall look).
import * as THREE from 'three';

export const renderer = new THREE.WebGLRenderer({ antialias: false });   // hard PSX edges
renderer.setPixelRatio(0.75);                                            // render low, scale up = chunky pixels
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070b);
scene.fog = new THREE.Fog(0x0a0a12, 5, 30);

export const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(1.2, 2.3, 9.8);
camera.lookAt(0.2, 1.05, -3);

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
